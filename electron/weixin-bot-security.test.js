"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { WeixinBotService } = require("./weixin-bot");
const { getAiEnvConfig } = require("./weixin-bot-server-agent");

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

test("AI runtime stays off without API key even if settings default on", (t) => {
  const previousAiKey = process.env.AI_API_KEY;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousEnabled = process.env.AI_ENABLED;
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_ENABLED;
  t.after(() => {
    if (previousAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousAiKey;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousEnabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previousEnabled;
  });

  const service = createService(t);
  const settings = service.getSettings().ai;
  assert.equal(service.getSettings().accessMode, "allowlist");
  const runtime = service.getAiRuntimeConfig();

  // 产品默认开启位，但无 Key 时 runtime 不可用
  assert.equal(settings.hasApiKey, false);
  assert.equal(runtime.apiKey, "");
  assert.equal(runtime.enabled, false);
});

test("AI timeout defaults to 90s and AI_TIMEOUT_MS overrides stored settings", (t) => {
  const previousTimeout = process.env.AI_TIMEOUT_MS;
  delete process.env.AI_TIMEOUT_MS;
  t.after(() => {
    if (previousTimeout === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = previousTimeout;
  });

  const service = createService(t);
  assert.equal(service.getAiRuntimeConfig().timeoutMs, 90_000);
  assert.equal(service.getSettings().ai.timeoutMs, 90_000);

  process.env.AI_TIMEOUT_MS = "75000";
  assert.equal(service.getAiRuntimeConfig().timeoutMs, 75_000);

  process.env.AI_TIMEOUT_MS = "999999";
  assert.equal(service.getAiRuntimeConfig().timeoutMs, 120_000);

  delete process.env.AI_TIMEOUT_MS;
  service.saveSettings({
    ai: {
      enabled: false,
      baseUrl: "https://example.test/v1",
      model: "test-model",
      timeoutMs: 60_000,
    },
  });
  assert.equal(service.getAiRuntimeConfig().timeoutMs, 60_000);
});

test("AI progressEnabled defaults on and AI_PROGRESS overrides settings", (t) => {
  const previousProgress = process.env.AI_PROGRESS;
  delete process.env.AI_PROGRESS;
  t.after(() => {
    if (previousProgress === undefined) delete process.env.AI_PROGRESS;
    else process.env.AI_PROGRESS = previousProgress;
  });

  const service = createService(t);
  assert.equal(service.getAiRuntimeConfig().progressEnabled, true);
  assert.equal(service.getSettings().ai.progressEnabled, true);

  service.saveSettings({
    ai: {
      enabled: false,
      baseUrl: "https://example.test/v1",
      model: "test-model",
      progressEnabled: false,
    },
  });
  assert.equal(service.getAiRuntimeConfig().progressEnabled, false);
  assert.equal(service.getSettings().ai.progressEnabled, false);

  process.env.AI_PROGRESS = "1";
  assert.equal(service.getAiRuntimeConfig().progressEnabled, true);

  process.env.AI_PROGRESS = "0";
  assert.equal(service.getAiRuntimeConfig().progressEnabled, false);
});

test("AI store migrates legacy 45s timeout to 90s", (t) => {
  const previousTimeout = process.env.AI_TIMEOUT_MS;
  delete process.env.AI_TIMEOUT_MS;
  t.after(() => {
    if (previousTimeout === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = previousTimeout;
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-timeout-"));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const storagePath = path.join(dir, "bot.json");
  fs.writeFileSync(storagePath, JSON.stringify({
    version: 4,
    settings: {
      autoReplyEnabled: false,
      autoReplyText: "消息已收到。",
      accessMode: "allowlist",
      allowUserIds: [],
      allowGroupIds: [],
      customCommands: [],
      ai: {
        enabled: true,
        baseUrl: "http://162.243.93.40:8317/v1",
        model: "grok-4.5",
        timeoutMs: 45_000,
        maxToolRounds: 4,
      },
    },
    defaultAccessPolicy: { accessMode: "allowlist", allowUserIds: [], allowGroupIds: [] },
    accountPolicies: {},
    encryptedAiKey: "",
    contacts: [],
    accounts: [],
  }, null, 2));

  const service = new WeixinBotService({
    storagePath: () => storagePath,
    encryptToken: (value) => Buffer.from(String(value)).toString("base64"),
    decryptToken: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  });
  assert.equal(service.getAiRuntimeConfig().timeoutMs, 90_000);
  assert.equal(service.getSettings().ai.timeoutMs, 90_000);
});

test("AI rejects unknown plaintext HTTP and permits localhost and built-in relay host", (t) => {
  const service = createService(t);

  assert.throws(
    () => service.saveSettings({ ai: {
      enabled: true,
      baseUrl: "http://api.example.test/v1",
      model: "test-model",
      apiKey: "test-key",
    } }),
    /AI 接口仅允许 HTTPS/
  );

  const local = service.saveSettings({ ai: {
    enabled: true,
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "test-model",
    apiKey: "test-key",
  } });
  assert.equal(local.ai.enabled, true);
  assert.equal(local.ai.baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(local.ai.hasApiKey, true);
  assert.equal("apiKey" in local.ai, false);

  const relay = service.saveSettings({ ai: {
    enabled: true,
    baseUrl: "http://162.243.93.40:8317/v1",
    model: "grok-4.5",
    apiKey: "test-key",
  } });
  assert.equal(relay.ai.baseUrl, "http://162.243.93.40:8317/v1");
});

test("security-sensitive sources contain no embedded API keys or public browser token", () => {
  const serverSources = [
    "electron/db-config.js",
    "electron/weixin-bot.js",
    "electron/weixin-bot-agent.js",
    "electron/weixin-bot-server-agent.js",
    "src/components/desktop/weixin-bot-page.tsx",
  ].map(readProjectFile).join("\n");
  const browserSources = [
    "src/app/agent/page.tsx",
    "src/app/knowledge/page.tsx",
    "src/client/http-electron-api.ts",
  ].map(readProjectFile).join("\n");

  assert.doesNotMatch(serverSources, /\bsk-[A-Za-z0-9_-]{16,}\b/);
  // 允许 localhost / 内置中继 IP；禁止其它明文 HTTP 端点写死在源码
  assert.doesNotMatch(
    serverSources,
    /http:\/\/(?!localhost(?=[:/])|127\.0\.0\.1(?=[:/])|\[::1\](?=[:/])|162\.243\.93\.40(?=[:/]))[^\s"'`)]+/i
  );
  assert.doesNotMatch(browserSources, /NEXT_PUBLIC_API_TOKEN/);
});

test("server agent disables invalid external HTTP AI endpoints", (t) => {
  const previous = {
    AI_ENABLED: process.env.AI_ENABLED,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };
  process.env.AI_ENABLED = "1";
  process.env.AI_BASE_URL = "http://api.example.test/v1";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const config = getAiEnvConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.baseUrl, "");
});

test("server agent requires an explicit AI enable flag", (t) => {
  const previous = {
    AI_ENABLED: process.env.AI_ENABLED,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };
  process.env.AI_BASE_URL = "https://api.example.test/v1";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  delete process.env.AI_ENABLED;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  assert.equal(getAiEnvConfig().enabled, false);
  process.env.AI_ENABLED = "true";
  assert.equal(getAiEnvConfig().enabled, true);
});

test("Agent and RAG routes keep centralized fail-closed authentication", () => {
  const routeRequirements = [
    ["src/app/api/agent/chat/route.ts", 2],
    ["src/app/api/bot/status/route.ts", 1],
    ["src/app/api/rag/search/route.ts", 1],
    ["src/app/api/rag/documents/route.ts", 2],
  ];

  for (const [file, expectedGuards] of routeRequirements) {
    const source = readProjectFile(file);
    assert.equal(
      source.match(/requireApiAccess\(req\)/g)?.length || 0,
      expectedGuards,
      `${file} 的所有处理器都必须鉴权`
    );
    assert.doesNotMatch(source, /if\s*\(\s*!configured\s*\)\s*return\s+true/);
  }

  assert.match(readProjectFile("src/app/api/agent/chat/route.ts"), /scopeApiSessionId\(principal,/);
});
