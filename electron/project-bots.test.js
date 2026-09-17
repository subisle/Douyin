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

test("createProjectBots wires the same command handler onto weixin and every qq bot", async () => {
  const dir = makeDir();
  const bots = createProjectBots({
    weixinStoragePath: () => path.join(dir, "weixin-bot.v1.json"),
    qqStoragePath: () => path.join(dir, "qq-bot.v1.json"),
    qqBots: () => [
      { key: "primary", label: "主机器人", appId: "10001", storagePath: path.join(dir, "qq-primary.json") },
      { key: "backup", label: "备用机器人", appId: "10002", storagePath: path.join(dir, "qq-backup.json") },
    ],
    encryptToken: (value) => Buffer.from(String(value)).toString("base64"),
    decryptToken: (value) => Buffer.from(String(value), "base64").toString("utf8"),
    db: {},
    renderReportPng: async () => Buffer.from("png"),
    logger: { log() {}, warn() {}, error() {} },
    runner: "test",
    runnerLockFile: path.join(dir, "runner.lock"),
  });
  assert.equal(typeof bots.weixinBot.commandHandler, "function");
  assert.equal(typeof bots.qqBot.commandHandler, "function");
  // 多机器人：每个实例都挂同一个 commandHandler
  assert.equal(bots.qqBots.length, 2);
  for (const item of bots.qqBots) {
    assert.equal(typeof item.service.commandHandler, "function");
    assert.equal(item.service.commandHandler, bots.weixinBot.commandHandler);
  }
  // qqBot 兼容旧调用，指向第一个实例
  assert.equal(bots.qqBot, bots.qqBots[0].service);
  const statuses = bots.listQqBotStatuses();
  assert.deepEqual(statuses.map((item) => item.key), ["primary", "backup"]);
  await bots.shutdown();
});

test("createProjectBots falls back to a single qq bot when qqBots is absent", async () => {
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
  assert.equal(bots.qqBots.length, 1);
  assert.equal(bots.qqBots[0].key, "default");
  await bots.shutdown();
});
