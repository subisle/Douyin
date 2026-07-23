"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadRuntimeEnvironment, runtimeEnvCandidates } = require("./runtime-env");

test("packaged runtime prefers user data configuration without bundling secrets", () => {
  const candidates = runtimeEnvCandidates({
    env: {},
    isPackaged: true,
    userDataPath: "/user/data",
    execPath: "/app/douyin",
    resourcesPath: "/app/resources",
  });
  assert.equal(candidates[0], path.resolve("/user/data/douyin.env"));
  assert.ok(candidates.includes(path.resolve("/app/resources/douyin.env")));
});

test("explicit runtime environment path is fail-closed", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-runtime-env-"));
  const file = path.join(dir, "runtime.env");
  const env = { DOUYIN_ENV_PATH: file };
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => loadRuntimeEnvironment({ env, isPackaged: true }), /文件不存在/);
  fs.writeFileSync(file, "DB_HOST=db.example.test\nDB_PORT=3306\n", "utf8");
  assert.equal(loadRuntimeEnvironment({ env, isPackaged: true }), file);
  assert.equal(env.DB_HOST, "db.example.test");
  assert.equal(env.DB_PORT, "3306");
});

test("existing process variables take precedence over a runtime file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-runtime-env-precedence-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "DB_HOST=file-host\nDB_PORT=3306\n", "utf8");
  const env = { DB_HOST: "process-host" };
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  loadRuntimeEnvironment({ env, projectDir: dir, isPackaged: false });
  assert.equal(env.DB_HOST, "process-host");
  assert.equal(env.DB_PORT, "3306");
});

test("development composes a partial .env.local over the base .env", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-runtime-env-layered-"));
  const localFile = path.join(dir, ".env.local");
  fs.writeFileSync(localFile, "DB_HOST=local-host\n", "utf8");
  fs.writeFileSync(path.join(dir, ".env"), "DB_HOST=base-host\nDB_PORT=3306\n", "utf8");
  const env = {};
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(loadRuntimeEnvironment({ env, projectDir: dir, isPackaged: false }), localFile);
  assert.equal(env.DB_HOST, "local-host");
  assert.equal(env.DB_PORT, "3306");
});
