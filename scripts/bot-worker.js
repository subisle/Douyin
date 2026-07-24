#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Server runner lifecycle.
 *
 * Owns the runner lease (file lock by default, optional MySQL lease when DB
 * mode is enabled) and may start the pure Node iLink text transport.
 * When BOT_ILINK_DB_ENABLED / options.dbRuntime is on:
 * - MySQL account lease + fencing
 * - Inbox/Cursor same-transaction staging for inbound text
 * - Outbox enqueue + dispatcher for outbound text (still experimental)
 * Media Artifact and full reconcile remain unwired.
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
const DEFAULT_OUTBOX_POLL_MS = 500;
const DEFAULT_OUTBOX_BATCH = 10;
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
      outboxStore: null,
      pool: null,
      outboxPollMs: DEFAULT_OUTBOX_POLL_MS,
      outboxBatch: DEFAULT_OUTBOX_BATCH,
      sendMessage: null,
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
      outboxStore: null,
      pool: null,
      outboxPollMs: DEFAULT_OUTBOX_POLL_MS,
      outboxBatch: DEFAULT_OUTBOX_BATCH,
      sendMessage: null,
    };
  }

  const outboxPollMs = positiveInt(
    injected?.outboxPollMs ?? env.BOT_ILINK_OUTBOX_POLL_MS,
    DEFAULT_OUTBOX_POLL_MS,
    { min: 50, max: 60_000 }
  );
  const outboxBatch = positiveInt(
    injected?.outboxBatch ?? env.BOT_ILINK_OUTBOX_BATCH,
    DEFAULT_OUTBOX_BATCH,
    { min: 1, max: 100 }
  );

  // Injected path (tests): use provided stores as-is.
  if (injected && (injected.leaseStore || injected.inboxStore || injected.outboxStore || injected.enabled)) {
    return {
      enabled: true,
      workspaceId,
      accountKey,
      sessionId,
      apiBaseUrl,
      leaseName,
      leaseStore: injected.leaseStore || null,
      inboxStore: injected.inboxStore || null,
      outboxStore: injected.outboxStore || null,
      pool: injected.pool || null,
      outboxPollMs,
      outboxBatch,
      sendMessage: typeof injected.sendMessage === "function" ? injected.sendMessage : null,
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
      outboxStore: null,
      pool: null,
      lazyBuild: true,
      outboxPollMs,
      outboxBatch,
      sendMessage: null,
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
    outboxStore: null,
    pool: null,
    outboxPollMs,
    outboxBatch,
    sendMessage: null,
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
  const { createOutboxStore } = require("./ilink-outbox");
  const { IlinkAdapter } = require("../shared/ilink-adapter");

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
  const adapter = new IlinkAdapter({
    timeoutMs: positiveInt(env.BOT_ILINK_POLL_TIMEOUT_MS, 35_000, {
      min: 1_000,
      max: 120_000,
    }),
  });
  return {
    ...dbRuntime,
    pool,
    leaseStore: createDbLeaseStore({ pool }),
    inboxStore: createInboxCursorStore({ pool, crypto: cryptoApi }),
    outboxStore: createOutboxStore({ pool, crypto: cryptoApi }),
    sendMessage:
      typeof dbRuntime.sendMessage === "function"
        ? dbRuntime.sendMessage
        : (opts) => adapter.sendMessage(opts),
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
  let outboxTimer = null;
  let exitRequested = false;
  let leaseLost = false;
  let lease = null;
  let transport = null;
  let outboxDispatching = false;
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
    outboxPending: 0,
    outboxSentCount: 0,
    lastOutboxAt: null,
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

  function stopOutboxDispatcher() {
    if (outboxTimer != null) timers.clearInterval(outboxTimer);
    outboxTimer = null;
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

  function buildSendOutbound() {
    if (!dbEnabled || !dbRuntime.outboxStore) return undefined;
    return async ({ toUserId, contextToken, groupId, text, clientId }) => {
      if (fencingToken == null || dbAccountId == null) {
        throw new Error("outbox enqueue requires active DB lease");
      }
      const result = await dbRuntime.outboxStore.enqueueText({
        workspaceId: dbRuntime.workspaceId,
        accountId: dbAccountId,
        sessionId: dbRuntime.sessionId,
        fencingToken,
        clientId: clientId || `worker-${Date.now()}`,
        toUserId,
        groupId,
        contextToken,
        text,
      });
      if (!result?.ok) {
        const err = new Error(result?.error || result?.code || "enqueueText failed");
        err.code = result?.code;
        throw err;
      }
      update({
        outboxPending: Number(state.outboxPending || 0) + 1,
        lastOutboxAt: new Date().toISOString(),
      });
      return result;
    };
  }

  async function dispatchOutboxOnce() {
    if (
      outboxDispatching
      || leaseLost
      || !dbModeActive
      || state.phase !== "running"
      || !dbRuntime.outboxStore
      || fencingToken == null
      || dbAccountId == null
    ) {
      return;
    }
    outboxDispatching = true;
    try {
      if (typeof dbRuntime.outboxStore.reclaimExpiredClaims === "function") {
        await dbRuntime.outboxStore.reclaimExpiredClaims({
          workspaceId: dbRuntime.workspaceId,
          accountId: dbAccountId,
        });
      }
      const claimed = await dbRuntime.outboxStore.claimBatch({
        workspaceId: dbRuntime.workspaceId,
        accountId: dbAccountId,
        ownerId: lease?.ownerId || ownerId,
        fencingToken,
        limit: dbRuntime.outboxBatch || DEFAULT_OUTBOX_BATCH,
        leaseName: dbRuntime.leaseName,
      });
      if (!claimed?.ok) {
        if (claimed?.code === "FENCING_MISMATCH") {
          handleLeaseLoss(claimed.error || "outbox fencing mismatch");
        }
        return;
      }
      const rows = Array.isArray(claimed.rows) ? claimed.rows : [];
      for (const row of rows) {
        if (leaseLost || state.phase !== "running") break;
        if (Number(row.fencingToken) !== Number(fencingToken)) {
          await dbRuntime.outboxStore.markFailedFencing({
            workspaceId: dbRuntime.workspaceId,
            accountId: dbAccountId,
            outboxId: row.id,
            claimToken: row.claimToken,
            error: "worker fencing token changed",
          });
          continue;
        }
        try {
          const sendImpl =
            typeof dbRuntime.sendMessage === "function"
              ? dbRuntime.sendMessage
              : null;
          if (!sendImpl) {
            await dbRuntime.outboxStore.markRetry({
              workspaceId: dbRuntime.workspaceId,
              accountId: dbAccountId,
              outboxId: row.id,
              claimToken: row.claimToken,
              error: "sendMessage not configured",
              delayMs: 2_000,
            });
            continue;
          }
          const msg = {
            from_user_id: "",
            to_user_id: row.payload.toUserId,
            client_id: row.clientId,
            message_type: 2,
            message_state: 2,
            context_token: row.payload.contextToken,
            item_list: [{ type: 1, text_item: { text: row.payload.text } }],
            ...(row.payload.groupId ? { group_id: row.payload.groupId } : {}),
          };
          const response = await sendImpl({
            baseUrl: transportConfig.baseUrl || dbRuntime.apiBaseUrl,
            token: transportConfig.token,
            msg,
            timeoutMs: 15_000,
          });
          const code = Number(response?.errcode ?? response?.ret ?? 0);
          if (code !== 0) {
            throw new Error(
              `微信发送消息失败 (${code}): ${String(response?.errmsg || "未知错误")}`
            );
          }
          await dbRuntime.outboxStore.markSent({
            workspaceId: dbRuntime.workspaceId,
            accountId: dbAccountId,
            outboxId: row.id,
            claimToken: row.claimToken,
            upstreamMessageId: response?.message_id || response?.msg_id || null,
          });
          update({
            outboxSentCount: Number(state.outboxSentCount || 0) + 1,
            outboxPending: Math.max(0, Number(state.outboxPending || 0) - 1),
            lastOutboxAt: new Date().toISOString(),
            lastOutboundAt: new Date().toISOString(),
          });
        } catch (error) {
          const message = safeError(error);
          const isTimeout =
            /timeout|超时|AbortError|ILINK_TIMEOUT/i.test(message)
            || error?.code === "ILINK_TIMEOUT"
            || error?.name === "AbortError";
          if (isTimeout) {
            await dbRuntime.outboxStore.markUnknown({
              workspaceId: dbRuntime.workspaceId,
              accountId: dbAccountId,
              outboxId: row.id,
              claimToken: row.claimToken,
              error: message,
            });
          } else {
            await dbRuntime.outboxStore.markRetry({
              workspaceId: dbRuntime.workspaceId,
              accountId: dbAccountId,
              outboxId: row.id,
              claimToken: row.claimToken,
              error: message,
              delayMs: 2_000,
            });
          }
          update({ lastError: `Outbox 发送失败：${message}` });
        }
      }
    } catch (error) {
      update({ lastError: `Outbox dispatcher 错误：${safeError(error)}` });
    } finally {
      outboxDispatching = false;
    }
  }

  function startOutboxDispatcher() {
    if (!dbEnabled || !dbRuntime.outboxStore) return;
    // Immediate kick; subsequent polls ride on the lease heartbeat timer so a
    // single setInterval (common in tests) cannot clobber lease renewals.
    void dispatchOutboxOnce();
  }

  function defaultCreateTransport(config) {
    return createIlinkTextTransport({
      config,
      env,
      onEvent: (event) => {
        if (event?.type === "state") applyTransportState(event.state);
      },
      persistBatch: buildPersistBatch(),
      sendOutbound: buildSendOutbound(),
    });
  }

  function createTransportFactory(config) {
    if (customCreateTransport) {
      // Injected factories may accept a second hooks bag.
      return customCreateTransport(config, {
        persistBatch: buildPersistBatch(),
        sendOutbound: buildSendOutbound(),
      });
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
    stopOutboxDispatcher();
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
        void dispatchOutboxOnce();
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
      startOutboxDispatcher();
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
    stopOutboxDispatcher();
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
