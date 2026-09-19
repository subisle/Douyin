// 导入记录：防止重复 CSV 入库。
//
// 直接复用 615 的 import_records 表（同一个库，615 的 db-maintenance.js 建的）：
// 两端共享去重账本——615 导过的文件 Go 也不会再导，反之亦然。
// file_hash = 文件字节 MD5；data_hash = 规范化数据的 SHA256。
package repo

import (
	"context"
	"time"
)

type ImportRecord struct {
	ID        uint64    `db:"id"`
	Kind      string    `db:"kind"`
	ImportAt  time.Time `db:"import_date"`
	FileHash  string    `db:"file_hash"`
	DataHash  string    `db:"data_hash"`
	FileName  string    `db:"file_name"`
	RowCount  int       `db:"row_count"`
	CreatedAt time.Time `db:"created_at"`
}

// FindImportRecord 查这个文件/这批数据在该类型+日期下是否已导入过。
// 返回 nil 表示没导过。命中 file_hash 视为同一文件，命中 data_hash 视为同内容。
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
