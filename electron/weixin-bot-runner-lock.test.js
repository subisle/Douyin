const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Worker } = require("node:worker_threads");

const {
  acquireRunnerLock,
  readLease,
  renewRunnerLock,
  releaseRunnerLock,
} = require("./weixin-bot-runner-lock");

function withLeaseFile(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-runner-lock-"));
  const file = path.join(dir, "runner.lock");
  try {
    return callback(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("same runner label still rejects a second owner", () => withLeaseFile((file) => {
  const first = acquireRunnerLock({ runner: "server", ownerId: "host-a:1", file });
  const second = acquireRunnerLock({ runner: "server", ownerId: "host-b:2", file });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(readLease(file).ownerId, "host-a:1");
}));

test("renew and release require the lease owner", () => withLeaseFile((file) => {
  acquireRunnerLock({ runner: "desktop", ownerId: "owner-a", file, ttlMs: 10 });

  assert.equal(renewRunnerLock({ runner: "desktop", ownerId: "owner-b", file }).ok, false);
  assert.equal(renewRunnerLock({ runner: "desktop", ownerId: "owner-a", file, ttlMs: 1000 }).ok, true);
  assert.equal(releaseRunnerLock({ runner: "desktop", ownerId: "owner-b", file }).ok, false);
  assert.equal(fs.existsSync(file), true);
  assert.equal(releaseRunnerLock({ runner: "desktop", ownerId: "owner-a", file }).ok, true);
  assert.equal(fs.existsSync(file), false);
}));

test("a contender's shorter TTL cannot take over an unexpired lease", () => withLeaseFile((file) => {
  const first = acquireRunnerLock({ runner: "server", ownerId: "owner-a", file, ttlMs: 10_000 });
  const contender = acquireRunnerLock({ runner: "desktop", ownerId: "owner-b", file, ttlMs: 1 });

  assert.equal(first.ok, true);
  assert.equal(contender.ok, false);
  assert.equal(readLease(file).ownerId, "owner-a");
}));

test("an expired lease can be taken over", () => withLeaseFile((file) => {
  acquireRunnerLock({ runner: "server", ownerId: "owner-a", file, ttlMs: 1 });
  const current = readLease(file);
  current.expiresAt = Date.now() - 1;
  fs.writeFileSync(file, JSON.stringify(current));

  const takeover = acquireRunnerLock({ runner: "server", ownerId: "owner-b", file, ttlMs: 1000 });
  assert.equal(takeover.ok, true);
  assert.equal(readLease(file).ownerId, "owner-b");
}));

test("concurrent contenders produce exactly one stale-lease takeover winner", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-runner-race-"));
  const file = path.join(dir, "runner.lock");
  fs.writeFileSync(file, JSON.stringify({
    runner: "server",
    ownerId: "expired-owner",
    pid: 1,
    updatedAt: Date.now() - 10_000,
    expiresAt: Date.now() - 1,
    host: "expired-host",
  }));

  const contenderCount = 12;
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const barrierView = new Int32Array(barrier);
  const workers = Array.from({ length: contenderCount }, (_, index) => new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const { acquireRunnerLock } = require(workerData.modulePath);
    const barrier = new Int32Array(workerData.barrier);
    Atomics.add(barrier, 0, 1);
    Atomics.notify(barrier, 0);
    Atomics.wait(barrier, 1, 0);
    const ownerId = "contender-" + workerData.index;
    const result = acquireRunnerLock({
      runner: "server",
      ownerId,
      file: workerData.file,
      ttlMs: 10_000,
    });
    parentPort.postMessage({ ok: result.ok, ownerId });
  `, {
    eval: true,
    workerData: { barrier, file, index, modulePath: __filename.replace(/\.test\.js$/, ".js") },
  }));
  t.after(async () => {
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => {})));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const deadline = Date.now() + 5_000;
  while (Atomics.load(barrierView, 0) !== contenderCount && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(Atomics.load(barrierView, 0), contenderCount, "all contenders should reach the start barrier");

  const resultsPromise = Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  })));
  Atomics.store(barrierView, 1, 1);
  Atomics.notify(barrierView, 1, contenderCount);
  const results = await resultsPromise;
  const winners = results.filter((result) => result.ok);

  assert.equal(winners.length, 1);
  assert.equal(readLease(file).ownerId, winners[0].ownerId);
  assert.equal(fs.existsSync(`${file}.acquire`), false);
});
