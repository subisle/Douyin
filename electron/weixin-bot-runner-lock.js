"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolveLockPath } = require("./local-paths");

const ACQUISITION_GUARD_STALE_MS = 30_000;
const ACQUISITION_GUARD_WAIT_MS = 5;
const ACQUISITION_GUARD_TIMEOUT_MS = 250;
const guardWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

/**
 * Mutual exclusion: same WeChat bot must not run on desktop and server together.
 * Lease file defaults to project data/runtime/locks (not system /tmp).
 */
function defaultLeasePath() {
  return resolveLockPath();
}

function defaultOwnerId() {
  return String(process.env.BOT_OWNER_ID || `${os.hostname()}:${process.pid}`).trim();
}

function leaseOwnerId(lease) {
  if (!lease) return "";
  return String(lease.ownerId || (lease.host && lease.pid ? `${lease.host}:${lease.pid}` : "")).trim();
}

function leaseExpiryMs(lease) {
  const value = lease?.expiresAt;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value || "").trim();
  if (!text) return 0;
  const timestamp = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sleepSync(ms) {
  Atomics.wait(guardWaitBuffer, 0, 0, ms);
}

function acquireOperationGuard(file) {
  const guard = `${file}.acquire`;
  const deadline = Date.now() + ACQUISITION_GUARD_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(guard, { mode: 0o700 });
      return guard;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    try {
      const stat = fs.statSync(guard);
      if (stat.mtimeMs < Date.now() - ACQUISITION_GUARD_STALE_MS) {
        fs.rmdirSync(guard);
        continue;
      }
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      if (error?.code !== "ENOTEMPTY") throw error;
    }

    if (Date.now() >= deadline) return null;
    sleepSync(ACQUISITION_GUARD_WAIT_MS);
  }
}

function withOperationGuard(file, callback) {
  const guard = acquireOperationGuard(file);
  if (!guard) {
    return {
      ok: false,
      error: "微信 Runner 锁操作繁忙，请重试",
      lease: readLease(file),
    };
  }
  try {
    return callback();
  } finally {
    try {
      fs.rmdirSync(guard);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function readLease(file = defaultLeasePath()) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeLease(file, lease) {
  const tempFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(lease, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempFile, file);
}

function createLeaseExclusive(file, lease) {
  const handle = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(handle, JSON.stringify(lease, null, 2), "utf8");
  } finally {
    fs.closeSync(handle);
  }
}

function acquireRunnerLock({
  runner = "desktop",
  ttlMs = 120_000,
  file = defaultLeasePath(),
  ownerId = defaultOwnerId(),
} = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withOperationGuard(file, () => {
    const now = Date.now();
    const existing = readLease(file);
    const existingOwner = leaseOwnerId(existing);
    if (existing && existingOwner !== ownerId && leaseExpiryMs(existing) > now) {
      return {
        ok: false,
        error: `微信 Runner 已被 ${existing.runner || "unknown"} 占用（pid ${existing.pid || "?"}）`,
        lease: existing,
      };
    }
    const lease = {
      runner,
      ownerId,
      pid: process.pid,
      updatedAt: now,
      expiresAt: now + ttlMs,
      host: os.hostname(),
    };

    if (existing && existingOwner === ownerId) {
      writeLease(file, lease);
      return { ok: true, lease, file };
    }

    if (existing) {
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    try {
      createLeaseExclusive(file, lease);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = readLease(file);
      return {
        ok: false,
        error: `微信 Runner 已被 ${current?.runner || "unknown"} 占用（pid ${current?.pid || "?"}）`,
        lease: current,
      };
    }
    return { ok: true, lease, file };
  });
}

function renewRunnerLock({ runner = "desktop", file = defaultLeasePath(), ownerId = defaultOwnerId(), ttlMs = 120_000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withOperationGuard(file, () => {
    const existing = readLease(file);
    if (!existing || leaseOwnerId(existing) !== ownerId) {
      return { ok: false, error: "微信 Runner 租约已被其他进程接管", lease: existing };
    }
    const now = Date.now();
    const lease = {
      runner,
      ownerId,
      pid: process.pid,
      updatedAt: now,
      expiresAt: now + ttlMs,
      host: os.hostname(),
    };
    writeLease(file, lease);
    return { ok: true, lease, file };
  });
}

function releaseRunnerLock({ file = defaultLeasePath(), ownerId = defaultOwnerId() } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withOperationGuard(file, () => {
    const existing = readLease(file);
    if (!existing) return { ok: true };
    if (leaseOwnerId(existing) !== ownerId) {
      return { ok: false, error: "微信 Runner 锁属于其他进程" };
    }
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return { ok: true };
  });
}

module.exports = {
  defaultLeasePath,
  defaultOwnerId,
  readLease,
  leaseExpiryMs,
  acquireRunnerLock,
  renewRunnerLock,
  releaseRunnerLock,
};
