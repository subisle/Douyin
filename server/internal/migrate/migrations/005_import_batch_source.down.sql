-- 回滚：先把 csv 来源的行改回 manual，再缩 ENUM。
UPDATE import_batch SET source = 'manual' WHERE source = 'csv';
ALTER TABLE import_batch
  MODIFY COLUMN source ENUM('douyinlang','manual','backfill','api') NOT NULL DEFAULT 'manual';
