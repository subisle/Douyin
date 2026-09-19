// 改名 / 改抖音号：两条对话式流程。
//
// 为什么用对话而不是单条消息：改抖音号时一个人可能有多个号，必须让运营
// 挑哪个；改名字靠抖音号定位，要防着把别的主播名字改重。
// 每个会话同时只挂一个待办，10 分钟没下文自动作废。
//
// 入口（照用户的话术设计）：
//
//	改名字 —— 发抖音号（「改名」或直接发一个库里存在的抖音号）
//	改抖音号 —— 发姓名（「改号」或「改号 柚子」）
//
// 任意一步发「取消」放弃。
package bot

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"douyin-server/internal/domain"
)

type opKind string

const (
	opRename   opKind = "rename"   // 发抖音号 → 等新名字
	opRedouyin opKind = "redouyin" // 发姓名 → 选号 → 等新抖音号
)

type pendingOp struct {
	kind        opKind
	step        int // 各流程内部步骤
	personID    uint64
	personName  string
	accountID   uint64 // redouyin：选中要改的账号
	accounts    []domain.Account
	douyinInput string
	expiresAt   time.Time
}

var rePureDouyinNo = regexp.MustCompile(`^[a-zA-Z0-9._]{4,64}$`)
var reNewDouyinNo = regexp.MustCompile(`^[a-zA-Z0-9._]{4,64}$`)

const pendingOpTTL = 90 * time.Second

func (m *Manager) setPendingOp(conv string, op *pendingOp) {
	op.expiresAt = time.Now().Add(pendingOpTTL)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pendingOps == nil {
		m.pendingOps = map[string]*pendingOp{}
	}
	m.pendingOps[conv] = op
}

func (m *Manager) takePendingOp(conv string) *pendingOp {
	m.mu.Lock()
	defer m.mu.Unlock()
	op := m.pendingOps[conv]
	if op == nil {
		return nil
	}
	if time.Now().After(op.expiresAt) {
		delete(m.pendingOps, conv)
		return nil
	}
	return op
}

func (m *Manager) clearPendingOp(conv string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.pendingOps, conv)
}

// handlePendingOp 有待办时消费这条消息。返回 handled=false 则继续走正常意图。
func (m *Manager) handlePendingOp(ctx context.Context, conv, text string) (string, bool) {
	op := m.takePendingOp(conv)
	if op == nil {
		return "", false
	}
	t := strings.TrimSpace(text)
	if t == "取消" || t == "算了" || t == "不了" {
		m.clearPendingOp(conv)
		return "已取消。", true
	}

	switch op.kind {
	case opRename:
		return m.continueRename(ctx, conv, op, t), true
	case opRedouyin:
		return m.continueRedouyin(ctx, conv, op, t), true
	}
	return "", false
}

// ---------- 改名字 ----------

// renameStart 处理「改名 [抖音号]」或裸抖音号。返回 (回复, 是否接管)。
func (m *Manager) renameStart(ctx context.Context, conv, arg string) (string, bool) {
	if arg == "" {
		m.setPendingOp(conv, &pendingOp{kind: opRename, step: 1})
		return "请发送要改名主播的抖音号。", true
	}
	if !rePureDouyinNo.MatchString(arg) {
		return "", false // 不是抖音号的样子，不接管
	}
	return m.renameLocate(ctx, conv, arg)
}

func (m *Manager) renameLocate(ctx context.Context, conv, douyinNo string) (string, bool) {
	acc, err := m.repo.FindAccountByDouyinNo(ctx, douyinNo)
	if err != nil {
		return fmt.Sprintf("库里没有抖音号 %s。要不要直接添加？发「姓名-抖音号」即可。", douyinNo), true
	}
	p, err := m.repo.GetPerson(ctx, acc.PersonID)
	if err != nil {
		return "账号找到了但主播信息读取失败，请稍后再试。", true
	}
	m.setPendingOp(conv, &pendingOp{kind: opRename, step: 2, personID: p.ID, personName: p.Name, accountID: acc.ID})
	return fmt.Sprintf("主播「%s」要改成什么名字？直接回复新名字即可（发送「取消」放弃）。", p.Name), true
}

func (m *Manager) continueRename(ctx context.Context, conv string, op *pendingOp, text string) string {
	if op.step != 2 {
		return "请先发送抖音号。"
	}
	newName := strings.TrimSpace(text)
	if newName == "" || len([]rune(newName)) > 32 || rePureDouyinNo.MatchString(newName) {
		return "名字不合法（不能是纯数字/符号，32 字以内）。请重新回复新名字。"
	}
	// 改成已存在的名字会让按艺名匹配产生歧义，拦下
	if exist, err := m.repo.FindPersonsByName(ctx, newName); err == nil && len(exist) > 0 {
		return fmt.Sprintf("已经有主播叫「%s」了，换一个名字吧（避免 CSV 按艺名匹配时撞名）。", newName)
	}
	if err := m.repo.RenamePerson(ctx, op.personID, newName); err != nil {
		return "改名失败：" + err.Error()
	}
	m.clearPendingOp(conv)
	return fmt.Sprintf("已把主播「%s」改名为「%s」。", op.personName, newName)
}

// ---------- 改抖音号 ----------

// redouyinStart 处理「改号 [姓名]」。返回 (回复, 是否接管)。
func (m *Manager) redouyinStart(ctx context.Context, conv, arg string) (string, bool) {
	if arg == "" {
		m.setPendingOp(conv, &pendingOp{kind: opRedouyin, step: 1})
		return "请发送要改号主播的姓名。", true
	}
	return m.redouyinLocate(ctx, conv, arg)
}

func (m *Manager) redouyinLocate(ctx context.Context, conv, name string) (string, bool) {
	persons, err := m.repo.FindPersonsByName(ctx, name)
	if err != nil {
		return "查询失败，请稍后再试。", true
	}
	if len(persons) == 0 {
		return fmt.Sprintf("库里没有叫「%s」的主播。要新增的话发「姓名-抖音号」。", name), true
	}
	// 库里不会有重名，直接取唯一那条
	p := persons[0]
	accounts, err := m.repo.ListAccounts(ctx, p.ID)
	if err != nil || len(accounts) == 0 {
		return fmt.Sprintf("主播「%s」还没有绑定账号，发「%s-抖音号」直接加一个。", name, name), true
	}
	op := &pendingOp{kind: opRedouyin, personID: p.ID, personName: p.Name, accounts: accounts}
	if len(accounts) == 1 {
		op.step = 3 // 单号不用挑，直接等新号
		m.setPendingOp(conv, op)
		return fmt.Sprintf("主播「%s」当前抖音号 %s。请回复新的抖音号（发送「取消」放弃）。",
			p.Name, accounts[0].DouyinNo), true
	}
	op.step = 2
	m.setPendingOp(conv, op)
	var lines []string
	for i, a := range accounts {
		lines = append(lines, fmt.Sprintf("%d) %s（抖音号 %s）", i+1, a.AnchorID, a.DouyinNo))
	}
	return fmt.Sprintf("主播「%s」有 %d 个号：\n%s\n回复序号选择要改的。",
		p.Name, len(accounts), strings.Join(lines, "\n")), true
}

func (m *Manager) continueRedouyin(ctx context.Context, conv string, op *pendingOp, text string) string {
	switch op.step {
	case 2: // 挑号
		var pick int
		if _, err := fmt.Sscanf(text, "%d", &pick); err != nil || pick < 1 || pick > len(op.accounts) {
			return fmt.Sprintf("回复 1 到 %d 之间的序号选择要改的号。", len(op.accounts))
		}
		op.accountID = op.accounts[pick-1].ID
		op.step = 3
		m.setPendingOp(conv, op)
		return fmt.Sprintf("选中 %s（抖音号 %s）。请回复新的抖音号。",
			op.accounts[pick-1].AnchorID, op.accounts[pick-1].DouyinNo)
	case 3: // 新抖音号
		newNo := strings.TrimSpace(text)
		if !reNewDouyinNo.MatchString(newNo) {
			return "抖音号格式不对（4-64 位字母数字点下划线）。请重新回复。"
		}
		if _, err := m.repo.ResolveAnchorOwnerFlexible(ctx, newNo, ""); err == nil {
			return fmt.Sprintf("抖音号 %s 已被其他主播占用，换一个。", newNo)
		}
		if err := m.repo.UpdateAccountIDs(ctx, op.accountID, newNo, newNo); err != nil {
			return "改号失败：" + err.Error()
		}
		m.clearPendingOp(conv)
		return fmt.Sprintf("主播「%s」的抖音号已改为 %s。之后 CSV 用新号即可匹配。", op.personName, newNo)
	}
	return "请先发送主播姓名。"
}

// tryOpStart 入口关键词：「改名 [抖音号]」「改号/改抖音号 [姓名]」。
func (m *Manager) tryOpStart(ctx context.Context, conv, text string) (string, bool) {
	t := strings.TrimSpace(text)
	switch {
	case t == "改名" || t == "改名字":
		return m.renameStart(ctx, conv, "")
	case strings.HasPrefix(t, "改名 "):
		return m.renameStart(ctx, conv, strings.TrimSpace(strings.TrimPrefix(t, "改名 ")))
	case t == "改号" || t == "改抖音号":
		return m.redouyinStart(ctx, conv, "")
	case strings.HasPrefix(t, "改号 "):
		return m.redouyinStart(ctx, conv, strings.TrimSpace(strings.TrimPrefix(t, "改号 ")))
	case strings.HasPrefix(t, "改抖音号 "):
		return m.redouyinStart(ctx, conv, strings.TrimSpace(strings.TrimPrefix(t, "改抖音号 ")))
	}
	return "", false
}

// tryStartRenameByNumber 裸抖音号消息：命中库里账号则进入改名流程。
// 返回 handled=false 时继续走正常意图（可能它本意是别的指令）。
func (m *Manager) tryStartRenameByNumber(ctx context.Context, conv, text string) (string, bool) {
	if !rePureDouyinNo.MatchString(text) {
		return "", false
	}
	acc, err := m.repo.FindAccountByDouyinNo(ctx, text)
	if err != nil {
		return "", false
	}
	return m.renameLocate(ctx, conv, acc.AnchorID)
}
