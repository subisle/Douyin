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
	"time"

	"douyin-server/internal/domain"
)

type Sync615Result struct {
	PersonsUpserted  int `json:"personsUpserted"`
	AccountsUpserted int `json:"accountsUpserted"`
	SkippedAccounts  int `json:"skippedAccounts"`
	WavesSynced      int `json:"wavesSynced"`
	WavesSkipped     int `json:"wavesSkipped"`
	DurationsSynced  int `json:"durationsSynced"`
	DurationsSkipped int `json:"durationsSkipped"`
	PeopleRecomputed int `json:"peopleRecomputed"`
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

// SyncWavesFrom615 把 615 的 wave_snapshots（日音浪）整表搬到 Go 的 wave_snapshot。
// 同一个库，直接 INSERT...SELECT；anchor_id 对不上 Go account 的行跳过并计数。
// 以 615 为准覆盖（ON DUPLICATE KEY UPDATE）。
func (r *Repo) SyncWavesFrom615(ctx context.Context) (synced, skipped int, err error) {
	var total, matched int
	if err = r.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM wave_snapshots`); err != nil {
		return 0, 0, fmt.Errorf("统计 615 wave_snapshots: %w", err)
	}
	if err = r.db.GetContext(ctx, &matched,
		`SELECT COUNT(*) FROM wave_snapshots w JOIN account a ON a.anchor_id = w.anchor_id COLLATE utf8mb4_unicode_ci`); err != nil {
		return 0, 0, fmt.Errorf("统计可匹配行: %w", err)
	}
	_, err = r.db.ExecContext(ctx,
		`INSERT INTO wave_snapshot (anchor_id, person_id, biz_date, wave_value, rank_in_guild)
		 SELECT w.anchor_id, a.person_id, w.import_date, w.wave_value, w.`+"`rank`"+`
		   FROM wave_snapshots w
		   JOIN account a ON a.anchor_id = w.anchor_id COLLATE utf8mb4_unicode_ci
		 ON DUPLICATE KEY UPDATE
		   person_id = VALUES(person_id), wave_value = VALUES(wave_value),
		   rank_in_guild = VALUES(rank_in_guild)`)
	if err != nil {
		return 0, 0, fmt.Errorf("同步音浪快照: %w", err)
	}
	return matched, total - matched, nil
}

// SyncDurationsFrom615 把 615 的 duration_snapshots（月末月度时长）搬到 Go 的 duration_snapshot。
func (r *Repo) SyncDurationsFrom615(ctx context.Context) (synced, skipped int, err error) {
	var total, matched int
	if err = r.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM duration_snapshots`); err != nil {
		return 0, 0, fmt.Errorf("统计 615 duration_snapshots: %w", err)
	}
	if err = r.db.GetContext(ctx, &matched,
		`SELECT COUNT(*) FROM duration_snapshots w JOIN account a ON a.anchor_id = w.anchor_id COLLATE utf8mb4_unicode_ci`); err != nil {
		return 0, 0, fmt.Errorf("统计可匹配行: %w", err)
	}
	_, err = r.db.ExecContext(ctx,
		`INSERT INTO duration_snapshot (anchor_id, person_id, biz_date, cumulative_minutes)
		 SELECT w.anchor_id, a.person_id, w.import_date, w.total_minutes
		   FROM duration_snapshots w
		   JOIN account a ON a.anchor_id = w.anchor_id COLLATE utf8mb4_unicode_ci
		 ON DUPLICATE KEY UPDATE
		   person_id = VALUES(person_id), cumulative_minutes = VALUES(cumulative_minutes)`)
	if err != nil {
		return 0, 0, fmt.Errorf("同步时长快照: %w", err)
	}
	return matched, total - matched, nil
}

type personRange struct {
	ID   uint64    `db:"id"`
	From time.Time `db:"from_date"`
	To   time.Time `db:"to_date"`
}

// PersonsToRecompute 返回有快照数据、需要重算指标的（人, 日期范围）列表。
func (r *Repo) PersonsToRecompute(ctx context.Context) ([]personRange, error) {
	var out []personRange
	err := r.db.SelectContext(ctx, &out,
		`SELECT person_id AS id, MIN(biz_date) AS from_date, MAX(biz_date) AS to_date
		   FROM (
		     SELECT person_id, biz_date FROM wave_snapshot
		     UNION ALL
		     SELECT person_id, biz_date FROM duration_snapshot
		   ) t
		  GROUP BY person_id`)
	if err != nil {
		return nil, fmt.Errorf("查询待重算人员: %w", err)
	}
	return out, nil
}
