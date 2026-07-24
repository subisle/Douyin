#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Seed an encrypted iLink account credential into MySQL.
 *
 * Requires (after dotenv):
 *   BOT_RUNTIME_SECRET (>=16)
 *   DB_* (via resolveDbConfig)
 *   BOT_ILINK_ACCOUNT_KEY (or BOT_ILINK_ACCOUNT_ID)
 *   BOT_ILINK_TOKEN
 * Optional:
 *   BOT_ILINK_WORKSPACE_ID (default: default)
 *   BOT_ILINK_BASE_URL
 *
 * Prints accountId on success. Never prints the token.
 * Depends on createAccountCredentialStore (A1: scripts/ilink-account-credentials.js).
 */

const path = require("node:path");
const mysql = require("mysql2/promise");
const { resolveDbConfig } = require("../electron/db-config");
const { createRuntimeCrypto } = require("./ilink-crypto");
const { createAccountCredentialStore } = require("./ilink-account-credentials");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function loadProjectEnvironment(env = process.env) {
  require("dotenv").config({
    path: path.join(PROJECT_ROOT, ".env"),
    processEnv: env,
    quiet: true,
  });
  return env;
}

function printUsage(output = console) {
  output.log("Usage: node scripts/ilink-seed-credential.js");
  output.log("  Writes BOT_ILINK_TOKEN into ilink_accounts.credential_ciphertext");
  output.log("Required env:");
  output.log("  BOT_RUNTIME_SECRET  (>=16 chars)");
  output.log("  DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME");
  output.log("  BOT_ILINK_ACCOUNT_KEY  (or BOT_ILINK_ACCOUNT_ID)");
  output.log("  BOT_ILINK_TOKEN");
  output.log("Optional:");
  output.log("  BOT_ILINK_WORKSPACE_ID  (default: default)");
  output.log("  BOT_ILINK_BASE_URL");
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, output?: Console, createPool?: Function }} [options]
 * @returns {Promise<number>} exit code
 */
async function main(options = {}) {
  const output = options.output || console;
  const env = options.env || loadProjectEnvironment(process.env);
  const createPool = options.createPool || ((config) => mysql.createPool(config));

  if (env.BOT_SEED_HELP === "1" || process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage(output);
    return 0;
  }

  const secret = String(env.BOT_RUNTIME_SECRET || "").trim();
  if (secret.length < 16) {
    output.error(
      "[seed-credential] BOT_RUNTIME_SECRET must be at least 16 characters"
    );
    return 1;
  }

  const workspaceId = String(env.BOT_ILINK_WORKSPACE_ID || "default").trim() || "default";
  const accountKey = String(
    env.BOT_ILINK_ACCOUNT_KEY || env.BOT_ILINK_ACCOUNT_ID || ""
  ).trim();
  const token = String(env.BOT_ILINK_TOKEN || "").trim();
  const baseUrl = String(env.BOT_ILINK_BASE_URL || "").trim() || undefined;

  if (!accountKey) {
    output.error(
      "[seed-credential] BOT_ILINK_ACCOUNT_KEY (or BOT_ILINK_ACCOUNT_ID) is required"
    );
    return 1;
  }
  if (!token) {
    output.error("[seed-credential] BOT_ILINK_TOKEN is required");
    return 1;
  }

  let config;
  try {
    config = resolveDbConfig(env);
  } catch (error) {
    output.error(`[seed-credential] ${error.message}`);
    return 1;
  }

  let pool;
  try {
    pool = createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 2,
      connectTimeout: 10_000,
      dateStrings: true,
    });
  } catch (error) {
    output.error(`[seed-credential] ${error.message}`);
    return 1;
  }

  let exitCode = 0;
  try {
    const cryptoApi = createRuntimeCrypto({ secret });
    const store = createAccountCredentialStore({ pool, crypto: cryptoApi });
    const result = await store.setCredential({
      workspaceId,
      accountKey,
      token,
      baseUrl,
    });

    if (!result || result.ok !== true || result.accountId == null) {
      const code = result && result.code ? String(result.code) : "SET_FAILED";
      output.error(`[seed-credential] setCredential failed: ${code}`);
      exitCode = 1;
    } else {
      // Never log token / ciphertext
      output.log(
        `[seed-credential] ok accountId=${result.accountId} workspaceId=${workspaceId} accountKey=${accountKey}`
      );
    }
  } catch (error) {
    output.error(`[seed-credential] ${error.message}`);
    exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch (error) {
      output.error(`[seed-credential] Failed to close database pool: ${error.message}`);
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
  loadProjectEnvironment,
  main,
  printUsage,
};
