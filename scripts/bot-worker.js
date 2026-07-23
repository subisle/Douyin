#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Server runner lifecycle.
 *
 * This process deliberately owns only the runner lease until the pure Node
 * iLink adapter, account store, and Inbox/Outbox dispatcher are wired in.
 * Keeping that boundary explicit prevents a live process from claiming that
 * messages are durable when it has not actually polled or persisted them.
 */

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const {
  acquireRunnerLock,
  renewRunnerLock,
  releaseRunnerLock,
} = require("../electron/weixin-bot-runner-lock");
const { resolveWorkerStatusPath } = require("../electron/local-paths");

const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const WORKER_PHASES = new Set([
  "starting",
  "running",
  "lease_lost",
  "stopped",
  "error",
]);

function positiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function defaultOwnerId(env = process.env) {
  return String(env.BOT_OWNER_ID || `${os.hostname()}:${process.pid}`).trim();
}

function normalizePhase(value) {
  const phase = String(value || "").trim();
  return WORKER_PHASES.has(phase) ? phase : "error";
}

function safeError(error) {
  const text = error instanceof Error ? error.message : String(error || "未知错误");
  return text.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 500);
}

function leaseExpiryIso(value, fallbackMs) {
  const raw = typeof value === "number" || /^\d+$/.test(String(value || "").trim())
    ? Number(value)
    : Date.parse(String(value || ""));
  const timestamp = Number.isFinite(raw) ? raw : fallbackMs;
  return new Date(timestamp).toISOString();
}

function writeStatusFile(file, state) {
  const target = String(file || "").trim();
  if (!target) return;
  const absolute = path.resolve(target);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, absolute);
  try {
    fs.chmodSync(absolute, 0o600);
  } catch {
    // Windows does not implement POSIX file modes.
  }
}

function createBotWorker(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const lock = options.runnerLock || {};
  const lockApi = {
    acquire: lock.acquire || acquireRunnerLock,
    renew: lock.renew || renewRunnerLock,
    release: lock.release || releaseRunnerLock,
  };
  const timers = options.timers || globalThis;
  const exit = typeof options.exit === "function" ? options.exit : (code) => process.exit(code);
  const runner = String(options.runner || env.BOT_RUNNER || "server").trim() || "server";
  const ownerId = String(options.ownerId || defaultOwnerId(env)).trim();
  const lockFile = String(options.lockFile || env.BOT_LOCK_PATH || "").trim() || undefined;
  const leaseTtlMs = positiveInt(
    options.leaseTtlMs ?? env.BOT_LEASE_TTL_MS,
    DEFAULT_LEASE_TTL_MS,
    { min: 10, max: 24 * 60 * 60_000 }
  );
  const configuredHeartbeatMs = positiveInt(
    options.heartbeatMs ?? env.BOT_HEARTBEAT_MS,
    Math.min(DEFAULT_HEARTBEAT_MS, Math.floor(leaseTtlMs / 3)),
    { min: 5, max: 24 * 60 * 60_000 }
  );
  const heartbeatMs = Math.min(configuredHeartbeatMs, Math.max(5, Math.floor(leaseTtlMs / 2)));
  const statusPath = String(options.statusPath || env.BOT_WORKER_STATUS_PATH || "").trim();
  let heartbeatTimer = null;
  let exitRequested = false;
  let leaseLost = false;
  let lease = null;
  let state = {
    phase: "starting",
    runner,
    ownerId,
    pid: process.pid,
    startedAt: null,
    stoppedAt: null,
    lastHeartbeatAt: null,
    lastError: null,
    leaseExpiresAt: null,
    persistence: "not_connected",
  };

  function snapshot() {
    return { ...state };
  }

  function update(next) {
    state = {
      ...state,
      ...next,
      phase: normalizePhase(next.phase || state.phase),
    };
    try {
      writeStatusFile(statusPath, snapshot());
    } catch (error) {
      // Status persistence must never hide a lease failure or keep a dead worker alive.
      state = {
        ...state,
        lastError: state.lastError || `状态文件写入失败：${safeError(error)}`,
      };
    }
    try {
      options.onStateChange?.(snapshot());
    } catch {
      // Observers are not part of the worker's lease contract.
    }
    return snapshot();
  }

  function callOptions() {
    return {
      runner,
      ownerId: lease?.ownerId || ownerId,
      ttlMs: leaseTtlMs,
      file: lease?.file || lockFile,
    };
  }

  function stopHeartbeat() {
    if (heartbeatTimer != null) timers.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function requestExit(code, reason) {
    if (exitRequested) return;
    exitRequested = true;
    if (reason && typeof logger.error === "function") logger.error(`[bot-worker] ${reason}`);
    // Keep the state write before handing control to the process supervisor.
    try {
      exit(code);
    } catch (error) {
      // Test/supervisor adapters may throw to prevent process termination.
      update({ lastError: `Worker 退出失败：${safeError(error)}` });
    }
  }

  function handleLeaseLoss(reason) {
    if (leaseLost || state.phase === "stopped") return snapshot();
    leaseLost = true;
    stopHeartbeat();
    lease = null;
    const message = `Runner 租约失效：${String(reason || "续租失败")}`;
    update({ phase: "lease_lost", lastError: message, stoppedAt: new Date().toISOString() });
    requestExit(1, message);
    return snapshot();
  }

  function renewNow() {
    if (!lease || leaseLost || state.phase !== "running") return snapshot();
    let result;
    try {
      result = lockApi.renew(callOptions());
    } catch (error) {
      return handleLeaseLoss(safeError(error));
    }
    if (!result?.ok) return handleLeaseLoss(result?.error || "Runner 租约续期失败");
    const now = new Date().toISOString();
    update({
      lastHeartbeatAt: now,
      leaseExpiresAt: leaseExpiryIso(result.lease?.expiresAt, Date.now() + leaseTtlMs),
      lastError: null,
    });
    return snapshot();
  }

  function start() {
    if (state.phase === "running") return snapshot();
    if (state.phase === "lease_lost") throw new Error(state.lastError || "Runner 租约已失效");
    let acquired;
    try {
      acquired = lockApi.acquire(callOptions());
    } catch (error) {
      const message = `Runner 锁获取失败：${safeError(error)}`;
      update({ phase: "error", lastError: message, stoppedAt: new Date().toISOString() });
      requestExit(1, message);
      throw error;
    }
    if (!acquired?.ok) {
      const error = new Error(acquired?.error || "Runner 锁获取失败");
      error.code = "BOT_RUNNER_LOCKED";
      update({ phase: "error", lastError: error.message, stoppedAt: new Date().toISOString() });
      requestExit(1, error.message);
      throw error;
    }
    lease = {
      file: acquired.file || lockFile,
      ownerId: acquired.lease?.ownerId || ownerId,
    };
    update({
      phase: "running",
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      lastError: null,
      leaseExpiresAt: leaseExpiryIso(acquired.lease?.expiresAt, Date.now() + leaseTtlMs),
    });
    heartbeatTimer = timers.setInterval(renewNow, heartbeatMs);
    return snapshot();
  }

  function stop({ exitCode = 0 } = {}) {
    if (state.phase === "stopped") return snapshot();
    stopHeartbeat();
    const ownedLease = lease && !leaseLost;
    lease = null;
    if (ownedLease) {
      try {
        const released = lockApi.release({
          runner,
          ownerId: ownedLease.ownerId || ownerId,
          file: ownedLease.file || lockFile,
        });
        if (released?.ok === false) {
          update({ lastError: released.error || "Runner 租约释放失败" });
        }
      } catch (error) {
        update({ lastError: `Runner 租约释放失败：${safeError(error)}` });
      }
    }
    update({ phase: "stopped", stoppedAt: new Date().toISOString() });
    if (exitCode !== 0) requestExit(exitCode, state.lastError || "Worker stopped with error");
    return snapshot();
  }

  return {
    start,
    stop,
    renewNow,
    getState: snapshot,
    get heartbeatActive() {
      return heartbeatTimer != null;
    },
  };
}

function main() {
  const worker = createBotWorker({ statusPath: resolveWorkerStatusPath() });
  try {
    worker.start();
  } catch (error) {
    if (typeof console.error === "function") console.error("[bot-worker]", safeError(error));
    process.exitCode = 1;
    return;
  }
  console.log("[bot-worker] lease acquired; server iLink adapter is not configured");
  console.log("[bot-worker] Inbox/Outbox polling remains disabled until account and adapter configuration is present");

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[bot-worker] ${signal} received`);
    const state = worker.stop();
    process.exitCode = state.lastError ? 1 : 0;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module) main();

module.exports = {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_LEASE_TTL_MS,
  createBotWorker,
  defaultOwnerId,
  main,
  leaseExpiryIso,
  safeError,
  writeStatusFile,
};
