package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"douyin-server/internal/bot"
)

func (s *Server) botManager() (*bot.Manager, bool) {
	if s.bots == nil {
		return nil, false
	}
	return s.bots, true
}

// botStatus GET /api/v1/bots/status
func (s *Server) botStatus(w http.ResponseWriter, _ *http.Request) {
	m, ok := s.botManager()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "BOTS_DISABLED", "机器人未启用")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"channels": m.Status(),
		"push":     m.PushEnabled(),
	})
}

// botStart POST /api/v1/bots/{name}/start
func (s *Server) botStart(w http.ResponseWriter, r *http.Request) {
	m, ok := s.botManager()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "BOTS_DISABLED", "机器人未启用")
		return
	}
	name := r.PathValue("name")
	if name != "weixin" && name != "qq" {
		badRequest(w, "通道只能是 weixin 或 qq")
		return
	}
	if err := m.Start(r.Context(), name); err != nil {
		writeError(w, http.StatusBadRequest, "START_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

// botStop POST /api/v1/bots/{name}/stop
func (s *Server) botStop(w http.ResponseWriter, r *http.Request) {
	m, ok := s.botManager()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "BOTS_DISABLED", "机器人未启用")
		return
	}
	name := r.PathValue("name")
	if name != "weixin" && name != "qq" {
		badRequest(w, "通道只能是 weixin 或 qq")
		return
	}
	if err := m.Stop(name); err != nil {
		writeError(w, http.StatusBadRequest, "STOP_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

// botSetPush POST /api/v1/bots/push  {"enabled": true}
func (s *Server) botSetPush(w http.ResponseWriter, r *http.Request) {
	m, ok := s.botManager()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "BOTS_DISABLED", "机器人未启用")
		return
	}
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "请求体不是合法 JSON")
		return
	}
	m.SetPush(req.Enabled)
	writeJSON(w, http.StatusOK, map[string]any{"push": req.Enabled})
}

// botMessages GET /api/v1/bots/messages?limit=50
func (s *Server) botMessages(w http.ResponseWriter, r *http.Request) {
	m, ok := s.botManager()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "BOTS_DISABLED", "机器人未启用")
		return
	}
	limit := queryInt(r.URL.Query().Get("limit"), 50)
	writeJSON(w, http.StatusOK, m.RecentMessages(limit))
}

// botParse POST /api/v1/bots/parse  {"text":"柚子 9月"}
//
// 只做意图解析、不真的发消息。用来验收"群里这句话会怎么被理解"，
// 不用连真实账号也能查——这也是本机没 MySQL/没凭据时唯一能验证的部分。
func (s *Server) botParse(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text   string `json:"text"`
		Now    string `json:"now"` // 可选，ISO 日期，便于回放历史说法
		Handle bool   `json:"handle"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "请求体不是合法 JSON")
		return
	}
	if req.Text == "" {
		badRequest(w, "text 不能为空")
		return
	}

	now := time.Now()
	if req.Now != "" {
		if t, err := time.ParseInLocation(isoDate, req.Now, time.Local); err == nil {
			now = t
		}
	}

	intent := bot.ParseIntent(req.Text, now)
	result := map[string]any{
		"input":  req.Text,
		"intent": intent,
	}

	// handle=true 时真的走一遍技能路由，产出回复（可能需要数据库）
	if req.Handle {
		m, ok := s.botManager()
		if !ok {
			writeError(w, http.StatusServiceUnavailable, "BOTS_DISABLED", "机器人未启用")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		out, err := m.Handle(ctx, bot.Inbound{
			Channel: "web", ConversationID: "debug", SenderID: "web",
			Text: req.Text, AtMe: true, ReceivedAt: now,
		})
		if err != nil {
			internalError(w, err)
			return
		}
		result["reply"] = map[string]any{
			"text":      out.Text,
			"hasImage":  len(out.Image) > 0,
			"imageName": out.ImageName,
		}
	}

	writeJSON(w, http.StatusOK, result)
}
