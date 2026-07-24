"use strict";

/**
 * Shared MySQL + crypto factories for bot-worker / Next API login control.
 * Lazy: only constructs when env is complete.
 */

function createIlinkRuntimeContext(env = process.env) {
  const { resolveDbConfig } = require("../electron/db-config");
  const mysql = require("mysql2/promise");
  const { createRuntimeCrypto } = require("./ilink-crypto");
  const { createLoginControlStore } = require("./ilink-login-control");
  const { createAccountCredentialStore } = require("./ilink-account-credentials");

  const secret = String(env.BOT_RUNTIME_SECRET || "").trim();
  if (secret.length < 16) {
    throw new Error("BOT_RUNTIME_SECRET must be at least 16 characters");
  }
  const config = resolveDbConfig(env);
  const pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 4,
    connectTimeout: 10_000,
    dateStrings: true,
  });
  const cryptoApi = createRuntimeCrypto({ secret });
  return {
    pool,
    crypto: cryptoApi,
    loginStore: createLoginControlStore({ pool, crypto: cryptoApi }),
    credentialStore: createAccountCredentialStore({ pool, crypto: cryptoApi }),
    workspaceId: String(env.BOT_ILINK_WORKSPACE_ID || "default").trim() || "default",
  };
}

let singleton = null;

function getIlinkRuntimeContext(env = process.env) {
  if (!singleton) singleton = createIlinkRuntimeContext(env);
  return singleton;
}

function resetIlinkRuntimeContextForTests() {
  singleton = null;
}

module.exports = {
  createIlinkRuntimeContext,
  getIlinkRuntimeContext,
  resetIlinkRuntimeContextForTests,
};
