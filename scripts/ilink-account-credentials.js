"use strict";

const DEFAULT_API_BASE_URL = "https://ilinkai.weixin.qq.com";

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
 * @param {{
 *   pool: { query: Function },
 *   crypto: { encrypt: Function, decrypt: Function },
 *   now?: () => Date
 * }} options
 */
function createAccountCredentialStore(options) {
  if (!options || !options.pool || typeof options.pool.query !== "function") {
    throw new Error("createAccountCredentialStore requires { pool } with query()");
  }
  if (
    !options.crypto ||
    typeof options.crypto.encrypt !== "function" ||
    typeof options.crypto.decrypt !== "function"
  ) {
    throw new Error(
      "createAccountCredentialStore requires { crypto } with encrypt/decrypt"
    );
  }

  const pool = options.pool;
  const cryptoApi = options.crypto;
  const nowFn = typeof options.now === "function" ? options.now : () => new Date();

  /**
   * @param {{ workspaceId: string, accountId?: number|string, accountKey?: string }} input
   */
  async function loadAccountRow(input) {
    const workspaceId = String(input.workspaceId);
    if (input.accountId != null && input.accountId !== "") {
      const rows = unwrap(
        await pool.query(
          `SELECT id, workspace_id, account_key, display_name, api_base_url,
  credential_ciphertext, credential_key_id, status
FROM ilink_accounts
WHERE workspace_id = ? AND id = ?
LIMIT 1`,
          [workspaceId, Number(input.accountId)]
        )
      );
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows[0];
    }

    if (input.accountKey != null && input.accountKey !== "") {
      const rows = unwrap(
        await pool.query(
          `SELECT id, workspace_id, account_key, display_name, api_base_url,
  credential_ciphertext, credential_key_id, status
FROM ilink_accounts
WHERE workspace_id = ? AND account_key = ?
LIMIT 1`,
          [workspaceId, String(input.accountKey)]
        )
      );
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows[0];
    }

    return null;
  }

  return {
    /**
     * @param {{
     *   workspaceId: string,
     *   accountKey: string,
     *   token: string,
     *   baseUrl?: string,
     *   displayName?: string
     * }} input
     */
    async setCredential(input) {
      try {
        const workspaceId = String(input.workspaceId ?? "").trim();
        const accountKey = String(input.accountKey ?? "").trim();
        const token = String(input.token ?? "");
        if (!workspaceId || !accountKey) {
          return {
            ok: false,
            error: "workspaceId and accountKey are required",
            code: "ERROR",
          };
        }
        if (!token) {
          return {
            ok: false,
            error: "token is required",
            code: "ERROR",
          };
        }

        const baseUrl = String(input.baseUrl || DEFAULT_API_BASE_URL);
        const displayName =
          input.displayName == null ? "" : String(input.displayName);
        const payload = {
          token,
          baseUrl,
          savedAt: nowFn().toISOString(),
        };
        const sealed = cryptoApi.encrypt(JSON.stringify(payload));

        await pool.query(
          `INSERT INTO ilink_accounts (
  workspace_id, account_key, display_name, api_base_url,
  credential_ciphertext, credential_key_id, status, enabled
) VALUES (?, ?, ?, ?, ?, ?, 'connected', 1)
ON DUPLICATE KEY UPDATE
  api_base_url = VALUES(api_base_url),
  credential_ciphertext = VALUES(credential_ciphertext),
  credential_key_id = VALUES(credential_key_id),
  display_name = IF(VALUES(display_name) = '', display_name, VALUES(display_name)),
  status = 'connected',
  updated_at = CURRENT_TIMESTAMP(6)`,
          [
            workspaceId,
            accountKey,
            displayName,
            baseUrl,
            sealed.ciphertext,
            sealed.keyId,
          ]
        );

        const rows = unwrap(
          await pool.query(
            `SELECT id FROM ilink_accounts
WHERE workspace_id = ? AND account_key = ?
LIMIT 1`,
            [workspaceId, accountKey]
          )
        );
        if (!Array.isArray(rows) || rows.length === 0) {
          return {
            ok: false,
            error: "account row missing after upsert",
            code: "ERROR",
          };
        }

        return {
          ok: true,
          accountId: Number(rows[0].id),
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
     * @param {{
     *   workspaceId: string,
     *   accountKey?: string,
     *   accountId?: number|string
     * }} input
     */
    async getCredential(input) {
      try {
        const workspaceId = String(input.workspaceId ?? "").trim();
        if (!workspaceId) {
          return {
            ok: false,
            error: "workspaceId is required",
            code: "ERROR",
          };
        }
        if (
          (input.accountId == null || input.accountId === "") &&
          (input.accountKey == null || input.accountKey === "")
        ) {
          return {
            ok: false,
            error: "accountId or accountKey is required",
            code: "ERROR",
          };
        }

        const row = await loadAccountRow(input);
        if (
          !row ||
          row.credential_ciphertext == null ||
          row.credential_ciphertext === "" ||
          row.credential_key_id == null ||
          row.credential_key_id === ""
        ) {
          return {
            ok: false,
            error: "credential not found",
            code: "NOT_FOUND",
          };
        }

        let plain;
        try {
          plain = cryptoApi.decrypt(
            String(row.credential_ciphertext),
            String(row.credential_key_id)
          );
        } catch (decryptErr) {
          return {
            ok: false,
            error:
              decryptErr instanceof Error
                ? decryptErr.message
                : String(decryptErr),
            code: "DECRYPT_ERROR",
          };
        }

        let payload;
        try {
          payload = JSON.parse(plain);
        } catch (parseErr) {
          return {
            ok: false,
            error:
              parseErr instanceof Error ? parseErr.message : String(parseErr),
            code: "DECRYPT_ERROR",
          };
        }

        const token = payload && payload.token != null ? String(payload.token) : "";
        if (!token) {
          return {
            ok: false,
            error: "credential payload missing token",
            code: "DECRYPT_ERROR",
          };
        }

        const baseUrl =
          payload.baseUrl != null && payload.baseUrl !== ""
            ? String(payload.baseUrl)
            : row.api_base_url
              ? String(row.api_base_url)
              : DEFAULT_API_BASE_URL;

        return {
          ok: true,
          accountId: Number(row.id),
          token,
          baseUrl,
          keyId: String(row.credential_key_id),
          accountKey: String(row.account_key),
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
     * @param {{
     *   workspaceId: string,
     *   accountId?: number|string,
     *   accountKey?: string
     * }} input
     */
    async clearCredential(input) {
      try {
        const workspaceId = String(input.workspaceId ?? "").trim();
        if (!workspaceId) {
          return {
            ok: false,
            error: "workspaceId is required",
            code: "ERROR",
          };
        }

        if (input.accountId != null && input.accountId !== "") {
          await pool.query(
            `UPDATE ilink_accounts
SET credential_ciphertext = NULL,
    credential_key_id = NULL,
    updated_at = CURRENT_TIMESTAMP(6)
WHERE workspace_id = ? AND id = ?`,
            [workspaceId, Number(input.accountId)]
          );
          return { ok: true };
        }

        if (input.accountKey != null && input.accountKey !== "") {
          await pool.query(
            `UPDATE ilink_accounts
SET credential_ciphertext = NULL,
    credential_key_id = NULL,
    updated_at = CURRENT_TIMESTAMP(6)
WHERE workspace_id = ? AND account_key = ?`,
            [workspaceId, String(input.accountKey)]
          );
          return { ok: true };
        }

        return {
          ok: false,
          error: "accountId or accountKey is required",
          code: "ERROR",
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ERROR",
        };
      }
    },
  };
}

module.exports = { createAccountCredentialStore };
