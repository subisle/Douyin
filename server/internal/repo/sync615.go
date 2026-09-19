// 主播数据同步：从 615 的 persons/accounts 表（同一个库，表名复数）
// upsert 到 Go 侧的 person/account（单数）。
//
// 两边是两套表，Electron 一直在用 615 那套；Go 服务刚上线，表是新的。
// 策略：以 615 为准全量 upsert——冲突行覆盖关键字段，Go 侧独有字段
// （group_name / avatar_url / status）保留原值不动。
package repo

import (
	"context"
	"fmt"

	"douyin-server/internal/domain"
)

type Sync615Result struct {
	PersonsUpserted  int `json:"personsUpserted"`
	AccountsUpserted int `json:"accountsUpserted"`
	SkippedAccounts  int `json:"skippedAccounts"`
}

type src615Person struct {
	ID                uint64  `db:"id"`
	Name              string  `db:"name"`
	Gender            string  `db:"gender"`
	MasterID          *uint64 `db:"master_id"`
	Generation        *int    `db:"generation"`
	HideInDailyReport int     `db:"hide_in_daily_report"`
}

type src615Account struct {
	PersonID   uint64 `db:"person_id"`
	AnchorID   string `db:"anchor_id"`
	DouyinNo   string `db:"douyin_no"`
	AnchorName string `db:"anchor_name"`
	IsPrimary  int    `db:"is_primary"`
}

// SyncPersonsFrom615 全量同步。幂等，可反复执行。
func (r *Repo) SyncPersonsFrom615(ctx context.Context) (*Sync615Result, error) {
	out := &Sync615Result{}

	var srcPersons []src615Person
	if err := r.db.SelectContext(ctx, &srcPersons,
		`SELECT id, name, gender, master_id, generation, hide_in_daily_report
		   FROM persons ORDER BY id`); err != nil {
		return nil, fmt.Errorf("读取 615 persons: %w", err)
	}
	var srcAccounts []src615Account
	if err := r.db.SelectContext(ctx, &srcAccounts,
		`SELECT person_id, anchor_id, douyin_no, anchor_name, is_primary
		   FROM accounts ORDER BY id`); err != nil {
		return nil, fmt.Errorf("读取 615 accounts: %w", err)
	}

	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	for _, p := range srcPersons {
		gender := domain.Gender(p.Gender)
		switch gender {
		case domain.GenderMale, domain.GenderFemale:
		default:
			gender = domain.GenderUnknown
		}
		_, err := tx.ExecContext(ctx,
			`INSERT INTO person (id, name, gender, master_id, generation, hide_in_daily_report, status)
			 VALUES (?, ?, ?, ?, ?, ?, 'active')
			 ON DUPLICATE KEY UPDATE
			   name = VALUES(name), gender = VALUES(gender), master_id = VALUES(master_id),
			   generation = VALUES(generation), hide_in_daily_report = VALUES(hide_in_daily_report),
			   deleted_at = NULL`,
			p.ID, p.Name, string(gender), p.MasterID, p.Generation, p.HideInDailyReport)
		if err != nil {
			return nil, fmt.Errorf("upsert person %d(%s): %w", p.ID, p.Name, err)
		}
		out.PersonsUpserted++
	}

	for _, a := range srcAccounts {
		if a.AnchorID == "" {
			out.SkippedAccounts++
			continue
		}
		_, err := tx.ExecContext(ctx,
			`INSERT INTO account (person_id, anchor_id, douyin_no, anchor_name, is_primary, status)
			 VALUES (?, ?, ?, ?, ?, 'active')
			 ON DUPLICATE KEY UPDATE
			   person_id = VALUES(person_id), douyin_no = VALUES(douyin_no),
			   anchor_name = VALUES(anchor_name), is_primary = VALUES(is_primary)`,
			a.PersonID, a.AnchorID, a.DouyinNo, a.AnchorName, a.IsPrimary)
		if err != nil {
			return nil, fmt.Errorf("upsert account %s: %w", a.AnchorID, err)
		}
		out.AccountsUpserted++
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}
	return out, nil
}
