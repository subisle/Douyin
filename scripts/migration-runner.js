"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_FILE_PATTERN = /^\d{3,}_[a-z0-9_]+\.js$/;
const DEFAULT_LOCK_TIMEOUT_SECONDS = 30;

const CREATE_MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(255) NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  execution_ms INT UNSIGNED NOT NULL DEFAULT 0,
  applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

function checksumSource(source) {
  return crypto.createHash("sha256").update(source).digest("hex");
}

function validateMigration(migration, filePath = "<memory>") {
  if (!migration || typeof migration !== "object") {
    throw new Error(`Migration ${filePath} must export an object`);
  }
  const id = String(migration.id || "").trim();
  const name = String(migration.name || "").trim();
  if (!/^\d{3,}_[a-z0-9_]+$/.test(id)) {
    throw new Error(`Migration ${filePath} has an invalid id: ${id || "<empty>"}`);
  }
  if (!name) throw new Error(`Migration ${filePath} must define a name`);
  if (typeof migration.up !== "function" && !Array.isArray(migration.up)) {
    throw new Error(`Migration ${filePath} must define up as a function or SQL array`);
  }
  if (Array.isArray(migration.up)) {
    for (const statement of migration.up) {
      if (typeof statement !== "string" || !statement.trim()) {
        throw new Error(`Migration ${filePath} contains an invalid SQL statement`);
      }
    }
  }
  return { ...migration, id, name };
}

function loadMigrations(directory) {
  const fileNames = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  const seen = new Set();
  return fileNames.map((fileName) => {
    const filePath = path.join(directory, fileName);
    const source = fs.readFileSync(filePath);
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
    const migration = validateMigration(require(resolved), filePath);
    const expectedId = path.basename(fileName, ".js");
    if (migration.id !== expectedId) {
      throw new Error(
        `Migration id ${migration.id} does not match file name ${expectedId}`
      );
    }
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id: ${migration.id}`);
    }
    seen.add(migration.id);
    return {
      ...migration,
      filePath,
      checksum: checksumSource(source),
    };
  });
}

function normalizeLockTimeout(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3600) {
    return DEFAULT_LOCK_TIMEOUT_SECONDS;
  }
  return parsed;
}

function buildLockName(databaseName) {
  const database = String(databaseName || "default");
  const digest = checksumSource(database).slice(0, 24);
  return `douyin:migrations:${digest}`;
}

async function withMigrationLock(pool, options, operation) {
  const lockName = String(options.lockName || buildLockName(options.database));
  const timeoutSeconds = normalizeLockTimeout(options.lockTimeoutSeconds);
  const connection = await pool.getConnection();
  let acquired = false;
  let result;
  let operationError = null;
  let releaseError = null;

  try {
    const [rows] = await connection.query(
      "SELECT GET_LOCK(?, ?) AS acquired",
      [lockName, timeoutSeconds]
    );
    acquired = Number(rows[0]?.acquired) === 1;
    if (!acquired) {
      throw new Error(
        `Timed out waiting for migration lock ${lockName} after ${timeoutSeconds}s`
      );
    }
    result = await operation(connection);
  } catch (error) {
    operationError = error;
  } finally {
    if (acquired) {
      try {
        const [rows] = await connection.query(
          "SELECT RELEASE_LOCK(?) AS released",
          [lockName]
        );
        if (Number(rows[0]?.released) !== 1) {
          throw new Error(`MySQL did not release migration lock ${lockName}`);
        }
      } catch (error) {
        releaseError = error;
      }
    }
    connection.release();
  }

  if (operationError) {
    if (releaseError && operationError && typeof operationError === "object") {
      operationError.releaseLockError = releaseError;
    }
    throw operationError;
  }
  if (releaseError) throw releaseError;
  return result;
}

async function ensureMigrationsTable(connection) {
  await connection.query(CREATE_MIGRATIONS_TABLE_SQL);
}

async function readAppliedMigrations(connection) {
  const [rows] = await connection.query(
    `SELECT version, name, checksum, execution_ms, applied_at
       FROM schema_migrations
      ORDER BY version`
  );
  return rows.map((row) => ({
    id: String(row.version),
    name: String(row.name),
    checksum: String(row.checksum),
    executionMs: Number(row.execution_ms) || 0,
    appliedAt: row.applied_at,
  }));
}

function compareMigrationState(migrations, appliedMigrations) {
  const localById = new Map(migrations.map((migration) => [migration.id, migration]));
  const appliedById = new Map(appliedMigrations.map((migration) => [migration.id, migration]));
  const items = migrations.map((migration) => {
    const applied = appliedById.get(migration.id);
    if (!applied) return { ...migration, state: "pending", applied: null };
    const state = applied.checksum === migration.checksum ? "applied" : "checksum_mismatch";
    return { ...migration, state, applied };
  });
  const orphaned = appliedMigrations
    .filter((migration) => !localById.has(migration.id))
    .map((migration) => ({ ...migration, state: "missing_local_file" }));
  return { items, orphaned };
}

function collectMigrationStateIssues(state) {
  const issues = [];
  for (const mismatch of state.items.filter(
    (item) => item.state === "checksum_mismatch"
  )) {
    issues.push({
      type: "checksum_mismatch",
      migrationId: mismatch.id,
      message:
        `Checksum mismatch for applied migration ${mismatch.id}: ` +
        `database=${mismatch.applied.checksum} local=${mismatch.checksum}`,
    });
  }

  for (const orphaned of state.orphaned) {
    issues.push({
      type: "missing_local_file",
      migrationId: orphaned.id,
      message: `Applied migration is missing locally: ${orphaned.id}`,
    });
  }

  let firstPendingId = null;
  for (const item of state.items) {
    if (item.state === "pending" && firstPendingId === null) {
      firstPendingId = item.id;
    }
    const existsInDatabase =
      item.state === "applied" || item.state === "checksum_mismatch";
    if (existsInDatabase && firstPendingId !== null) {
      issues.push({
        type: "non_contiguous_history",
        migrationId: item.id,
        pendingMigrationId: firstPendingId,
        message:
          `Migration history is not contiguous: ${item.id} is applied after pending ` +
          firstPendingId,
      });
    }
  }
  return issues;
}

function assertMigrationStateIsValid(state) {
  const issue = collectMigrationStateIssues(state)[0];
  if (issue) throw new Error(issue.message);
}

async function executeMigration(connection, migration) {
  if (typeof migration.up === "function") {
    await migration.up(connection);
    return;
  }
  for (const statement of migration.up) {
    await connection.query(statement);
  }
}

async function getMigrationStatus(pool, migrations, options = {}) {
  return withMigrationLock(pool, options, async (connection) => {
    await ensureMigrationsTable(connection);
    const applied = await readAppliedMigrations(connection);
    const state = compareMigrationState(migrations, applied);
    return { ...state, issues: collectMigrationStateIssues(state) };
  });
}

async function migrateUp(pool, migrations, options = {}) {
  return withMigrationLock(pool, options, async (connection) => {
    await ensureMigrationsTable(connection);
    const applied = await readAppliedMigrations(connection);
    const initialState = compareMigrationState(migrations, applied);
    assertMigrationStateIsValid(initialState);

    const appliedNow = [];
    for (const migration of initialState.items) {
      if (migration.state === "applied") continue;
      const startedAt = Date.now();
      await executeMigration(connection, migration);
      const executionMs = Math.max(0, Date.now() - startedAt);
      await connection.query(
        `INSERT INTO schema_migrations
           (version, name, checksum, execution_ms)
         VALUES (?, ?, ?, ?)`,
        [migration.id, migration.name, migration.checksum, executionMs]
      );
      appliedNow.push({ id: migration.id, name: migration.name, executionMs });
    }
    return { applied: appliedNow };
  });
}

module.exports = {
  CREATE_MIGRATIONS_TABLE_SQL,
  buildLockName,
  checksumSource,
  collectMigrationStateIssues,
  compareMigrationState,
  executeMigration,
  getMigrationStatus,
  loadMigrations,
  migrateUp,
  validateMigration,
  withMigrationLock,
};
