package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jmoiron/sqlx"
)

// Ping 做一次真实的连通性检查，供 /readyz 使用。
func (r *Repo) Ping(ctx context.Context) error {
	return r.db.PingContext(ctx)
}

// sqlxIn 展开 IN (?) 占位符。手写拼接有注入风险，必须用 sqlx.In。
// 注意：整个 slice 作为**单个**参数传给 sqlx.In，不要展开。
func sqlxIn(query string, ids []string) (string, []any, error) {
	q, args, err := sqlx.In(query, ids)
	if err != nil {
		return "", nil, fmt.Errorf("展开 IN 子句: %w", err)
	}
	return q, args, nil
}

// translateNotFound 把 sql.ErrNoRows 翻译成领域错误，其余原样包装。
// 这样 HTTP 层能干净地区分「没找到」和「数据库炸了」。
func translateNotFound(err error, action string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return fmt.Errorf("%s: %w", action, err)
}

// ensureAffected 保证写操作确实命中了行，避免"更新了一个不存在的 ID"被当成成功。
func ensureAffected(res sql.Result, action string) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s: 读取影响行数失败: %w", action, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
