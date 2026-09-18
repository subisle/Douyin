-- 三层物化指标：日 / 月 / 年。
--
-- 全部可重算：数据量极小（<200 主播），单人单月只有 31 行，
-- 重算成本可以忽略，所以物化表脏了随时能重建。

CREATE TABLE IF NOT EXISTS daily_metric (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id           BIGINT UNSIGNED NOT NULL,
  anchor_id           VARCHAR(64) NOT NULL,
  biz_date            DATE NOT NULL,

  wave                BIGINT NOT NULL DEFAULT 0 COMMENT '日音浪 = 当前累计 - 上次累计',
  cumulative_wave     BIGINT NOT NULL DEFAULT 0 COMMENT '当天累计总音浪（快照原值）',
  prev_snapshot_date  DATE NULL COMMENT '上一次快照日期，用于判定差分跨度',
  wave_span           SMALLINT NOT NULL DEFAULT 1 COMMENT '差分跨越天数；>1 表示中间漏采',
  wave_reliable       TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0=漏采或回退导致日音浪不可信',

  minutes             INT NOT NULL DEFAULT 0 COMMENT '当日直播分钟数（差分）',
  cumulative_minutes  INT NOT NULL DEFAULT 0,
  minutes_span        SMALLINT NOT NULL DEFAULT 1,
  minutes_reliable    TINYINT(1) NOT NULL DEFAULT 1,

  is_live             TINYINT(1) NOT NULL DEFAULT 0,
  tier                CHAR(1) NULL COMMENT '当日等级快照，导出直接读',
  source_batch_id     BIGINT UNSIGNED NULL,
  recomputed_at       DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_person_date (person_id, biz_date),
  KEY idx_date (biz_date),
  KEY idx_date_wave (biz_date, wave DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monthly_metric (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id              BIGINT UNSIGNED NOT NULL,
  period                 CHAR(7) NOT NULL COMMENT 'YYYY-MM',

  wave                   BIGINT NOT NULL DEFAULT 0 COMMENT '月音浪',
  minutes                INT NOT NULL DEFAULT 0 COMMENT '月直播时长（分钟）',
  formatted_duration     VARCHAR(16) NOT NULL DEFAULT '' COMMENT '如 128h30m，导出直接渲染',

  live_days              SMALLINT NOT NULL DEFAULT 0,
  absent_days            SMALLINT NOT NULL DEFAULT 0,
  best_day_wave          BIGINT NOT NULL DEFAULT 0,
  best_day_date          DATE NULL,
  avg_wave_per_live_day  BIGINT NOT NULL DEFAULT 0,
  tier                   CHAR(1) NULL,
  unreliable_days        SMALLINT NOT NULL DEFAULT 0 COMMENT '因漏采不可信的天数',

  updated_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_person_period (person_id, period),
  KEY idx_period_wave (period, wave DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS yearly_metric (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id        BIGINT UNSIGNED NOT NULL,
  year             SMALLINT NOT NULL,

  wave             BIGINT NOT NULL DEFAULT 0 COMMENT '全年总音浪',
  minutes          INT NOT NULL DEFAULT 0 COMMENT '全年总时长（分钟）',
  formatted_duration VARCHAR(16) NOT NULL DEFAULT '',

  live_days        SMALLINT NOT NULL DEFAULT 0,
  active_months    SMALLINT NOT NULL DEFAULT 0 COMMENT '有开播记录的月数',
  best_month       CHAR(7) NULL,
  best_month_wave  BIGINT NOT NULL DEFAULT 0,
  best_day_wave    BIGINT NOT NULL DEFAULT 0,
  best_day_date    DATE NULL,
  avg_month_wave   BIGINT NOT NULL DEFAULT 0,
  tier             CHAR(1) NULL,
  year_rank        INT NULL COMMENT '年度榜排名（任务刷新）',

  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_person_year (person_id, year),
  KEY idx_year_wave (year, wave DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 差分时发现的异常（负增量等），留给人工处理，不静默吞掉。
CREATE TABLE IF NOT EXISTS data_anomaly (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id   BIGINT UNSIGNED NOT NULL,
  anchor_id   VARCHAR(64) NOT NULL,
  biz_date    DATE NOT NULL,
  kind        ENUM('negative_delta','missing_snapshot','orphan_account') NOT NULL,
  detail      VARCHAR(255) NOT NULL DEFAULT '',
  resolved    TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_anomaly (anchor_id, biz_date, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
