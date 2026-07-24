"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  resolveArtifactRoot,
  artifactMaxBytes,
  artifactTtlMs,
  getStorageReport,
  projectRoot,
} = require("./local-paths");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("resolveArtifactRoot prefers ARTIFACT_ROOT", () => {
  const root = tempDir("artifact-root-");
  const resolved = resolveArtifactRoot({ ARTIFACT_ROOT: root });
  assert.equal(resolved, path.resolve(root));
  fs.rmSync(root, { recursive: true, force: true });
});

test("resolveArtifactRoot uses BOT_STORAGE_DIR/artifacts", () => {
  const storage = tempDir("bot-storage-");
  const resolved = resolveArtifactRoot({ BOT_STORAGE_DIR: storage });
  assert.equal(resolved, path.resolve(storage, "artifacts"));
  assert.ok(fs.existsSync(resolved));
  fs.rmSync(storage, { recursive: true, force: true });
});

test("resolveArtifactRoot falls back to project data/runtime/artifacts", () => {
  const resolved = resolveArtifactRoot({});
  const expected = path.join(projectRoot(), "data", "runtime", "artifacts");
  // When project runtime is creatable, should not be bare os.tmpdir()/douyin-artifacts
  assert.notEqual(resolved, path.join(os.tmpdir(), "douyin-artifacts"));
  assert.ok(
    resolved === expected || resolved.startsWith(os.tmpdir()),
    `unexpected artifact root: ${resolved}`
  );
});

test("artifactMaxBytes / artifactTtlMs read env", () => {
  assert.equal(artifactMaxBytes({ ARTIFACT_MAX_BYTES: "4096" }), 4096);
  assert.equal(artifactTtlMs({ ARTIFACT_TTL_MS: "60000" }), 60_000);
  assert.equal(artifactMaxBytes({}), 20 * 1024 * 1024);
});

test("getStorageReport includes artifactRoot and warns on tmp artifacts", () => {
  const tmpArtifacts = path.join(os.tmpdir(), `douyin-artifacts-test-${process.pid}`);
  fs.mkdirSync(tmpArtifacts, { recursive: true });
  const report = getStorageReport({
    ARTIFACT_ROOT: tmpArtifacts,
    BOT_STORAGE_DIR: path.join(projectRoot(), "data", "runtime"),
  });
  assert.equal(report.artifactRoot, path.resolve(tmpArtifacts));
  assert.ok(
    report.warnings.some((w) => String(w).includes("Artifact")),
    `expected artifact warning, got ${JSON.stringify(report.warnings)}`
  );
  fs.rmSync(tmpArtifacts, { recursive: true, force: true });
});
