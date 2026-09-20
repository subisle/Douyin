// 导入记录：防止重复 CSV 入库。
//
// 直接复用 615 的 import_records 表（同一个库，615 的 db-maintenance.js 建的）：
// 两端共享去重账本——615 导过的文件 Go 也不会再导，反之亦然。
// file_hash = 文件字节 MD5；data_hash = 规范化数据的 SHA256。
//
// 去重口径（运营规则）：唯一键都带 import_date——同一文件/同一内容
// 对**同一日期**只许导入一次；换个日期再导同一文件是允许的。
package repo

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"douyin-server/internal/csvparse"
)

type ImportRecord struct {
	ID        uint64    `db:"id" json:"id"`
	Kind      string    `db:"kind" json:"kind"`
	ImportAt  time.Time `db:"import_date" json:"import_date"`
	FileHash  string    `db:"file_hash" json:"file_hash"`
	DataHash  string    `db:"data_hash" json:"data_hash"`
	FileName  string    `db:"file_name" json:"file_name"`
	RowCount  int       `db:"row_count" json:"row_count"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

// FindImportRecord 查这个文件/这批数据在该类型+日期下是否已导入过。
// 返回 nil 表示没导过。命中 file_hash 视为同一文件，命中 data_hash 视为同内容。
// 注意：按 kind+日期查——同一文件换个日期导入不会被这条拦。
func (r *Repo) FindImportRecord(ctx context.Context, kind string, date time.Time,
	fileHash, dataHash string) (*ImportRecord, error) {

	var rec ImportRecord
	err := r.db.GetContext(ctx, &rec,
		`SELECT id, kind, import_date, file_hash, data_hash, file_name, row_count, created_at
		   FROM import_records
		  WHERE kind = ? AND import_date = ? AND (file_hash = ? OR data_hash = ?)
		  LIMIT 1`,
		kind, date, fileHash, dataHash)
	if err != nil {
		return nil, translateNotFound(err, "查导入记录")
	}
	return &rec, nil
}

// InsertImportRecord 记一笔导入。与 615 的唯一键一致：
// uq_import_kind_date_file (kind, import_date, file_hash) 和
// uq_import_kind_date_data (kind, import_date, data_hash)。
func (r *Repo) InsertImportRecord(ctx context.Context, kind string, date time.Time,
	fileHash, dataHash, fileName string, rowCount int) error {

	_, err := r.db.ExecContext(ctx,
		`INSERT INTO import_records (kind, import_date, file_hash, data_hash, file_name, row_count)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		kind, date, fileHash, dataHash, fileName, rowCount)
	return err
}

// ComputeImportHashes 与 615 的 buildImportMeta 对齐：文件 MD5 + 规范化数据 SHA256。
// 规范化 = 匹配到的行取 {anchorId, value, rank(wave)}，按 anchorId 排序后序列化。
// bot 与 web 导入共用，保证两端算出的指纹一致、账本互通。
func ComputeImportHashes(fileBytes []byte, rows []csvparse.Row, kind csvparse.Kind) (string, string) {
	fileHash := fmt.Sprintf("%x", md5.Sum(fileBytes))

	type canonicalRow struct {
		AnchorID string `json:"anchorId"`
		Value    int64  `json:"value"`
		Rank     int    `json:"rank"`
	}
	canonical := make([]canonicalRow, 0, len(rows))
	for _, row := range rows {
		if row.AnchorID == "" || row.Err != "" {
			continue
		}
		item := canonicalRow{AnchorID: row.AnchorID, Value: row.Wave}
		if kind == csvparse.KindDuration {
			item.Value = int64(row.Minutes)
		} else if row.Rank != nil {
			item.Rank = *row.Rank
		}
		canonical = append(canonical, item)
	}
	sort.Slice(canonical, func(i, j int) bool { return canonical[i].AnchorID < canonical[j].AnchorID })
	blob, _ := json.Marshal(canonical)
	dataHash := fmt.Sprintf("%x", sha256.Sum256(blob))
	return fileHash, dataHash
}
