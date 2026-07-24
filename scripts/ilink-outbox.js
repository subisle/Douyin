"use strict";

const crypto = require("node:crypto");

const DEFAULT_LEASE_NAME = "ilink-poller";
const CLAIM_TTL_MS = 30_000;

function unwrap(result) {
  if (Array.isArray(result) && result.length >= 1) return result[0];
  return result;
}

function isDuplicateKeyError(err) {
  if (!err || typeof err !== "object") return false;
  const code = err.code;
  const errno = err.errno;
  return code === "ER_DUP_ENTRY" || errno === 1062;
}

function createOutboxStore(options) {
  if (!options || !options.pool || typeof options.pool.query !== "function") {
    throw new Error("createOutboxStore requires { pool } with query()");
  }
  if (
    !options.crypto
    || typeof options.crypto.encrypt !== "function"
    || typeof options.crypto.decrypt !== "function"
    || typeof options.crypto.sha256Hex !== "function"
  ) {
    throw new Error("createOutboxStore requires { crypto } with encrypt/decrypt/sha256Hex");
  }

  const pool = options.pool;
  const cryptoApi = options.crypto;
  const nowFn = typeof options.now === "function" ? options.now : () => new Date();

  async function withTransaction(work) {
    if (typeof pool.getConnection === "function") {
      const conn = await pool.getConnection();
      try {
        if (typeof conn.beginTransaction === "function") {
          await conn.beginTransaction();
        } else {
          await conn.query("BEGIN");
        }
        const result = await work(conn);
        if (typeof conn.commit === "function") {
          await conn.commit();
        } else {
          await conn.query("COMMIT");
        }
        return result;
      } catch (err) {
        if (typeof conn.rollback === "function") {
          try {
            await conn.rollback();
          } catch {
            // ignore
          }
        } else {
          try {
            await conn.query("ROLLBACK");
          } catch {
            // ignore
          }
        }
        throw err;
      } finally {
        if (typeof conn.release === "function") conn.release();
      }
    }

    await pool.query("BEGIN");
    try {
      const result = await work(pool);
      await pool.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await pool.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async function assertLeaseFencing(conn, { workspaceId, accountId, fencingToken, leaseName }) {
    const rows = unwrap(
      await conn.query(
        `SELECT fencing_token, owner_id, lease_expires_at
FROM bot_runner_leases
WHERE workspace_id = ? AND account_id = ? AND lease_name = ?
FOR UPDATE`,
        [workspaceId, accountId, leaseName || DEFAULT_LEASE_NAME]
      )
    );
    const lease = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!lease || Number(lease.fencing_token) !== Number(fencingToken)) {
      const err = new Error("fencing token mismatch");
      err.code = "FENCING_MISMATCH";
      throw err;
    }
    return lease;
  }

  return {
    async enqueueText(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const sessionId = String(input.sessionId || "main");
      const fencingToken = Number(input.fencingToken);
      const clientId = String(input.clientId || "").trim();
      if (!clientId) {
        return { ok: false, error: "clientId required", code: "ERROR" };
      }
      const toUserId = String(input.toUserId || "").trim();
      const groupId = String(input.groupId || "");
      const contextToken = String(input.contextToken || "");
      const text = String(input.text || "");
      const replyToInboxId =
        input.replyToInboxId == null || input.replyToInboxId === ""
          ? null
          : Number(input.replyToInboxId);
      const dedupeKey =
        input.dedupeKey != null && String(input.dedupeKey).trim()
          ? String(input.dedupeKey)
          : cryptoApi.sha256Hex(`${workspaceId}:${accountId}:${clientId}`);

      try {
        return await withTransaction(async (conn) => {
          await assertLeaseFencing(conn, {
            workspaceId,
            accountId,
            fencingToken,
            leaseName: DEFAULT_LEASE_NAME,
          });

          const payload = {
            toUserId,
            groupId,
            contextToken,
            text,
          };
          const sealed = cryptoApi.encrypt(JSON.stringify(payload));
          const ctxSealed = contextToken
            ? cryptoApi.encrypt(contextToken)
            : { ciphertext: null, keyId: sealed.keyId };
          const now = nowFn();

          const header = unwrap(
            await conn.query(
              `INSERT INTO outbox_messages (
  workspace_id, account_id, session_id, client_id, dedupe_key, reply_to_inbox_id,
  message_type, context_token_ciphertext, payload_ciphertext, payload_key_id,
  payload_metadata, status, fencing_token, attempt_count, max_attempts, next_attempt_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                workspaceId,
                accountId,
                sessionId,
                clientId,
                dedupeKey,
                replyToInboxId,
                "text",
                ctxSealed.ciphertext,
                sealed.ciphertext,
                sealed.keyId,
                null,
                "prepared",
                fencingToken,
                0,
                10,
                now,
              ]
            )
          );

          const outboxId = Number(header?.insertId);
          return { ok: true, outboxId };
        });
      } catch (err) {
        if (err && err.code === "FENCING_MISMATCH") {
          return {
            ok: false,
            error: String(err.message || "fencing mismatch"),
            code: "FENCING_MISMATCH",
          };
        }
        if (isDuplicateKeyError(err)) {
          return {
            ok: false,
            error: String(err.message || "duplicate client_id"),
            code: "DUP_CLIENT",
          };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ERROR",
        };
      }
    },

    async claimBatch(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const ownerId = String(input.ownerId || "").trim();
      const fencingToken = Number(input.fencingToken);
      const limit = Number(input.limit) > 0 ? Number(input.limit) : 10;
      const leaseName = String(input.leaseName || DEFAULT_LEASE_NAME);

      try {
        return await withTransaction(async (conn) => {
          await assertLeaseFencing(conn, {
            workspaceId,
            accountId,
            fencingToken,
            leaseName,
          });

          const now = nowFn();
          const selected = unwrap(
            await conn.query(
              `SELECT id, client_id, payload_ciphertext, payload_key_id, fencing_token,
  attempt_count, max_attempts, status
FROM outbox_messages
WHERE workspace_id = ? AND account_id = ?
  AND status IN ('prepared', 'retry_wait')
  AND next_attempt_at <= ?
ORDER BY id ASC
LIMIT ?
FOR UPDATE`,
              [workspaceId, accountId, now, limit]
            )
          );
          const candidates = Array.isArray(selected) ? selected : [];
          const rows = [];

          for (const candidate of candidates) {
            const claimToken = crypto.randomUUID();
            const claimExpires = new Date(now.getTime() + CLAIM_TTL_MS);
            const updated = unwrap(
              await conn.query(
                `UPDATE outbox_messages
SET claimed_by = ?, claim_token = ?, claim_expires_at = ?,
    attempt_count = attempt_count + 1, status = 'sending'
WHERE id = ? AND workspace_id = ? AND account_id = ?
  AND status IN ('prepared', 'retry_wait')`,
                [
                  ownerId,
                  claimToken,
                  claimExpires,
                  candidate.id,
                  workspaceId,
                  accountId,
                ]
              )
            );
            if (!updated || Number(updated.affectedRows) !== 1) continue;

            let payload;
            try {
              payload = JSON.parse(
                cryptoApi.decrypt(
                  candidate.payload_ciphertext,
                  candidate.payload_key_id
                )
              );
            } catch (decryptErr) {
              await conn.query(
                `UPDATE outbox_messages
SET status = 'dead_letter', last_error = ?,
    claimed_by = NULL, claim_token = NULL, claim_expires_at = NULL
WHERE id = ? AND workspace_id = ? AND account_id = ? AND claim_token = ?`,
                [
                  decryptErr instanceof Error
                    ? decryptErr.message
                    : String(decryptErr),
                  candidate.id,
                  workspaceId,
                  accountId,
                  claimToken,
                ]
              );
              continue;
            }

            rows.push({
              id: Number(candidate.id),
              clientId: String(candidate.client_id),
              payload: {
                toUserId: String(payload.toUserId || ""),
                groupId: String(payload.groupId || ""),
                contextToken: String(payload.contextToken || ""),
                text: String(payload.text || ""),
              },
              fencingToken: Number(candidate.fencing_token),
              attemptCount: Number(candidate.attempt_count || 0) + 1,
              maxAttempts: Number(candidate.max_attempts || 10),
              claimToken,
            });
          }

          return { ok: true, rows };
        });
      } catch (err) {
        if (err && err.code === "FENCING_MISMATCH") {
          return {
            ok: false,
            error: String(err.message || "fencing mismatch"),
            code: "FENCING_MISMATCH",
          };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ERROR",
        };
      }
    },

    async markSent(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const outboxId = Number(input.outboxId);
      const claimToken = String(input.claimToken || "");
      const upstreamMessageId =
        input.upstreamMessageId == null ? null : String(input.upstreamMessageId);
      const now = nowFn();
      try {
        const header = unwrap(
          await pool.query(
            `UPDATE outbox_messages
SET status = 'sent', sent_at = ?, claimed_by = NULL, claim_token = NULL,
    claim_expires_at = NULL, upstream_message_id = ?
WHERE id = ? AND workspace_id = ? AND account_id = ? AND claim_token = ?
  AND status = 'sending'`,
            [now, upstreamMessageId, outboxId, workspaceId, accountId, claimToken]
          )
        );
        if (!header || Number(header.affectedRows) !== 1) {
          return { ok: false, error: "markSent affected 0 rows" };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async markUnknown(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const outboxId = Number(input.outboxId);
      const claimToken = String(input.claimToken || "");
      const lastError = String(input.error || "unknown");
      const now = nowFn();
      try {
        const header = unwrap(
          await pool.query(
            `UPDATE outbox_messages
SET status = 'unknown', unknown_at = ?, reconcile_status = 'pending', last_error = ?,
    claimed_by = NULL, claim_token = NULL, claim_expires_at = NULL
WHERE id = ? AND workspace_id = ? AND account_id = ? AND claim_token = ?
  AND status = 'sending'`,
            [now, lastError, outboxId, workspaceId, accountId, claimToken]
          )
        );
        if (!header || Number(header.affectedRows) !== 1) {
          return { ok: false, error: "markUnknown affected 0 rows" };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async markRetry(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const outboxId = Number(input.outboxId);
      const claimToken = String(input.claimToken || "");
      const lastError = String(input.error || "retry");
      const delayMs = Number(input.delayMs) >= 0 ? Number(input.delayMs) : 2_000;
      const now = nowFn();
      const nextAttemptAt = new Date(now.getTime() + delayMs);
      try {
        const header = unwrap(
          await pool.query(
            `UPDATE outbox_messages
SET status = 'retry_wait', next_attempt_at = ?, last_error = ?,
    claimed_by = NULL, claim_token = NULL, claim_expires_at = NULL
WHERE id = ? AND workspace_id = ? AND account_id = ? AND claim_token = ?
  AND status = 'sending'`,
            [nextAttemptAt, lastError, outboxId, workspaceId, accountId, claimToken]
          )
        );
        if (!header || Number(header.affectedRows) !== 1) {
          return { ok: false, error: "markRetry affected 0 rows" };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async markFailedFencing(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const outboxId = Number(input.outboxId);
      const claimToken = String(input.claimToken || "");
      const lastError = String(input.error || "fencing mismatch");
      try {
        const header = unwrap(
          await pool.query(
            `UPDATE outbox_messages
SET status = 'dead_letter', last_error = ?,
    claimed_by = NULL, claim_token = NULL, claim_expires_at = NULL
WHERE id = ? AND workspace_id = ? AND account_id = ? AND claim_token = ?
  AND status = 'sending'`,
            [lastError, outboxId, workspaceId, accountId, claimToken]
          )
        );
        if (!header || Number(header.affectedRows) !== 1) {
          return { ok: false, error: "markFailedFencing affected 0 rows" };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

module.exports = {
  createOutboxStore,
  DEFAULT_LEASE_NAME,
};
