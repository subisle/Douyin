"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_TTL_MS = 30 * 60_000;

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function storageKeyHash(storageKey) {
  return sha256Hex(Buffer.from(String(storageKey), "utf8"));
}

/**
 * Local filesystem artifact staging (S3.1 foundation).
 * status: staging → ready | discarded
 */
function createLocalArtifactStore(options = {}) {
  const rootDir = path.resolve(
    String(options.rootDir || path.join(os.tmpdir(), "douyin-artifacts"))
  );
  const maxBytes =
    Number(options.maxBytes) > 0 ? Number(options.maxBytes) : DEFAULT_MAX_BYTES;
  const defaultTtlMs =
    Number(options.defaultTtlMs) > 0 ? Number(options.defaultTtlMs) : DEFAULT_TTL_MS;
  const nowFn = typeof options.now === "function" ? options.now : () => new Date();

  fs.mkdirSync(rootDir, { recursive: true });

  function absolutePath(storageKey) {
    const key = String(storageKey || "").replace(/^[/\\]+/, "");
    if (!key || key.includes("..")) throw new Error("invalid storage key");
    const full = path.resolve(rootDir, key);
    if (!full.startsWith(rootDir)) throw new Error("path escape blocked");
    return full;
  }

  return {
    rootDir,
    maxBytes,

    /**
     * Write bytes to a staging path. Does not touch MySQL (caller inserts row).
     */
    async stageBuffer(input) {
      const buffer = Buffer.isBuffer(input.buffer)
        ? input.buffer
        : Buffer.from(input.buffer || []);
      if (!buffer.length) {
        return { ok: false, error: "empty buffer", code: "EMPTY" };
      }
      if (buffer.length > maxBytes) {
        return {
          ok: false,
          error: `artifact exceeds maxBytes (${buffer.length} > ${maxBytes})`,
          code: "TOO_LARGE",
        };
      }

      const artifactId = String(input.artifactId || crypto.randomUUID());
      const kind = String(input.artifactKind || "file").trim() || "file";
      const mimeType = String(input.mimeType || "application/octet-stream");
      const workspaceId = String(input.workspaceId || "default");
      const accountId = Number(input.accountId) || 0;
      const sessionId = String(input.sessionId || "main");
      const ownerType = String(input.ownerType || "session");
      const ownerId = String(input.ownerId || sessionId);
      const ttlMs = Number(input.ttlMs) > 0 ? Number(input.ttlMs) : defaultTtlMs;
      const now = nowFn();
      const expiresAt = new Date(now.getTime() + ttlMs);

      const contentSha = sha256Hex(buffer);
      const storageKey = path.posix.join(
        workspaceId,
        String(accountId),
        `${artifactId}.bin`
      );
      const full = absolutePath(storageKey);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      const tmp = `${full}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, buffer, { mode: 0o600 });
      await fsp.rename(tmp, full);

      return {
        ok: true,
        artifactId,
        storageProvider: "local",
        storageKey,
        storageKeyHash: storageKeyHash(storageKey),
        contentSha256: contentSha,
        byteSize: buffer.length,
        mimeType,
        artifactKind: kind,
        status: "staging",
        workspaceId,
        accountId,
        sessionId,
        ownerType,
        ownerId,
        expiresAt: expiresAt.toISOString(),
        absolutePath: full,
      };
    },

    async markReady(storageKey) {
      const full = absolutePath(storageKey);
      await fsp.access(full);
      return { ok: true, status: "ready", storageKey: String(storageKey) };
    },

    async readBuffer(storageKey) {
      const full = absolutePath(storageKey);
      const buffer = await fsp.readFile(full);
      return { ok: true, buffer, byteSize: buffer.length };
    },

    async discard(storageKey) {
      const full = absolutePath(storageKey);
      try {
        await fsp.unlink(full);
      } catch (error) {
        if (error && error.code !== "ENOENT") throw error;
      }
      return { ok: true };
    },

    /**
     * Delete files under root whose mtime/expiry is past.
     * @param {{ olderThanMs?: number }} input
     */
    async gcExpired(input = {}) {
      const olderThanMs =
        Number(input.olderThanMs) > 0 ? Number(input.olderThanMs) : defaultTtlMs;
      const cutoff = nowFn().getTime() - olderThanMs;
      let removed = 0;

      async function walk(dir) {
        let entries;
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
            continue;
          }
          if (!entry.isFile()) continue;
          const st = await fsp.stat(full);
          if (st.mtimeMs <= cutoff) {
            await fsp.unlink(full);
            removed += 1;
          }
        }
      }

      await walk(rootDir);
      return { ok: true, removed };
    },

    /**
     * Build a row-shaped object for INSERT into artifacts (caller runs SQL).
     */
    toDbRow(staged, { status = "ready" } = {}) {
      return {
        workspace_id: staged.workspaceId,
        account_id: staged.accountId,
        session_id: staged.sessionId,
        artifact_id: staged.artifactId,
        owner_type: staged.ownerType,
        owner_id: staged.ownerId,
        artifact_kind: staged.artifactKind,
        mime_type: staged.mimeType,
        storage_provider: staged.storageProvider,
        storage_key: staged.storageKey,
        storage_key_hash: staged.storageKeyHash,
        content_sha256: staged.contentSha256,
        byte_size: staged.byteSize,
        status,
        metadata: null,
        expires_at: staged.expiresAt,
      };
    },
  };
}

module.exports = {
  createLocalArtifactStore,
  sha256Hex,
  storageKeyHash,
  DEFAULT_MAX_BYTES,
  DEFAULT_TTL_MS,
};
