"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  checksumSource,
  compareMigrationState,
  executeMigration,
  getMigrationStatus,
  loadMigrations,
  migrateUp,
} = require("./migration-runner");
const migration = require("../migrations/001_ilink_runtime");
const tenantFkMigration = require("../migrations/002_outbox_tenant_fk");
const { main } = require("./migrate");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

function createPoolMock({ applied = [], lockAcquired = 1 } = {}) {
  const events = [];
  const connection = {
    async query(sql, params) {
      const normalized = sql.trim();
      if (normalized === "SELECT GET_LOCK(?, ?) AS acquired") {
        events.push({ type: "get-lock", params });
        return [[{ acquired: lockAcquired }]];
      }
      if (normalized === "SELECT RELEASE_LOCK(?) AS released") {
        events.push({ type: "release-lock", params });
        return [[{ released: 1 }]];
      }
      if (normalized.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) {
        events.push({ type: "ensure-table" });
        return [{ affectedRows: 0 }];
      }
      if (normalized.startsWith("SELECT version, name, checksum")) {
        events.push({ type: "read-applied" });
        return [applied];
      }
      if (normalized.startsWith("INSERT INTO schema_migrations")) {
        events.push({ type: "record", params });
        return [{ affectedRows: 1 }];
      }
      events.push({ type: "statement", sql: normalized, params });
      return [{ affectedRows: 0 }];
    },
    release() {
      events.push({ type: "release-connection" });
    },
  };
  return {
    events,
    pool: {
      async getConnection() {
        events.push({ type: "get-connection" });
        return connection;
      },
      async end() {
        events.push({ type: "end-pool" });
      },
    },
  };
}

function migrationFixture(overrides = {}) {
  const source = `fixture:${overrides.id || "002_fixture"}`;
  return {
    id: overrides.id || "002_fixture",
    name: overrides.name || "Fixture migration",
    checksum: overrides.checksum || checksumSource(source),
    up: overrides.up || ["SELECT 'value;still-one-statement' AS marker"],
  };
}

test("loads the first migration with a source checksum and required schema definitions", () => {
  const loaded = loadMigrations(MIGRATIONS_DIR);
  const firstMigration = loaded.find((item) => item.id === "001_ilink_runtime");
  assert.ok(firstMigration);
  assert.match(firstMigration.checksum, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(firstMigration.statements));

  const source = fs.readFileSync(firstMigration.filePath);
  assert.equal(firstMigration.checksum, checksumSource(source));
  const sql = firstMigration.statements.join("\n");
  for (const table of [
    "ilink_accounts",
    "ilink_update_cursors",
    "bot_runner_leases",
    "inbox_messages",
    "outbox_messages",
    "artifacts",
    "import_records",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /UNIQUE KEY uq_inbox_dedupe/);
  assert.match(sql, /UNIQUE KEY uq_inbox_workspace_account_id \(workspace_id, account_id, id\)/);
  assert.match(sql, /UNIQUE KEY uq_outbox_client/);
  assert.match(sql, /payload_ciphertext/);
  assert.match(sql, /cursor_ciphertext/);
  assert.doesNotMatch(sql, /\bpayload JSON\b/);
  assert.match(sql, /prepared, sending, sent, retry_wait, unknown, reconcile, dead_letter, cancelled/);
  assert.match(sql, /reconcile_status/);
  assert.match(sql, /attempt_count/);
  assert.match(
    sql,
    /FOREIGN KEY \(workspace_id, account_id, reply_to_inbox_id\)\s+REFERENCES inbox_messages \(workspace_id, account_id, id\)/
  );
  assert.match(
    sql,
    /FOREIGN KEY \(workspace_id, account_id, reply_to_inbox_id\)\s+REFERENCES inbox_messages \(workspace_id, account_id, id\)\s+ON UPDATE RESTRICT ON DELETE RESTRICT/
  );
  assert.doesNotMatch(sql, /ON DELETE SET NULL/);
});

test("executes SQL arrays as complete statements without semicolon splitting", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(sql);
    },
  };
  await executeMigration(connection, {
    id: "002_fixture",
    name: "Fixture",
    up: ["SELECT 'a;b' AS value", "SELECT 2"],
  });
  assert.deepEqual(calls, ["SELECT 'a;b' AS value", "SELECT 2"]);
});

test("migration up holds the MySQL lock and records the checksum after execution", async () => {
  const fixture = migrationFixture();
  const { pool, events } = createPoolMock();

  const result = await migrateUp(pool, [fixture], {
    database: "app_db",
    lockName: "test:migrations",
    lockTimeoutSeconds: 4,
  });

  assert.deepEqual(result.applied.map((item) => item.id), ["002_fixture"]);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      "get-connection",
      "get-lock",
      "ensure-table",
      "read-applied",
      "statement",
      "record",
      "release-lock",
      "release-connection",
    ]
  );
  assert.deepEqual(events[1].params, ["test:migrations", 4]);
  assert.equal(events.find((event) => event.type === "record").params[2], fixture.checksum);
});

test("checksum mismatch blocks up and still releases the advisory lock", async () => {
  const fixture = migrationFixture();
  const { pool, events } = createPoolMock({
    applied: [
      {
        version: fixture.id,
        name: fixture.name,
        checksum: "0".repeat(64),
        execution_ms: 1,
        applied_at: "2026-07-22 00:00:00",
      },
    ],
  });

  await assert.rejects(
    migrateUp(pool, [fixture], { database: "app_db", lockName: "test:migrations" }),
    /Checksum mismatch.*002_fixture/
  );
  assert.ok(!events.some((event) => event.type === "statement"));
  assert.ok(events.some((event) => event.type === "release-lock"));
  assert.ok(events.some((event) => event.type === "release-connection"));
});

test("non-contiguous applied history is rejected before pending migrations run", async () => {
  const first = migrationFixture({ id: "001_first" });
  const second = migrationFixture({ id: "002_second" });
  const { pool, events } = createPoolMock({
    applied: [
      {
        version: second.id,
        name: second.name,
        checksum: second.checksum,
        execution_ms: 1,
        applied_at: "2026-07-22 00:00:00",
      },
    ],
  });

  await assert.rejects(
    migrateUp(pool, [first, second], { database: "app_db" }),
    /history is not contiguous/
  );
  assert.ok(!events.some((event) => event.type === "statement"));
  assert.ok(events.some((event) => event.type === "release-lock"));
});

test("status reports pending, applied, and locally missing migrations", async () => {
  const first = migrationFixture({ id: "001_first" });
  const second = migrationFixture({ id: "002_second" });
  const { pool } = createPoolMock({
    applied: [
      {
        version: first.id,
        name: first.name,
        checksum: first.checksum,
        execution_ms: 2,
        applied_at: "2026-07-22 00:00:00",
      },
      {
        version: "000_removed",
        name: "Removed",
        checksum: "1".repeat(64),
        execution_ms: 3,
        applied_at: "2026-07-21 00:00:00",
      },
    ],
  });

  const state = await getMigrationStatus(pool, [first, second], {
    database: "app_db",
    lockName: "test:migrations",
  });
  assert.deepEqual(
    state.items.map((item) => [item.id, item.state]),
    [
      ["001_first", "applied"],
      ["002_second", "pending"],
    ]
  );
  assert.deepEqual(state.orphaned.map((item) => item.id), ["000_removed"]);
  assert.deepEqual(
    state.issues.map((issue) => [issue.type, issue.migrationId]),
    [["missing_local_file", "000_removed"]]
  );
  assert.deepEqual(
    compareMigrationState([first], state.items.filter((item) => item.applied).map((item) => item.applied)),
    {
      items: [{ ...first, state: "applied", applied: state.items[0].applied }],
      orphaned: [],
    }
  );
});

test("status identifies non-contiguous applied history", async () => {
  const first = migrationFixture({ id: "001_first" });
  const second = migrationFixture({ id: "002_second" });
  const { pool } = createPoolMock({
    applied: [
      {
        version: second.id,
        name: second.name,
        checksum: second.checksum,
        execution_ms: 1,
        applied_at: "2026-07-22 00:00:00",
      },
    ],
  });

  const state = await getMigrationStatus(pool, [first, second], {
    database: "app_db",
  });

  assert.deepEqual(
    state.items.map((item) => [item.id, item.state]),
    [
      ["001_first", "pending"],
      ["002_second", "applied"],
    ]
  );
  assert.deepEqual(state.issues, [
    {
      type: "non_contiguous_history",
      migrationId: "002_second",
      pendingMigrationId: "001_first",
      message:
        "Migration history is not contiguous: 002_second is applied after pending 001_first",
    },
  ]);
});

test("lock timeout is surfaced without running migration statements", async () => {
  const fixture = migrationFixture();
  const { pool, events } = createPoolMock({ lockAcquired: 0 });
  await assert.rejects(
    migrateUp(pool, [fixture], { database: "app_db", lockName: "test:migrations" }),
    /Timed out waiting for migration lock/
  );
  assert.ok(!events.some((event) => event.type === "ensure-table"));
  assert.ok(events.some((event) => event.type === "release-connection"));
});

test("migration CLI exits before creating a pool when database configuration is missing", async () => {
  let createPoolCalled = false;
  const errors = [];
  const exitCode = await main({
    argv: ["status"],
    env: {},
    output: {
      log() {},
      error(message) {
        errors.push(message);
      },
    },
    createPool() {
      createPoolCalled = true;
      throw new Error("pool should not be created");
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(createPoolCalled, false);
  assert.match(errors[0], /DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME/);
});

test("migration CLI status exits non-zero for non-contiguous history", async () => {
  const loaded = loadMigrations(MIGRATIONS_DIR);
  const second = loaded.find((item) => item.id === "002_outbox_tenant_fk");
  assert.ok(second);
  const { pool, events } = createPoolMock({
    applied: [
      {
        version: second.id,
        name: second.name,
        checksum: second.checksum,
        execution_ms: 1,
        applied_at: "2026-07-22 00:00:00",
      },
    ],
  });
  const logs = [];
  const errors = [];

  const exitCode = await main({
    argv: ["status"],
    env: {
      DB_HOST: "db.example.test",
      DB_PORT: "3306",
      DB_USER: "app",
      DB_PASSWORD: "test-secret",
      DB_NAME: "app_db",
    },
    migrationsDir: MIGRATIONS_DIR,
    createPool() {
      return pool;
    },
    output: {
      log(message) {
        logs.push(message);
      },
      error(message) {
        errors.push(message);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.ok(logs.some((line) => /^pending\s+001_ilink_runtime/.test(line)));
  assert.ok(logs.some((line) => /^applied\s+002_outbox_tenant_fk/.test(line)));
  assert.ok(errors.some((line) => /history is not contiguous/.test(line)));
  assert.ok(events.some((event) => event.type === "end-pool"));
});

test("first migration recognizes an existing import data uniqueness index", async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (/information_schema\.statistics/.test(sql)) {
        return [[
          {
            indexName: "uq_import_kind_date_data",
            nonUnique: 0,
            sequenceNumber: 1,
            columnName: "kind",
          },
          {
            indexName: "uq_import_kind_date_data",
            nonUnique: 0,
            sequenceNumber: 2,
            columnName: "import_date",
          },
          {
            indexName: "uq_import_kind_date_data",
            nonUnique: 0,
            sequenceNumber: 3,
            columnName: "data_hash",
          },
        ]];
      }
      return [{ affectedRows: 0 }];
    },
  };
  await migration.up(db);
  assert.equal(calls.length, migration.statements.length + 1);
  assert.ok(!calls.some((sql) => /ALTER TABLE import_records/.test(sql)));
});

test("first migration upgrades a legacy non-unique import data index", async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (/information_schema\.statistics/.test(sql)) {
        return [[
          {
            indexName: "idx_import_kind_date_data",
            nonUnique: 1,
            sequenceNumber: 1,
            columnName: "kind",
          },
          {
            indexName: "idx_import_kind_date_data",
            nonUnique: 1,
            sequenceNumber: 2,
            columnName: "import_date",
          },
          {
            indexName: "idx_import_kind_date_data",
            nonUnique: 1,
            sequenceNumber: 3,
            columnName: "data_hash",
          },
        ]];
      }
      return [{ affectedRows: 0 }];
    },
  };
  await migration.up(db);
  assert.equal(calls.length, migration.statements.length + 2);
  assert.match(calls.at(-1), /ADD UNIQUE KEY uq_import_kind_date_data/);
  assert.ok(calls.every((sql) => typeof sql === "string"));
});

test("tenant FK migration replaces the global inbox reference", async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (/COUNT\(\*\) AS invalidReplyCount/.test(sql)) {
        return [[{ invalidReplyCount: 0 }]];
      }
      if (/information_schema\.statistics/.test(sql)) {
        return [[
          {
            indexName: "PRIMARY",
            nonUnique: 0,
            sequenceNumber: 1,
            columnName: "id",
          },
        ]];
      }
      if (/information_schema\.key_column_usage/.test(sql)) {
        return [[
          {
            constraintName: "fk_outbox_inbox",
            position: 1,
            columnName: "reply_to_inbox_id",
            referencedColumnName: "id",
            updateRule: "RESTRICT",
            deleteRule: "SET NULL",
          },
        ]];
      }
      return [{ affectedRows: 0 }];
    },
  };

  await tenantFkMigration.up(db);

  const sql = calls.join("\n");
  assert.match(
    sql,
    /ADD UNIQUE KEY `uq_inbox_scope_id` \(`workspace_id`, `account_id`, `id`\)/
  );
  assert.match(sql, /DROP FOREIGN KEY `fk_outbox_inbox`/);
  assert.match(sql, /ADD CONSTRAINT `fk_outbox_inbox_scope`/);
  assert.match(
    sql,
    /FOREIGN KEY \(`workspace_id`, `account_id`, `reply_to_inbox_id`\)/
  );
  assert.match(
    sql,
    /REFERENCES `inbox_messages` \(`workspace_id`, `account_id`, `id`\)/
  );
  assert.match(sql, /ON UPDATE RESTRICT ON DELETE RESTRICT/);
});

test("tenant FK migration is idempotent after the scoped keys exist", async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (/COUNT\(\*\) AS invalidReplyCount/.test(sql)) {
        return [[{ invalidReplyCount: 0 }]];
      }
      if (/information_schema\.statistics/.test(sql)) {
        return [[
          {
            indexName: "uq_inbox_scope_id",
            nonUnique: 0,
            sequenceNumber: 1,
            columnName: "workspace_id",
          },
          {
            indexName: "uq_inbox_scope_id",
            nonUnique: 0,
            sequenceNumber: 2,
            columnName: "account_id",
          },
          {
            indexName: "uq_inbox_scope_id",
            nonUnique: 0,
            sequenceNumber: 3,
            columnName: "id",
          },
        ]];
      }
      if (/information_schema\.key_column_usage/.test(sql)) {
        return [[
          {
            constraintName: "fk_outbox_inbox_scope",
            position: 1,
            columnName: "workspace_id",
            referencedColumnName: "workspace_id",
            updateRule: "RESTRICT",
            deleteRule: "RESTRICT",
          },
          {
            constraintName: "fk_outbox_inbox_scope",
            position: 2,
            columnName: "account_id",
            referencedColumnName: "account_id",
            updateRule: "RESTRICT",
            deleteRule: "RESTRICT",
          },
          {
            constraintName: "fk_outbox_inbox_scope",
            position: 3,
            columnName: "reply_to_inbox_id",
            referencedColumnName: "id",
            updateRule: "RESTRICT",
            deleteRule: "RESTRICT",
          },
        ]];
      }
      throw new Error(`Unexpected migration statement: ${sql}`);
    },
  };

  await tenantFkMigration.up(db);

  assert.equal(calls.length, 3);
  assert.ok(!calls.some((sql) => /^ALTER TABLE/.test(sql)));
});

test("tenant FK migration rejects existing cross-tenant replies", async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      return [[{ invalidReplyCount: 2 }]];
    },
  };

  await assert.rejects(
    tenantFkMigration.up(db),
    /2 rows reference a missing or cross-tenant inbox message/
  );
  assert.equal(calls.length, 1);
});
