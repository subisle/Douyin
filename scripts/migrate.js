#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const path = require("node:path");
const mysql = require("mysql2/promise");
const { resolveDbConfig } = require("../electron/db-config");
const {
  buildLockName,
  getMigrationStatus,
  loadMigrations,
  migrateUp,
} = require("./migration-runner");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_MIGRATIONS_DIR = path.join(PROJECT_ROOT, "migrations");

function printUsage(output = console) {
  output.log("Usage: node scripts/migrate.js <up|status>");
  output.log("  up      Apply every pending migration in version order");
  output.log("  status  Show applied, pending, and checksum mismatch state");
  output.log("  down    Intentionally unsupported; restore from a verified backup instead");
}

function loadProjectEnvironment(env = process.env) {
  require("dotenv").config({
    path: path.join(PROJECT_ROOT, ".env"),
    processEnv: env,
    quiet: true,
  });
  return env;
}

function printStatus(state, output = console) {
  for (const item of state.items) {
    output.log(`${item.state.padEnd(18)} ${item.id} ${item.name}`);
  }
  for (const item of state.orphaned) {
    output.log(`${item.state.padEnd(18)} ${item.id} ${item.name}`);
  }
  for (const issue of state.issues || []) {
    output.error(`[migrate] ${issue.message}`);
  }
}

async function main(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const output = options.output || console;
  const env = options.env || loadProjectEnvironment(process.env);
  const createPool = options.createPool || ((config) => mysql.createPool(config));
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const command = argv[0] || "status";

  if (command === "help" || command === "--help" || command === "-h") {
    printUsage(output);
    return 0;
  }
  if (!new Set(["up", "status"]).has(command)) {
    output.error(`Unknown migration command: ${command}`);
    printUsage(output);
    return 2;
  }

  let config;
  try {
    config = resolveDbConfig(env);
  } catch (error) {
    output.error(`[migrate] ${error.message}`);
    return 1;
  }

  let migrations;
  try {
    migrations = loadMigrations(migrationsDir);
  } catch (error) {
    output.error(`[migrate] ${error.message}`);
    return 1;
  }

  let pool;
  try {
    pool = createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 2,
      connectTimeout: 10000,
      dateStrings: true,
    });
  } catch (error) {
    output.error(`[migrate] ${error.message}`);
    return 1;
  }
  const runnerOptions = {
    database: config.database,
    lockName: buildLockName(config.database),
    lockTimeoutSeconds: env.MIGRATION_LOCK_TIMEOUT_SECONDS,
  };

  let exitCode = 0;
  try {
    if (command === "up") {
      const result = await migrateUp(pool, migrations, runnerOptions);
      for (const migration of result.applied) {
        output.log(`applied ${migration.id} ${migration.name} (${migration.executionMs}ms)`);
      }
      if (result.applied.length === 0) output.log("No pending migrations.");
    } else {
      const state = await getMigrationStatus(pool, migrations, runnerOptions);
      printStatus(state, output);
      exitCode = state.issues.length > 0 ? 1 : 0;
    }
  } catch (error) {
    output.error(`[migrate] ${error.message}`);
    exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch (error) {
      output.error(`[migrate] Failed to close database pool: ${error.message}`);
      exitCode = 1;
    }
  }
  return exitCode;
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  loadProjectEnvironment,
  main,
  printStatus,
  printUsage,
};
