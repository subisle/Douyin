"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { WeixinBotService } = require("./weixin-bot");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function readProjectFile(file) {
  return fs.readFileSync(path.join(PROJECT_ROOT, file), "utf8");
}

function createService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-security-"));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  return new WeixinBotService({
    storagePath: () => path.join(dir, "bot.json"),
    encryptToken: (value) => Buffer.from(String(value)).toString("base64"),
    decryptToken: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  });
}

test("security-sensitive sources contain no embedded API keys or public browser token", () => {
  const serverSources = [
    "electron/db-config.js",
    "electron/weixin-bot.js",
    "electron/qq-bot.js",
    "electron/weixin-bot-commands.js",
    "src/components/desktop/weixin-bot-page.tsx",
  ].map(readProjectFile).join("\n");
  const browserSources = [
    "src/client/http-electron-api.ts",
  ].map(readProjectFile).join("\n");

  assert.doesNotMatch(serverSources, /\bsk-[A-Za-z0-9_-]{16,}\b/);
  // 允许 localhost / 内置中继 IP；禁止其它明文 HTTP 端点写死在源码
  assert.doesNotMatch(
    serverSources,
    /http:\/\/(?!localhost(?=[:/])|127\.0\.0\.1(?=[:/])|\[::1\](?=[:/])|192\.168\.5\.12(?=[:/])|162\.243\.93\.40(?=[:/]))[^\s"'`)]+/i
  );
  assert.doesNotMatch(browserSources, /NEXT_PUBLIC_API_TOKEN/);
});

test("AI 能力已整体移除：模块、路由与模型配置都不应残留", () => {
  // 纯 AI 模块必须不存在
  for (const file of [
    "electron/weixin-bot-agent.js",
    "electron/weixin-bot-server-agent.js",
    "electron/weixin-bot-rag.js",
    "electron/weixin-bot-rag-store.js",
    "electron/weixin-bot-user-memory.js",
    "electron/weixin-bot-session-store.js",
    "electron/weixin-bot-skills.js",
    "src/server/bot-core/rag.js",
    "src/app/api/agent/chat/route.ts",
    "src/app/api/rag/search/route.ts",
    "src/app/api/rag/documents/route.ts",
    "src/app/agent/page.tsx",
    "src/app/knowledge/page.tsx",
  ]) {
    assert.equal(fs.existsSync(path.join(PROJECT_ROOT, file)), false, `${file} 应已删除`);
  }

  // 运行时代码不得再读取模型相关环境变量
  const runtimeSources = [
    "electron/weixin-bot.js",
    "electron/qq-bot.js",
    "electron/project-bots.js",
    "electron/weixin-bot-commands.js",
    "src/server/bots/runtime.js",
    "src/server/bots/http.js",
  ].map(readProjectFile).join("\n");
  assert.doesNotMatch(runtimeSources, /\bAI_(?:ENABLED|BASE_URL|MODEL|API_KEY|TIMEOUT_MS|PROGRESS|MAX_TOOL_ROUNDS)\b/);
  assert.doesNotMatch(runtimeSources, /\bOPENAI_(?:API_KEY|BASE_URL|MODEL)\b/);
  // 也不得再调用模型端点
  assert.doesNotMatch(runtimeSources, /chat\/completions/);

  // Bot 服务端不再暴露 AI 处理器
  const bot = createService({ after() {} });
  assert.equal(bot.agentHandler, undefined);
  assert.equal(bot.modeStore, undefined);
  assert.equal(typeof bot.setAgentHandler, "undefined");
  assert.equal(typeof bot.setModeStore, "undefined");
});

test("server bot routes keep centralized fail-closed authentication", () => {
  const routeRequirements = [
    ["src/app/api/bot/status/route.ts", 1],
    ["src/app/api/v1/[[...path]]/route.ts", 1],
  ];

  for (const [file, expectedGuards] of routeRequirements) {
    const source = readProjectFile(file);
    assert.ok(
      (source.match(/requireApiAccess\(/g)?.length || 0) >= expectedGuards,
      `${file} 的处理器必须鉴权`
    );
    assert.doesNotMatch(source, /if\s*\(\s*!configured\s*\)\s*return\s+true/);
  }
});
