package qq

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"douyin-server/internal/bot"
)

// Handler 处理入站消息，由 bot.Manager 实现。
type Handler interface {
	Handle(ctx context.Context, in bot.Inbound) (bot.Outbound, error)
}

// 官方要求的重连码，收到就该断开重连（换 gateway 地址）
const (
	opDispatch     = 0
	opHeartbeat    = 1
	opIdentify     = 2
	opResume       = 6
	opReconnect    = 7
	opInvalidSess  = 9
	opHello        = 10
	opHeartbeatACK = 11
)

// sessionCtx 回复一条消息所需的信息。
// QQ 的被动回复必须带 msg_id，而且窗口只有几分钟，所以收到就记下来。
type sessionCtx struct {
	groupOpenID string
	userOpenID  string
	msgID       string
	at          time.Time
}

// Transport 实现 bot.Transport。
type Transport struct {
	handler Handler
	client  *Client
	appID   string

	mu        sync.RWMutex
	running   bool
	connected bool
	phase     string
	note      string
	msgCount  int
	lastText  string
	seq       int64

	sessions map[string]sessionCtx
	inbox    chan bot.Inbound
	cancel   context.CancelFunc
}

// New 构造 Transport。
func New(handler Handler, appID, clientSecret, apiBase string) *Transport {
	return &Transport{
		handler:  handler,
		client:   NewClient(appID, clientSecret, apiBase),
		appID:    appID,
		phase:    "idle",
		sessions: map[string]sessionCtx{},
		inbox:    make(chan bot.Inbound, 32),
	}
}

// Name 实现 bot.Transport。
func (t *Transport) Name() string { return "qq" }

// Receive 实现 bot.Transport。
func (t *Transport) Receive() <-chan bot.Inbound { return t.inbox }

// Close 实现 bot.Transport。
func (t *Transport) Close() error {
	t.mu.Lock()
	cancel := t.cancel
	t.cancel = nil
	t.running = false
	t.connected = false
	t.phase = "idle"
	t.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

// Start 建立 WebSocket 连接并开始收事件。
func (t *Transport) Start(ctx context.Context) error {
	t.mu.Lock()
	if t.running {
		t.mu.Unlock()
		return nil
	}
	if t.appID == "" {
		t.mu.Unlock()
		return errors.New("请先在设置里填写 QQ 机器人 AppID")
	}
	// 不能用调用方的 ctx：HTTP handler 传进来的是 r.Context()，
	// start 接口一返回它就被取消，WS 会在后台静默死亡。
	runCtx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	t.running = true
	t.phase = "connecting"
	t.mu.Unlock()

	go t.connectLoop(runCtx)
	return nil
}

// connectLoop 断了就重连。官方要求收到 op 7/9 时换地址重连，这里统一按退避重连处理。
func (t *Transport) connectLoop(ctx context.Context) {
	backoff := 3 * time.Second
	for ctx.Err() == nil {
		err := t.runOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			t.setPhase("error", err.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 60*time.Second {
			backoff *= 2
		}
	}
}

// runOnce 跑一轮连接：取 gateway → 握手 → identify → 收事件。
func (t *Transport) runOnce(ctx context.Context) error {
	gateway, err := t.client.Gateway(ctx)
	if err != nil {
		return err
	}
	token, err := t.client.EnsureToken(ctx)
	if err != nil {
		return err
	}

	conn, resp, err := websocket.DefaultDialer.DialContext(ctx, gateway, nil)
	if err != nil {
		if resp != nil {
			return fmt.Errorf("连接 QQ gateway 失败（HTTP %d）: %w", resp.StatusCode, err)
		}
		return fmt.Errorf("连接 QQ gateway 失败: %w", err)
	}
	defer func() { _ = conn.Close() }()

	// 等 HELLO，拿心跳间隔
	heartbeat := 30 * time.Second
	{
		_ = conn.SetReadDeadline(time.Now().Add(20 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("读取 HELLO 失败: %w", err)
		}
		var hello struct {
			Op int `json:"op"`
			D  struct {
				HeartbeatInterval int `json:"heartbeat_interval"`
			} `json:"d"`
		}
		if err := json.Unmarshal(raw, &hello); err != nil {
			return fmt.Errorf("解析 HELLO 失败: %w", err)
		}
		if hello.Op != opHello {
			return fmt.Errorf("QQ gateway 首帧不是 HELLO（op=%d）", hello.Op)
		}
		if hello.D.HeartbeatInterval > 0 {
			heartbeat = time.Duration(hello.D.HeartbeatInterval) * time.Millisecond
		}
	}

	// identify
	identify := map[string]any{
		"op": opIdentify,
		"d": map[string]any{
			"token":   "QQBot " + token,
			"intents": IntentGroupAndC2C,
			"shard":   []int{0, 1},
		},
	}
	if err := conn.WriteJSON(identify); err != nil {
		return fmt.Errorf("发送 identify 失败: %w", err)
	}

	t.setPhase("ready", "")
	stopHeartbeat := make(chan struct{})
	defer close(stopHeartbeat)
	go t.heartbeatLoop(ctx, conn, heartbeat, stopHeartbeat)

	for {
		if ctx.Err() != nil {
			return nil
		}
		_ = conn.SetReadDeadline(time.Now().Add(heartbeat * 3))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("QQ 连接断开: %w", err)
		}

		var frame struct {
			Op int             `json:"op"`
			T  string          `json:"t"`
			S  int64           `json:"s"`
			D  json.RawMessage `json:"d"`
		}
		if err := json.Unmarshal(raw, &frame); err != nil {
			continue
		}
		if frame.S > 0 {
			t.mu.Lock()
			t.seq = frame.S
			t.mu.Unlock()
		}

		switch frame.Op {
		case opDispatch:
			t.handleDispatch(ctx, frame.T, frame.D)
		case opReconnect:
			return errors.New("QQ 要求重连")
		case opInvalidSess:
			return errors.New("QQ 会话失效，需要重新 identify")
		}
	}
}

func (t *Transport) heartbeatLoop(ctx context.Context, conn *websocket.Conn,
	interval time.Duration, stop <-chan struct{}) {

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-stop:
			return
		case <-ticker.C:
			t.mu.RLock()
			seq := t.seq
			t.mu.RUnlock()
			if err := conn.WriteJSON(map[string]any{"op": opHeartbeat, "d": seq}); err != nil {
				return
			}
		}
	}
}

// dispatchData 群/私聊消息的事件体。
type dispatchData struct {
	ID          string `json:"id"` // 消息 id，被动回复要带
	Content     string `json:"content"`
	GroupOpenID string `json:"group_openid"`
	Author      struct {
		ID         string `json:"id"`
		UserOpenID string `json:"user_openid"`
	} `json:"author"`
}

// handleDispatch 处理事件。只关心群 @ 和私聊两种。
func (t *Transport) handleDispatch(ctx context.Context, eventType string, raw json.RawMessage) {
	var d dispatchData
	if err := json.Unmarshal(raw, &d); err != nil {
		t.setNote("解析事件失败: " + err.Error())
		return
	}

	isGroup := eventType == "GROUP_AT_MESSAGE_CREATE" || d.GroupOpenID != ""
	isC2C := eventType == "C2C_MESSAGE_CREATE" ||
		(!isGroup && (d.Author.UserOpenID != "" || d.Author.ID != ""))
	if !isGroup && !isC2C {
		return
	}

	conversationID := d.GroupOpenID
	if !isGroup {
		conversationID = d.Author.UserOpenID
		if conversationID == "" {
			conversationID = d.Author.ID
		}
	}
	if conversationID == "" {
		return
	}

	t.mu.Lock()
	t.sessions[conversationID] = sessionCtx{
		groupOpenID: d.GroupOpenID,
		userOpenID:  d.Author.UserOpenID,
		msgID:       d.ID,
		at:          time.Now(),
	}
	t.msgCount++
	t.lastText = d.Content
	t.mu.Unlock()

	if d.Content == "" {
		return
	}

	out, err := t.handler.Handle(ctx, bot.Inbound{
		Channel:        t.Name(),
		ConversationID: conversationID,
		SenderID:       conversationID,
		Text:           d.Content,
		AtMe:           true,
		ReceivedAt:     time.Now(),
	})
	if err != nil {
		t.setNote("处理消息失败: " + err.Error())
		return
	}
	if err := t.Send(ctx, out); err != nil {
		t.setNote("发送失败: " + err.Error())
	}
}

// Send 实现 bot.Transport。QQ 的图片要先走 /files 上传拿 file_info，
// 再用 msg_type=7 发；这一步待接入，当前先回文本。
func (t *Transport) Send(ctx context.Context, out bot.Outbound) error {
	t.mu.RLock()
	sc, ok := t.sessions[out.ConversationID]
	t.mu.RUnlock()
	if !ok {
		return fmt.Errorf("找不到会话 %s 的回复上下文", out.ConversationID)
	}

	text := out.Text
	if len(out.Image) > 0 {
		text = text + "\n（图片发送待接入 /files 上传流程）"
	}

	// 被动回复窗口只有几分钟，过期后就别带 msg_id 了（变成主动消息有频率限制）
	msgID := sc.msgID
	if time.Since(sc.at) > 4*time.Minute {
		msgID = ""
	}

	if sc.groupOpenID != "" {
		return t.client.SendToGroup(ctx, sc.groupOpenID, text, msgID, 0)
	}
	return t.client.SendToUser(ctx, sc.userOpenID, text, msgID, 0)
}

// Detail 前端展示状态。
type Detail struct {
	Phase      string `json:"phase"`
	Note       string `json:"note,omitempty"`
	MessageNum int    `json:"messageCount"`
	LastText   string `json:"lastMessage,omitempty"`
	HasCred    bool   `json:"hasCredentials"`
	Connected  bool   `json:"connected"`
}

// Connected 实时连接状态。Manager 汇总 /bots/status 时要用这个，
// 不能用 Start() 返回时的快照——WS 是异步连的，Start 返回 ≠ 已连上。
func (t *Transport) Connected() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.connected
}

// Detail 返回当前状态。
func (t *Transport) Detail() Detail {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return Detail{
		Phase:      t.phase,
		Note:       t.note,
		MessageNum: t.msgCount,
		LastText:   t.lastText,
		HasCred:    t.appID != "",
		Connected:  t.connected,
	}
}

func (t *Transport) setPhase(phase, note string) {
	t.mu.Lock()
	t.phase = phase
	t.note = note
	t.connected = phase == "ready"
	t.mu.Unlock()
}

func (t *Transport) setNote(note string) {
	t.mu.Lock()
	t.note = note
	t.mu.Unlock()
}
