"use strict";

const DEFAULT_LEASE_NAME = "ilink-poller";

/**
 * @param {unknown} result
 */
function unwrap(result) {
  if (Array.isArray(result) && result.length >= 1) {
    return result[0];
  }
  return result;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isDuplicateKeyError(err) {
  if (!err || typeof err !== "object") return false;
  const code = /** @type {{ code?: string, errno?: number }} */ (err).code;
  const errno = /** @type {{ errno?: number }} */ (err).errno;
  return code === "ER_DUP_ENTRY" || errno === 1062;
}

/**
 * Stable dedupe key for an inbound text message.
 * Prefer upstreamMessageId; otherwise hash text+from+context.
 * @param {{
 *   crypto: { sha256Hex: (text: string) => string },
 *   workspaceId: string,
 *   accountId: number,
 *   message: {
 *     upstreamMessageId?: string|null,
 *     text?: string,
 *     fromUserId?: string,
 *     contextToken?: string
 *   }
 * }} input
 */
function buildDedupeKey(input) {
  const { crypto: cryptoApi, workspaceId, accountId, message } = input;
  const upstream =
    message.upstreamMessageId == null || message.upstreamMessageId === ""
      ? null
      : String(message.upstreamMessageId);
  const identity =
    upstream ||
    `${String(message.text ?? "")}${String(message.fromUserId ?? "")}${String(message.contextToken ?? "")}`;
  return cryptoApi.sha256Hex(`${workspaceId}:${accountId}:${identity}`);
}

/**
 * @param {{
 *   pool: { query: Function, getConnection?: Function },
 *   crypto: { encrypt: Function, sha256Hex: Function },
 *   now?: () => Date
 * }} options
 */
function createInboxCursorStore(options) {
  if (!options || !options.pool || typeof options.pool.query !== "function") {
    throw new Error("createInboxCursorStore requires { pool } with query()");
  }
  if (
    !options.crypto ||
    typeof options.crypto.encrypt !== "function" ||
    typeof options.crypto.sha256Hex !== "function"
  ) {
    throw new Error("createInboxCursorStore requires { crypto } with encrypt/sha256Hex");
  }

  const pool = options.pool;
  const cryptoApi = options.crypto;
  const nowFn = typeof options.now === "function" ? options.now : () => new Date();

  /**
   * @template T
   * @param {(conn: { query: Function }) => Promise<T>} work
   * @returns {Promise<T>}
   */
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
            // ignore rollback errors
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
        if (typeof conn.release === "function") {
          conn.release();
        }
      }
    }

    // Fallback: sequential pool.query without real isolation.
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

  return {
    /**
     * @param {{
     *   workspaceId: string,
     *   accountId: number,
     *   sessionId: string,
     *   fencingToken: number,
     *   ownerId?: string,
     *   updatesBuf: string,
     *   messages?: Array<{
     *     upstreamMessageId?: string|null,
     *     fromUserId: string,
     *     groupId?: string,
     *     contextToken: string,
     *     text: string,
     *     receivedAt?: string|Date
     *   }>
     * }} input
     */
    async stageTextBatch(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const sessionId = String(input.sessionId);
      const fencingToken = Number(input.fencingToken);
      const ownerId =
        input.ownerId == null || input.ownerId === ""
          ? null
          : String(input.ownerId);
      const updatesBuf = String(input.updatesBuf ?? "");
      const messages = Array.isArray(input.messages) ? input.messages : [];

      try {
        return await withTransaction(async (conn) => {
          const rows = unwrap(
            await conn.query(
              `SELECT fencing_token, owner_id, lease_expires_at
FROM bot_runner_leases
WHERE workspace_id = ? AND account_id = ? AND lease_name = ?
FOR UPDATE`,
              [workspaceId, accountId, DEFAULT_LEASE_NAME]
            )
          );
          const lease = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          if (!lease || Number(lease.fencing_token) !== fencingToken) {
            const err = new Error("fencing token mismatch");
            err.code = "FENCING_MISMATCH";
            throw err;
          }
          if (ownerId != null) {
            const currentOwner =
              lease.owner_id == null ? null : String(lease.owner_id);
            if (currentOwner !== ownerId) {
              const err = new Error("lease owner mismatch");
              err.code = "FENCING_MISMATCH";
              throw err;
            }
          }

          let inserted = 0;
          let deduped = 0;
          const now = nowFn();

          for (const message of messages) {
            const dedupeKey = buildDedupeKey({
              crypto: cryptoApi,
              workspaceId,
              accountId,
              message,
            });
            const payload = {
              text: message.text,
              fromUserId: message.fromUserId,
              groupId: message.groupId,
              contextToken: message.contextToken,
            };
            const sealed = cryptoApi.encrypt(JSON.stringify(payload));
            const receivedAt =
              message.receivedAt != null
                ? message.receivedAt instanceof Date
                  ? message.receivedAt
                  : new Date(message.receivedAt)
                : now;
            const upstreamMessageId =
              message.upstreamMessageId == null || message.upstreamMessageId === ""
                ? null
                : String(message.upstreamMessageId);

            try {
              await conn.query(
                `INSERT INTO inbox_messages (
  workspace_id, account_id, session_id, dedupe_key, upstream_message_id,
  message_type, payload_ciphertext, payload_key_id, payload_metadata, status, received_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  workspaceId,
                  accountId,
                  sessionId,
                  dedupeKey,
                  upstreamMessageId,
                  "text",
                  sealed.ciphertext,
                  sealed.keyId,
                  null,
                  "prepared",
                  receivedAt,
                ]
              );
              inserted += 1;
            } catch (insertErr) {
              if (isDuplicateKeyError(insertErr)) {
                deduped += 1;
              } else {
                throw insertErr;
              }
            }
          }

          const cursorSealed = cryptoApi.encrypt(updatesBuf);
          const cursorHash = cryptoApi.sha256Hex(updatesBuf);
          await conn.query(
            `INSERT INTO ilink_update_cursors (
  workspace_id, account_id, session_id, cursor_ciphertext, cursor_key_id,
  cursor_hash, fencing_token, last_update_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  cursor_ciphertext = VALUES(cursor_ciphertext),
  cursor_key_id = VALUES(cursor_key_id),
  cursor_hash = VALUES(cursor_hash),
  fencing_token = VALUES(fencing_token),
  last_update_at = VALUES(last_update_at)`,
            [
              workspaceId,
              accountId,
              sessionId,
              cursorSealed.ciphertext,
              cursorSealed.keyId,
              cursorHash,
              fencingToken,
              now,
            ]
          );

          return {
            ok: true,
            inserted,
            deduped,
            cursorHash,
          };
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
  };
}

module.exports = { createInboxCursorStore, buildDedupeKey };
