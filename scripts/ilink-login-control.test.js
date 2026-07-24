"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntimeCrypto } = require("./ilink-crypto");
const { createLoginControlStore } = require("./ilink-login-control");

function createMemoryPool() {
  /** @type {Map<string, object>} */
  const bySlot = new Map();
  /** @type {Map<string, object>} */
  const byRequestId = new Map();
  let nextId = 1;
  const statements = [];

  function slotKey(workspaceId, loginSlotId) {
    return `${workspaceId}\0${loginSlotId}`;
  }

  function toDate(value) {
    if (value == null) return null;
    if (value instanceof Date) return value;
    return new Date(value);
  }

  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, " ").trim();
    statements.push(s);

    if (s.includes("INSERT INTO ilink_login_requests")) {
      // Bind params: workspaceId, loginSlotId, accountId, actorId, requestId, expiresAt
      // status is SQL literal 'pending'
      const [
        workspaceId,
        loginSlotId,
        accountId,
        actorId,
        requestId,
        expiresAt,
      ] = params;
      const key = slotKey(workspaceId, loginSlotId);
      if (bySlot.has(key)) {
        const err = new Error("Duplicate entry for uq_ilink_login_slot");
        err.code = "ER_DUP_ENTRY";
        err.errno = 1062;
        throw err;
      }
      const id = nextId++;
      const row = {
        id,
        workspace_id: workspaceId,
        login_slot_id: loginSlotId,
        account_id: accountId,
        actor_id: actorId,
        request_id: requestId,
        status: "pending",
        expires_at: toDate(expiresAt),
        claimed_by: null,
        claim_expires_at: null,
        result_ciphertext: null,
        result_key_id: null,
        error_message: null,
      };
      bySlot.set(key, row);
      byRequestId.set(String(requestId), row);
      return [{ affectedRows: 1, insertId: id }, undefined];
    }

    if (s.includes("FROM ilink_login_requests") && s.includes("SELECT") && s.includes("login_slot_id")) {
      const [workspaceId, loginSlotId] = params;
      const row = bySlot.get(slotKey(workspaceId, loginSlotId));
      return [row ? [{ ...row }] : [], undefined];
    }

    if (s.includes("FROM ilink_login_requests") && s.includes("SELECT") && s.includes("request_id")) {
      const [requestId] = params;
      const row = byRequestId.get(String(requestId));
      return [row ? [{ ...row }] : [], undefined];
    }

    if (s.includes("UPDATE ilink_login_requests") && s.includes("status = 'claimed'")) {
      // claim: claimed_by, claim_expires_at, workspaceId, loginSlotId, now
      const [claimedBy, claimExpiresAt, workspaceId, loginSlotId, now] = params;
      const row = bySlot.get(slotKey(workspaceId, loginSlotId));
      if (!row) return [{ affectedRows: 0 }, undefined];
      if (row.status !== "pending") return [{ affectedRows: 0 }, undefined];
      if (toDate(row.expires_at).getTime() <= toDate(now).getTime()) {
        return [{ affectedRows: 0 }, undefined];
      }
      row.status = "claimed";
      row.claimed_by = claimedBy;
      row.claim_expires_at = toDate(claimExpiresAt);
      return [{ affectedRows: 1 }, undefined];
    }

    if (s.includes("UPDATE ilink_login_requests") && s.includes("result_ciphertext")) {
      // write result: status, result_ciphertext, result_key_id, error_message, requestId
      const [status, ciphertext, keyId, errorMessage, requestId] = params;
      const row = byRequestId.get(String(requestId));
      if (!row) return [{ affectedRows: 0 }, undefined];
      if (row.status !== "claimed" && row.status !== "pending") {
        return [{ affectedRows: 0 }, undefined];
      }
      row.status = status;
      row.result_ciphertext = ciphertext;
      row.result_key_id = keyId;
      row.error_message = errorMessage;
      return [{ affectedRows: 1 }, undefined];
    }

    if (s.includes("UPDATE ilink_login_requests") && s.includes("status = 'cancelled'")) {
      const [workspaceId, loginSlotId] = params;
      const row = bySlot.get(slotKey(workspaceId, loginSlotId));
      if (!row) return [{ affectedRows: 0 }, undefined];
      if (row.status === "succeeded" || row.status === "cancelled") {
        return [{ affectedRows: 0 }, undefined];
      }
      row.status = "cancelled";
      return [{ affectedRows: 1 }, undefined];
    }

    if (
      s.includes("UPDATE ilink_login_requests")
      && s.includes("status = 'expired'")
      && s.includes("expires_at")
    ) {
      const [now] = params;
      let n = 0;
      const nowMs = toDate(now).getTime();
      for (const row of bySlot.values()) {
        if (
          (row.status === "pending" || row.status === "claimed")
          && row.expires_at
          && toDate(row.expires_at).getTime() <= nowMs
        ) {
          row.status = "expired";
          n += 1;
        }
      }
      return [{ affectedRows: n }, undefined];
    }

    // DELETE old slot for recreate
    if (s.includes("DELETE FROM ilink_login_requests")) {
      const [workspaceId, loginSlotId] = params;
      const key = slotKey(workspaceId, loginSlotId);
      const row = bySlot.get(key);
      if (!row) return [{ affectedRows: 0 }, undefined];
      bySlot.delete(key);
      byRequestId.delete(String(row.request_id));
      return [{ affectedRows: 1 }, undefined];
    }

    throw new Error(`memory pool unhandled SQL: ${s}`);
  }

  return {
    query,
    __state: { bySlot, byRequestId, statements },
  };
}

function fixedNow(iso = "2026-07-24T12:00:00.000Z") {
  let ms = Date.parse(iso);
  return {
    now: () => new Date(ms),
    advance(delta) {
      ms += delta;
    },
  };
}

test("createLoginRequest then getLoginResult empty until write", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const clock = fixedNow();
  const pool = createMemoryPool();
  const store = createLoginControlStore({
    pool,
    crypto: cryptoApi,
    now: clock.now,
  });

  const created = await store.createLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-1",
    actorId: "admin-1",
    ttlMs: 120_000,
  });
  assert.equal(created.ok, true);
  assert.ok(created.requestId);
  assert.equal(created.status, "pending");

  const peek = await store.getLoginResult({
    workspaceId: "ws",
    loginSlotId: "slot-1",
    actorId: "admin-1",
  });
  assert.equal(peek.ok, true);
  assert.equal(peek.status, "pending");
  assert.equal(peek.result, null);
});

test("claimLoginRequest then writeLoginResult encrypts payload", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const clock = fixedNow();
  const pool = createMemoryPool();
  const store = createLoginControlStore({
    pool,
    crypto: cryptoApi,
    now: clock.now,
  });

  const created = await store.createLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-2",
    actorId: "admin-1",
    ttlMs: 120_000,
  });
  assert.equal(created.ok, true);

  const claimed = await store.claimLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-2",
    ownerId: "worker-1",
    claimTtlMs: 60_000,
  });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.requestId, created.requestId);
  assert.equal(claimed.actorId, "admin-1");

  const written = await store.writeLoginResult({
    requestId: created.requestId,
    status: "pending_scan",
    result: { qrcode: "QR-CONTENT", qrcode_img_content: "data:image/png;base64,xx" },
  });
  assert.equal(written.ok, true);

  const row = [...pool.__state.bySlot.values()][0];
  assert.ok(row.result_ciphertext);
  assert.ok(!String(row.result_ciphertext).includes("QR-CONTENT"));

  const got = await store.getLoginResult({
    workspaceId: "ws",
    loginSlotId: "slot-2",
    actorId: "admin-1",
  });
  assert.equal(got.ok, true);
  assert.equal(got.result.qrcode, "QR-CONTENT");
});

test("claim fails when already claimed or expired", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const clock = fixedNow();
  const pool = createMemoryPool();
  const store = createLoginControlStore({
    pool,
    crypto: cryptoApi,
    now: clock.now,
  });

  await store.createLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-3",
    actorId: "admin-1",
    ttlMs: 5_000,
  });
  const first = await store.claimLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-3",
    ownerId: "w1",
  });
  assert.equal(first.ok, true);
  const second = await store.claimLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-3",
    ownerId: "w2",
  });
  assert.equal(second.ok, false);

  clock.advance(10_000);
  await store.createLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-4",
    actorId: "admin-1",
    ttlMs: 1_000,
  });
  clock.advance(2_000);
  const late = await store.claimLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-4",
    ownerId: "w1",
  });
  assert.equal(late.ok, false);
});

test("cancelLoginRequest and expireStale", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const clock = fixedNow();
  const pool = createMemoryPool();
  const store = createLoginControlStore({
    pool,
    crypto: cryptoApi,
    now: clock.now,
  });

  await store.createLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-5",
    actorId: "admin-1",
    ttlMs: 60_000,
  });
  const cancelled = await store.cancelLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-5",
    actorId: "admin-1",
  });
  assert.equal(cancelled.ok, true);

  await store.createLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-6",
    actorId: "admin-1",
    ttlMs: 1_000,
  });
  clock.advance(5_000);
  const expired = await store.expireStale({ workspaceId: "ws" });
  assert.equal(expired.ok, true);
  assert.ok(expired.expired >= 1);
});

test("getLoginResult rejects wrong actor", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  const store = createLoginControlStore({
    pool,
    crypto: cryptoApi,
    now: fixedNow().now,
  });
  await store.createLoginRequest({
    workspaceId: "ws",
    loginSlotId: "slot-7",
    actorId: "admin-1",
    ttlMs: 60_000,
  });
  const got = await store.getLoginResult({
    workspaceId: "ws",
    loginSlotId: "slot-7",
    actorId: "other",
  });
  assert.equal(got.ok, false);
  assert.equal(got.code, "FORBIDDEN");
});
