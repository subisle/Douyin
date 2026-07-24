"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntimeCrypto } = require("./ilink-crypto");
const { createOutboxStore } = require("./ilink-outbox");

/**
 * In-memory MySQL pool covering SQL issued by createOutboxStore.
 * mysql2-shaped results: [rows, fields] or [ResultSetHeader, fields].
 */
function createMemoryPool(seed = {}) {
  /** @type {Map<string, {
   *   workspace_id: string,
   *   account_id: number,
   *   lease_name: string,
   *   owner_id: string|null,
   *   fencing_token: number,
   *   lease_expires_at: Date|null
   * }>} */
  const leases = new Map(seed.leases || []);
  /** @type {Map<number, object>} */
  const outbox = new Map(seed.outbox || []);
  /** @type {Map<string, number>} client unique index */
  const clientIndex = new Map();
  /** @type {Map<string, number>} dedupe unique index */
  const dedupeIndex = new Map();
  let nextOutboxId = 1;
  /** @type {string[]} */
  const statements = [];
  /** @type {{ begun: number, committed: number, rolledBack: number }} */
  const tx = { begun: 0, committed: 0, rolledBack: 0 };

  function leaseKey(workspaceId, accountId, leaseName) {
    return `${workspaceId}\0${accountId}\0${leaseName}`;
  }

  function clientKey(workspaceId, accountId, clientId) {
    return `${workspaceId}\0${accountId}\0${clientId}`;
  }

  function dedupeKey(workspaceId, accountId, dedupe) {
    return `${workspaceId}\0${accountId}\0${dedupe}`;
  }

  function toDate(value) {
    if (value == null) return null;
    if (value instanceof Date) return value;
    return new Date(value);
  }

  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, " ").trim();
    statements.push(s);

    if (/^BEGIN$/i.test(s) || s === "START TRANSACTION") {
      tx.begun += 1;
      return [{ affectedRows: 0 }, undefined];
    }
    if (/^COMMIT$/i.test(s)) {
      tx.committed += 1;
      return [{ affectedRows: 0 }, undefined];
    }
    if (/^ROLLBACK$/i.test(s)) {
      tx.rolledBack += 1;
      return [{ affectedRows: 0 }, undefined];
    }

    // SELECT fencing_token ... FROM bot_runner_leases ... FOR UPDATE
    if (s.includes("FROM bot_runner_leases") && s.includes("SELECT")) {
      const [workspaceId, accountId, leaseName] = params;
      const row = leases.get(leaseKey(workspaceId, accountId, leaseName || "ilink-poller"));
      if (!row) return [[], undefined];
      return [
        [
          {
            fencing_token: row.fencing_token,
            owner_id: row.owner_id,
            lease_expires_at: row.lease_expires_at,
          },
        ],
        undefined,
      ];
    }

    // INSERT INTO outbox_messages
    if (s.includes("INSERT INTO outbox_messages")) {
      const [
        workspaceId,
        accountId,
        sessionId,
        clientId,
        dedupe,
        replyToInboxId,
        messageType,
        contextTokenCiphertext,
        payloadCiphertext,
        payloadKeyId,
        payloadMetadata,
        status,
        fencingToken,
        attemptCount,
        maxAttempts,
        nextAttemptAt,
      ] = params;

      const ck = clientKey(workspaceId, accountId, clientId);
      if (clientIndex.has(ck)) {
        const err = new Error(
          `Duplicate entry '${ck}' for key 'uq_outbox_client'`
        );
        err.code = "ER_DUP_ENTRY";
        err.errno = 1062;
        throw err;
      }
      if (dedupe != null && dedupe !== "") {
        const dk = dedupeKey(workspaceId, accountId, dedupe);
        if (dedupeIndex.has(dk)) {
          const err = new Error(
            `Duplicate entry '${dk}' for key 'uq_outbox_dedupe'`
          );
          err.code = "ER_DUP_ENTRY";
          err.errno = 1062;
          throw err;
        }
      }

      const id = nextOutboxId++;
      const row = {
        id,
        workspace_id: workspaceId,
        account_id: Number(accountId),
        session_id: sessionId,
        client_id: clientId,
        dedupe_key: dedupe,
        reply_to_inbox_id: replyToInboxId,
        message_type: messageType,
        context_token_ciphertext: contextTokenCiphertext,
        payload_ciphertext: payloadCiphertext,
        payload_key_id: payloadKeyId,
        payload_metadata: payloadMetadata,
        status,
        reconcile_status: "not_required",
        upstream_message_id: null,
        claimed_by: null,
        claim_token: null,
        claim_expires_at: null,
        fencing_token: Number(fencingToken),
        attempt_count: Number(attemptCount) || 0,
        max_attempts: Number(maxAttempts) || 10,
        next_attempt_at: toDate(nextAttemptAt) || new Date(),
        sent_at: null,
        unknown_at: null,
        last_error: null,
      };
      outbox.set(id, row);
      clientIndex.set(ck, id);
      if (dedupe != null && dedupe !== "") {
        dedupeIndex.set(dedupeKey(workspaceId, accountId, dedupe), id);
      }
      return [{ affectedRows: 1, insertId: id, warningStatus: 0 }, undefined];
    }

    // SELECT claimable outbox rows
    if (
      s.includes("FROM outbox_messages") &&
      s.includes("SELECT") &&
      s.includes("status")
    ) {
      const [workspaceId, accountId, now, limit] = params;
      const nowMs = toDate(now).getTime();
      const rows = [...outbox.values()]
        .filter(
          (r) =>
            r.workspace_id === workspaceId &&
            Number(r.account_id) === Number(accountId) &&
            (r.status === "prepared" || r.status === "retry_wait") &&
            toDate(r.next_attempt_at).getTime() <= nowMs
        )
        .sort((a, b) => a.id - b.id)
        .slice(0, Number(limit) || 10)
        .map((r) => ({
          id: r.id,
          client_id: r.client_id,
          payload_ciphertext: r.payload_ciphertext,
          payload_key_id: r.payload_key_id,
          fencing_token: r.fencing_token,
          attempt_count: r.attempt_count,
          max_attempts: r.max_attempts,
          status: r.status,
        }));
      return [rows, undefined];
    }

    // Claim UPDATE: must SET claimed_by (mark* only CLEARS claim fields)
    if (
      s.includes("UPDATE outbox_messages") &&
      s.includes("status = 'sending'") &&
      s.includes("claimed_by = ?")
    ) {
      const [claimedBy, claimToken, claimExpiresAt, id, workspaceId, accountId] =
        params;
      const row = outbox.get(Number(id));
      if (
        !row ||
        row.workspace_id !== workspaceId ||
        Number(row.account_id) !== Number(accountId)
      ) {
        return [{ affectedRows: 0 }, undefined];
      }
      if (row.status !== "prepared" && row.status !== "retry_wait") {
        return [{ affectedRows: 0 }, undefined];
      }
      row.status = "sending";
      row.claimed_by = claimedBy;
      row.claim_token = claimToken;
      row.claim_expires_at = toDate(claimExpiresAt);
      row.attempt_count = Number(row.attempt_count) + 1;
      return [{ affectedRows: 1 }, undefined];
    }

    // markSent
    if (
      s.includes("UPDATE outbox_messages") &&
      s.includes("sent_at") &&
      s.includes("status = 'sent'")
    ) {
      const [sentAt, upstreamMessageId, id, workspaceId, accountId, claimToken] =
        params;
      const row = outbox.get(Number(id));
      if (
        !row ||
        row.workspace_id !== workspaceId ||
        Number(row.account_id) !== Number(accountId) ||
        row.claim_token !== claimToken ||
        row.status !== "sending"
      ) {
        return [{ affectedRows: 0 }, undefined];
      }
      row.status = "sent";
      row.sent_at = toDate(sentAt);
      row.claimed_by = null;
      row.claim_token = null;
      row.claim_expires_at = null;
      row.upstream_message_id = upstreamMessageId;
      return [{ affectedRows: 1 }, undefined];
    }

    // markUnknown
    if (
      s.includes("UPDATE outbox_messages") &&
      s.includes("status = 'unknown'")
    ) {
      const [unknownAt, lastError, id, workspaceId, accountId, claimToken] =
        params;
      const row = outbox.get(Number(id));
      if (
        !row ||
        row.workspace_id !== workspaceId ||
        Number(row.account_id) !== Number(accountId) ||
        row.claim_token !== claimToken ||
        row.status !== "sending"
      ) {
        return [{ affectedRows: 0 }, undefined];
      }
      row.status = "unknown";
      row.unknown_at = toDate(unknownAt);
      row.reconcile_status = "pending";
      row.last_error = lastError;
      row.claimed_by = null;
      row.claim_token = null;
      row.claim_expires_at = null;
      return [{ affectedRows: 1 }, undefined];
    }

    // markRetry (require next_attempt_at so claim WHERE 'retry_wait' does not match)
    if (
      s.includes("UPDATE outbox_messages") &&
      s.includes("status = 'retry_wait'") &&
      s.includes("next_attempt_at")
    ) {
      const [nextAttemptAt, lastError, id, workspaceId, accountId, claimToken] =
        params;
      const row = outbox.get(Number(id));
      if (
        !row ||
        row.workspace_id !== workspaceId ||
        Number(row.account_id) !== Number(accountId) ||
        row.claim_token !== claimToken ||
        row.status !== "sending"
      ) {
        return [{ affectedRows: 0 }, undefined];
      }
      row.status = "retry_wait";
      row.next_attempt_at = toDate(nextAttemptAt);
      row.last_error = lastError;
      row.claimed_by = null;
      row.claim_token = null;
      row.claim_expires_at = null;
      return [{ affectedRows: 1 }, undefined];
    }

    // markFailedFencing / decrypt dead_letter
    if (
      s.includes("UPDATE outbox_messages") &&
      s.includes("status = 'dead_letter'")
    ) {
      // Two shapes:
      // markFailedFencing: [lastError, id, workspaceId, accountId, claimToken] (status='sending' in WHERE)
      // decrypt path: [lastError, id, workspaceId, accountId, claimToken] (claim_token match only)
      const [lastError, id, workspaceId, accountId, claimToken] = params;
      const row = outbox.get(Number(id));
      if (
        !row ||
        row.workspace_id !== workspaceId ||
        Number(row.account_id) !== Number(accountId) ||
        row.claim_token !== claimToken
      ) {
        return [{ affectedRows: 0 }, undefined];
      }
      row.status = "dead_letter";
      row.last_error = lastError;
      row.claimed_by = null;
      row.claim_token = null;
      row.claim_expires_at = null;
      return [{ affectedRows: 1 }, undefined];
    }

    throw new Error(`memory pool: unhandled SQL: ${s}`);
  }

  const pool = {
    async query(sql, params) {
      return query(sql, params);
    },
    async getConnection() {
      return {
        async beginTransaction() {
          tx.begun += 1;
        },
        async query(sql, params) {
          return query(sql, params);
        },
        async commit() {
          tx.committed += 1;
        },
        async rollback() {
          tx.rolledBack += 1;
        },
        release() {},
      };
    },
    __state: { leases, outbox, clientIndex, dedupeIndex, statements, tx },
  };
  return pool;
}

function seedLease(
  pool,
  {
    workspaceId = "ws1",
    accountId = 1,
    leaseName = "ilink-poller",
    ownerId = "owner-1",
    fencingToken = 1,
    leaseExpiresAt = new Date("2099-01-01T00:00:00.000Z"),
  } = {}
) {
  const key = `${workspaceId}\0${accountId}\0${leaseName}`;
  pool.__state.leases.set(key, {
    workspace_id: workspaceId,
    account_id: accountId,
    lease_name: leaseName,
    owner_id: ownerId,
    fencing_token: fencingToken,
    lease_expires_at: leaseExpiresAt,
  });
}

function createFixedNow(iso = "2026-01-01T00:00:00.000Z") {
  let ms = new Date(iso).getTime();
  return {
    now: () => new Date(ms),
    advance(msDelta) {
      ms += msDelta;
    },
    set(iso2) {
      ms = new Date(iso2).getTime();
    },
  };
}

function baseEnqueue(overrides = {}) {
  return {
    workspaceId: "ws1",
    accountId: 1,
    sessionId: "main",
    fencingToken: 7,
    clientId: "client-1",
    toUserId: "u1",
    groupId: "g1",
    contextToken: "ctx-1",
    text: "hello",
    ...overrides,
  };
}

test("enqueueText success returns outboxId", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 7 });
  const clock = createFixedNow();
  const store = createOutboxStore({ pool, crypto: cryptoApi, now: clock.now });

  const result = await store.enqueueText(baseEnqueue());

  assert.equal(result.ok, true);
  assert.equal(typeof result.outboxId, "number");
  assert.ok(result.outboxId >= 1);
  assert.equal(pool.__state.outbox.size, 1);

  const row = pool.__state.outbox.get(result.outboxId);
  assert.equal(row.status, "prepared");
  assert.equal(row.message_type, "text");
  assert.equal(row.client_id, "client-1");
  assert.equal(row.fencing_token, 7);
  assert.equal(row.attempt_count, 0);
  assert.equal(row.max_attempts, 10);
  assert.ok(row.payload_ciphertext);
  assert.equal(row.payload_key_id, "v1");
  const payload = JSON.parse(
    cryptoApi.decrypt(row.payload_ciphertext, row.payload_key_id)
  );
  assert.equal(payload.toUserId, "u1");
  assert.equal(payload.groupId, "g1");
  assert.equal(payload.contextToken, "ctx-1");
  assert.equal(payload.text, "hello");
  assert.equal(pool.__state.tx.committed, 1);
  assert.equal(pool.__state.tx.rolledBack, 0);
});

test("enqueueText fencing mismatch → FENCING_MISMATCH and no row", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 5 });
  const store = createOutboxStore({
    pool,
    crypto: cryptoApi,
    now: createFixedNow().now,
  });

  const result = await store.enqueueText(baseEnqueue({ fencingToken: 99 }));

  assert.equal(result.ok, false);
  assert.equal(result.code, "FENCING_MISMATCH");
  assert.ok(result.error);
  assert.equal(pool.__state.outbox.size, 0);
});

test("enqueueText duplicate client_id → DUP_CLIENT", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 7 });
  const store = createOutboxStore({
    pool,
    crypto: cryptoApi,
    now: createFixedNow().now,
  });

  const first = await store.enqueueText(baseEnqueue({ clientId: "same-client" }));
  assert.equal(first.ok, true);

  const second = await store.enqueueText(
    baseEnqueue({ clientId: "same-client", text: "other" })
  );
  assert.equal(second.ok, false);
  assert.equal(second.code, "DUP_CLIENT");
  assert.equal(pool.__state.outbox.size, 1);
});

test("claimBatch returns decrypted payload and marks sending", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 7, ownerId: "owner-1" });
  const clock = createFixedNow();
  const store = createOutboxStore({ pool, crypto: cryptoApi, now: clock.now });

  const enq = await store.enqueueText(baseEnqueue({ clientId: "c-claim" }));
  assert.equal(enq.ok, true);

  const claimed = await store.claimBatch({
    workspaceId: "ws1",
    accountId: 1,
    ownerId: "owner-1",
    fencingToken: 7,
    limit: 10,
  });

  assert.equal(claimed.ok, true);
  assert.equal(claimed.rows.length, 1);
  const row = claimed.rows[0];
  assert.equal(row.id, enq.outboxId);
  assert.equal(row.clientId, "c-claim");
  assert.equal(row.payload.toUserId, "u1");
  assert.equal(row.payload.groupId, "g1");
  assert.equal(row.payload.contextToken, "ctx-1");
  assert.equal(row.payload.text, "hello");
  assert.equal(row.fencingToken, 7);
  assert.equal(row.attemptCount, 1);
  assert.equal(row.maxAttempts, 10);
  assert.ok(row.claimToken);
  assert.equal(typeof row.claimToken, "string");

  const stored = pool.__state.outbox.get(enq.outboxId);
  assert.equal(stored.status, "sending");
  assert.equal(stored.claimed_by, "owner-1");
  assert.equal(stored.claim_token, row.claimToken);
  assert.ok(stored.claim_expires_at);
  assert.equal(stored.attempt_count, 1);
});

test("markSent succeeds", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 7, ownerId: "owner-1" });
  const store = createOutboxStore({
    pool,
    crypto: cryptoApi,
    now: createFixedNow().now,
  });

  const enq = await store.enqueueText(baseEnqueue({ clientId: "c-sent" }));
  const claimed = await store.claimBatch({
    workspaceId: "ws1",
    accountId: 1,
    ownerId: "owner-1",
    fencingToken: 7,
  });
  assert.equal(claimed.ok, true);
  const claimToken = claimed.rows[0].claimToken;

  const marked = await store.markSent({
    workspaceId: "ws1",
    accountId: 1,
    outboxId: enq.outboxId,
    claimToken,
    upstreamMessageId: "up-99",
  });
  assert.equal(marked.ok, true);

  const stored = pool.__state.outbox.get(enq.outboxId);
  assert.equal(stored.status, "sent");
  assert.equal(stored.upstream_message_id, "up-99");
  assert.equal(stored.claim_token, null);
  assert.equal(stored.claimed_by, null);
  assert.ok(stored.sent_at);
});

test("markRetry then claim again works", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 7, ownerId: "owner-1" });
  const clock = createFixedNow("2026-01-01T00:00:00.000Z");
  const store = createOutboxStore({ pool, crypto: cryptoApi, now: clock.now });

  const enq = await store.enqueueText(baseEnqueue({ clientId: "c-retry" }));
  const claimed1 = await store.claimBatch({
    workspaceId: "ws1",
    accountId: 1,
    ownerId: "owner-1",
    fencingToken: 7,
  });
  assert.equal(claimed1.ok, true);
  const claimToken = claimed1.rows[0].claimToken;

  const retried = await store.markRetry({
    workspaceId: "ws1",
    accountId: 1,
    outboxId: enq.outboxId,
    claimToken,
    error: "transient",
    delayMs: 1000,
  });
  assert.equal(retried.ok, true);

  const mid = pool.__state.outbox.get(enq.outboxId);
  assert.equal(mid.status, "retry_wait");
  assert.equal(mid.last_error, "transient");
  assert.equal(mid.claim_token, null);

  // still before next_attempt_at → empty claim
  const early = await store.claimBatch({
    workspaceId: "ws1",
    accountId: 1,
    ownerId: "owner-1",
    fencingToken: 7,
  });
  assert.equal(early.ok, true);
  assert.equal(early.rows.length, 0);

  clock.advance(1001);
  const claimed2 = await store.claimBatch({
    workspaceId: "ws1",
    accountId: 1,
    ownerId: "owner-1",
    fencingToken: 7,
  });
  assert.equal(claimed2.ok, true);
  assert.equal(claimed2.rows.length, 1);
  assert.equal(claimed2.rows[0].id, enq.outboxId);
  assert.equal(claimed2.rows[0].attemptCount, 2);
  assert.equal(claimed2.rows[0].payload.text, "hello");
});

test("claimBatch with wrong fencing → FENCING_MISMATCH", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 7, ownerId: "owner-1" });
  const store = createOutboxStore({
    pool,
    crypto: cryptoApi,
    now: createFixedNow().now,
  });

  await store.enqueueText(baseEnqueue({ clientId: "c-fence" }));

  const claimed = await store.claimBatch({
    workspaceId: "ws1",
    accountId: 1,
    ownerId: "owner-1",
    fencingToken: 99,
  });

  assert.equal(claimed.ok, false);
  assert.equal(claimed.code, "FENCING_MISMATCH");
  const stored = [...pool.__state.outbox.values()][0];
  assert.equal(stored.status, "prepared");
});
