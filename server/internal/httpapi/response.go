// Package httpapi 是 REST 接口层：只做参数校验、调用 repo、序列化结果。
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type envelope struct {
	Data  any      `json:"data,omitempty"`
	Error *apiError `json:"error,omitempty"`
}

// writeJSON 统一成功响应体。前端只需要认 data 字段。
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if data == nil {
		data = map[string]any{"ok": true}
	}
	if err := json.NewEncoder(w).Encode(envelope{Data: data}); err != nil {
		slog.Error("写出响应失败", "err", err)
	}
}

// writeError 统一错误响应体。code 给程序读，message 给人读。
func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Error: &apiError{Code: code, Message: message}})
}

func badRequest(w http.ResponseWriter, message string) {
	writeError(w, http.StatusBadRequest, "BAD_REQUEST", message)
}

func notFound(w http.ResponseWriter, message string) {
	writeError(w, http.StatusNotFound, "NOT_FOUND", message)
}

func internalError(w http.ResponseWriter, err error) {
	slog.Error("处理请求失败", "err", err)
	writeError(w, http.StatusInternalServerError, "INTERNAL", "服务内部错误")
}
