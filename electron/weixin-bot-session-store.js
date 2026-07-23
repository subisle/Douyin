"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  resolveSessionPath,
  sessionMaxBytes,
  sessionMaxSessions,
} = require("./local-paths");

const STORE_LOCK_TIMEOUT_MS = 5_000;
const STORE_LOCK_STALE_MS = 30_000;
const SESSION_LOCK_TIMEOUT_MS = 120_000;
const SESSION_LOCK_STALE_MS = 180_000;
const SESSION_LOCK_HEARTBEAT_MS = 30_000;
const MAX_SESSION_ID_CHARS = 128;
const MAX_MESSAGE_CONTENT_CHARS = 2_000;
const MAX_MESSAGE_ROLE_CHARS = 32;
const MAX_MESSAGES_PER_SESSION = 40;
const VALID_MESSAGE_ROLES = new Set(["user", "assistant"]);
const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function storePath() {
  return resolveSessionPath();
}

function emptyStore() {
  return Object.create(null);
}

function normalizeSessionId(sessionId) {
  const raw = String(sessionId || "default");
  if (raw.length <= MAX_SESSION_ID_CHARS) return raw;
  const suffix = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `${raw.slice(0, MAX_SESSION_ID_CHARS - suffix.length - 1)}:${suffix}`;
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const role = String(message.role ?? "").slice(0, MAX_MESSAGE_ROLE_CHARS);
  if (!VALID_MESSAGE_ROLES.has(role)) return null;
  return {
    role,
    content: String(message.content ?? "").slice(0, MAX_MESSAGE_CONTENT_CHARS),
    at: String(message.at ?? "").slice(0, 64),
  };
}

function normalizeStore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = emptyStore();
  for (const [rawKey, rawItem] of Object.entries(value)) {
    const key = normalizeSessionId(rawKey);
    const item = rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)
      ? rawItem
      : {};
    const messages = Array.isArray(item.messages)
      ? item.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES_PER_SESSION)
      : [];
    const updatedAt = Number(item.updatedAt);
    const candidate = {
      messages,
      updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
    };
    const previous = data[key];
    if (!previous || candidate.updatedAt >= previous.updatedAt) data[key] = candidate;
  }
  return data;
}

function quarantineCorruptStore(file) {
  const quarantine = `${file}.corrupt`;
  try {
    fs.unlinkSync(quarantine);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    fs.renameSync(file, quarantine);
    try {
      fs.chmodSync(quarantine, 0o600);
    } catch {
      // Windows does not implement POSIX file modes.
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function loadAll({ quarantineCorrupt = false } = {}) {
  const file = storePath();
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyStore();
    throw error;
  }
  if (!stat.isFile()) throw new Error("Agent 会话文件不是普通文件");
  const maxBytes = sessionMaxBytes();
  if (stat.size > maxBytes) {
    if (quarantineCorrupt) quarantineCorruptStore(file);
    return emptyStore();
  }

  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return emptyStore();
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (quarantineCorrupt) quarantineCorruptStore(file);
    return emptyStore();
  }
  const normalized = normalizeStore(parsed);
  if (!normalized) {
    if (quarantineCorrupt) quarantineCorruptStore(file);
    return emptyStore();
  }
  return normalized;
}

function tryAcquireFileLock(file, staleMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = `${process.pid}:${crypto.randomUUID()}`;
  try {
    const handle = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(handle, token, "utf8");
    return {
      refresh() {
        try {
          if (fs.readFileSync(file, "utf8") !== token) return false;
          const now = new Date();
          fs.futimesSync(handle, now, now);
          return true;
        } catch {
          return false;
        }
      },
      release() {
        try {
          fs.closeSync(handle);
        } catch {
          // ignore
        }
        try {
          if (fs.readFileSync(file, "utf8") === token) fs.unlinkSync(file);
        } catch {
          // The lock may have been reclaimed after a crashed/stalled owner.
        }
      },
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > staleMs) fs.unlinkSync(file);
    } catch (statError) {
      if (statError?.code !== "ENOENT") throw statError;
    }
    return null;
  }
}

function withStoreWriteLock(operation) {
  const lockFile = `${storePath()}.write.lock`;
  const deadline = Date.now() + STORE_LOCK_TIMEOUT_MS;
  while (true) {
    const release = tryAcquireFileLock(lockFile, STORE_LOCK_STALE_MS);
    if (release) {
      try {
        return operation();
      } finally {
        release.release();
      }
    }
    if (Date.now() >= deadline) throw new Error("Agent 会话存储锁等待超时");
    Atomics.wait(WAIT_BUFFER, 0, 0, 10);
  }
}

function pruneToBudget(all, maxSessions, maxBytes) {
  const data = Object.assign(emptyStore(), all);
  let keys = Object.keys(data);
  keys.sort((a, b) => (data[a].updatedAt || 0) - (data[b].updatedAt || 0));
  while (keys.length > maxSessions) {
    delete data[keys.shift()];
  }
  // size prune
  let json = JSON.stringify(data);
  while (Buffer.byteLength(json, "utf8") > maxBytes && keys.length > 1) {
    keys = Object.keys(data).sort((a, b) => (data[a].updatedAt || 0) - (data[b].updatedAt || 0));
    delete data[keys.shift()];
    json = JSON.stringify(data);
  }
  return data;
}

function saveAllUnlocked(data) {
  const file = storePath();
  const maxBytes = sessionMaxBytes();
  const maxSessions = sessionMaxSessions();
  const pruned = pruneToBudget(data, maxSessions, maxBytes);
  const json = JSON.stringify(pruned, null, 2);
  if (Buffer.byteLength(json, "utf8") > maxBytes) {
    throw new Error(`Agent 会话文件超过硬顶 ${maxBytes} 字节，已停止写入`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(handle, json, "utf8");
    try {
      fs.fsyncSync(handle);
    } catch {
      // Some virtual filesystems do not support fsync.
    }
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows does not implement POSIX file modes.
    }
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        // Ignore cleanup failures after a failed write.
      }
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Do not mask the original write/rename error.
    }
  }
}

function getSession(sessionId) {
  const all = loadAll();
  const key = normalizeSessionId(sessionId);
  const item = Object.prototype.hasOwnProperty.call(all, key)
    ? all[key]
    : { messages: [], updatedAt: 0 };
  return {
    id: key,
    messages: Array.isArray(item.messages) ? item.messages.map((message) => ({ ...message })) : [],
  };
}

function appendMessages(sessionId, messages, { assertOwned } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return getSession(sessionId);
  const additions = messages.map((message) => {
    const normalized = normalizeMessage({
      role: message?.role,
      content: message?.content,
      at: message?.at || new Date().toISOString(),
    });
    if (!normalized) throw new Error("Agent 会话消息格式无效");
    if (!message?.at) normalized.at = new Date().toISOString();
    return normalized;
  });

  return withStoreWriteLock(() => {
    assertOwned?.();
    const all = loadAll({ quarantineCorrupt: true });
    const key = normalizeSessionId(sessionId);
    const item = Object.prototype.hasOwnProperty.call(all, key)
      ? all[key]
      : { messages: [], updatedAt: 0 };
    item.messages = Array.isArray(item.messages) ? item.messages : [];
    item.messages.push(...additions);
    while (item.messages.length > MAX_MESSAGES_PER_SESSION) item.messages.shift();
    item.updatedAt = Date.now();
    all[key] = item;
    assertOwned?.();
    saveAllUnlocked(all);
    return { id: key, messages: [...item.messages] };
  });
}

function appendSession(sessionId, role, content, options = {}) {
  return appendMessages(sessionId, [{ role, content }], options);
}

function clearSession(sessionId) {
  return withStoreWriteLock(() => {
    const all = loadAll({ quarantineCorrupt: true });
    const key = normalizeSessionId(sessionId);
    delete all[key];
    saveAllUnlocked(all);
    return { ok: true };
  });
}

async function runSessionExclusive(sessionId, operation, lockOptions = {}) {
  if (typeof operation !== "function") throw new TypeError("Agent 会话操作必须是函数");
  const key = normalizeSessionId(sessionId);
  const digest = crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
  const lockFile = `${storePath()}.session-${digest}.lock`;
  const configured = Number(process.env.AGENT_SESSION_LOCK_TIMEOUT_MS);
  const configuredTimeoutMs = Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 300_000)
    : SESSION_LOCK_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(lockOptions.timeoutMs) && lockOptions.timeoutMs > 0
    ? Math.min(lockOptions.timeoutMs, 300_000)
    : configuredTimeoutMs;
  const staleMs = Number.isFinite(lockOptions.staleMs) && lockOptions.staleMs > 0
    ? Math.min(lockOptions.staleMs, 900_000)
    : SESSION_LOCK_STALE_MS;
  const maxHeartbeatMs = Math.max(1, Math.floor(staleMs / 3));
  const requestedHeartbeatMs = Number.isFinite(lockOptions.heartbeatMs) && lockOptions.heartbeatMs > 0
    ? lockOptions.heartbeatMs
    : SESSION_LOCK_HEARTBEAT_MS;
  const heartbeatMs = Math.min(requestedHeartbeatMs, maxHeartbeatMs);
  const deadline = Date.now() + timeoutMs;
  let lock = null;
  while (!lock) {
    lock = tryAcquireFileLock(lockFile, staleMs);
    if (lock) break;
    if (Date.now() >= deadline) throw new Error("Agent 会话处理锁等待超时");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  let lostError = null;
  const abortController = new AbortController();
  const markLost = () => {
    if (lostError) return;
    lostError = new Error("Agent 会话处理锁已失效");
    abortController.abort(lostError);
  };
  const assertOwned = () => {
    if (lostError || !lock.refresh()) {
      markLost();
      throw lostError;
    }
    return true;
  };
  const heartbeat = setInterval(() => {
    if (!lock.refresh()) markLost();
  }, heartbeatMs);
  heartbeat.unref?.();
  try {
    const result = await operation({
      signal: abortController.signal,
      assertOwned,
    });
    assertOwned();
    return result;
  } finally {
    clearInterval(heartbeat);
    lock.release();
  }
}

module.exports = {
  storePath,
  getSession,
  appendSession,
  appendMessages,
  clearSession,
  runSessionExclusive,
};
