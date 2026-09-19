// Package config 从环境变量加载服务配置。
//
// 之所以不用 viper：部署目标是 RK3318 盒子上的 Docker 容器，
// 环境变量已足够，少一个依赖就少一份交叉编译风险。
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const envPrefix = "DY_"

// DB 描述数据库连接参数。
type DB struct {
	Host     string
	Port     int
	User     string
	Password string
	Name     string

	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration
}

// DSN 组装 MySQL DSN。parseTime 与 loc 必须显式指定，
// 否则时间字段会被当成 UTC 字符串，日榜日期会整体偏移。
func (d DB) DSN() string {
	return fmt.Sprintf(
		"%s:%s@tcp(%s:%d)/%s?parseTime=true&loc=Local&charset=utf8mb4&collation=utf8mb4_unicode_ci",
		d.User, d.Password, d.Host, d.Port, d.Name,
	)
}

// Bots 机器人与 IM 通道配置。
type Bots struct {
	// 微信 iLink：token 来自扫码登录，baseURL 一般不用改
	WeixinToken   string
	WeixinBaseURL string

	// QQ 开放平台：appID + clientSecret 在开放平台后台拿
	QQAppID        string
	QQClientSecret string
	QQAPIBase      string
}

// Config 是服务完整配置。
type Config struct {
	Addr        string
	LogLevel    string
	DB          DB
	Bots        Bots
	AutoMigrate bool
	// WebDir 存在时，/ 会直接托管该目录下的静态文件（用于单容器部署前端产物）。
	WebDir string
}

// Load 读取环境变量并填充默认值。任何非法值都会直接报错，
// 避免带着半截配置启动后在运行时才炸。
func Load() (Config, error) {
	cfg := Config{
		Addr:        envString("ADDR", ":8080"),
		LogLevel:    envString("LOG_LEVEL", "info"),
		AutoMigrate: envBool("AUTO_MIGRATE", true),
		WebDir:      envString("WEB_DIR", ""),
		DB: DB{
			Host:            envString("DB_HOST", "127.0.0.1"),
			Port:            envInt("DB_PORT", 3306),
			User:            envString("DB_USER", "root"),
			Password:        envString("DB_PASSWORD", ""),
			Name:            envString("DB_NAME", "douyin"),
			MaxOpenConns:    envInt("DB_MAX_OPEN", 20),
			MaxIdleConns:    envInt("DB_MAX_IDLE", 5),
			ConnMaxLifetime: envDuration("DB_CONN_MAX_LIFE", 5*time.Minute),
			ConnMaxIdleTime: envDuration("DB_CONN_MAX_IDLE", time.Minute),
		},
		Bots: Bots{
			WeixinToken:    envString("WEIXIN_TOKEN", ""),
			WeixinBaseURL:  envString("WEIXIN_BASE_URL", ""),
			QQAppID:        envString("QQ_APP_ID", ""),
			QQClientSecret: envString("QQ_CLIENT_SECRET", ""),
			QQAPIBase:      envString("QQ_API_BASE", ""),
		},
	}

	if cfg.DB.Port <= 0 || cfg.DB.Port > 65535 {
		return Config{}, fmt.Errorf("DB_PORT 非法: %d", cfg.DB.Port)
	}
	switch cfg.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return Config{}, fmt.Errorf("LOG_LEVEL 非法: %q（可选 debug/info/warn/error）", cfg.LogLevel)
	}
	return cfg, nil
}

func envString(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(envPrefix + key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(envPrefix + key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return v
}

func envBool(key string, fallback bool) bool {
	raw := strings.TrimSpace(os.Getenv(envPrefix + key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return v
}

func envDuration(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(envPrefix + key))
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return d
}
