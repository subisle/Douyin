"use strict";

// 主播收入模块：
// - anchor_income：平台导出的「个人明细」按月落库，唯一键 (period, anchor_id)
// - anchor_income_profiles：入会时间 + 期初累计个人收益（累计总收益 = 期初 + 各月之和）

const UP_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS anchor_income (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    period VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'YYYY-MM',
    anchor_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    person_id INT NULL,
    douyin_no VARCHAR(64) NOT NULL DEFAULT '',
    nickname VARCHAR(128) NOT NULL DEFAULT '',
    start_date DATE NULL,
    end_date DATE NULL,
    income_name VARCHAR(64) NOT NULL DEFAULT '',
    fee_type VARCHAR(64) NOT NULL DEFAULT '',
    revenue DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '本期流水',
    streamer_ratio VARCHAR(16) NOT NULL DEFAULT '' COMMENT '主播分成比',
    guild_ratio VARCHAR(16) NOT NULL DEFAULT '' COMMENT '公会分成比',
    streamer_income DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '主播收入',
    guild_income DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '公会收入',
    remark VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_anchor_income (period, anchor_id),
    KEY idx_anchor_income_period (period),
    KEY idx_anchor_income_person (person_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS anchor_income_profiles (
    person_id INT NOT NULL,
    join_date VARCHAR(32) NOT NULL DEFAULT '' COMMENT '入会时间（原文，如 2023年/4/5）',
    opening_total DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '期初累计个人收益',
    note VARCHAR(255) NOT NULL DEFAULT '',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (person_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]);

module.exports = {
  id: "004_anchor_income",
  name: "Create anchor income tables",
  statements: UP_STATEMENTS,
  async up(db) {
    for (const statement of UP_STATEMENTS) {
      await db.query(statement);
    }
  },
};
