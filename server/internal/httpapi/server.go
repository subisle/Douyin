package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"douyin-server/internal/config"
	"douyin-server/internal/repo"
)

// Server 持有依赖与路由。
type Server struct {
	repo   *repo.Repo
	cfg    config.Config
	log    *slog.Logger
	mux    *http.ServeMux
	bootAt time.Time
}

// New 注册全部路由。
func New(r *repo.Repo, cfg config.Config, log *slog.Logger) *Server {
	s := &Server{repo: r, cfg: cfg, log: log, mux: http.NewServeMux(), bootAt: time.Now()}

	// 健康检查不进业务栈，探针要能在 DB 挂掉时仍然区分出存活与就绪。
	s.mux.HandleFunc("GET /healthz", s.handleHealth)
	s.mux.HandleFunc("GET /readyz", s.handleReady)

	s.mux.HandleFunc("GET /api/v1/persons", s.listPersons)
	s.mux.HandleFunc("POST /api/v1/persons", s.createPerson)
	s.mux.HandleFunc("GET /api/v1/persons/{id}", s.getPerson)
	s.mux.HandleFunc("PATCH /api/v1/persons/{id}", s.updatePerson)
	s.mux.HandleFunc("DELETE /api/v1/persons/{id}", s.deletePerson)
	s.mux.HandleFunc("GET /api/v1/persons/{id}/accounts", s.listAccounts)
	s.mux.HandleFunc("POST /api/v1/persons/{id}/accounts", s.bindAccount)

	s.mux.HandleFunc("GET /api/v1/metrics/daily", s.dailyMetrics)
	s.mux.HandleFunc("GET /api/v1/metrics/monthly", s.monthlyMetrics)
	s.mux.HandleFunc("GET /api/v1/metrics/yearly", s.yearlyMetrics)

	s.mux.HandleFunc("POST /api/v1/imports/snapshots", s.importSnapshots)
	s.mux.HandleFunc("POST /api/v1/imports/recompute", s.recompute)

	return s
}

// ServeStatic 把前端构建产物挂在根路径，用于单容器部署。
// 带 SPA 回退：找不到静态文件时返回 index.html，否则刷新子路由会 404。
func (s *Server) ServeStatic(dir string) {
	fs := http.FileServer(http.Dir(dir))
	s.mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			if _, err := os.Stat(filepath.Join(dir, filepath.Clean(r.URL.Path))); err != nil {
				http.ServeFile(w, r, filepath.Join(dir, "index.html"))
				return
			}
		}
		fs.ServeHTTP(w, r)
	}))
}

// Handler 返回带日志、恢复、CORS 的完整中间件栈。
func (s *Server) Handler() http.Handler {
	var h http.Handler = s.mux
	h = cors(h)
	h = recoverer(s.log, h)
	return h
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"uptime": time.Since(s.bootAt).String(),
	})
}

// handleReady 会真的打一次数据库，DB 不就绪时不该接流量。
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.repo.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "DB_DOWN", "数据库不可用")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

// cors 允许本地前端跨域。生产是同一个域名下的反代，这里放开是为了开发方便。
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// recoverer 兜住 panic，避免一个 handler 崩掉整个进程。
func recoverer(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Error("请求处理 panic", "path", r.URL.Path, "panic", rec)
				writeError(w, http.StatusInternalServerError, "PANIC", "服务内部错误")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// isNotFound 统一判断领域层的"没找到"。
func isNotFound(err error) bool {
	return errors.Is(err, repo.ErrNotFound)
}
