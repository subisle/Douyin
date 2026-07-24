"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntimeCrypto } = require("./ilink-crypto");
const { createAccountCredentialStore } = require("./ilink-account-credentials");

/**
 * In-memory MySQL pool covering SQL issued by createAccountCredentialStore.
 * mysql2-shaped results: [rows, fields] or [ResultSetHeader, fields].
 */
function createMemoryPool(seed = {}) {
  /** @type {Map<string, {
   *   id: number,
   *   workspace_id: string,
   *   account_key: string,
   *   display_name: string,
   *   api_base_url: string,
   *   credential_ciphertext: string|null,
   *   credential_key_id: string|null,
   *   status: string,
   *   enabled: number
   * }>} */
  const accounts = new Map(seed.accounts || []);
  let nextAccountId = seed.nextAccountId || 1;
  /** @type {string[]} */
  const statements = [];

  function accountKey(workspaceId, accountKeyValue) {
    return `${workspaceId}\0${accountKeyValue}`;
  }

  function findById(workspaceId, accountId) {
    for (const row of accounts.values()) {
      if (row.workspace_id === workspaceId && Number(row.id) === Number(accountId)) {
        return row;
      }
    }
    return null;
  }

  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, " ").trim();
    statements.push(s);

    // INSERT INTO ilink_accounts ... ON DUPLICATE KEY UPDATE
    // Params: workspaceId, accountKey, displayName, apiBaseUrl, ciphertext, keyId
    // (status/enabled are SQL literals, not bind params)
    if (s.includes("INSERT INTO ilink_accounts")) {
      const [
        workspaceId,
        accountKeyValue,
        displayName,
        apiBaseUrl,
        ciphertext,
        keyId,
      ] = params;
      const key = accountKey(workspaceId, accountKeyValue);
      const existing = accounts.get(key);
      if (existing) {
        existing.api_base_url = apiBaseUrl;
        existing.credential_ciphertext = ciphertext;
        existing.credential_key_id = keyId;
        const nextName = displayName == null ? "" : String(displayName);
        if (nextName !== "") existing.display_name = nextName;
        existing.status = "connected";
        return [{ affectedRows: 2, insertId: existing.id, warningStatus: 0 }, undefined];
      }
      const id = nextAccountId++;
      accounts.set(key, {
        id,
        workspace_id: workspaceId,
        account_key: accountKeyValue,
        display_name: displayName == null ? "" : String(displayName),
        api_base_url: apiBaseUrl,
        credential_ciphertext: ciphertext,
        credential_key_id: keyId,
        status: "connected",
        enabled: 1,
      });
      return [{ affectedRows: 1, insertId: id, warningStatus: 0 }, undefined];
    }

    // SELECT ... FROM ilink_accounts by numeric id (avoid matching workspace_id = ?)
    if (
      s.includes("FROM ilink_accounts") &&
      s.includes("SELECT") &&
      /(?:^|[^_])\bid\s*=\s*\?/i.test(s)
    ) {
      const [workspaceId, accountId] = params;
      const row = findById(workspaceId, accountId);
      return [row ? [{ ...row }] : [], undefined];
    }

    // SELECT ... FROM ilink_accounts by account_key
    if (
      s.includes("FROM ilink_accounts") &&
      s.includes("SELECT") &&
      /account_key\s*=\s*\?/i.test(s)
    ) {
      const [workspaceId, accountKeyValue] = params;
      const row = accounts.get(accountKey(workspaceId, accountKeyValue));
      return [row ? [{ ...row }] : [], undefined];
    }

    // UPDATE ilink_accounts SET credential_ciphertext = NULL ...
    if (s.includes("UPDATE ilink_accounts") || s.includes("UPDATE `ilink_accounts`")) {
      if (/(?:^|[^_])\bid\s*=\s*\?/i.test(s) && params.length >= 2) {
        const [workspaceId, accountId] = params;
        const row = findById(workspaceId, accountId);
        if (!row) return [{ affectedRows: 0, warningStatus: 0 }, undefined];
        row.credential_ciphertext = null;
        row.credential_key_id = null;
        return [{ affectedRows: 1, warningStatus: 0 }, undefined];
      }
      if (/account_key\s*=\s*\?/i.test(s) && params.length >= 2) {
        const [workspaceId, accountKeyValue] = params;
        const row = accounts.get(accountKey(workspaceId, accountKeyValue));
        if (!row) return [{ affectedRows: 0, warningStatus: 0 }, undefined];
        row.credential_ciphertext = null;
        row.credential_key_id = null;
        return [{ affectedRows: 1, warningStatus: 0 }, undefined];
      }
    }

    throw new Error(`memory pool: unhandled SQL: ${s}`);
  }

  return {
    async query(sql, params) {
      return query(sql, params);
    },
    __state: { accounts, statements },
  };
}

function createFixedNow(iso = "2026-01-01T00:00:00.000Z") {
  const fixed = new Date(iso);
  return () => new Date(fixed.getTime());
}

test("setCredential → getCredential roundtrip returns token/baseUrl", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  const now = createFixedNow();
  const store = createAccountCredentialStore({ pool, crypto: cryptoApi, now });

  const setResult = await store.setCredential({
    workspaceId: "ws1",
    accountKey: "acc-a",
    token: "tok-secret",
    baseUrl: "https://example.ilink.test",
    displayName: "Account A",
  });
  assert.equal(setResult.ok, true);
  assert.equal(typeof setResult.accountId, "number");

  const getResult = await store.getCredential({
    workspaceId: "ws1",
    accountKey: "acc-a",
  });
  assert.equal(getResult.ok, true);
  assert.equal(getResult.accountId, setResult.accountId);
  assert.equal(getResult.token, "tok-secret");
  assert.equal(getResult.baseUrl, "https://example.ilink.test");
  assert.equal(getResult.accountKey, "acc-a");
  assert.equal(typeof getResult.keyId, "string");
  assert.ok(getResult.keyId.length > 0);

  // ciphertext must not be plaintext token
  const row = [...pool.__state.accounts.values()][0];
  assert.notEqual(row.credential_ciphertext, "tok-secret");
  assert.ok(!String(row.credential_ciphertext).includes("tok-secret"));
});

test("getCredential missing account → NOT_FOUND", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  const store = createAccountCredentialStore({ pool, crypto: cryptoApi });

  const byKey = await store.getCredential({
    workspaceId: "ws1",
    accountKey: "missing",
  });
  assert.equal(byKey.ok, false);
  assert.equal(byKey.code, "NOT_FOUND");

  const byId = await store.getCredential({
    workspaceId: "ws1",
    accountId: 999,
  });
  assert.equal(byId.ok, false);
  assert.equal(byId.code, "NOT_FOUND");
});

test("clearCredential → getCredential returns NOT_FOUND", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  const store = createAccountCredentialStore({ pool, crypto: cryptoApi });

  const setResult = await store.setCredential({
    workspaceId: "ws1",
    accountKey: "acc-clear",
    token: "tok-clear",
  });
  assert.equal(setResult.ok, true);

  const cleared = await store.clearCredential({
    workspaceId: "ws1",
    accountKey: "acc-clear",
  });
  assert.equal(cleared.ok, true);

  const after = await store.getCredential({
    workspaceId: "ws1",
    accountKey: "acc-clear",
  });
  assert.equal(after.ok, false);
  assert.equal(after.code, "NOT_FOUND");

  // also clear by accountId
  const set2 = await store.setCredential({
    workspaceId: "ws1",
    accountKey: "acc-clear-id",
    token: "tok-2",
  });
  const clearedById = await store.clearCredential({
    workspaceId: "ws1",
    accountId: set2.accountId,
  });
  assert.equal(clearedById.ok, true);
  const afterId = await store.getCredential({
    workspaceId: "ws1",
    accountId: set2.accountId,
  });
  assert.equal(afterId.ok, false);
  assert.equal(afterId.code, "NOT_FOUND");
});

test("getCredential with bad ciphertext → DECRYPT_ERROR", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  // seed a row with unreadable ciphertext
  pool.__state.accounts.set("ws1\0acc-bad", {
    id: 42,
    workspace_id: "ws1",
    account_key: "acc-bad",
    display_name: "",
    api_base_url: "https://ilinkai.weixin.qq.com",
    credential_ciphertext: "not-a-valid-ciphertext",
    credential_key_id: "v1",
    status: "connected",
    enabled: 1,
  });
  const store = createAccountCredentialStore({ pool, crypto: cryptoApi });

  const result = await store.getCredential({
    workspaceId: "ws1",
    accountKey: "acc-bad",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DECRYPT_ERROR");
  assert.equal(typeof result.error, "string");
});

test("setCredential twice with same accountKey keeps accountId and updates token", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  const store = createAccountCredentialStore({
    pool,
    crypto: cryptoApi,
    now: createFixedNow("2026-01-01T00:00:00.000Z"),
  });

  const first = await store.setCredential({
    workspaceId: "ws1",
    accountKey: "acc-upsert",
    token: "token-v1",
    baseUrl: "https://first.example",
  });
  assert.equal(first.ok, true);

  const second = await store.setCredential({
    workspaceId: "ws1",
    accountKey: "acc-upsert",
    token: "token-v2",
    baseUrl: "https://second.example",
  });
  assert.equal(second.ok, true);
  assert.equal(second.accountId, first.accountId);
  assert.equal(pool.__state.accounts.size, 1);

  const got = await store.getCredential({
    workspaceId: "ws1",
    accountId: first.accountId,
  });
  assert.equal(got.ok, true);
  assert.equal(got.token, "token-v2");
  assert.equal(got.baseUrl, "https://second.example");
  assert.equal(got.accountKey, "acc-upsert");
});
