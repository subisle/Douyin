"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntimeCrypto } = require("./ilink-crypto");
const { createInboxCursorStore } = require("./ilink-inbox-cursor");

/**
 * In-memory MySQL pool covering SQL issued by createInboxCursorStore.
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
  /** @type {Map<string, object>} */
  const inbox = new Map(seed.inbox || []);
  /** @type {Map<string, object>} */
  const cursors = new Map(seed.cursors || []);
  let nextInboxId = 1;
  let nextCursorId = 1;
  /** @type {string[]} */
  const statements = [];
  /** @type {{ begun: number, committed: number, rolledBack: number }} */
  const tx = { begun: 0, committed: 0, rolledBack: 0 };

  function leaseKey(workspaceId, accountId, leaseName) {
    return `${workspaceId}\0${accountId}\0${leaseName}`;
  }

  function inboxDedupeKey(workspaceId, accountId, dedupeKey) {
    return `${workspaceId}\0${accountId}\0${dedupeKey}`;
  }

  function cursorScopeKey(workspaceId, accountId, sessionId) {
    return `${workspaceId}\0${accountId}\0${sessionId}`;
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

    // SELECT fencing_token, owner_id, lease_expires_at FROM bot_runner_leases ... FOR UPDATE
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

    // INSERT INTO inbox_messages
    if (s.includes("INSERT INTO inbox_messages")) {
      const [
        workspaceId,
        accountId,
        sessionId,
        dedupeKey,
        upstreamMessageId,
        messageType,
        payloadCiphertext,
        payloadKeyId,
        payloadMetadata,
        status,
        receivedAt,
      ] = params;
      const key = inboxDedupeKey(workspaceId, accountId, dedupeKey);
      if (inbox.has(key)) {
        const err = new Error(
          `Duplicate entry '${key}' for key 'uq_inbox_dedupe'`
        );
        err.code = "ER_DUP_ENTRY";
        err.errno = 1062;
        throw err;
      }
      const id = nextInboxId++;
      inbox.set(key, {
        id,
        workspace_id: workspaceId,
        account_id: Number(accountId),
        session_id: sessionId,
        dedupe_key: dedupeKey,
        upstream_message_id: upstreamMessageId,
        message_type: messageType,
        payload_ciphertext: payloadCiphertext,
        payload_key_id: payloadKeyId,
        payload_metadata: payloadMetadata,
        status,
        received_at: toDate(receivedAt) || new Date(),
      });
      return [{ affectedRows: 1, insertId: id, warningStatus: 0 }, undefined];
    }

    // INSERT INTO ilink_update_cursors ... ON DUPLICATE KEY UPDATE
    if (s.includes("INSERT INTO ilink_update_cursors") || s.includes("INTO ilink_update_cursors")) {
      const [
        workspaceId,
        accountId,
        sessionId,
        cursorCiphertext,
        cursorKeyId,
        cursorHash,
        fencingToken,
        lastUpdateAt,
      ] = params;
      const key = cursorScopeKey(workspaceId, accountId, sessionId);
      const existing = cursors.get(key);
      if (existing) {
        existing.cursor_ciphertext = cursorCiphertext;
        existing.cursor_key_id = cursorKeyId;
        existing.cursor_hash = cursorHash;
        existing.fencing_token = Number(fencingToken);
        existing.last_update_at = toDate(lastUpdateAt);
        return [{ affectedRows: 2, insertId: existing.id, warningStatus: 0 }, undefined];
      }
      const id = nextCursorId++;
      cursors.set(key, {
        id,
        workspace_id: workspaceId,
        account_id: Number(accountId),
        session_id: sessionId,
        cursor_ciphertext: cursorCiphertext,
        cursor_key_id: cursorKeyId,
        cursor_hash: cursorHash,
        fencing_token: Number(fencingToken),
        last_update_at: toDate(lastUpdateAt),
      });
      return [{ affectedRows: 1, insertId: id, warningStatus: 0 }, undefined];
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
    __state: { leases, inbox, cursors, statements, tx },
  };
  return pool;
}

function seedLease(pool, {
  workspaceId = "ws1",
  accountId = 1,
  leaseName = "ilink-poller",
  ownerId = "owner-1",
  fencingToken = 1,
  leaseExpiresAt = new Date("2099-01-01T00:00:00.000Z"),
} = {}) {
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
  const fixed = new Date(iso);
  return () => new Date(fixed.getTime());
}

test("stage 1 message → inserted=1 deduped=0 and cursor written", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 7, ownerId: "owner-1" });
  const now = createFixedNow();
  const store = createInboxCursorStore({ pool, crypto: cryptoApi, now });

  const updatesBuf = "cursor-buf-1";
  const result = await store.stageTextBatch({
    workspaceId: "ws1",
    accountId: 1,
    sessionId: "main",
    fencingToken: 7,
    ownerId: "owner-1",
    updatesBuf,
    messages: [
      {
        upstreamMessageId: "up-1",
        fromUserId: "u1",
        groupId: "g1",
        contextToken: "ctx-1",
        text: "hello",
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.inserted, 1);
  assert.equal(result.deduped, 0);
  assert.equal(result.cursorHash, cryptoApi.sha256Hex(updatesBuf));
  assert.equal(pool.__state.inbox.size, 1);
  assert.equal(pool.__state.cursors.size, 1);

  const inboxRow = [...pool.__state.inbox.values()][0];
  assert.equal(inboxRow.message_type, "text");
  assert.equal(inboxRow.status, "prepared");
  assert.equal(inboxRow.upstream_message_id, "up-1");
  assert.equal(inboxRow.payload_key_id, "v1");
  assert.ok(inboxRow.payload_ciphertext);
  const plain = cryptoApi.decrypt(inboxRow.payload_ciphertext, inboxRow.payload_key_id);
  const payload = JSON.parse(plain);
  assert.equal(payload.text, "hello");
  assert.equal(payload.fromUserId, "u1");
  assert.equal(payload.groupId, "g1");
  assert.equal(payload.contextToken, "ctx-1");

  const cursorRow = [...pool.__state.cursors.values()][0];
  assert.equal(cursorRow.session_id, "main");
  assert.equal(cursorRow.cursor_hash, cryptoApi.sha256Hex(updatesBuf));
  assert.equal(cursorRow.fencing_token, 7);
  assert.equal(
    cryptoApi.decrypt(cursorRow.cursor_ciphertext, cursorRow.cursor_key_id),
    updatesBuf
  );
  assert.equal(pool.__state.tx.committed, 1);
  assert.equal(pool.__state.tx.rolledBack, 0);
});

test("same dedupe restage → inserted=0 deduped=1 but cursor advances", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 3 });
  const store = createInboxCursorStore({
    pool,
    crypto: cryptoApi,
    now: createFixedNow(),
  });

  const msg = {
    upstreamMessageId: "up-dup",
    fromUserId: "u1",
    contextToken: "ctx",
    text: "same",
  };

  const first = await store.stageTextBatch({
    workspaceId: "ws1",
    accountId: 1,
    sessionId: "main",
    fencingToken: 3,
    updatesBuf: "buf-v1",
    messages: [msg],
  });
  assert.equal(first.ok, true);
  assert.equal(first.inserted, 1);
  assert.equal(first.deduped, 0);

  const second = await store.stageTextBatch({
    workspaceId: "ws1",
    accountId: 1,
    sessionId: "main",
    fencingToken: 3,
    updatesBuf: "buf-v2",
    messages: [msg],
  });
  assert.equal(second.ok, true);
  assert.equal(second.inserted, 0);
  assert.equal(second.deduped, 1);
  assert.equal(second.cursorHash, cryptoApi.sha256Hex("buf-v2"));
  assert.equal(pool.__state.inbox.size, 1);
  assert.equal(pool.__state.cursors.size, 1);

  const cursorRow = [...pool.__state.cursors.values()][0];
  assert.equal(cursorRow.cursor_hash, cryptoApi.sha256Hex("buf-v2"));
  assert.equal(
    cryptoApi.decrypt(cursorRow.cursor_ciphertext, cursorRow.cursor_key_id),
    "buf-v2"
  );
});

test("fencing mismatch → FENCING_MISMATCH and no inbox row", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 5, ownerId: "owner-1" });
  const store = createInboxCursorStore({
    pool,
    crypto: cryptoApi,
    now: createFixedNow(),
  });

  const result = await store.stageTextBatch({
    workspaceId: "ws1",
    accountId: 1,
    sessionId: "main",
    fencingToken: 99,
    ownerId: "owner-1",
    updatesBuf: "should-not-write",
    messages: [
      {
        upstreamMessageId: "up-x",
        fromUserId: "u1",
        contextToken: "ctx",
        text: "nope",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "FENCING_MISMATCH");
  assert.ok(result.error);
  assert.equal(pool.__state.inbox.size, 0);
  assert.equal(pool.__state.cursors.size, 0);
  assert.ok(pool.__state.tx.rolledBack >= 1);
  assert.equal(pool.__state.tx.committed, 0);
});

test("empty messages still advances cursor only", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  seedLease(pool, { fencingToken: 2 });
  const store = createInboxCursorStore({
    pool,
    crypto: cryptoApi,
    now: createFixedNow(),
  });

  const updatesBuf = "empty-batch-cursor";
  const result = await store.stageTextBatch({
    workspaceId: "ws1",
    accountId: 1,
    sessionId: "main",
    fencingToken: 2,
    updatesBuf,
    messages: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.inserted, 0);
  assert.equal(result.deduped, 0);
  assert.equal(result.cursorHash, cryptoApi.sha256Hex(updatesBuf));
  assert.equal(pool.__state.inbox.size, 0);
  assert.equal(pool.__state.cursors.size, 1);
  const cursorRow = [...pool.__state.cursors.values()][0];
  assert.equal(
    cryptoApi.decrypt(cursorRow.cursor_ciphertext, cursorRow.cursor_key_id),
    updatesBuf
  );
});

test("missing lease row → FENCING_MISMATCH", async () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const pool = createMemoryPool();
  const store = createInboxCursorStore({
    pool,
    crypto: cryptoApi,
    now: createFixedNow(),
  });

  const result = await store.stageTextBatch({
    workspaceId: "ws1",
    accountId: 1,
    sessionId: "main",
    fencingToken: 1,
    updatesBuf: "buf",
    messages: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "FENCING_MISMATCH");
  assert.equal(pool.__state.cursors.size, 0);
});
