// Package domain 存放实体与业务规则，不依赖任何基础设施。
package domain

import "time"

// Gender 主播性别。导出图片按性别路由样式（男团 apple / 女队 classic），
// 所以这个字段必须干净，unknown 一律按男团样式兜底。
type Gender string

const (
	GenderMale    Gender = "male"
	GenderFemale  Gender = "female"
	GenderUnknown Gender = "unknown"
)

// Valid 判断性别值是否合法。
func (g Gender) Valid() bool {
	switch g {
	case GenderMale, GenderFemale, GenderUnknown:
		return true
	}
	return false
}

// PersonStatus 主播在团状态。
type PersonStatus string

const (
	PersonStatusActive PersonStatus = "active"
	PersonStatusLeft   PersonStatus = "left"
	PersonStatusPaused PersonStatus = "paused"
)

// Valid 判断状态值是否合法。
func (s PersonStatus) Valid() bool {
	switch s {
	case PersonStatusActive, PersonStatusLeft, PersonStatusPaused:
		return true
	}
	return false
}

// Person 主播（业务主体）。一个人可以绑多个抖音账号。
type Person struct {
	ID                uint64       `db:"id"                  json:"id"`
	Name              string       `db:"name"                json:"name"`
	Gender            Gender       `db:"gender"              json:"gender"`
	MasterID          *uint64      `db:"master_id"           json:"masterId,omitempty"`
	Generation        *int         `db:"generation"          json:"generation,omitempty"`
	GroupName         *string      `db:"group_name"          json:"groupName,omitempty"`
	AvatarURL         *string      `db:"avatar_url"          json:"avatarUrl,omitempty"`
	HideInDailyReport bool         `db:"hide_in_daily_report" json:"hideInDailyReport"`
	Status            PersonStatus `db:"status"              json:"status"`
	JoinedAt          *time.Time   `db:"joined_at"           json:"joinedAt,omitempty"`
	CreatedAt         time.Time    `db:"created_at"          json:"createdAt"`
	UpdatedAt         time.Time    `db:"updated_at"          json:"updatedAt"`
}

// Account 抖音账号，是采集单元：快照按 anchor_id 存，指标按 person_id 聚。
type Account struct {
	ID         uint64    `db:"id"          json:"id"`
	PersonID   uint64    `db:"person_id"   json:"personId"`
	AnchorID   string    `db:"anchor_id"   json:"anchorId"`
	DouyinNo   string    `db:"douyin_no"   json:"douyinNo"`
	AnchorName string    `db:"anchor_name" json:"anchorName"`
	IsPrimary  bool      `db:"is_primary"  json:"isPrimary"`
	Status     string    `db:"status"      json:"status"`
	CreatedAt  time.Time `db:"created_at"  json:"createdAt"`
}

// TierScope 等级规则适用的指标粒度。
type TierScope string

const (
	TierScopeDaily   TierScope = "daily"
	TierScopeMonthly TierScope = "monthly"
	TierScopeYearly  TierScope = "yearly"
)

// TierRule 等级门槛。沿用 615 的口径：A 50万 / B 20万 / C 5万 / D 0。
type TierRule struct {
	ID        uint64    `db:"id"         json:"id"`
	Scope     TierScope `db:"scope"      json:"scope"`
	Label     string    `db:"label"      json:"label"`
	MinWave   int64     `db:"min_wave"   json:"minWave"`
	SortOrder int       `db:"sort_order" json:"sortOrder"`
}
