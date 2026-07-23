"use strict";

const UP_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS ilink_accounts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    display_name VARCHAR(255) NOT NULL DEFAULT '',
    session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
    status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'disconnected',
    api_base_url VARCHAR(512) NOT NULL,
    credential_ciphertext MEDIUMTEXT NULL,
    credential_key_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_connected_at DATETIME(6) NULL,
    last_seen_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_ilink_accounts_workspace_id (workspace_id, id),
    UNIQUE KEY uq_ilink_accounts_key (workspace_id, account_key),
    KEY idx_ilink_accounts_session (workspace_id, session_id),
    KEY idx_ilink_accounts_status (workspace_id, enabled, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS ilink_update_cursors (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    cursor_ciphertext MEDIUMTEXT NOT NULL,
    cursor_key_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    cursor_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_update_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_ilink_cursor_scope (workspace_id, account_id, session_id),
    CONSTRAINT fk_ilink_cursor_account
      FOREIGN KEY (workspace_id, account_id)
      REFERENCES ilink_accounts (workspace_id, id)
      ON UPDATE RESTRICT ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS bot_runner_leases (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lease_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ilink-poller',
    owner_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
    lease_expires_at DATETIME(6) NULL,
    heartbeat_at DATETIME(6) NULL,
    acquire_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_bot_runner_lease (workspace_id, account_id, lease_name),
    KEY idx_bot_runner_expiry (lease_expires_at),
    CONSTRAINT fk_bot_runner_lease_account
      FOREIGN KEY (workspace_id, account_id)
      REFERENCES ilink_accounts (workspace_id, id)
      ON UPDATE RESTRICT ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS inbox_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    dedupe_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    upstream_message_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
    source_cursor_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    message_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload_ciphertext MEDIUMTEXT NOT NULL,
    payload_key_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload_metadata JSON NULL,
    status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'prepared'
      COMMENT 'prepared, processing, retry_wait, succeeded, dead_letter, cancelled',
    available_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    claimed_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    claim_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    claim_expires_at DATETIME(6) NULL,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts INT UNSIGNED NOT NULL DEFAULT 10,
    received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    processed_at DATETIME(6) NULL,
    expires_at DATETIME(6) NULL,
    last_error TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_inbox_dedupe (workspace_id, account_id, dedupe_key),
    UNIQUE KEY uq_inbox_workspace_account_id (workspace_id, account_id, id),
    KEY idx_inbox_claim (workspace_id, status, available_at, claim_expires_at),
    KEY idx_inbox_session_order (workspace_id, account_id, session_id, id),
    KEY idx_inbox_expiry (status, expires_at),
    CONSTRAINT fk_inbox_account
      FOREIGN KEY (workspace_id, account_id)
      REFERENCES ilink_accounts (workspace_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS outbox_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    client_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    dedupe_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    reply_to_inbox_id BIGINT UNSIGNED NULL,
    message_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    context_token_ciphertext MEDIUMTEXT NULL,
    payload_ciphertext MEDIUMTEXT NOT NULL,
    payload_key_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload_metadata JSON NULL,
    status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'prepared'
      COMMENT 'prepared, sending, sent, retry_wait, unknown, reconcile, dead_letter, cancelled',
    reconcile_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'not_required'
      COMMENT 'not_required, pending, claimed, resolved, failed',
    upstream_message_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
    claimed_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    claim_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    claim_expires_at DATETIME(6) NULL,
    fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts INT UNSIGNED NOT NULL DEFAULT 10,
    next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    reconcile_after DATETIME(6) NULL,
    sent_at DATETIME(6) NULL,
    unknown_at DATETIME(6) NULL,
    reconciled_at DATETIME(6) NULL,
    expires_at DATETIME(6) NULL,
    last_error TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_outbox_client (workspace_id, account_id, client_id),
    UNIQUE KEY uq_outbox_dedupe (workspace_id, account_id, dedupe_key),
    KEY idx_outbox_claim (workspace_id, status, next_attempt_at, claim_expires_at),
    KEY idx_outbox_reconcile (workspace_id, reconcile_status, reconcile_after),
    KEY idx_outbox_session_order (workspace_id, account_id, session_id, id),
    KEY idx_outbox_expiry (status, expires_at),
    CONSTRAINT fk_outbox_account
      FOREIGN KEY (workspace_id, account_id)
      REFERENCES ilink_accounts (workspace_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_outbox_inbox
      FOREIGN KEY (workspace_id, account_id, reply_to_inbox_id)
      REFERENCES inbox_messages (workspace_id, account_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS artifacts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    artifact_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    owner_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    owner_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    artifact_kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mime_type VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    storage_provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    storage_key VARCHAR(1024) NOT NULL,
    storage_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    byte_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
    status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ready',
    metadata JSON NULL,
    expires_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_artifact_id (workspace_id, artifact_id),
    UNIQUE KEY uq_artifact_storage (workspace_id, storage_provider, storage_key_hash),
    KEY idx_artifact_owner (workspace_id, account_id, session_id, owner_type, owner_id),
    KEY idx_artifact_expiry (status, expires_at),
    CONSTRAINT fk_artifact_account
      FOREIGN KEY (workspace_id, account_id)
      REFERENCES ilink_accounts (workspace_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS import_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    kind VARCHAR(20) NOT NULL,
    import_date DATE NOT NULL,
    file_hash CHAR(32) NOT NULL,
    data_hash CHAR(64) NOT NULL,
    file_name VARCHAR(255) NOT NULL DEFAULT '',
    row_count INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_import_kind_date_file (kind, import_date, file_hash),
    UNIQUE KEY uq_import_kind_date_data (kind, import_date, data_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]);

async function ensureUniqueImportDataIndex(db) {
  const [rows] = await db.query(
    `SELECT index_name AS indexName,
            non_unique AS nonUnique,
            seq_in_index AS sequenceNumber,
            column_name AS columnName
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'import_records'
      ORDER BY index_name, seq_in_index`
  );
  const indexes = new Map();
  for (const row of rows) {
    const index = indexes.get(row.indexName) || {
      unique: Number(row.nonUnique) === 0,
      columns: [],
    };
    index.columns.push({
      sequenceNumber: Number(row.sequenceNumber),
      columnName: String(row.columnName),
    });
    indexes.set(row.indexName, index);
  }

  const requiredColumns = ["kind", "import_date", "data_hash"];
  const hasRequiredIndex = Array.from(indexes.values()).some((index) => {
    const columns = index.columns
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
      .map((item) => item.columnName);
    return (
      index.unique &&
      columns.length === requiredColumns.length &&
      columns.every((column, indexPosition) => column === requiredColumns[indexPosition])
    );
  });
  if (hasRequiredIndex) return;

  const conflictingIndex = indexes.get("uq_import_kind_date_data");
  if (conflictingIndex) {
    await db.query(
      "ALTER TABLE import_records DROP INDEX uq_import_kind_date_data"
    );
  }
  await db.query(
    `ALTER TABLE import_records
       ADD UNIQUE KEY uq_import_kind_date_data (kind, import_date, data_hash)`
  );
}

module.exports = {
  id: "001_ilink_runtime",
  name: "Create durable iLink runtime tables",
  statements: UP_STATEMENTS,
  async up(db) {
    for (const statement of UP_STATEMENTS) {
      await db.query(statement);
    }
    await ensureUniqueImportDataIndex(db);
  },
};
