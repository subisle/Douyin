const assert = require("node:assert/strict");
const test = require("node:test");

const { WeixinBotAgent } = require("./weixin-bot-agent");

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
}

function toolCall(id) {
  return {
    id,
    type: "function",
    function: {
      name: "lookup",
      arguments: JSON.stringify({ id }),
    },
  };
}

test("desktop agent records only tool calls that it executes", async () => {
  const requests = [];
  const executed = [];
  const responses = [
    jsonResponse({
      choices: [{
        message: {
          content: null,
          tool_calls: [toolCall("call-1"), toolCall("call-2"), toolCall("call-3"), toolCall("call-4")],
        },
      }],
    }),
    jsonResponse({ choices: [{ message: { content: "查询完成" } }] }),
  ];
  const agent = new WeixinBotAgent({
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return responses.shift();
    },
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      maxToolRounds: 2,
    }),
    skills: {
      definitions: [],
      execute: async (name, args) => {
        executed.push({ name, args });
        return { ok: true, id: args.id };
      },
    },
  });
  const context = { accountId: "account-1", fromUserId: "user-1" };
  agent.enableSession(context);

  const result = await agent.handleMessage({ ...context, text: "查数据" });

  assert.equal(result.text, "查询完成");
  assert.deepEqual(executed.map((item) => item.args.id), ["call-1", "call-2", "call-3"]);
  assert.equal(requests.length, 2);
  const followupMessages = requests[1].messages;
  const assistant = followupMessages.find((item) => item.role === "assistant" && item.tool_calls);
  const toolResponses = followupMessages.filter((item) => item.role === "tool");
  assert.deepEqual(assistant.tool_calls.map((call) => call.id), ["call-1", "call-2", "call-3"]);
  assert.deepEqual(toolResponses.map((item) => item.tool_call_id), ["call-1", "call-2", "call-3"]);
});

test("desktop agent default timeout is 90s for slow reasoning models", () => {
  const agent = new WeixinBotAgent({
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
    }),
  });
  assert.equal(agent.getPublicStatus().timeoutMs, 90_000);
});

test("desktop agent aborts an in-flight model request with runner work", async () => {
  let requestSignal;
  const agent = new WeixinBotAgent({
    fetchImpl: async (_url, options) => {
      requestSignal = options.signal;
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
    }),
    skills: { definitions: [], execute: async () => ({ ok: true }) },
  });
  const context = { accountId: "account-1", fromUserId: "user-1" };
  const controller = new AbortController();
  agent.enableSession(context);

  const pending = agent.handleMessage({
    ...context,
    text: "查数据",
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, /AI 请求已中止/);
  assert.equal(requestSignal.aborted, true);
});

function waveToolCall(id = "call-wave") {
  return {
    id,
    type: "function",
    function: {
      name: "get_anchor_wave_profile",
      arguments: JSON.stringify({ query: "小张" }),
    },
  };
}

test("desktop agent sends opening and tool progress replies by default", async () => {
  const replies = [];
  const responses = [
    jsonResponse({
      choices: [{ message: { content: null, tool_calls: [waveToolCall()] } }],
    }),
    jsonResponse({ choices: [{ message: { content: "小张音浪 100" } }] }),
  ];
  const agent = new WeixinBotAgent({
    fetchImpl: async () => responses.shift(),
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      progressEnabled: true,
    }),
    skills: {
      definitions: [],
      execute: async () => ({ ok: true, text: "wave" }),
    },
  });
  const context = { accountId: "account-1", fromUserId: "user-1" };
  agent.enableSession(context);

  const result = await agent.handleMessage({
    ...context,
    text: "查小张音浪",
    replyText: async (text) => {
      replies.push(text);
    },
  });

  assert.equal(result.text, "小张音浪 100");
  assert.deepEqual(replies, [
    "收到，正在处理…",
    "正在查询音浪…",
    "小张音浪 100",
  ]);
});

test("desktop agent skips progress when progressEnabled is false", async () => {
  const replies = [];
  const agent = new WeixinBotAgent({
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: "你好" } }] }),
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      progressEnabled: false,
    }),
    skills: { definitions: [], execute: async () => ({ ok: true }) },
  });
  const context = { accountId: "account-1", fromUserId: "user-1" };
  agent.enableSession(context);

  await agent.handleMessage({
    ...context,
    text: "你好",
    replyText: async (text) => {
      replies.push(text);
    },
  });

  assert.deepEqual(replies, ["你好"]);
});

test("desktop agent continues when progress reply fails", async () => {
  const replies = [];
  let progressAttempts = 0;
  const agent = new WeixinBotAgent({
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: "完成" } }] }),
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      progressEnabled: true,
    }),
    skills: { definitions: [], execute: async () => ({ ok: true }) },
  });
  const context = { accountId: "account-1", fromUserId: "user-1" };
  agent.enableSession(context);

  const result = await agent.handleMessage({
    ...context,
    text: "查一下",
    replyText: async (text) => {
      if (text === "收到，正在处理…") {
        progressAttempts += 1;
        throw new Error("send failed");
      }
      replies.push(text);
    },
  });

  assert.equal(progressAttempts, 1);
  assert.equal(result.text, "完成");
  assert.deepEqual(replies, ["完成"]);
});

test("desktop agent dedupes consecutive same tool progress", async () => {
  const replies = [];
  const responses = [
    jsonResponse({
      choices: [{
        message: {
          content: null,
          tool_calls: [waveToolCall("a"), waveToolCall("b")],
        },
      }],
    }),
    jsonResponse({ choices: [{ message: { content: "对比完成" } }] }),
  ];
  const agent = new WeixinBotAgent({
    fetchImpl: async () => responses.shift(),
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      progressEnabled: true,
      maxToolRounds: 2,
    }),
    skills: {
      definitions: [],
      execute: async () => ({ ok: true }),
    },
  });
  const context = { accountId: "account-1", fromUserId: "user-1" };
  agent.enableSession(context);

  await agent.handleMessage({
    ...context,
    text: "查两次",
    replyText: async (text) => {
      replies.push(text);
    },
  });

  const progressLines = replies.filter((line) => line !== "对比完成");
  assert.deepEqual(progressLines, [
    "收到，正在处理…",
    "正在查询音浪…",
  ]);
  assert.equal(replies.at(-1), "对比完成");
});

test("desktop agent injects habit summary and learns from successful tools", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createWeixinUserMemory } = require("./weixin-bot-user-memory");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-"));
  const memory = createWeixinUserMemory({
    filePath: path.join(dir, "m.json"),
    now: () => 1_700_000_000_000,
  });
  // seed habit
  memory.learnFromTool("a:account-1|u:user-1", "get_anchor_wave_profile", { query: "小张" }, { ok: true });

  const requests = [];
  const responses = [
    jsonResponse({
      choices: [{ message: { content: null, tool_calls: [waveToolCall("seed")] } }],
    }),
    jsonResponse({ choices: [{ message: { content: "已查到" } }] }),
  ];
  const agent = new WeixinBotAgent({
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return responses.shift();
    },
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      progressEnabled: false,
    }),
    userMemory: memory,
    skills: {
      definitions: [],
      execute: async () => ({ ok: true }),
    },
  });
  const context = { accountId: "account-1", fromUserId: "user-1" };
  agent.enableSession(context);
  await agent.handleMessage({ ...context, text: "再查一次" });

  const system = requests[0].messages.find((item) => item.role === "system");
  assert.match(system.content, /用户习惯·自动/);
  assert.match(system.content, /小张/);

  const profile = memory.getProfile("a:account-1|u:user-1");
  assert.ok(profile.topAnchors[0].count >= 2);

  // clear thread keeps profile
  agent.clearThread("a:account-1|u:user-1");
  assert.deepEqual(memory.getThread("a:account-1|u:user-1").messages, []);
  assert.equal(memory.getProfile("a:account-1|u:user-1").topAnchors[0].query, "小张");

  // clearProfile removes habits only
  agent.clearProfile("a:account-1|u:user-1");
  assert.equal(memory.getProfile("a:account-1|u:user-1").topAnchors.length, 0);

  fs.rmSync(dir, { force: true, recursive: true });
});

test("desktop agent restores thread from user memory store", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createWeixinUserMemory } = require("./weixin-bot-user-memory");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-thread-"));
  const filePath = path.join(dir, "m.json");
  const memory = createWeixinUserMemory({ filePath, now: () => 1000 });
  const agent1 = new WeixinBotAgent({
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: "第一句" } }] }),
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      progressEnabled: false,
    }),
    userMemory: memory,
    skills: { definitions: [], execute: async () => ({ ok: true }) },
  });
  const context = { accountId: "account-1", fromUserId: "user-9" };
  agent1.enableSession(context);
  await agent1.handleMessage({ ...context, text: "你好" });

  const agent2 = new WeixinBotAgent({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const history = body.messages.filter((item) => item.role === "user" || item.role === "assistant");
      assert.ok(history.some((item) => item.role === "user" && item.content === "你好"));
      assert.ok(history.some((item) => item.role === "assistant" && item.content === "第一句"));
      return jsonResponse({ choices: [{ message: { content: "第二句" } }] });
    },
    getConfig: () => ({
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      progressEnabled: false,
    }),
    userMemory: createWeixinUserMemory({ filePath, now: () => 2000 }),
    skills: { definitions: [], execute: async () => ({ ok: true }) },
  });
  agent2.enableSession(context);
  const result = await agent2.handleMessage({ ...context, text: "继续" });
  assert.equal(result.text, "第二句");
  fs.rmSync(dir, { force: true, recursive: true });
});

test("AI 熔断：连接失败后冷却期内跳过 AI 并立即回复", async () => {
  const failingFetch = async () => {
    const error = new Error("fetch failed");
    error.cause = { code: "ECONNREFUSED" };
    throw error;
  };
  const agent = new WeixinBotAgent({
    skills: { definitions: [] },
    fetchImpl: failingFetch,
    getConfig: () => ({
      enabled: true,
      apiKey: "k",
      model: "m",
      baseUrl: "https://example.test/v1",
      progressEnabled: false,
    }),
  });

  const context = { accountId: "acc", fromUserId: "user-x" };
  agent.enableSession(context);

  const firstReplies = [];
  await assert.rejects(
    () => agent.handleMessage({ ...context,
      text: "在吗",
      replyText: async (t) => { firstReplies.push(t); },
    }),
    /fetch failed/
  );
  assert.equal(agent._isAiBreakerOpen(), true);

  // 冷却期内：不再发请求，直接回复提示
  let fetchCalls = 0;
  agent.fetchImpl = async () => { fetchCalls += 1; return jsonResponse({ choices: [{ message: { content: "ok" } }] }); };
  const replies = [];
  const result = await agent.handleMessage({ ...context,
    text: "第二条",
    replyText: async (t) => { replies.push(t); },
  });
  assert.equal(result.handled, true);
  assert.equal(result.reason, "ai-breaker-open");
  assert.equal(fetchCalls, 0);
  assert.match(replies.at(-1) || "", /暂时无法连接/);
});

test("AI 熔断：HTTP 错误（服务在线）不触发熔断", async () => {
  const agent = new WeixinBotAgent({
    skills: { definitions: [] },
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    }),
    getConfig: () => ({
      enabled: true,
      apiKey: "k",
      model: "m",
      baseUrl: "https://example.test/v1",
      progressEnabled: false,
    }),
  });
  const breakerContext = { accountId: "acc", fromUserId: "user-y" };
  agent.enableSession(breakerContext);
  await assert.rejects(() => agent.handleMessage({ ...breakerContext, text: "hi", replyText: async () => {} }), /HTTP 500/);
  assert.equal(agent._isAiBreakerOpen(), false);
});
