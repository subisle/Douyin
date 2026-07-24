"use strict";

const UP_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS ilink_login_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    login_slot_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id BIGINT UNSIGNED NULL,
    actor_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending'
      COMMENT 'pending, claimed, succeeded, failed, expired, cancelled',
    expires_at DATETIME(6) NOT NULL,
    claimed_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    claim_expires_at DATETIME(6) NULL,
    result_ciphertext MEDIUMTEXT NULL,
    result_key_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    error_message VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_ilink_login_slot (workspace_id, login_slot_id),
    UNIQUE KEY uq_ilink_login_request_id (request_id),
    KEY idx_ilink_login_status (workspace_id, status, expires_at),
    CONSTRAINT fk_ilink_login_account
      FOREIGN KEY (workspace_id, account_id)
      REFERENCES ilink_accounts (workspace_id, id)
      ON UPDATE RESTRICT ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]);

module.exports = {
  id: "003_ilink_login_control",
  name: "Create iLink login control channel tables",
  statements: UP_STATEMENTS,
  async up(db) {
    for (const statement of UP_STATEMENTS) {
      await db.query(statement);
    }
  },
};
