package metric

import "douyin-server/internal/domain"

// ResolveTier 按音浪值匹配等级标签。
// rules 必须按 min_wave 降序传入（repo.ListTierRules 已保证），
// 取第一个门槛被达到的等级。达不到任何门槛返回 nil（表里记为未知）。
func ResolveTier(wave int64, rules []domain.TierRule) *string {
	for _, r := range rules {
		if wave >= r.MinWave {
			label := r.Label
			return &label
		}
	}
	return nil
}
