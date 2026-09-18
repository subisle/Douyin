// Package store 负责数据库连接池的生命周期。
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	// MySQL 驱动，只用它的 init() 注册。
	_ "github.com/go-sql-driver/mysql"

	"douyin-server/internal/config"
)

// Open 建立连接池并验证连通性。池参数按盒子上的内存预算调小，
// 一个 MySQL 实例扛 20 条连接对这个数据量绰绰有余。
func Open(cfg config.DB) (*sqlx.DB, error) {
	db, err := sqlx.Open("mysql", cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("初始化 MySQL 驱动: %w", err)
	}

	db.SetMaxOpenConns(cfg.MaxOpenConns)
	db.SetMaxIdleConns(cfg.MaxIdleConns)
	db.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	db.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("连接 MySQL %s:%d/%s 失败: %w", cfg.Host, cfg.Port, cfg.Name, err)
	}
	return db, nil
}
