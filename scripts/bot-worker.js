#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Server runner lifecycle.
 *
 * Owns the runner lease (file lock by default, optional MySQL lease when DB
 * mode is enabled) and may start the pure Node iLink text transport.
 * When BOT_ILINK_DB_ENABLED / options.dbRuntime is on, inbox batches can be
 * staged via MySQL Inbox/Cursor. Outbox / media / durable claim of full
 * message durability beyond staged text still remain unwired.
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
const {
  createIlinkTextTransport,
  loadTransportConfig,
} = require("./ilink-text-transport");

const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_DB_LEASE_NAME = "ilink-poller";
const DEFAULT_API_BASE_URL = "https://ilinkai.weixin.qq.com";
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

function truthyEnv(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
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

function mergeTransportState(transportState) {
  if (!transportState || typeof transportState !== "object") return {};
  return {
    transport: transportState.phase || "disabled",
    transportAccountId: transportState.accountId ?? null,
    lastPollAt: transportState.lastPollAt ?? null,
    lastInboundAt: transportState.lastInboundAt ?? null,
    lastOutboundAt: transportState.lastOutboundAt ?? null,
    receivedCount: Number(transportState.receivedCount) || 0,
    sentCount: Number(transportState.sentCount) || 0,
  };
}

/**
 * Resolve injected or env-driven DB runtime config.
 * Unit tests inject stores via options.dbRuntime; production can enable via env
 * and lazily build real pool + stores.
 *
 * @returns {{
 *   enabled: boolean,
 *   workspaceId: string,
 *   accountKey: string,
 *   sessionId: string,
 *   apiBaseUrl: string,
 *   leaseName: string,
 *   leaseStore: object|null,
 *   inboxStore: object|null,
 *   pool: object|null,
 * }}
 */
function resolveDbRuntime(options = {}, env = process.env) {
  const injected = options.dbRuntime && typeof options.dbRuntime === "object"
    ? options.dbRuntime
    : null;
  const envEnabled = truthyEnv(env.BOT_ILINK_DB_ENABLED);
  if (!injected && !envEnabled) {
    return {
      enabled: false,
      workspaceId: "default",
      accountKey: "default",
      sessionId: "main",
      apiBaseUrl: DEFAULT_API_BASE_URL,
      leaseName: DEFAULT_DB_LEASE_NAME,
      leaseStore: null,
      inboxStore: null,
      pool: null,
    };
  }

  const workspaceId = String(
    injected?.workspaceId || env.BOT_ILINK_WORKSPACE_ID || "default"
  ).trim() || "default";
  const accountKey = String(
    injected?.accountKey ||
      env.BOT_ILINK_ACCOUNT_KEY ||
      env.BOT_ILINK_ACCOUNT_ID ||
      "default"
  ).trim() || "default";
  const sessionId = String(injected?.sessionId || "main").trim() || "main";
  const apiBaseUrl = String(
    injected?.apiBaseUrl || env.BOT_ILINK_BASE_URL || DEFAULT_API_BASE_URL
  ).trim() || DEFAULT_API_BASE_URL;
  const leaseName = String(
    injected?.leaseName || DEFAULT_DB_LEASE_NAME
  ).trim() || DEFAULT_DB_LEASE_NAME;

  if (injected?.enabled === false && !envEnabled) {
    return {
      enabled: false,
      workspaceId,
      accountKey,
      sessionId,
      apiBaseUrl,
      leaseName,
      leaseStore: null,
      inboxStore: null,
      pool: null,
    };
  }

  // Injected path (tests): use provided stores as-is.
  if (injected && (injected.leaseStore || injected.inboxStore || injected.enabled)) {
    return {
      enabled: true,
      workspaceId,
      accountKey,
      sessionId,
      apiBaseUrl,
      leaseName,
      leaseStore: injected.leaseStore || null,
      inboxStore: injected.inboxStore || null,
      pool: injected.pool || null,
    };
  }

  // Env-only production path: lazily build real pool + stores.
  if (envEnabled) {
    return {
      enabled: true,
      workspaceId,
      accountKey,
      sessionId,
      apiBaseUrl,
      leaseName,
      leaseStore: null,
      inboxStore: null,
      pool: null,
      lazyBuild: true,
    };
  }

  return {
    enabled: false,
    workspaceId,
    accountKey,
    sessionId,
    apiBaseUrl,
    leaseName,
    leaseStore: null,
    inboxStore: null,
    pool: null,
  };
}

/**
 * Build real MySQL-backed stores when env enables DB and no stores injected.
 * Lazy require keeps unit tests free of mysql2 unless this path runs.
 */
function buildLiveDbRuntime(dbRuntime, env = process.env) {
  const { resolveDbConfig } = require("../electron/db-config");
  const mysql = require("mysql2/promise");
  const { createRuntimeCrypto } = require("./ilink-crypto");
  const { createDbLeaseStore } = require("./ilink-db-lease");
  const { createInboxCursorStore } = require("./ilink-inbox-cursor");

  const secret = String(env.BOT_RUNTIME_SECRET || "").trim();
  if (secret.length < 16) {
    throw new Error("BOT_RUNTIME_SECRET must be at least 16 characters when DB mode is enabled");
  }
  const config = resolveDbConfig(env);
  const pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 4,
    connectTimeout: 10_000,
    dateStrings: true,
  });
  const cryptoApi = createRuntimeCrypto({ secret });
  return {
    ...dbRuntime,
    pool,
    leaseStore: createDbLeaseStore({ pool }),
    inboxStore: createInboxCursorStore({ pool, crypto: cryptoApi }),
  };
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
  const transportConfig =
    options.transportConfig || loadTransportConfig({ env });

  let dbRuntime = resolveDbRuntime(options, env);
  const dbEnabled = Boolean(dbRuntime.enabled);
  const customCreateTransport = typeof options.createTransport === "function"
    ? options.createTransport
    : null;

  let heartbeatTimer = null;
  let exitRequested = false;
  let leaseLost = false;
  let lease = null;
  let transport = null;
  /** @type {number|null} */
  let dbAccountId = null;
  /** @type {number|null} */
  let fencingToken = null;
  let dbModeActive = false;

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
    transport: "disabled",
    transportAccountId: null,
    lastPollAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    receivedCount: 0,
    sentCount: 0,
    fencingToken: null,
    dbAccountId: null,
  };

  function snapshot() {
    return { ...state };
  }

  function update(next) {
    // File mode always keeps persistence not_connected.
    // DB mode allows mysql and keeps it across heartbeats / transport merges.
    let persistence = "not_connected";
    if (next.persistence !== undefined) {
      persistence = next.persistence;
    } else if (dbModeActive || state.persistence === "mysql") {
      persistence = "mysql";
    }

    state = {
      ...state,
      ...next,
      phase: normalizePhase(next.phase || state.phase),
      persistence,
      fencingToken:
        next.fencingToken !== undefined ? next.fencingToken : state.fencingToken,
      dbAccountId:
        next.dbAccountId !== undefined ? next.dbAccountId : state.dbAccountId,
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

  function applyTransportState(transportState) {
    return update(mergeTransportState(transportState));
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

  function stopTransport() {
    if (!transport) return;
    const current = transport;
    transport = null;
    try {
      const result = current.stop?.();
      // Prefer getState after stop() is invoked; mocks often mutate sync then return a Promise.
      const after = current.getState?.();
      if (after) {
        applyTransportState(after);
        return;
      }
      if (result && typeof result.then === "function") {
        result.then(
          (stopped) => applyTransportState(stopped || { phase: "stopped" }),
          () => applyTransportState({ phase: "stopped" })
        );
        return;
      }
      applyTransportState(result || { phase: "stopped" });
    } catch {
      applyTransportState(current.getState?.() || { phase: "stopped" });
    }
  }

  function buildPersistBatch() {
    if (!dbEnabled || !dbRuntime.inboxStore) return undefined;
    return async ({ updatesBuf, messages }) => {
      const result = await dbRuntime.inboxStore.stageTextBatch({
        workspaceId: dbRuntime.workspaceId,
        accountId: dbAccountId,
        sessionId: dbRuntime.sessionId,
        fencingToken,
        ownerId: lease?.ownerId || ownerId,
        updatesBuf,
        messages,
      });
      if (!result?.ok) {
        const err = new Error(result?.error || result?.code || "stageTextBatch failed");
        err.code = result?.code;
        throw err;
      }
      return result;
    };
  }

  function defaultCreateTransport(config) {
    return createIlinkTextTransport({
      config,
      env,
      onEvent: (event) => {
        if (event?.type === "state") applyTransportState(event.state);
      },
      persistBatch: buildPersistBatch(),
    });
  }

  function createTransportFactory(config) {
    if (customCreateTransport) {
      // Injected factories may accept a second hooks bag; pass persistBatch for tests.
      return customCreateTransport(config, { persistBatch: buildPersistBatch() });
    }
    return defaultCreateTransport(config);
  }

  function startTransport() {
    if (!transportConfig?.enabled) {
      update({ transport: "disabled" });
      return;
    }
    if (!String(transportConfig.token || "").trim()) {
      update({
        transport: "not_configured",
        lastError: state.lastError || "缺少 BOT_ILINK_TOKEN",
      });
      return;
    }
    if (transport || leaseLost || state.phase !== "running") return;
    try {
      transport = createTransportFactory(transportConfig);
      const started = transport.start?.();
      const mergeFrom = () => {
        if (leaseLost || state.phase === "stopped" || state.phase === "lease_lost") {
          return;
        }
        applyTransportState(transport?.getState?.() || { phase: "polling" });
      };
      if (started && typeof started.then === "function") {
        started.then(
          () => mergeFrom(),
          (error) => {
            update({
              lastError: `iLink transport 启动失败：${safeError(error)}`,
              transport: "error",
            });
          }
        );
      } else {
        mergeFrom();
      }
    } catch (error) {
      update({
        lastError: `iLink transport 启动失败：${safeError(error)}`,
        transport: "error",
      });
    }
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
    stopTransport();
    lease = null;
    fencingToken = null;
    dbAccountId = null;
    const message = `Runner 租约失效：${String(reason || "续租失败")}`;
    update({
      phase: "lease_lost",
      lastError: message,
      stoppedAt: new Date().toISOString(),
      fencingToken: null,
      dbAccountId: null,
    });
    requestExit(1, message);
    return snapshot();
  }

  function renewNowFile() {
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

  function renewNowDb() {
    if (!lease || leaseLost || state.phase !== "running" || !dbRuntime.leaseStore) {
      return snapshot();
    }
    const renewPromise = Promise.resolve().then(() =>
      dbRuntime.leaseStore.renew({
        workspaceId: dbRuntime.workspaceId,
        accountId: dbAccountId,
        ownerId: lease?.ownerId || ownerId,
        leaseName: dbRuntime.leaseName,
        fencingToken,
        ttlMs: leaseTtlMs,
      })
    );
    renewPromise.then(
      (result) => {
        if (leaseLost || state.phase !== "running") return;
        if (!result?.ok) {
          handleLeaseLoss(result?.error || "DB 租约续期失败");
          return;
        }
        if (result.fencingToken != null) {
          fencingToken = Number(result.fencingToken);
        }
        const now = new Date().toISOString();
        update({
          lastHeartbeatAt: now,
          leaseExpiresAt: leaseExpiryIso(
            result.expiresAt,
            Date.now() + leaseTtlMs
          ),
          lastError: null,
          fencingToken,
          persistence: "mysql",
        });
      },
      (error) => {
        if (leaseLost || state.phase !== "running") return;
        handleLeaseLoss(safeError(error));
      }
    );
    return snapshot();
  }

  function renewNow() {
    if (dbModeActive) return renewNowDb();
    return renewNowFile();
  }

  function startFileMode() {
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
    // Keep start() synchronous: create/start transport without awaiting.
    // Injected createTransport.start may return a Promise; state merges when it settles.
    startTransport();
    return snapshot();
  }

  async function startDbMode() {
    if (state.phase === "running") return snapshot();
    if (state.phase === "lease_lost") throw new Error(state.lastError || "Runner 租约已失效");

    try {
      if (dbRuntime.lazyBuild || !dbRuntime.leaseStore) {
        dbRuntime = buildLiveDbRuntime(dbRuntime, env);
      }
      if (!dbRuntime.leaseStore) {
        throw new Error("DB lease store is not configured");
      }

      const ensured = await dbRuntime.leaseStore.ensureAccount({
        workspaceId: dbRuntime.workspaceId,
        accountKey: dbRuntime.accountKey,
        apiBaseUrl: dbRuntime.apiBaseUrl,
      });
      dbAccountId = Number(ensured.accountId);

      const acquired = await dbRuntime.leaseStore.acquire({
        workspaceId: dbRuntime.workspaceId,
        accountId: dbAccountId,
        ownerId,
        leaseName: dbRuntime.leaseName,
        ttlMs: leaseTtlMs,
      });

      if (!acquired?.ok) {
        const error = new Error(acquired?.error || "DB 租约获取失败");
        error.code = "BOT_DB_LEASE_LOCKED";
        update({
          phase: "error",
          lastError: error.message,
          stoppedAt: new Date().toISOString(),
          fencingToken: null,
          dbAccountId: null,
        });
        requestExit(1, error.message);
        throw error;
      }

      fencingToken = Number(acquired.fencingToken);
      dbModeActive = true;
      lease = {
        ownerId: acquired.ownerId || ownerId,
        mode: "mysql",
      };
      update({
        phase: "running",
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        lastError: null,
        leaseExpiresAt: leaseExpiryIso(
          acquired.expiresAt,
          Date.now() + leaseTtlMs
        ),
        persistence: "mysql",
        fencingToken,
        dbAccountId,
      });
      heartbeatTimer = timers.setInterval(renewNow, heartbeatMs);
      startTransport();
      return snapshot();
    } catch (error) {
      if (state.phase === "error" || state.phase === "lease_lost") throw error;
      const message = `DB 租约获取失败：${safeError(error)}`;
      update({
        phase: "error",
        lastError: message,
        stoppedAt: new Date().toISOString(),
        fencingToken: null,
        dbAccountId: null,
      });
      requestExit(1, message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  function start() {
    if (dbEnabled) return startDbMode();
    return startFileMode();
  }

  function stop({ exitCode = 0 } = {}) {
    if (state.phase === "stopped") return snapshot();
    stopHeartbeat();
    stopTransport();
    const ownedLease = lease && !leaseLost;
    const releaseOwnerId = lease?.ownerId || ownerId;
    const releaseFencing = fencingToken;
    const releaseAccountId = dbAccountId;
    const wasDbMode = dbModeActive;
    lease = null;

    if (ownedLease && wasDbMode && dbRuntime.leaseStore) {
      // Fire-and-forget async release (mirrors file path sync release contract for callers).
      Promise.resolve()
        .then(() =>
          dbRuntime.leaseStore.release({
            workspaceId: dbRuntime.workspaceId,
            accountId: releaseAccountId,
            ownerId: releaseOwnerId,
            leaseName: dbRuntime.leaseName,
            fencingToken: releaseFencing,
          })
        )
        .then((released) => {
          if (released?.ok === false) {
            update({ lastError: released.error || "DB 租约释放失败" });
          }
        })
        .catch((error) => {
          update({ lastError: `DB 租约释放失败：${safeError(error)}` });
        });
    } else if (ownedLease && !wasDbMode) {
      try {
        const released = lockApi.release({
          runner,
          ownerId: releaseOwnerId,
          file: ownedLease.file || lockFile,
        });
        if (released?.ok === false) {
          update({ lastError: released.error || "Runner 租约释放失败" });
        }
      } catch (error) {
        update({ lastError: `Runner 租约释放失败：${safeError(error)}` });
      }
    }

    fencingToken = null;
    dbAccountId = null;
    update({
      phase: "stopped",
      stoppedAt: new Date().toISOString(),
      fencingToken: null,
      dbAccountId: null,
      // Keep persistence label for observability of last mode.
      persistence: wasDbMode ? "mysql" : state.persistence === "mysql" ? "mysql" : "not_connected",
    });
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
  const transportConfig = loadTransportConfig();
  const worker = createBotWorker({
    statusPath: resolveWorkerStatusPath(),
    transportConfig,
  });

  const boot = () => {
    const started = worker.start();
    if (started && typeof started.then === "function") {
      return started.then(
        () => afterStart(),
        (error) => {
          if (typeof console.error === "function") console.error("[bot-worker]", safeError(error));
          process.exitCode = 1;
        }
      );
    }
    afterStart();
    return undefined;
  };

  function afterStart() {
    const state = worker.getState();
    if (state.persistence === "mysql") {
      console.log("[bot-worker] DB lease acquired; persistence=mysql (inbox staging enabled, no Outbox)");
    } else if (!transportConfig.enabled) {
      console.log("[bot-worker] lease acquired; iLink text transport disabled");
    } else if (!String(transportConfig.token || "").trim()) {
      console.log("[bot-worker] lease acquired; iLink text transport not_configured (missing token)");
    } else {
      console.log("[bot-worker] lease acquired; iLink text transport starting");
    }
    if (state.persistence !== "mysql") {
      console.log("[bot-worker] persistence remains not_connected until durable store is wired");
    }

    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[bot-worker] ${signal} received`);
      const stopped = worker.stop();
      process.exitCode = stopped.lastError ? 1 : 0;
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }

  try {
    boot();
  } catch (error) {
    if (typeof console.error === "function") console.error("[bot-worker]", safeError(error));
    process.exitCode = 1;
  }
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
  resolveDbRuntime,
  truthyEnv,
};
