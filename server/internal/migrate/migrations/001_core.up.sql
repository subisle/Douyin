-- 核心实体：人 / 抖音账号 / 等级规则 / 导入批次
--
-- 与 615 分支的映射：
--   persons            -> person
--   accounts           -> account
--   tier_rules         -> tier_rule（新增 scope 字段，支持日/月/年不同阈值）
--   import_records     -> import_batch

CREATE TABLE IF NOT EXISTS person (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                 VARCHAR(64)  NOT NULL DEFAULT '',
  gender               ENUM('male','female','unknown') NOT NULL DEFAULT 'unknown',
  master_id            BIGINT UNSIGNED NULL COMMENT '所属师傅（自引用 person.id）',
  generation           INT NULL COMMENT '第几代徒弟',
  group_name           VARCHAR(64) NULL COMMENT '所属团队/分组',
  avatar_url           VARCHAR(512) NULL COMMENT '头像，每日之星图要用',
  hide_in_daily_report TINYINT(1) NOT NULL DEFAULT 0,
  status               ENUM('active','left','paused') NOT NULL DEFAULT 'active',
  joined_at            DATE NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at           DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_master (master_id),
  KEY idx_status_gender (status, gender)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id   BIGINT UNSIGNED NOT NULL,
  anchor_id   VARCHAR(64)  NOT NULL COMMENT '抖音采集 ID（唯一键）',
  douyin_no   VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '抖音号（展示用）',
  anchor_name VARCHAR(128) NOT NULL DEFAULT '',
  is_primary  TINYINT(1)   NOT NULL DEFAULT 0,
  status      ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_anchor (anchor_id),
  KEY idx_person (person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tier_rule (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope      ENUM('daily','monthly','yearly') NOT NULL DEFAULT 'daily',
  label      VARCHAR(8)  NOT NULL,
  min_wave   BIGINT      NOT NULL,
  sort_order INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_scope_label (scope, label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_batch (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_date    DATE NOT NULL COMMENT '数据归属日期',
  source      ENUM('douyinlang','manual','backfill','api') NOT NULL DEFAULT 'manual',
  status      ENUM('running','succeeded','failed') NOT NULL DEFAULT 'running',
  row_count   INT NOT NULL DEFAULT 0,
  operator    VARCHAR(64) NOT NULL DEFAULT '',
  error_text  TEXT NULL,
  started_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_date_status (biz_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
