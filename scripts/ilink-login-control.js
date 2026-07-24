"use strict";

const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_CLAIM_TTL_MS = 60_000;

function unwrap(result) {
  if (Array.isArray(result) && result.length >= 1) return result[0];
  return result;
}

function isDuplicateKeyError(err) {
  if (!err || typeof err !== "object") return false;
  return err.code === "ER_DUP_ENTRY" || err.errno === 1062;
}

/**
 * @param {{
 *   pool: { query: Function },
 *   crypto: { encrypt: Function, decrypt: Function },
 *   now?: () => Date
 * }} options
 */
function createLoginControlStore(options) {
  if (!options || !options.pool || typeof options.pool.query !== "function") {
    throw new Error("createLoginControlStore requires { pool } with query()");
  }
  if (
    !options.crypto
    || typeof options.crypto.encrypt !== "function"
    || typeof options.crypto.decrypt !== "function"
  ) {
    throw new Error("createLoginControlStore requires { crypto } with encrypt/decrypt");
  }

  const pool = options.pool;
  const cryptoApi = options.crypto;
  const nowFn = typeof options.now === "function" ? options.now : () => new Date();

  async function selectBySlot(workspaceId, loginSlotId) {
    const rows = unwrap(
      await pool.query(
        `SELECT id, workspace_id, login_slot_id, account_id, actor_id, request_id, status,
  expires_at, claimed_by, claim_expires_at, result_ciphertext, result_key_id, error_message
FROM ilink_login_requests
WHERE workspace_id = ? AND login_slot_id = ?
LIMIT 1`,
        [workspaceId, loginSlotId]
      )
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  }

  async function selectByRequestId(requestId) {
    const rows = unwrap(
      await pool.query(
        `SELECT id, workspace_id, login_slot_id, account_id, actor_id, request_id, status,
  expires_at, claimed_by, claim_expires_at, result_ciphertext, result_key_id, error_message
FROM ilink_login_requests
WHERE request_id = ?
LIMIT 1`,
        [requestId]
      )
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  }

  return {
    /**
     * Create or replace a pending login request for a slot.
     */
    async createLoginRequest(input) {
      try {
        const workspaceId = String(input.workspaceId || "").trim();
        const loginSlotId = String(input.loginSlotId || "").trim();
        const actorId = String(input.actorId || "").trim();
        if (!workspaceId || !loginSlotId || !actorId) {
          return { ok: false, error: "workspaceId, loginSlotId, actorId required", code: "ERROR" };
        }
        const ttlMs = Number(input.ttlMs) > 0 ? Number(input.ttlMs) : DEFAULT_TTL_MS;
        const now = nowFn();
        const expiresAt = new Date(now.getTime() + ttlMs);
        const requestId = String(input.requestId || crypto.randomUUID());
        const accountId =
          input.accountId == null || input.accountId === ""
            ? null
            : Number(input.accountId);

        // Replace any previous slot row so unique(workspace, slot) can be reused.
        await pool.query(
          `DELETE FROM ilink_login_requests WHERE workspace_id = ? AND login_slot_id = ?`,
          [workspaceId, loginSlotId]
        );

        await pool.query(
          `INSERT INTO ilink_login_requests (
  workspace_id, login_slot_id, account_id, actor_id, request_id, status, expires_at
) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
          [workspaceId, loginSlotId, accountId, actorId, requestId, expiresAt]
        );

        return {
          ok: true,
          requestId,
          loginSlotId,
          status: "pending",
          expiresAt: expiresAt.toISOString(),
        };
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          return { ok: false, error: "duplicate login slot", code: "DUP_SLOT" };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ERROR",
        };
      }
    },

    async claimLoginRequest(input) {
      try {
        const workspaceId = String(input.workspaceId || "").trim();
        const loginSlotId = String(input.loginSlotId || "").trim();
        const ownerId = String(input.ownerId || "").trim();
        if (!workspaceId || !loginSlotId || !ownerId) {
          return { ok: false, error: "workspaceId, loginSlotId, ownerId required", code: "ERROR" };
        }
        const claimTtlMs =
          Number(input.claimTtlMs) > 0 ? Number(input.claimTtlMs) : DEFAULT_CLAIM_TTL_MS;
        const now = nowFn();
        const claimExpiresAt = new Date(now.getTime() + claimTtlMs);

        const header = unwrap(
          await pool.query(
            `UPDATE ilink_login_requests
SET status = 'claimed', claimed_by = ?, claim_expires_at = ?
WHERE workspace_id = ? AND login_slot_id = ?
  AND status = 'pending'
  AND expires_at > ?`,
            [ownerId, claimExpiresAt, workspaceId, loginSlotId, now]
          )
        );
        if (!header || Number(header.affectedRows) !== 1) {
          return { ok: false, error: "nothing to claim", code: "NOT_CLAIMABLE" };
        }

        const row = await selectBySlot(workspaceId, loginSlotId);
        if (!row) {
          return { ok: false, error: "claimed row missing", code: "ERROR" };
        }
        return {
          ok: true,
          requestId: String(row.request_id),
          loginSlotId,
          actorId: String(row.actor_id),
          accountId: row.account_id == null ? null : Number(row.account_id),
          status: "claimed",
          claimExpiresAt: claimExpiresAt.toISOString(),
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ERROR",
        };
      }
    },

    async writeLoginResult(input) {
      try {
        const requestId = String(input.requestId || "").trim();
        if (!requestId) {
          return { ok: false, error: "requestId required", code: "ERROR" };
        }
        const status = String(input.status || "pending_scan").trim() || "pending_scan";
        // Map control-plane status into table status when terminal.
        let dbStatus = "claimed";
        if (status === "succeeded" || status === "failed" || status === "expired" || status === "cancelled") {
          dbStatus = status;
        } else if (status === "pending_scan" || status === "scanned" || status === "confirmed") {
          dbStatus = "claimed";
        }

        const payload = {
          status,
          result: input.result == null ? null : input.result,
          updatedAt: nowFn().toISOString(),
        };
        const sealed = cryptoApi.encrypt(JSON.stringify(payload));
        const errorMessage =
          input.error == null ? null : String(input.error).slice(0, 500);

        const header = unwrap(
          await pool.query(
            `UPDATE ilink_login_requests
SET status = ?, result_ciphertext = ?, result_key_id = ?, error_message = ?
WHERE request_id = ?
  AND status IN ('pending', 'claimed')`,
            [dbStatus, sealed.ciphertext, sealed.keyId, errorMessage, requestId]
          )
        );
        if (!header || Number(header.affectedRows) !== 1) {
          // Allow writing terminal success after claimed
          const header2 = unwrap(
            await pool.query(
              `UPDATE ilink_login_requests
SET status = ?, result_ciphertext = ?, result_key_id = ?, error_message = ?
WHERE request_id = ?`,
              [dbStatus === "claimed" ? "claimed" : dbStatus, sealed.ciphertext, sealed.keyId, errorMessage, requestId]
            )
          );
          if (!header2 || Number(header2.affectedRows) !== 1) {
            return { ok: false, error: "writeLoginResult affected 0 rows", code: "ERROR" };
          }
        }
        return { ok: true, requestId, status };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ERROR",
        };
      }
    },

    async markLoginSucceeded(input) {
      return this.writeLoginResult({
        requestId: input.requestId,
        status: "succeeded",
        result: input.result || null,
      });
    },

    async markLoginFailed(input) {
      return this.writeLoginResult({
        requestId: input.requestId,
        status: "failed",
        result: input.result || null,
        error: input.error || "login failed",
      });
    },

    async getLoginResult(input) {
      try {
        const workspaceId = String(input.workspaceId || "").trim();
        const loginSlotId = String(input.loginSlotId || "").trim();
        const actorId = String(input.actorId || "").trim();
        if (!workspaceId || !loginSlotId || !actorId) {
          return { ok: false, error: "workspaceId, loginSlotId, actorId required", code: "ERROR" };
        }
        const row = await selectBySlot(workspaceId, loginSlotId);
        if (!row) {
          return { ok: false, error: "not found", code: "NOT_FOUND" };
        }
        if (String(row.actor_id) !== actorId) {
          return { ok: false, error: "actor mismatch", code: "FORBIDDEN" };
        }

        let result = null;
        let controlStatus = String(row.status || "pending");
        if (row.result_ciphertext && row.result_key_id) {
          try {
            const plain = cryptoApi.decrypt(
              String(row.result_ciphertext),
              String(row.result_key_id)
            );
            const parsed = JSON.parse(plain);
            result = parsed?.result ?? parsed;
            if (parsed?.status) controlStatus = String(parsed.status);
          } catch (err) {
            return {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              code: "DECRYPT_ERROR",
            };
          }
        }

        return {
          ok: true,
          requestId: String(row.request_id),
          loginSlotId,
          status: String(row.status),
          controlStatus,
          result,
          errorMessage: row.error_message == null ? null : String(row.error_message),
          expiresAt: row.expires_at
            ? new Date(row.expires_at).toISOString()
            : null,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ERROR",
        };
      }
    },

    async cancelLoginRequest(input) {
      try {
        const workspaceId = String(input.workspaceId || "").trim();
        const loginSlotId = String(input.loginSlotId || "").trim();
        if (!workspaceId || !loginSlotId) {
          return { ok: false, error: "workspaceId, loginSlotId required", code: "ERROR" };
        }
        const header = unwrap(
          await pool.query(
            `UPDATE ilink_login_requests
SET status = 'cancelled'
WHERE workspace_id = ? AND login_slot_id = ?
  AND status IN ('pending', 'claimed')`,
            [workspaceId, loginSlotId]
          )
        );
        if (!header || Number(header.affectedRows) !== 1) {
          return { ok: false, error: "nothing to cancel", code: "ERROR" };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ERROR",
        };
      }
    },

    async expireStale(input = {}) {
      try {
        const now = nowFn();
        const header = unwrap(
          await pool.query(
            `UPDATE ilink_login_requests
SET status = 'expired'
WHERE status IN ('pending', 'claimed')
  AND expires_at <= ?`,
            [now]
          )
        );
        return {
          ok: true,
          expired: Number(header?.affectedRows) || 0,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ERROR",
        };
      }
    },

    /**
     * Worker helper: find any pending slot for workspace (optional simple poll).
     * For multi-slot, prefer claimLoginRequest with known slot from config.
     */
    async claimNextPending(input) {
      // Minimal: caller must pass loginSlotId. Kept for API symmetry.
      return this.claimLoginRequest(input);
    },
  };
}

module.exports = {
  createLoginControlStore,
  DEFAULT_TTL_MS,
  DEFAULT_CLAIM_TTL_MS,
};
