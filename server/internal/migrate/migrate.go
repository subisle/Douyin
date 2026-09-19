// Package migrate 提供一个内置的数据库迁移执行器。
//
// 为什么不引 golang-migrate：目标是单二进制部署到 RK3318 arm64 容器，
// 不想再带一个 CLI 或一坨 driver 依赖。迁移文件仍是标准 .sql，
// 随时可以原样交给 golang-migrate / Flyway 接管，不会被锁死。
package migrate

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/jmoiron/sqlx"
)

//go:embed migrations/*.up.sql
var migrations embed.FS

const migrationsDir = "migrations"

// Run 按文件名顺序执行尚未应用过的迁移。每个文件在自己的事务里跑，
// 失败则整体回滚并留下版本号为空，下次启动会重试。
func Run(ctx context.Context, db *sqlx.DB) (applied []string, err error) {
	// 表名带 server 后缀：Electron 的 migration-runner 也用 schema_migrations，
	// 但它的表多了 name/checksum 两个 NOT NULL 列，且两边迁移文件完全不同
	// （JS vs SQL）。共用一张表会互相插坏记录，各记各的账。
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations_server (
		version    VARCHAR(255) NOT NULL PRIMARY KEY,
		applied_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`); err != nil {
		return nil, fmt.Errorf("创建 schema_migrations: %w", err)
	}

	entries, err := fs.ReadDir(migrations, migrationsDir)
	if err != nil {
		return nil, fmt.Errorf("读取迁移目录: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".up.sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var count int
		if err := db.QueryRowxContext(ctx,
			"SELECT COUNT(*) FROM schema_migrations_server WHERE version = ?", name,
		).Scan(&count); err != nil {
			return applied, fmt.Errorf("检查迁移状态 %s: %w", name, err)
		}
		if count > 0 {
			continue
		}

		raw, err := fs.ReadFile(migrations, migrationsDir+"/"+name)
		if err != nil {
			return applied, fmt.Errorf("读取迁移文件 %s: %w", name, err)
		}
		stmts := splitStatements(string(raw))
		if len(stmts) == 0 {
			continue
		}

		if err := applyFile(ctx, db, name, stmts); err != nil {
			return applied, err
		}
		applied = append(applied, name)
	}
	return applied, nil
}

func applyFile(ctx context.Context, db *sqlx.DB, name string, stmts []string) error {
	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("开启事务(%s): %w", name, err)
	}
	defer func() { _ = tx.Rollback() }()

	for _, stmt := range stmts {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("执行迁移 %s 失败: %w\n语句: %s", name, err, truncate(stmt, 200))
		}
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO schema_migrations_server (version) VALUES (?)", name); err != nil {
		return fmt.Errorf("记录迁移版本 %s: %w", name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("提交迁移 %s: %w", name, err)
	}
	return nil
}

// splitStatements 按分号拆分 SQL。
// 迁移里不用 DELIMITER、不含存储过程，这种朴素切法够用且比引一个 SQL parser 轻。
func splitStatements(content string) []string {
	var stmts []string
	var buf strings.Builder
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}
		buf.WriteString(trimmed)
		buf.WriteByte('\n')
		if strings.HasSuffix(trimmed, ";") {
			stmt := strings.TrimSuffix(strings.TrimSpace(buf.String()), ";")
			if stmt != "" {
				stmts = append(stmts, stmt)
			}
			buf.Reset()
		}
	}
	if tail := strings.TrimSpace(buf.String()); tail != "" {
		stmts = append(stmts, strings.TrimSuffix(tail, ";"))
	}
	return stmts
}

func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
