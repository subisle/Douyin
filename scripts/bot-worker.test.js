"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createBotWorker } = require("./bot-worker");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

function waitForExit(child, timeoutMs = 2_000) {
  if (child.exitCode != null || child.signalCode != null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`child process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

function createTimers() {
  let callback = null;
  let cleared = false;
  return {
    setInterval(fn) {
      callback = fn;
      cleared = false;
      return { unref() {} };
    },
    clearInterval() {
      cleared = true;
      callback = null;
    },
    fire() {
      callback?.();
    },
    get active() {
      return Boolean(callback) && !cleared;
    },
  };
}

test("worker owns one lease, renews it, and releases it on shutdown", () => {
  const calls = [];
  const timers = createTimers();
  const exits = [];
  const worker = createBotWorker({
    runner: "server",
    ownerId: "worker-owner",
    lockFile: "/tmp/fixture-runner.lock",
    heartbeatMs: 10,
    leaseTtlMs: 100,
    timers,
    exit: (code) => exits.push(code),
    logger: { log() {}, error() {} },
    runnerLock: {
      acquire(options) {
        calls.push({ type: "acquire", options });
        return {
          ok: true,
          file: options.file,
          lease: { ownerId: options.ownerId, expiresAt: Date.parse("2026-07-23T12:00:00.000Z") },
        };
      },
      renew(options) {
        calls.push({ type: "renew", options });
        return {
          ok: true,
          lease: { ownerId: options.ownerId, expiresAt: "2026-07-23T12:01:00.000Z" },
        };
      },
      release(options) {
        calls.push({ type: "release", options });
        return { ok: true };
      },
    },
  });

  assert.equal(worker.start().phase, "running");
  assert.equal(worker.getState().leaseExpiresAt, "2026-07-23T12:00:00.000Z");
  assert.equal(worker.heartbeatActive, true);
  timers.fire();
  assert.equal(worker.getState().leaseExpiresAt, "2026-07-23T12:01:00.000Z");
  assert.ok(worker.getState().lastHeartbeatAt);
  assert.equal(worker.stop().phase, "stopped");
  assert.equal(worker.heartbeatActive, false);
  assert.deepEqual(calls.map((call) => call.type), ["acquire", "renew", "release"]);
  assert.equal(calls[2].options.ownerId, "worker-owner");
  assert.deepEqual(exits, []);
});

test("worker process stays alive and releases its lease on SIGTERM", {
  skip: process.platform === "win32" ? "POSIX signal lifecycle" : false,
}, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-worker-process-"));
  const lockPath = path.join(tempDir, "runner.lock");
  const statusPath = path.join(tempDir, "worker-status.json");
  const child = spawn(process.execPath, [path.join(__dirname, "bot-worker.js")], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      BOT_HEARTBEAT_MS: "50",
      BOT_LEASE_TTL_MS: "500",
      BOT_LOCK_PATH: lockPath,
      BOT_OWNER_ID: "test-worker-owner",
      BOT_WORKER_STATUS_PATH: statusPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill("SIGKILL");
      await waitForExit(child).catch(() => {});
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await waitFor(() => {
    if (!fs.existsSync(statusPath)) return false;
    return JSON.parse(fs.readFileSync(statusPath, "utf8")).phase === "running";
  });
  await delay(150);
  assert.equal(child.exitCode, null, output);
  assert.equal(child.signalCode, null, output);
  assert.equal(fs.existsSync(lockPath), true);

  child.kill("SIGTERM");
  const exit = await waitForExit(child);
  assert.deepEqual(exit, { code: 0, signal: null }, output);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, "utf8")).phase, "stopped");
  assert.equal(fs.existsSync(lockPath), false);
});

test("renewal failure persists lease_lost state and exits without releasing another owner", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-worker-status-"));
  const statusPath = path.join(tempDir, "worker.json");
  const timers = createTimers();
  const exits = [];
  const errors = [];
  let releaseCalls = 0;
  const worker = createBotWorker({
    ownerId: "worker-owner",
    statusPath,
    heartbeatMs: 10,
    leaseTtlMs: 100,
    timers,
    exit: (code) => exits.push(code),
    logger: { log() {}, error: (message) => errors.push(message) },
    runnerLock: {
      acquire: () => ({
        ok: true,
        file: "LOCK_FILE",
        lease: { ownerId: "worker-owner", expiresAt: "2026-07-23T12:00:00.000Z" },
      }),
      renew: () => ({ ok: false, error: "lease taken over" }),
      release: () => {
        releaseCalls += 1;
        return { ok: true };
      },
    },
  });
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  worker.start();
  timers.fire();

  assert.equal(worker.getState().phase, "lease_lost");
  assert.match(worker.getState().lastError, /lease taken over/);
  assert.equal(worker.heartbeatActive, false);
  assert.deepEqual(exits, [1]);
  assert.equal(releaseCalls, 0);
  assert.match(errors[0], /lease taken over/);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, "utf8")).phase, "lease_lost");

  worker.stop();
  assert.equal(releaseCalls, 0);
});

test("acquisition failure records error and requests a non-zero exit", () => {
  const exits = [];
  const worker = createBotWorker({
    timers: createTimers(),
    exit: (code) => exits.push(code),
    logger: { log() {}, error() {} },
    runnerLock: {
      acquire: () => ({ ok: false, error: "lease occupied" }),
      renew: () => ({ ok: true }),
      release: () => ({ ok: true }),
    },
  });

  assert.throws(() => worker.start(), /lease occupied/);
  assert.equal(worker.getState().phase, "error");
  assert.match(worker.getState().lastError, /lease occupied/);
  assert.deepEqual(exits, [1]);
});

test("worker starts text transport after lease when enabled", async () => {
  const timers = createTimers();
  const transportCalls = [];
  let transportPhase = "stopped";
  const worker = createBotWorker({
    runner: "server",
    ownerId: "worker-owner",
    lockFile: "/tmp/fixture-runner.lock",
    heartbeatMs: 10,
    leaseTtlMs: 100,
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: {
      acquire: (options) => ({
        ok: true,
        file: options.file,
        lease: { ownerId: options.ownerId, expiresAt: Date.parse("2026-07-23T12:00:00.000Z") },
      }),
      renew: () => ({ ok: true, lease: { ownerId: "worker-owner", expiresAt: "2026-07-23T12:01:00.000Z" } }),
      release: () => ({ ok: true }),
    },
    createTransport: (config) => {
      transportCalls.push({ type: "create", config });
      return {
        async start() {
          transportPhase = "polling";
          transportCalls.push({ type: "start" });
          return { phase: "polling" };
        },
        async stop() {
          transportPhase = "stopped";
          transportCalls.push({ type: "stop" });
          return { phase: "stopped" };
        },
        getState: () => ({
          phase: transportPhase,
          updatesBuf: "c1",
          accountId: "acc-1",
          lastPollAt: "2026-07-23T12:00:00.000Z",
          lastInboundAt: null,
          lastOutboundAt: null,
          lastError: null,
          receivedCount: 0,
          sentCount: 0,
        }),
      };
    },
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      accountId: "acc-1",
      ackText: "收到",
    },
  });

  assert.equal(worker.start().phase, "running");
  await delay(10);
  assert.equal(worker.getState().transport, "polling");
  assert.equal(worker.getState().persistence, "not_connected");
  assert.equal(worker.getState().transportAccountId, "acc-1");
  assert.deepEqual(
    transportCalls.map((c) => c.type),
    ["create", "start"]
  );

  assert.equal(worker.stop().phase, "stopped");
  assert.ok(transportCalls.some((c) => c.type === "stop"));
  assert.equal(worker.getState().transport, "stopped");
});

test("worker without transport config keeps transport disabled", () => {
  const timers = createTimers();
  const worker = createBotWorker({
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: {
      acquire: () => ({
        ok: true,
        file: "LOCK",
        lease: { ownerId: "o", expiresAt: "2026-07-23T12:00:00.000Z" },
      }),
      renew: () => ({ ok: true, lease: { ownerId: "o", expiresAt: "2026-07-23T12:01:00.000Z" } }),
      release: () => ({ ok: true }),
    },
  });
  worker.start();
  assert.equal(worker.getState().transport, "disabled");
  assert.equal(worker.getState().persistence, "not_connected");
  worker.stop();
});

test("worker with enabled flag but missing token is not_configured", () => {
  const timers = createTimers();
  const worker = createBotWorker({
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: {
      acquire: () => ({
        ok: true,
        file: "LOCK",
        lease: { ownerId: "o", expiresAt: "2026-07-23T12:00:00.000Z" },
      }),
      renew: () => ({ ok: true, lease: { ownerId: "o", expiresAt: "2026-07-23T12:01:00.000Z" } }),
      release: () => ({ ok: true }),
    },
    transportConfig: {
      enabled: true,
      token: "",
      baseUrl: "https://ilinkai.weixin.qq.com",
      ackText: "收到",
    },
  });
  worker.start();
  assert.equal(worker.getState().transport, "not_configured");
  assert.equal(worker.getState().persistence, "not_connected");
  assert.equal(worker.getState().phase, "running");
  worker.stop();
});

test("lease loss stops transport before exit", () => {
  const timers = createTimers();
  const transportCalls = [];
  const worker = createBotWorker({
    ownerId: "worker-owner",
    heartbeatMs: 10,
    leaseTtlMs: 100,
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: {
      acquire: () => ({
        ok: true,
        file: "LOCK",
        lease: { ownerId: "worker-owner", expiresAt: "2026-07-23T12:00:00.000Z" },
      }),
      renew: () => ({ ok: false, error: "lease taken over" }),
      release: () => ({ ok: true }),
    },
    createTransport: () => ({
      async start() {
        transportCalls.push("start");
        return { phase: "polling" };
      },
      async stop() {
        transportCalls.push("stop");
        return { phase: "stopped" };
      },
      getState: () => ({
        phase: "polling",
        updatesBuf: "",
        accountId: null,
        lastPollAt: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        lastError: null,
        receivedCount: 0,
        sentCount: 0,
      }),
    }),
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      ackText: "收到",
    },
  });

  worker.start();
  // 若 transport 异步启动，先给一拍
  // 然后 fire renew 失败
  timers.fire();
  assert.equal(worker.getState().phase, "lease_lost");
  assert.ok(transportCalls.includes("stop"));
});

function createThrowingFileLock() {
  return {
    acquire: () => {
      throw new Error("file lock should not run");
    },
    renew: () => {
      throw new Error("file lock should not run");
    },
    release: () => {
      throw new Error("file lock should not run");
    },
  };
}

function createIdleTransport(transportCalls) {
  let transportPhase = "stopped";
  return {
    async start() {
      transportPhase = "polling";
      transportCalls?.push("start");
      return { phase: "polling" };
    },
    async stop() {
      transportPhase = "stopped";
      transportCalls?.push("stop");
      return { phase: "stopped" };
    },
    getState: () => ({
      phase: transportPhase,
      accountId: "acc",
      updatesBuf: "",
      lastPollAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      lastError: null,
      receivedCount: 0,
      sentCount: 0,
    }),
  };
}

test("db mode start acquires lease and sets mysql persistence", async () => {
  const calls = [];
  const timers = createTimers();
  const worker = createBotWorker({
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: createThrowingFileLock(),
    createTransport: () => createIdleTransport(),
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      accountId: "acc",
      ackText: "收到",
    },
    dbRuntime: {
      enabled: true,
      workspaceId: "ws",
      accountKey: "k1",
      sessionId: "main",
      leaseStore: {
        ensureAccount: async () => {
          calls.push("ensure");
          return { accountId: 9 };
        },
        acquire: async (o) => {
          calls.push("acquire");
          return {
            ok: true,
            fencingToken: 3,
            expiresAt: new Date("2026-07-24T12:00:00.000Z"),
            ownerId: o.ownerId,
          };
        },
        renew: async () => ({
          ok: true,
          fencingToken: 3,
          expiresAt: new Date("2026-07-24T12:01:00.000Z"),
        }),
        release: async () => {
          calls.push("release");
          return { ok: true };
        },
      },
      inboxStore: {
        stageTextBatch: async () => ({
          ok: true,
          inserted: 0,
          deduped: 0,
          cursorHash: "x",
        }),
      },
    },
  });

  await worker.start();
  assert.equal(worker.getState().phase, "running");
  assert.equal(worker.getState().persistence, "mysql");
  assert.equal(worker.getState().fencingToken, 3);
  assert.equal(worker.getState().dbAccountId, 9);
  assert.deepEqual(calls, ["ensure", "acquire"]);

  worker.stop();
  await delay(20);
  assert.ok(calls.includes("release"));
  assert.equal(worker.getState().phase, "stopped");
  assert.equal(worker.getState().persistence, "mysql");
});

test("db renew failure yields lease_lost and stops transport", async () => {
  const transportCalls = [];
  const timers = createTimers();
  const worker = createBotWorker({
    ownerId: "db-owner",
    heartbeatMs: 10,
    leaseTtlMs: 100,
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: createThrowingFileLock(),
    createTransport: () => createIdleTransport(transportCalls),
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      ackText: "收到",
    },
    dbRuntime: {
      enabled: true,
      workspaceId: "ws",
      accountKey: "k1",
      sessionId: "main",
      leaseStore: {
        ensureAccount: async () => ({ accountId: 9 }),
        acquire: async () => ({
          ok: true,
          fencingToken: 1,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        renew: async () => ({ ok: false, error: "db lease taken over" }),
        release: async () => ({ ok: true }),
      },
      inboxStore: {
        stageTextBatch: async () => ({
          ok: true,
          inserted: 0,
          deduped: 0,
          cursorHash: "h",
        }),
      },
    },
  });

  await worker.start();
  await delay(10);
  assert.equal(worker.getState().phase, "running");
  assert.ok(transportCalls.includes("start"));

  timers.fire();
  await waitFor(() => worker.getState().phase === "lease_lost");
  assert.equal(worker.getState().phase, "lease_lost");
  assert.match(worker.getState().lastError, /db lease taken over/);
  assert.ok(transportCalls.includes("stop"));
  assert.equal(worker.getState().fencingToken, null);
});

test("db stop calls lease release", async () => {
  const releaseArgs = [];
  const worker = createBotWorker({
    ownerId: "db-owner",
    timers: createTimers(),
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: createThrowingFileLock(),
    createTransport: () => createIdleTransport(),
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      ackText: "收到",
    },
    dbRuntime: {
      enabled: true,
      workspaceId: "ws1",
      accountKey: "acc-key",
      sessionId: "main",
      leaseStore: {
        ensureAccount: async () => ({ accountId: 42 }),
        acquire: async () => ({
          ok: true,
          fencingToken: 7,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        renew: async () => ({
          ok: true,
          fencingToken: 7,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        release: async (input) => {
          releaseArgs.push(input);
          return { ok: true };
        },
      },
      inboxStore: {
        stageTextBatch: async () => ({
          ok: true,
          inserted: 0,
          deduped: 0,
          cursorHash: "h",
        }),
      },
    },
  });

  await worker.start();
  worker.stop();
  await waitFor(() => releaseArgs.length === 1);
  assert.equal(releaseArgs[0].workspaceId, "ws1");
  assert.equal(releaseArgs[0].accountId, 42);
  assert.equal(releaseArgs[0].ownerId, "db-owner");
  assert.equal(releaseArgs[0].fencingToken, 7);
});

test("db mode wires persistBatch into createTransport hooks", async () => {
  const stageCalls = [];
  let capturedPersistBatch = null;
  const worker = createBotWorker({
    timers: createTimers(),
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: createThrowingFileLock(),
    createTransport: (config, hooks) => {
      capturedPersistBatch = hooks?.persistBatch || null;
      return createIdleTransport();
    },
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      ackText: "收到",
    },
    dbRuntime: {
      enabled: true,
      workspaceId: "ws",
      accountKey: "k1",
      sessionId: "sess-1",
      leaseStore: {
        ensureAccount: async () => ({ accountId: 11 }),
        acquire: async () => ({
          ok: true,
          fencingToken: 5,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        renew: async () => ({
          ok: true,
          fencingToken: 5,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        release: async () => ({ ok: true }),
      },
      inboxStore: {
        stageTextBatch: async (input) => {
          stageCalls.push(input);
          return { ok: true, inserted: 1, deduped: 0, cursorHash: "h" };
        },
      },
    },
  });

  await worker.start();
  assert.equal(typeof capturedPersistBatch, "function");
  const staged = await capturedPersistBatch({
    updatesBuf: "cursor-1",
    messages: [{ text: "hi", fromUserId: "u1" }],
  });
  assert.equal(staged.ok, true);
  assert.equal(stageCalls.length, 1);
  assert.equal(stageCalls[0].workspaceId, "ws");
  assert.equal(stageCalls[0].accountId, 11);
  assert.equal(stageCalls[0].sessionId, "sess-1");
  assert.equal(stageCalls[0].fencingToken, 5);
  assert.equal(stageCalls[0].updatesBuf, "cursor-1");
  worker.stop();
});

test("db acquisition failure records error and exits non-zero", async () => {
  const exits = [];
  const worker = createBotWorker({
    timers: createTimers(),
    exit: (code) => exits.push(code),
    logger: { log() {}, error() {} },
    runnerLock: createThrowingFileLock(),
    dbRuntime: {
      enabled: true,
      workspaceId: "ws",
      accountKey: "k1",
      leaseStore: {
        ensureAccount: async () => ({ accountId: 1 }),
        acquire: async () => ({ ok: false, error: "lease occupied by other" }),
        renew: async () => ({ ok: true }),
        release: async () => ({ ok: true }),
      },
      inboxStore: {
        stageTextBatch: async () => ({
          ok: true,
          inserted: 0,
          deduped: 0,
          cursorHash: "h",
        }),
      },
    },
  });

  await assert.rejects(() => worker.start(), /lease occupied by other/);
  assert.equal(worker.getState().phase, "error");
  assert.match(worker.getState().lastError, /lease occupied by other/);
  assert.deepEqual(exits, [1]);
});


test("db mode enqueues outbound via outbox and dispatches send", async () => {
  const timers = createTimers();
  const enqueued = [];
  const claimedTokens = [];
  const sentMarks = [];
  const sendCalls = [];
  let claimToken = "claim-1";
  let prepared = null;

  const worker = createBotWorker({
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: createThrowingFileLock(),
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      accountId: "acc",
      ackText: "收到",
    },
    createTransport: (config, hooks) => {
      assert.equal(typeof hooks?.sendOutbound, "function");
      return {
        async start() {
          await hooks.sendOutbound({
            toUserId: "user-a",
            contextToken: "ctx-1",
            groupId: "",
            text: "收到",
            clientId: "client-out-1",
          });
          return { phase: "polling" };
        },
        async stop() {
          return { phase: "stopped" };
        },
        getState: () => ({
          phase: "polling",
          accountId: "acc",
          updatesBuf: "",
          lastPollAt: null,
          lastInboundAt: null,
          lastOutboundAt: null,
          lastError: null,
          receivedCount: 0,
          sentCount: 1,
        }),
      };
    },
    dbRuntime: {
      enabled: true,
      workspaceId: "ws",
      accountKey: "k1",
      sessionId: "main",
      leaseStore: {
        ensureAccount: async () => ({ accountId: 42 }),
        acquire: async () => ({
          ok: true,
          fencingToken: 3,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        renew: async () => ({
          ok: true,
          fencingToken: 3,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        release: async () => ({ ok: true }),
      },
      inboxStore: {
        stageTextBatch: async () => ({
          ok: true,
          inserted: 0,
          deduped: 0,
          cursorHash: "h",
        }),
      },
      outboxStore: {
        enqueueText: async (input) => {
          enqueued.push(input);
          prepared = {
            id: 99,
            clientId: input.clientId,
            payload: {
              toUserId: input.toUserId,
              groupId: input.groupId || "",
              contextToken: input.contextToken,
              text: input.text,
            },
            fencingToken: input.fencingToken,
            attemptCount: 1,
            maxAttempts: 10,
            claimToken,
          };
          return { ok: true, outboxId: 99 };
        },
        claimBatch: async (input) => {
          claimedTokens.push(input);
          if (!prepared) return { ok: true, rows: [] };
          const row = { ...prepared };
          prepared = null;
          return { ok: true, rows: [row] };
        },
        markSent: async (input) => {
          sentMarks.push(input);
          return { ok: true };
        },
        markRetry: async () => ({ ok: true }),
        markUnknown: async () => ({ ok: true }),
        markFailedFencing: async () => ({ ok: true }),
      },
      sendMessage: async (options) => {
        sendCalls.push(options);
        return { errcode: 0, message_id: "up-1" };
      },
    },
  });

  await worker.start();
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].text, "收到");
  assert.equal(enqueued[0].toUserId, "user-a");
  assert.equal(enqueued[0].fencingToken, 3);
  assert.equal(enqueued[0].accountId, 42);

  // First dispatch runs at start; if race, fire heartbeat renew to re-kick.
  await waitFor(() => sendCalls.length >= 1 || sentMarks.length >= 1, 1_000);
  if (sendCalls.length === 0) {
    timers.fire();
    await waitFor(() => sendCalls.length >= 1, 1_000);
  }
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].msg.to_user_id, "user-a");
  assert.equal(sendCalls[0].msg.item_list[0].text_item.text, "收到");
  await waitFor(() => sentMarks.length >= 1, 1_000);
  assert.equal(sentMarks[0].outboxId, 99);
  assert.equal(worker.getState().outboxSentCount, 1);

  worker.stop();
});

test("db mode sendOutbound is provided in createTransport hooks", async () => {
  let captured = null;
  const worker = createBotWorker({
    timers: createTimers(),
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: createThrowingFileLock(),
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      ackText: "收到",
    },
    createTransport: (config, hooks) => {
      captured = hooks;
      return createIdleTransport();
    },
    dbRuntime: {
      enabled: true,
      workspaceId: "ws",
      accountKey: "k1",
      leaseStore: {
        ensureAccount: async () => ({ accountId: 1 }),
        acquire: async () => ({
          ok: true,
          fencingToken: 1,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        renew: async () => ({
          ok: true,
          fencingToken: 1,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        release: async () => ({ ok: true }),
      },
      inboxStore: {
        stageTextBatch: async () => ({
          ok: true,
          inserted: 0,
          deduped: 0,
          cursorHash: "h",
        }),
      },
      outboxStore: {
        enqueueText: async () => ({ ok: true, outboxId: 1 }),
        claimBatch: async () => ({ ok: true, rows: [] }),
        markSent: async () => ({ ok: true }),
        markRetry: async () => ({ ok: true }),
        markUnknown: async () => ({ ok: true }),
        markFailedFencing: async () => ({ ok: true }),
      },
      sendMessage: async () => ({ errcode: 0 }),
    },
  });
  await worker.start();
  assert.equal(typeof captured?.persistBatch, "function");
  assert.equal(typeof captured?.sendOutbound, "function");
  worker.stop();
});
