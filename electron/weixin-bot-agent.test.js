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
