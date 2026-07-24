"use strict";

const DEFAULT_API_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_LEASE_NAME = "ilink-poller";

/**
 * @param {unknown} value
 * @returns {Date|null}
 */
function asDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {{ pool: { query: Function, getConnection?: Function }, now?: () => Date }} options
 */
function createDbLeaseStore(options) {
  if (!options || !options.pool || typeof options.pool.query !== "function") {
    throw new Error("createDbLeaseStore requires { pool } with query()");
  }
  const pool = options.pool;
  const nowFn = typeof options.now === "function" ? options.now : () => new Date();

  /**
   * Run work inside a connection transaction when getConnection is available.
   * @template T
   * @param {(conn: { query: Function }) => Promise<T>} work
   * @returns {Promise<T>}
   */
  async function withConnection(work) {
    if (typeof pool.getConnection === "function") {
      const conn = await pool.getConnection();
      try {
        if (typeof conn.beginTransaction === "function") {
          await conn.beginTransaction();
        }
        const result = await work(conn);
        if (typeof conn.commit === "function") {
          await conn.commit();
        }
        return result;
      } catch (err) {
        if (typeof conn.rollback === "function") {
          try {
            await conn.rollback();
          } catch {
            // ignore rollback errors
          }
        }
        throw err;
      } finally {
        if (typeof conn.release === "function") {
          conn.release();
        }
      }
    }
    return work(pool);
  }

  /**
   * mysql2 returns [rows, fields]; normalize to rows/header.
   * @param {unknown} result
   */
  function unwrap(result) {
    if (Array.isArray(result) && result.length >= 1) {
      return result[0];
    }
    return result;
  }

  return {
    /**
     * @param {{ workspaceId: string, accountKey: string, apiBaseUrl?: string }} input
     * @returns {Promise<{ accountId: number }>}
     */
    async ensureAccount(input) {
      const workspaceId = String(input.workspaceId);
      const accountKey = String(input.accountKey);
      const apiBaseUrl = String(input.apiBaseUrl || DEFAULT_API_BASE_URL);

      await pool.query(
        `INSERT INTO ilink_accounts (workspace_id, account_key, api_base_url, status, enabled)
VALUES (?, ?, ?, 'disconnected', 1)
ON DUPLICATE KEY UPDATE
  api_base_url = VALUES(api_base_url),
  updated_at = CURRENT_TIMESTAMP(6)`,
        [workspaceId, accountKey, apiBaseUrl]
      );

      const rows = unwrap(
        await pool.query(
          `SELECT id FROM ilink_accounts WHERE workspace_id = ? AND account_key = ? LIMIT 1`,
          [workspaceId, accountKey]
        )
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error("ensureAccount: account row missing after upsert");
      }
      return { accountId: Number(rows[0].id) };
    },

    /**
     * @param {{
     *   workspaceId: string,
     *   accountId: number,
     *   ownerId: string,
     *   leaseName?: string,
     *   ttlMs: number
     * }} input
     */
    async acquire(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const ownerId = String(input.ownerId);
      const leaseName = String(input.leaseName || DEFAULT_LEASE_NAME);
      const ttlMs = Number(input.ttlMs);
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        return { ok: false, error: "invalid ttlMs" };
      }

      return withConnection(async (conn) => {
        const now = nowFn();
        const expiresAt = new Date(now.getTime() + ttlMs);

        const rows = unwrap(
          await conn.query(
            `SELECT * FROM bot_runner_leases
WHERE workspace_id = ? AND account_id = ? AND lease_name = ?
FOR UPDATE`,
            [workspaceId, accountId, leaseName]
          )
        );
        const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

        if (!existing) {
          await conn.query(
            `INSERT INTO bot_runner_leases
(workspace_id, account_id, lease_name, owner_id, fencing_token, lease_expires_at, heartbeat_at, acquire_count)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [workspaceId, accountId, leaseName, ownerId, 1, expiresAt, now, 1]
          );
          return {
            ok: true,
            fencingToken: 1,
            expiresAt,
            ownerId,
          };
        }

        const currentOwner = existing.owner_id == null ? null : String(existing.owner_id);
        const currentExpires = asDate(existing.lease_expires_at);
        const expired =
          currentOwner == null ||
          currentExpires == null ||
          currentExpires.getTime() <= now.getTime();
        const isSelf = currentOwner === ownerId;

        if (!expired && !isSelf) {
          return {
            ok: false,
            error: `lease held by ${currentOwner}`,
          };
        }

        // Self + unexpired → renew without bumping fencing
        if (isSelf && !expired) {
          const header = unwrap(
            await conn.query(
              `UPDATE bot_runner_leases
SET lease_expires_at = ?, heartbeat_at = ?
WHERE workspace_id = ? AND account_id = ? AND lease_name = ?
  AND owner_id = ? AND fencing_token = ?
  AND (lease_expires_at IS NULL OR lease_expires_at > ?)`,
              [
                expiresAt,
                now,
                workspaceId,
                accountId,
                leaseName,
                ownerId,
                Number(existing.fencing_token),
                now,
              ]
            )
          );
          if (!header || Number(header.affectedRows) === 0) {
            return { ok: false, error: "lease renew race" };
          }
          return {
            ok: true,
            fencingToken: Number(existing.fencing_token),
            expiresAt,
            ownerId,
          };
        }

        // Empty owner or expired → preempt / take over; bump fencing
        const prevToken = Number(existing.fencing_token);
        const header = unwrap(
          await conn.query(
            `UPDATE bot_runner_leases
SET owner_id = ?,
    fencing_token = fencing_token + 1,
    lease_expires_at = ?,
    heartbeat_at = ?,
    acquire_count = acquire_count + 1
WHERE workspace_id = ? AND account_id = ? AND lease_name = ?
  AND fencing_token = ?`,
            [
              ownerId,
              expiresAt,
              now,
              workspaceId,
              accountId,
              leaseName,
              prevToken,
            ]
          )
        );
        if (!header || Number(header.affectedRows) === 0) {
          return { ok: false, error: "lease acquire race" };
        }
        return {
          ok: true,
          fencingToken: prevToken + 1,
          expiresAt,
          ownerId,
        };
      });
    },

    /**
     * @param {{
     *   workspaceId: string,
     *   accountId: number,
     *   ownerId: string,
     *   leaseName?: string,
     *   fencingToken: number,
     *   ttlMs: number
     * }} input
     */
    async renew(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const ownerId = String(input.ownerId);
      const leaseName = String(input.leaseName || DEFAULT_LEASE_NAME);
      const fencingToken = Number(input.fencingToken);
      const ttlMs = Number(input.ttlMs);
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        return { ok: false, error: "invalid ttlMs" };
      }

      const now = nowFn();
      const expiresAt = new Date(now.getTime() + ttlMs);

      const header = unwrap(
        await pool.query(
          `UPDATE bot_runner_leases
SET lease_expires_at = ?, heartbeat_at = ?
WHERE workspace_id = ? AND account_id = ? AND lease_name = ?
  AND owner_id = ? AND fencing_token = ?
  AND (lease_expires_at IS NULL OR lease_expires_at > ?)`,
          [
            expiresAt,
            now,
            workspaceId,
            accountId,
            leaseName,
            ownerId,
            fencingToken,
            now,
          ]
        )
      );

      if (!header || Number(header.affectedRows) === 0) {
        return { ok: false, error: "lease renew failed" };
      }
      return {
        ok: true,
        fencingToken,
        expiresAt,
        ownerId,
      };
    },

    /**
     * @param {{
     *   workspaceId: string,
     *   accountId: number,
     *   ownerId: string,
     *   leaseName?: string,
     *   fencingToken: number
     * }} input
     */
    async release(input) {
      const workspaceId = String(input.workspaceId);
      const accountId = Number(input.accountId);
      const ownerId = String(input.ownerId);
      const leaseName = String(input.leaseName || DEFAULT_LEASE_NAME);
      const fencingToken = Number(input.fencingToken);

      const header = unwrap(
        await pool.query(
          `UPDATE bot_runner_leases
SET owner_id = NULL, lease_expires_at = NULL, heartbeat_at = NULL
WHERE workspace_id = ? AND account_id = ? AND lease_name = ?
  AND owner_id = ? AND fencing_token = ?`,
          [workspaceId, accountId, leaseName, ownerId, fencingToken]
        )
      );

      if (!header || Number(header.affectedRows) === 0) {
        return { ok: false, error: "lease release failed" };
      }
      return { ok: true };
    },
  };
}

module.exports = { createDbLeaseStore };
