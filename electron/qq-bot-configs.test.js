"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { discoverQqBotConfigs } = require("./qq-bot-configs");

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "qq-bot-configs-"));
}

function writeConfig(dir, name, config) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(config, null, 2), "utf8");
}

test("discoverQqBotConfigs reads one config per file from qq-bots dir", () => {
  const dir = makeDir();
  writeConfig(path.join(dir, "qq-bots"), "robot-a.json", { appId: "10001", clientSecret: "s1" });
  writeConfig(path.join(dir, "qq-bots"), "robot-b.json", { appId: "10002", clientSecret: "s2", label: "备用号" });

  const { configs, skipped } = discoverQqBotConfigs({ env: {}, builtinDir: dir, runtimeDir: "" });
  assert.equal(configs.length, 2);
  assert.deepEqual(configs.map((item) => item.key).sort(), ["robot-a", "robot-b"]);
  assert.equal(configs.find((item) => item.key === "robot-b").label, "备用号");
  assert.equal(configs.find((item) => item.key === "robot-b").appId, "10002");
  assert.equal(skipped.length, 0);
});

test("discoverQqBotConfigs skips invalid, disabled, and duplicated configs", () => {
  const dir = makeDir();
  const botsDir = path.join(dir, "qq-bots");
  // 同 appId 时按文件名排序取第一份（a-ok.json 先于 dup.json）
  writeConfig(botsDir, "a-ok.json", { appId: "20001", clientSecret: "s" });
  writeConfig(botsDir, "no-secret.json", { appId: "20002" });
  writeConfig(botsDir, "disabled.json", { appId: "20003", clientSecret: "s", enabled: false });
  writeConfig(botsDir, "dup.json", { appId: "20001", clientSecret: "s" });
  fs.writeFileSync(path.join(botsDir, "broken.json"), "{ not json", "utf8");

  const { configs, skipped } = discoverQqBotConfigs({ env: {}, builtinDir: dir, runtimeDir: "" });
  assert.equal(configs.length, 1);
  assert.equal(configs[0].key, "a-ok");
  const reasons = skipped.map((item) => item.reason).join("|");
  assert.match(reasons, /缺少 appId 或 clientSecret/);
  assert.match(reasons, /enabled=false/);
  assert.match(reasons, /已由其它配置占用/);
  assert.match(reasons, /配置读取失败/);
});

test("discoverQqBotConfigs supports legacy single file and QQ_BOTS_DIR override", () => {
  const builtin = makeDir();
  const runtime = makeDir();
  const override = makeDir();
  writeConfig(runtime, "qq-bot.v1.json", { appId: "30001", clientSecret: "s" });
  const legacy = discoverQqBotConfigs({ env: {}, builtinDir: builtin, runtimeDir: runtime });
  assert.equal(legacy.configs.length, 1);
  assert.equal(legacy.configs[0].key, "qq-bot.v1");

  // QQ_BOTS_DIR 优先，且与内置/运行时目录一起参与去重
  writeConfig(override, "extra.json", { appId: "30002", clientSecret: "s" });
  const overridden = discoverQqBotConfigs({
    env: { QQ_BOTS_DIR: override },
    builtinDir: builtin,
    runtimeDir: runtime,
  });
  assert.equal(overridden.configs.length, 2);
  assert.equal(overridden.configs[0].key, "extra");
  assert.equal(overridden.configs[0].storagePath, path.join(override, "extra.json"));
});

test("discoverQqBotConfigs returns empty list when nothing is configured", () => {
  const dir = makeDir();
  const { configs, skipped } = discoverQqBotConfigs({ env: {}, builtinDir: dir, runtimeDir: dir });
  assert.deepEqual(configs, []);
  assert.deepEqual(skipped, []);
});

test("discoverQqBotConfigs reads credentials from QqBotService store format", () => {
  const dir = makeDir();
  // 桌面导出的旧格式：凭据在 settings 下面（服务端读不到就会漏掉机器人）
  writeConfig(dir, "qq-bot.v1.json", {
    version: 1,
    settings: { appId: "1905320810", clientSecret: "secret-from-desktop", label: "老配置" },
    messages: [],
  });
  const { configs, skipped } = discoverQqBotConfigs({ env: {}, builtinDir: dir, runtimeDir: "" });
  assert.equal(skipped.length, 0);
  assert.equal(configs.length, 1);
  assert.equal(configs[0].appId, "1905320810");
  assert.equal(configs[0].label, "老配置");
});
