"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectBots } = require("./project-bots");

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "project-bots-"));
}

test("createProjectBots starts weixin and qq together without auto-connect", async () => {
  const dir = makeDir();
  const bots = createProjectBots({
    weixinStoragePath: () => path.join(dir, "weixin-bot.v1.json"),
    qqStoragePath: () => path.join(dir, "qq-bot.v1.json"),
    encryptToken: (value) => Buffer.from(String(value)).toString("base64"),
    decryptToken: (value) => Buffer.from(String(value), "base64").toString("utf8"),
    db: {},
    renderReportPng: async () => Buffer.from("png"),
    logger: { log() {}, warn() {}, error() {} },
    runner: "test",
    runnerLockFile: path.join(dir, "runner.lock"),
  });

  const status = await bots.initialize({ autoStart: false, midnightReminder: false });
  assert.equal(status.weixin.available, true);
  assert.equal(status.qq.channel, "qqbot");
  assert.equal(status.qq.connected, false);
  await bots.shutdown();
});

test("shouldSkipProjectBots honors PROJECT_BOTS=0", () => {
  const { shouldSkipProjectBots } = require("../src/server/bots/runtime.js");
  assert.equal(shouldSkipProjectBots({ PROJECT_BOTS: "0" }), true);
  assert.equal(shouldSkipProjectBots({ ELECTRON: "true" }), true);
  assert.equal(shouldSkipProjectBots({}), false);
});
