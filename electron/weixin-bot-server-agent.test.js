const assert = require("node:assert/strict");
const test = require("node:test");
const {
  handleDeterministic,
  handleServerAgentChat,
  runLlmToolLoop,
} = require("./weixin-bot-server-agent");

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
      name: "search_anchors",
      arguments: JSON.stringify({ query: id }),
    },
  };
}

async function withAiEnvironment(callback) {
  const keys = ["AI_ENABLED", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_TIMEOUT_MS", "AI_MAX_TOOL_ROUNDS"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    AI_ENABLED: "true",
    AI_BASE_URL: "https://example.test/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_TIMEOUT_MS: "5000",
    AI_MAX_TOOL_ROUNDS: "2",
  });
  try {
    return await callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("server agent answers import help via RAG without requiring wave data", async () => {
  const result = await handleServerAgentChat({
    message: "CSV怎么导入",
    sessionId: "unit-rag-1",
  });
  assert.equal(result.success, true);
  assert.match(String(result.data.mode), /rag/);
  assert.match(result.data.reply, /昨天|CSV|导入/);
  assert.ok((result.data.sources || []).length >= 1);
});

test("server agent answers business day via RAG", async () => {
  const result = await handleServerAgentChat({
    message: "业务日是什么",
    sessionId: "unit-rag-2",
  });
  assert.equal(result.success, true);
  assert.match(result.data.reply, /昨天|业务日/);
});

test("server FastRoute preserves explicit dates for data tools", async () => {
  const calls = [];
  const analytics = {
    latestWaveDate: async () => "2026-07-22",
    getAnchorWaveProfile: async (args) => {
      calls.push(["wave", args]);
      return { found: false, message: "no data" };
    },
    getDailyReportData: async (args) => {
      calls.push(["report", args]);
      return { asOfDate: args.date, gender: args.gender, total: 0, notLiveCount: 0 };
    },
  };

  await handleDeterministic(analytics, "小张18号音浪");
  await handleDeterministic(analytics, "18号报告");
  assert.deepEqual(calls, [
    ["wave", { query: "小张", date: "2026-07-18" }],
    ["report", { date: "2026-07-18", gender: "both" }],
  ]);
});

test("server agent timeout remains active while reading the response body", async () => {
  await withAiEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let timeoutCallback;
    const timer = { active: true };
    globalThis.setTimeout = (callback) => {
      timeoutCallback = callback;
      return timer;
    };
    globalThis.clearTimeout = (handle) => {
      handle.active = false;
    };
    globalThis.fetch = async (_url, options) => ({
      ok: true,
      status: 200,
      text: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("body aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
        queueMicrotask(() => {
          if (timer.active) timeoutCallback();
          else reject(new Error("timeout cleared before response body completed"));
        });
      }),
    });
    try {
      await assert.rejects(
        runLlmToolLoop({}, "请分析数据"),
        (error) => error?.name === "AbortError"
      );
      assert.equal(timer.active, false);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

test("server agent records only tool calls that it executes", async () => {
  await withAiEnvironment(async () => {
    const originalFetch = globalThis.fetch;
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
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return responses.shift();
    };
    try {
      const result = await runLlmToolLoop({
        searchAnchors: async (args) => {
          executed.push(args.query);
          return { anchors: [] };
        },
      }, "请分析数据");

      assert.equal(result.reply, "查询完成");
      assert.deepEqual(executed, ["call-1", "call-2", "call-3"]);
      assert.equal(requests.length, 2);
      const followupMessages = requests[1].messages;
      const assistant = followupMessages.find((item) => item.role === "assistant" && item.tool_calls);
      const toolResponses = followupMessages.filter((item) => item.role === "tool");
      assert.deepEqual(assistant.tool_calls.map((call) => call.id), ["call-1", "call-2", "call-3"]);
      assert.deepEqual(toolResponses.map((item) => item.tool_call_id), ["call-1", "call-2", "call-3"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
