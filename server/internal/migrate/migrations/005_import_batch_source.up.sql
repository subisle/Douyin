-- import_batch.source 原来是 ENUM('douyinlang','manual','backfill','api')，
-- 但 CSV 导入（web / 机器人）都传 'csv'，真库上一执行就报
-- Data truncated for column 'source'——web 导入此前从未在真库跑通过。
-- 扩 ENUM 加 'csv'；ENUM 加值是向后兼容的，615 侧不受影响。
ALTER TABLE import_batch
  MODIFY COLUMN source ENUM('douyinlang','manual','backfill','api','csv') NOT NULL DEFAULT 'manual';
