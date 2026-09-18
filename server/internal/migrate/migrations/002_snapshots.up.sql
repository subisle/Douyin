-- 原始快照：平台给的是"累计值"，日音浪/日时长要靠差分算。
-- 这两张表是事实来源，只增不改。

CREATE TABLE IF NOT EXISTS wave_snapshot (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anchor_id      VARCHAR(64) NOT NULL,
  person_id      BIGINT UNSIGNED NOT NULL,
  biz_date       DATE NOT NULL,
  wave_value     BIGINT NOT NULL DEFAULT 0 COMMENT '平台累计总音浪（快照值）',
  rank_in_guild  INT NULL COMMENT '榜内排名',
  batch_id       BIGINT UNSIGNED NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_wave (anchor_id, biz_date),
  KEY idx_person_date (person_id, biz_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS duration_snapshot (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anchor_id          VARCHAR(64) NOT NULL,
  person_id          BIGINT UNSIGNED NOT NULL,
  biz_date           DATE NOT NULL,
  cumulative_minutes INT NOT NULL DEFAULT 0 COMMENT '平台累计直播分钟数（快照值）',
  batch_id           BIGINT UNSIGNED NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_dur (anchor_id, biz_date),
  KEY idx_person_date (person_id, biz_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
