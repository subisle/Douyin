// 「姓名-抖音号」加主播：运营在群里发一条消息就把新人建档+绑号，
// 省得为一个人专门开电脑上网页。设计约束：
//   - 抖音号已被占用 → 明确告知绑给了谁，不偷偷改绑
//   - 姓名已存在（唯一）→ 不新建，直接给已有主播加账号
//   - 重名（多个）→ 不猜，让运营换个更独特的名字
package bot

import (
	"context"
	"fmt"

	"douyin-server/internal/domain"
)

// handleAddAnchor 处理「姓名-抖音号」，返回给用户的回复。
func (m *Manager) handleAddAnchor(ctx context.Context, name, douyinNo string) (Outbound, error) {
	out := Outbound{}

	// 1. 这个抖音号是不是已经绑给别人了（anchor_id 或 douyin_no 任一命中）
	if ownerID, err := m.repo.ResolveAnchorOwnerFlexible(ctx, douyinNo, ""); err == nil {
		if p, perr := m.repo.GetPerson(ctx, ownerID); perr == nil {
			out.Text = fmt.Sprintf("抖音号 %s 已经绑定给主播「%s」了，不用重复添加。", douyinNo, p.Name)
			return out, nil
		}
	}

	// 2. 姓名已存在 → 不新建，直接加账号（库里不会有重名，取唯一那条）
	persons, err := m.repo.FindPersonsByName(ctx, name)
	if err != nil {
		return out, err
	}
	if len(persons) > 0 {
		p := persons[0]
		if err := m.repo.BindAccount(ctx, &domain.Account{
			PersonID:   p.ID,
			AnchorID:   douyinNo,
			DouyinNo:   douyinNo,
			AnchorName: name,
			IsPrimary:  false,
			Status:     "active",
		}); err != nil {
			return out, fmt.Errorf("绑定账号: %w", err)
		}
		out.Text = fmt.Sprintf("已把抖音号 %s 绑到已有主播「%s」。现在发 CSV 就能匹配了。", douyinNo, p.Name)
		return out, nil
	}

	// 3. 全新的主播：建档 + 绑号（第一个账号即主账号）
	if err := m.repo.CreatePerson(ctx, &domain.Person{
		Name:   name,
		Gender: domain.GenderUnknown,
		Status: domain.PersonStatusActive,
	}); err != nil {
		return out, err
	}
	persons, err = m.repo.FindPersonsByName(ctx, name)
	if err != nil {
		return out, err
	}
	if len(persons) != 1 {
		return out, fmt.Errorf("新建主播「%s」后查询异常（命中 %d 条）", name, len(persons))
	}
	if err := m.repo.BindAccount(ctx, &domain.Account{
		PersonID:   persons[0].ID,
		AnchorID:   douyinNo,
		DouyinNo:   douyinNo,
		AnchorName: name,
		IsPrimary:  true,
		Status:     "active",
	}); err != nil {
		return out, fmt.Errorf("绑定账号: %w", err)
	}
	out.Text = fmt.Sprintf("已添加主播「%s」（抖音号 %s）。现在发 CSV 就能匹配了；性别等资料可在网页上补。", name, douyinNo)
	return out, nil
}
