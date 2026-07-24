"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDbLeaseStore } = require("./ilink-db-lease");

/**
 * Minimal in-memory MySQL pool that understands the SQL issued by createDbLeaseStore.
 * Returns mysql2-shaped results: [rows, fields] or [ResultSetHeader, fields].
 */
function createMemoryPool() {
  /** @type {Map<string, { id: number, workspace_id: string, account_key: string, api_base_url: string }>} */
  const accounts = new Map();
  /** @type {Map<string, {
   *   workspace_id: string,
   *   account_id: number,
   *   lease_name: string,
   *   owner_id: string|null,
   *   fencing_token: number,
   *   lease_expires_at: Date|null,
   *   heartbeat_at: Date|null,
   *   acquire_count: number,
   *   session_id: string|null
   * }>} */
  const leases = new Map();
  let nextAccountId = 1;

  function accountKey(workspaceId, accountKeyValue) {
    return `${workspaceId}\0${accountKeyValue}`;
  }

  function leaseKey(workspaceId, accountId, leaseName) {
    return `${workspaceId}\0${accountId}\0${leaseName}`;
  }

  function toDate(value) {
    if (value == null) return null;
    if (value instanceof Date) return value;
    return new Date(value);
  }

  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, " ").trim();

    // INSERT INTO ilink_accounts ... ON DUPLICATE KEY UPDATE
    if (s.includes("INSERT INTO ilink_accounts")) {
      const [workspaceId, accountKeyValue, apiBaseUrl] = params;
      const key = accountKey(workspaceId, accountKeyValue);
      const existing = accounts.get(key);
      if (existing) {
        existing.api_base_url = apiBaseUrl;
        return [{ affectedRows: 2, insertId: existing.id, warningStatus: 0 }, undefined];
      }
      const id = nextAccountId++;
      accounts.set(key, {
        id,
        workspace_id: workspaceId,
        account_key: accountKeyValue,
        api_base_url: apiBaseUrl,
      });
      return [{ affectedRows: 1, insertId: id, warningStatus: 0 }, undefined];
    }

    // SELECT id FROM ilink_accounts WHERE workspace_id=? AND account_key=?
    if (s.includes("FROM ilink_accounts") && s.includes("SELECT")) {
      const [workspaceId, accountKeyValue] = params;
      const row = accounts.get(accountKey(workspaceId, accountKeyValue));
      return [row ? [{ id: row.id }] : [], undefined];
    }

    // SELECT * FROM bot_runner_leases ... FOR UPDATE
    if (s.includes("FROM bot_runner_leases") && s.includes("SELECT")) {
      const [workspaceId, accountId, leaseName] = params;
      const row = leases.get(leaseKey(workspaceId, accountId, leaseName));
      if (!row) return [[], undefined];
      return [[{ ...row }], undefined];
    }

    // INSERT INTO bot_runner_leases
    if (s.includes("INSERT INTO bot_runner_leases")) {
      // (workspace_id, account_id, lease_name, owner_id, fencing_token, lease_expires_at, heartbeat_at, acquire_count)
      const [
        workspaceId,
        accountId,
        leaseName,
        ownerId,
        fencingToken,
        leaseExpiresAt,
        heartbeatAt,
        acquireCount,
      ] = params;
      const key = leaseKey(workspaceId, accountId, leaseName);
      if (leases.has(key)) {
        const err = new Error("Duplicate entry");
        err.code = "ER_DUP_ENTRY";
        throw err;
      }
      leases.set(key, {
        workspace_id: workspaceId,
        account_id: Number(accountId),
        lease_name: leaseName,
        owner_id: ownerId,
        fencing_token: Number(fencingToken),
        lease_expires_at: toDate(leaseExpiresAt),
        heartbeat_at: toDate(heartbeatAt),
        acquire_count: Number(acquireCount ?? 1),
        session_id: null,
      });
      return [{ affectedRows: 1, insertId: 1, warningStatus: 0 }, undefined];
    }

    // UPDATE bot_runner_leases ...
    if (s.includes("UPDATE bot_runner_leases") || s.includes("UPDATE `bot_runner_leases`")) {
      // Preempt / acquire-self renew / take over: fencing_token = fencing_token + 1 OR SET owner_id
      // We match by WHERE params which always end with identity + optional fencing/owner checks.

      // Detect release: SET owner_id = NULL (or owner_id=NULL)
      if (/SET\s+owner_id\s*=\s*NULL/i.test(s) || s.includes("owner_id = NULL")) {
        // WHERE workspace_id=? AND account_id=? AND lease_name=? AND owner_id=? AND fencing_token=?
        const [workspaceId, accountId, leaseName, ownerId, fencingToken] = params;
        const key = leaseKey(workspaceId, accountId, leaseName);
        const row = leases.get(key);
        if (
          !row ||
          row.owner_id !== ownerId ||
          Number(row.fencing_token) !== Number(fencingToken)
        ) {
          return [{ affectedRows: 0, warningStatus: 0 }, undefined];
        }
        row.owner_id = null;
        row.lease_expires_at = null;
        row.heartbeat_at = null;
        return [{ affectedRows: 1, warningStatus: 0 }, undefined];
      }

      // Detect renew: extends expires without bumping fencing (no fencing_token = fencing_token + 1)
      if (!s.includes("fencing_token = fencing_token + 1") && !s.includes("fencing_token=fencing_token+1")) {
        // renew: SET lease_expires_at=?, heartbeat_at=? WHERE ... owner_id=? AND fencing_token=? AND (lease_expires_at IS NULL OR lease_expires_at > ?)
        const [
          leaseExpiresAt,
          heartbeatAt,
          workspaceId,
          accountId,
          leaseName,
          ownerId,
          fencingToken,
          now,
        ] = params;
        const key = leaseKey(workspaceId, accountId, leaseName);
        const row = leases.get(key);
        if (
          !row ||
          row.owner_id !== ownerId ||
          Number(row.fencing_token) !== Number(fencingToken)
        ) {
          return [{ affectedRows: 0, warningStatus: 0 }, undefined];
        }
        const nowDate = toDate(now);
        if (row.lease_expires_at != null && row.lease_expires_at <= nowDate) {
          return [{ affectedRows: 0, warningStatus: 0 }, undefined];
        }
        row.lease_expires_at = toDate(leaseExpiresAt);
        row.heartbeat_at = toDate(heartbeatAt);
        return [{ affectedRows: 1, warningStatus: 0 }, undefined];
      }

      // Preempt / re-acquire: SET owner_id=?, fencing_token=fencing_token+1, lease_expires_at=?, heartbeat_at=?, acquire_count=acquire_count+1
      // WHERE workspace_id=? AND account_id=? AND lease_name=? AND fencing_token=?
      // (optionally with expires condition already applied in app logic; we still honor fencing match)
      const [
        ownerId,
        leaseExpiresAt,
        heartbeatAt,
        workspaceId,
        accountId,
        leaseName,
        fencingToken,
      ] = params;
      const key = leaseKey(workspaceId, accountId, leaseName);
      const row = leases.get(key);
      if (!row || Number(row.fencing_token) !== Number(fencingToken)) {
        return [{ affectedRows: 0, warningStatus: 0 }, undefined];
      }
      row.owner_id = ownerId;
      row.fencing_token = Number(row.fencing_token) + 1;
      row.lease_expires_at = toDate(leaseExpiresAt);
      row.heartbeat_at = toDate(heartbeatAt);
      row.acquire_count = Number(row.acquire_count) + 1;
      return [{ affectedRows: 1, warningStatus: 0 }, undefined];
    }

    // Self-renew style update that keeps fencing (owner==self unexpired path may use this)
    // Covered above via renew detection when fencing is not incremented.

    throw new Error(`memory pool: unhandled SQL: ${s}`);
  }

  const pool = {
    async query(sql, params) {
      return query(sql, params);
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async query(sql, params) {
          return query(sql, params);
        },
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
    __state: { accounts, leases },
  };
  return pool;
}

function createClock(startMs = Date.parse("2026-01-01T00:00:00.000Z")) {
  let nowMs = startMs;
  return {
    now: () => new Date(nowMs),
    advance(ms) {
      nowMs += ms;
    },
    set(ms) {
      nowMs = ms;
    },
  };
}

test("ensureAccount creates and returns stable accountId on second call", async () => {
  const pool = createMemoryPool();
  const store = createDbLeaseStore({ pool, now: () => new Date() });

  const first = await store.ensureAccount({
    workspaceId: "ws1",
    accountKey: "acc-a",
    apiBaseUrl: "https://ilinkai.weixin.qq.com",
  });
  const second = await store.ensureAccount({
    workspaceId: "ws1",
    accountKey: "acc-a",
    apiBaseUrl: "https://ilinkai.weixin.qq.com",
  });

  assert.equal(typeof first.accountId, "number");
  assert.equal(first.accountId, second.accountId);
  assert.ok(first.accountId >= 1);
});

test("acquire empty → ok fencingToken 1", async () => {
  const clock = createClock();
  const pool = createMemoryPool();
  const store = createDbLeaseStore({ pool, now: clock.now });

  const { accountId } = await store.ensureAccount({
    workspaceId: "ws1",
    accountKey: "acc-a",
  });

  const result = await store.acquire({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-1",
    ttlMs: 30_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.fencingToken, 1);
  assert.equal(result.ownerId, "owner-1");
  assert.ok(result.expiresAt instanceof Date);
  assert.equal(result.expiresAt.getTime(), clock.now().getTime() + 30_000);
});

test("second different owner while unexpired → fail", async () => {
  const clock = createClock();
  const pool = createMemoryPool();
  const store = createDbLeaseStore({ pool, now: clock.now });

  const { accountId } = await store.ensureAccount({
    workspaceId: "ws1",
    accountKey: "acc-a",
  });

  const first = await store.acquire({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-1",
    ttlMs: 30_000,
  });
  assert.equal(first.ok, true);

  const second = await store.acquire({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-2",
    ttlMs: 30_000,
  });
  assert.equal(second.ok, false);
  assert.match(String(second.error), /lease held/i);
});

test("after expire, second owner acquire → ok fencingToken 2", async () => {
  const clock = createClock();
  const pool = createMemoryPool();
  const store = createDbLeaseStore({ pool, now: clock.now });

  const { accountId } = await store.ensureAccount({
    workspaceId: "ws1",
    accountKey: "acc-a",
  });

  const first = await store.acquire({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-1",
    ttlMs: 10_000,
  });
  assert.equal(first.ok, true);
  assert.equal(first.fencingToken, 1);

  clock.advance(10_001);

  const second = await store.acquire({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-2",
    ttlMs: 10_000,
  });
  assert.equal(second.ok, true);
  assert.equal(second.fencingToken, 2);
  assert.equal(second.ownerId, "owner-2");
});

test("renew with wrong fencing → fail", async () => {
  const clock = createClock();
  const pool = createMemoryPool();
  const store = createDbLeaseStore({ pool, now: clock.now });

  const { accountId } = await store.ensureAccount({
    workspaceId: "ws1",
    accountKey: "acc-a",
  });

  const acquired = await store.acquire({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-1",
    ttlMs: 30_000,
  });
  assert.equal(acquired.ok, true);

  const renewed = await store.renew({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-1",
    fencingToken: acquired.fencingToken + 99,
    ttlMs: 30_000,
  });
  assert.equal(renewed.ok, false);
  assert.ok(renewed.error);
});

test("renew with correct fencing → extends expires", async () => {
  const clock = createClock();
  const pool = createMemoryPool();
  const store = createDbLeaseStore({ pool, now: clock.now });

  const { accountId } = await store.ensureAccount({
    workspaceId: "ws1",
    accountKey: "acc-a",
  });

  const acquired = await store.acquire({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-1",
    ttlMs: 30_000,
  });
  assert.equal(acquired.ok, true);
  const originalExpiry = acquired.expiresAt.getTime();

  clock.advance(5_000);

  const renewed = await store.renew({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-1",
    fencingToken: acquired.fencingToken,
    ttlMs: 30_000,
  });
  assert.equal(renewed.ok, true);
  assert.equal(renewed.fencingToken, acquired.fencingToken);
  assert.equal(renewed.expiresAt.getTime(), clock.now().getTime() + 30_000);
  assert.ok(renewed.expiresAt.getTime() > originalExpiry);
});

test("release then other owner acquire → ok", async () => {
  const clock = createClock();
  const pool = createMemoryPool();
  const store = createDbLeaseStore({ pool, now: clock.now });

  const { accountId } = await store.ensureAccount({
    workspaceId: "ws1",
    accountKey: "acc-a",
  });

  const first = await store.acquire({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-1",
    ttlMs: 30_000,
  });
  assert.equal(first.ok, true);

  const released = await store.release({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-1",
    fencingToken: first.fencingToken,
  });
  assert.equal(released.ok, true);

  const second = await store.acquire({
    workspaceId: "ws1",
    accountId,
    ownerId: "owner-2",
    ttlMs: 30_000,
  });
  assert.equal(second.ok, true);
  assert.equal(second.ownerId, "owner-2");
  // release does not bump fencing; re-acquire after empty owner should bump
  assert.equal(second.fencingToken, 2);
});
