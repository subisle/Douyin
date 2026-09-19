// Package repo 封装所有 SQL 访问。只用 sqlx，不用 ORM：
// 本项目有大量聚合查询，ORM 挡在中间只会让 SQL 变不可控。
package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jmoiron/sqlx"

	"douyin-server/internal/domain"
)

// ErrNotFound 表示目标行不存在。调用方用 errors.Is 判断，
// HTTP 层据此返回 404 而不是 500。
var ErrNotFound = errors.New("记录不存在")

// Repo 持有连接池。所有方法都要求传入 context。
type Repo struct {
	db *sqlx.DB
}

// New 构造 Repo。
func New(db *sqlx.DB) *Repo { return &Repo{db: db} }

// PersonFilter 是主播列表的筛选条件。
type PersonFilter struct {
	Gender   domain.Gender
	Status   domain.PersonStatus
	MasterID *uint64
	Keyword  string
	Limit    int
	Offset   int
}

// ListPersons 返回主播列表。gender/status 为空字符串时表示不筛选。
func (r *Repo) ListPersons(ctx context.Context, f PersonFilter) ([]domain.Person, error) {
	query := `SELECT id, name, gender, master_id, generation, group_name, avatar_url,
	                 hide_in_daily_report, status, joined_at, created_at, updated_at
	          FROM person
	          WHERE deleted_at IS NULL`
	args := []any{}

	if f.Gender != "" {
		query += " AND gender = ?"
		args = append(args, string(f.Gender))
	}
	if f.Status != "" {
		query += " AND status = ?"
		args = append(args, string(f.Status))
	}
	if f.MasterID != nil {
		query += " AND master_id = ?"
		args = append(args, *f.MasterID)
	}
	if f.Keyword != "" {
		query += " AND name LIKE ?"
		args = append(args, "%"+f.Keyword+"%")
	}
	query += " ORDER BY name ASC"
	if f.Limit > 0 {
		query += " LIMIT ? OFFSET ?"
		args = append(args, f.Limit, f.Offset)
	}

	var out []domain.Person
	if err := r.db.SelectContext(ctx, &out, query, args...); err != nil {
		return nil, fmt.Errorf("查询主播列表: %w", err)
	}
	return out, nil
}

// GetPerson 按 ID 取单个主播。
func (r *Repo) GetPerson(ctx context.Context, id uint64) (*domain.Person, error) {
	const query = `SELECT id, name, gender, master_id, generation, group_name, avatar_url,
	                      hide_in_daily_report, status, joined_at, created_at, updated_at
	               FROM person WHERE id = ? AND deleted_at IS NULL`

	var p domain.Person
	if err := r.db.GetContext(ctx, &p, query, id); err != nil {
		return nil, translateNotFound(err, "查询主播")
	}
	return &p, nil
}

// CreatePerson 新建主播，返回自增 ID。
func (r *Repo) CreatePerson(ctx context.Context, p *domain.Person) error {
	const query = `INSERT INTO person
		(name, gender, master_id, generation, group_name, avatar_url, hide_in_daily_report, status, joined_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	res, err := r.db.ExecContext(ctx, query,
		p.Name, p.Gender, p.MasterID, p.Generation, p.GroupName,
		p.AvatarURL, p.HideInDailyReport, p.Status, p.JoinedAt,
	)
	if err != nil {
		return fmt.Errorf("新建主播: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("读取新主播 ID: %w", err)
	}
	p.ID = uint64(id)
	return nil
}

// UpdatePerson 更新主播资料。nil 指针字段表示不改动。
func (r *Repo) UpdatePerson(ctx context.Context, p *domain.Person) error {
	const query = `UPDATE person SET
		name = ?, gender = ?, master_id = ?, generation = ?, group_name = ?,
		avatar_url = ?, hide_in_daily_report = ?, status = ?, joined_at = ?
		WHERE id = ? AND deleted_at IS NULL`

	res, err := r.db.ExecContext(ctx, query,
		p.Name, p.Gender, p.MasterID, p.Generation, p.GroupName,
		p.AvatarURL, p.HideInDailyReport, p.Status, p.JoinedAt, p.ID,
	)
	if err != nil {
		return fmt.Errorf("更新主播: %w", err)
	}
	return ensureAffected(res, "更新主播")
}

// SoftDeletePerson 软删除。历史数据必须保留，硬删会毁掉月榜和年榜。
func (r *Repo) SoftDeletePerson(ctx context.Context, id uint64) error {
	res, err := r.db.ExecContext(ctx,
		"UPDATE person SET deleted_at = NOW(3) WHERE id = ? AND deleted_at IS NULL", id)
	if err != nil {
		return fmt.Errorf("删除主播: %w", err)
	}
	return ensureAffected(res, "删除主播")
}

// ListAccounts 返回某主播绑定的全部抖音账号。
func (r *Repo) ListAccounts(ctx context.Context, personID uint64) ([]domain.Account, error) {
	var out []domain.Account
	if err := r.db.SelectContext(ctx, &out,
		`SELECT id, person_id, anchor_id, douyin_no, anchor_name, is_primary, status, created_at
		 FROM account WHERE person_id = ? ORDER BY is_primary DESC, id ASC`, personID); err != nil {
		return nil, fmt.Errorf("查询账号列表: %w", err)
	}
	return out, nil
}

// BindAccount 给主播绑定抖音账号。同一 anchor_id 重复绑定会返回冲突错误。
func (r *Repo) BindAccount(ctx context.Context, a *domain.Account) error {
	const query = `INSERT INTO account
		(person_id, anchor_id, douyin_no, anchor_name, is_primary, status)
		VALUES (?, ?, ?, ?, ?, ?)`

	res, err := r.db.ExecContext(ctx, query,
		a.PersonID, a.AnchorID, a.DouyinNo, a.AnchorName, a.IsPrimary, a.Status)
	if err != nil {
		return fmt.Errorf("绑定账号: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("读取新账号 ID: %w", err)
	}
	a.ID = uint64(id)
	return nil
}

// ResolveAnchorOwner 按 anchor_id 反查归属人，导入数据时用来补 person_id。
func (r *Repo) ResolveAnchorOwner(ctx context.Context, anchorID string) (uint64, error) {
	var personID uint64
	err := r.db.GetContext(ctx, &personID,
		"SELECT person_id FROM account WHERE anchor_id = ?", anchorID)
	if err != nil {
		return 0, translateNotFound(err, "反查账号归属")
	}
	return personID, nil
}

// ListTierRules 取某粒度的等级规则，按门槛从高到低排。
func (r *Repo) ListTierRules(ctx context.Context, scope domain.TierScope) ([]domain.TierRule, error) {
	var out []domain.TierRule
	if err := r.db.SelectContext(ctx, &out,
		`SELECT id, scope, label, min_wave, sort_order FROM tier_rule
		 WHERE scope = ? ORDER BY min_wave DESC`, string(scope)); err != nil {
		return nil, fmt.Errorf("查询等级规则: %w", err)
	}
	return out, nil
}
