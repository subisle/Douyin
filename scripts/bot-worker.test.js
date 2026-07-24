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
