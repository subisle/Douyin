"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createLocalArtifactStore } = require("./ilink-artifact-store");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "artifact-store-"));
}

test("stageBuffer writes file and returns hashes", async () => {
  const root = tempRoot();
  const store = createLocalArtifactStore({ rootDir: root, maxBytes: 1024 });
  const staged = await store.stageBuffer({
    workspaceId: "ws",
    accountId: 1,
    sessionId: "main",
    buffer: Buffer.from("hello-artifact"),
    mimeType: "text/plain",
    artifactKind: "csv",
  });
  assert.equal(staged.ok, true);
  assert.equal(staged.byteSize, 14);
  assert.equal(staged.contentSha256.length, 64);
  assert.equal(staged.storageProvider, "local");
  assert.ok(fs.existsSync(staged.absolutePath));

  const read = await store.readBuffer(staged.storageKey);
  assert.equal(read.buffer.toString("utf8"), "hello-artifact");

  const row = store.toDbRow(staged);
  assert.equal(row.artifact_id, staged.artifactId);
  assert.equal(row.status, "ready");

  fs.rmSync(root, { recursive: true, force: true });
});

test("stageBuffer rejects oversized payload", async () => {
  const root = tempRoot();
  const store = createLocalArtifactStore({ rootDir: root, maxBytes: 8 });
  const staged = await store.stageBuffer({
    workspaceId: "ws",
    accountId: 1,
    buffer: Buffer.alloc(32, 1),
  });
  assert.equal(staged.ok, false);
  assert.equal(staged.code, "TOO_LARGE");
  fs.rmSync(root, { recursive: true, force: true });
});

test("discard removes file; gcExpired removes old files", async () => {
  const root = tempRoot();
  let nowMs = Date.parse("2026-07-24T12:00:00.000Z");
  const store = createLocalArtifactStore({
    rootDir: root,
    defaultTtlMs: 1_000,
    now: () => new Date(nowMs),
  });
  const staged = await store.stageBuffer({
    workspaceId: "ws",
    accountId: 1,
    buffer: Buffer.from("old"),
  });
  assert.equal(staged.ok, true);

  // force mtime into the past for gc
  const past = (nowMs - 60_000) / 1000;
  fs.utimesSync(staged.absolutePath, past, past);

  const gc = await store.gcExpired({ olderThanMs: 10_000 });
  assert.equal(gc.ok, true);
  assert.ok(gc.removed >= 1);
  assert.equal(fs.existsSync(staged.absolutePath), false);

  const staged2 = await store.stageBuffer({
    workspaceId: "ws",
    accountId: 1,
    buffer: Buffer.from("new"),
  });
  await store.discard(staged2.storageKey);
  assert.equal(fs.existsSync(staged2.absolutePath), false);

  fs.rmSync(root, { recursive: true, force: true });
});
