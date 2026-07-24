# Bot Worker 接入 iLink 最小文本收发 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 `scripts/bot-worker.js` 在配置了账号凭据时，用 `shared/ilink-adapter.js` 完成**最小文本长轮询收发闭环**；未配置时保持现状（只持租约）。**不**宣称 durable Inbox/Outbox，**不**迁 Core/Tools，**不**接 MySQL transport 表。

**架构：** 从 Worker 抽出纯 Node 模块 `scripts/ilink-text-transport.js`（可测）：持有 Adapter + 内存游标 + 上下文 map，循环 `getUpdates`，对入站文本调用注入的 `onText`，经 `sendText` 出站。`createBotWorker` 在 `start()` 成功后可选启动 transport；`stop()` / 丢租时 abort 轮询。状态文件增加 `transport` 字段，与 `persistence: "not_connected"` 并存，避免伪装已持久化。

**技术栈：** Node.js CommonJS、`node:test`、`shared/ilink-adapter.js`、现有文件租约 `weixin-bot-runner-lock.js`。

**范围边界（YAGNI）：**

| 做 | 不做 |
| --- | --- |
| 文本 getupdates / sendmessage | 图片/CSV/媒体 CDN |
| 内存 cursor + 可选落盘 cursor 文件 | MySQL Inbox/Outbox/lease fencing |
| 入站文本 echo 或固定 ack（可注入 handler） | Agent/FastRoute/Tools/日报 |
| 凭据来自 env 或 JSON 文件（明文 token，开发用） | 二维码登录控制面、加密凭据库 |
| 状态：`transport` 与 `persistence` 分离 | 宣称服务器生产可用 |

---

## 文件结构

| 路径 | 职责 |
| --- | --- |
| **创建** `scripts/ilink-text-transport.js` | 纯 Node 文本 Poller/Sender：load config、poll loop、sendText、abort |
| **创建** `scripts/ilink-text-transport.test.js` | 注入 fake adapter 的 transport 单测 |
| **修改** `scripts/bot-worker.js` | 租约成功后可选启动 transport；stop/lease_lost 停 transport；扩展 status |
| **修改** `scripts/bot-worker.test.js` | transport 启动/停止/未配置/丢租中止 用例 |
| **可选修改** `docs/server-deployment.md` 或 `docs/LANDING.md` | 补充 env 与「仍非 durable」说明（任务 5，可后置） |

**不改：** `electron/weixin-bot.js` 主链、`shared/ilink-adapter.js` 协议、migrations、Web API（本切片不依赖）。

---

## 配置契约（冻结）

环境变量（均可被 `createBotWorker({ env, transportConfig })` 覆盖）：

| 变量 | 含义 |
| --- | --- |
| `BOT_ILINK_ENABLED` | `1`/`true` 才启动 transport；缺省 false |
| `BOT_ILINK_TOKEN` | Bearer token（开发/应急；生产后续改加密库） |
| `BOT_ILINK_BASE_URL` | 可选，默认 `https://ilinkai.weixin.qq.com` |
| `BOT_ILINK_ACCOUNT_ID` | 可选，写入 status |
| `BOT_ILINK_CURSOR` | 可选初始 `get_updates_buf` |
| `BOT_ILINK_CURSOR_PATH` | 可选：游标文件路径（JSON `{ "updatesBuf": "..." }`） |
| `BOT_ILINK_ACK_TEXT` | 入站文本默认回执，默认 `收到`；空字符串表示只收不发 |
| `BOT_ILINK_POLL_TIMEOUT_MS` | 单次 long poll 超时，默认 `35000` |

也可用 `options.transportConfig = { enabled, token, baseUrl, accountId, updatesBuf, cursorPath, ackText, onText, adapter }` 注入（测试主路径）。

**状态字段扩展（`getState()` / status 文件）：**

```js
{
  // 既有
  phase, runner, ownerId, pid, startedAt, stoppedAt,
  lastHeartbeatAt, lastError, leaseExpiresAt,
  persistence: "not_connected", // 本切片保持不变
  // 新增
  transport: "disabled" | "not_configured" | "starting" | "polling" | "session_expired" | "error" | "stopped",
  transportAccountId: string | null,
  lastPollAt: string | null,
  lastInboundAt: string | null,
  lastOutboundAt: string | null,
  receivedCount: number,
  sentCount: number,
}
```

语义：

- `enabled=false` → `transport: "disabled"`，日志可保留「adapter not configured」类说明
- `enabled=true` 但缺 token → `not_configured`，**不**启动 poll，**不** exit(1)（租约仍可运行，便于运维观察）
- poll 中 → `polling`
- `IlinkSessionExpiredError` → `session_expired`，停 poll，**不** release 他人租约；是否 `exit(1)`：本切片选 **记录错误并停 transport，租约继续心跳**（运维可重启配新 token）；丢租仍走既有 `lease_lost` + exit(1)

---

### 任务 1：Transport 模块 — 失败测试（纯逻辑）

**文件：**
- 创建：`scripts/ilink-text-transport.test.js`
- 创建（稍后绿灯）：`scripts/ilink-text-transport.js`

- [ ] **步骤 1：编写失败的测试文件**

```js
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createIlinkTextTransport,
  loadTransportConfig,
} = require("./ilink-text-transport");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("loadTransportConfig disabled by default", () => {
  const config = loadTransportConfig({ env: {} });
  assert.equal(config.enabled, false);
  assert.equal(config.token, "");
});

test("loadTransportConfig reads env flags and token", () => {
  const config = loadTransportConfig({
    env: {
      BOT_ILINK_ENABLED: "true",
      BOT_ILINK_TOKEN: "tok-1",
      BOT_ILINK_BASE_URL: "https://ilinkai.weixin.qq.com",
      BOT_ILINK_ACCOUNT_ID: "acc-1",
      BOT_ILINK_ACK_TEXT: "pong",
    },
  });
  assert.equal(config.enabled, true);
  assert.equal(config.token, "tok-1");
  assert.equal(config.accountId, "acc-1");
  assert.equal(config.ackText, "pong");
});

test("poll once handles text message, sends ack, advances cursor", async () => {
  const calls = [];
  const adapter = {
    async getUpdates(options) {
      calls.push({ type: "getUpdates", options });
      if (calls.filter((c) => c.type === "getUpdates").length === 1) {
        return {
          errcode: 0,
          get_updates_buf: "cursor-2",
          msgs: [{
            message_type: 1,
            from_user_id: "user-a",
            context_token: "ctx-1",
            message_id: "m1",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          }],
        };
      }
      // second call: hang until aborted
      return new Promise(() => {});
    },
    async sendMessage(options) {
      calls.push({ type: "sendMessage", options });
      return { errcode: 0 };
    },
  };

  const events = [];
  const transport = createIlinkTextTransport({
    adapter,
    config: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      accountId: "acc",
      updatesBuf: "cursor-1",
      ackText: "收到",
    },
    onEvent: (event) => events.push(event),
    sleep: async () => {},
  });

  const startPromise = transport.start();
  await delay(30);
  await transport.stop();
  await startPromise;

  const sent = calls.find((c) => c.type === "sendMessage");
  assert.ok(sent, "should send ack");
  assert.equal(sent.options.msg.item_list[0].text_item.text, "收到");
  assert.equal(sent.options.msg.to_user_id, "user-a");
  assert.equal(sent.options.msg.context_token, "ctx-1");
  assert.equal(transport.getState().updatesBuf, "cursor-2");
  assert.equal(transport.getState().receivedCount, 1);
  assert.equal(transport.getState().sentCount, 1);
  assert.equal(transport.getState().phase, "stopped");
});

test("session expired stops polling and reports session_expired", async () => {
  const { IlinkSessionExpiredError } = require("../shared/ilink-adapter");
  const adapter = {
    async getUpdates() {
      throw new IlinkSessionExpiredError({ errcode: -14 });
    },
    async sendMessage() {
      throw new Error("should not send");
    },
  };
  const transport = createIlinkTextTransport({
    adapter,
    config: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      updatesBuf: "",
      ackText: "收到",
    },
    sleep: async () => {},
  });
  await transport.start();
  assert.equal(transport.getState().phase, "session_expired");
});

test("stop aborts in-flight getUpdates", async () => {
  let aborted = false;
  const adapter = {
    async getUpdates(options) {
      return new Promise((_, reject) => {
        const signal = options.signal;
        if (signal.aborted) {
          aborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    },
    async sendMessage() {
      return { errcode: 0 };
    },
  };
  const transport = createIlinkTextTransport({
    adapter,
    config: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      updatesBuf: "",
      ackText: "",
    },
    sleep: async () => {},
  });
  const p = transport.start();
  await delay(20);
  await transport.stop();
  await p;
  assert.equal(aborted, true);
  assert.equal(transport.getState().phase, "stopped");
});
```

- [ ] **步骤 2：运行测试验证失败**

```bash
cd /Volumes/2t/it/抖音 && node --test scripts/ilink-text-transport.test.js
```

预期：FAIL，`Cannot find module './ilink-text-transport'` 或导出缺失。

- [ ] **步骤 3：实现最少 `scripts/ilink-text-transport.js`**

实现要点（完整实现时写入文件，以下为契约级伪码，实现须满足测试）：

```js
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");
const { IlinkAdapter, isAbortError, IlinkSessionExpiredError } = require("../shared/ilink-adapter");

function truthy(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function loadTransportConfig({ env = process.env, overrides = {} } = {}) {
  const enabled = overrides.enabled ?? truthy(env.BOT_ILINK_ENABLED);
  const token = String(overrides.token ?? env.BOT_ILINK_TOKEN ?? "").trim();
  const baseUrl = String(overrides.baseUrl ?? env.BOT_ILINK_BASE_URL ?? "https://ilinkai.weixin.qq.com").trim();
  const accountId = String(overrides.accountId ?? env.BOT_ILINK_ACCOUNT_ID ?? "").trim();
  const ackText = overrides.ackText !== undefined
    ? String(overrides.ackText)
    : (env.BOT_ILINK_ACK_TEXT !== undefined ? String(env.BOT_ILINK_ACK_TEXT) : "收到");
  const cursorPath = String(overrides.cursorPath ?? env.BOT_ILINK_CURSOR_PATH ?? "").trim();
  let updatesBuf = String(overrides.updatesBuf ?? env.BOT_ILINK_CURSOR ?? "").trim();
  if (!updatesBuf && cursorPath && fs.existsSync(cursorPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cursorPath, "utf8"));
      updatesBuf = String(parsed?.updatesBuf || "");
    } catch {
      // ignore corrupt cursor file; start empty
    }
  }
  const pollTimeoutMs = Number(overrides.pollTimeoutMs ?? env.BOT_ILINK_POLL_TIMEOUT_MS) || 35_000;
  return { enabled, token, baseUrl, accountId, updatesBuf, cursorPath, ackText, pollTimeoutMs };
}

function extractText(message) {
  const items = Array.isArray(message?.item_list) ? message.item_list : [];
  for (const item of items) {
    if (Number(item?.type) === 1) {
      const text = String(item?.text_item?.text || "").trim();
      if (text) return text;
    }
  }
  return "";
}

function createIlinkTextTransport(options = {}) {
  const config = { ...loadTransportConfig({ env: options.env, overrides: options.config }), ...(options.config || {}) };
  // Prefer explicit adapter (tests); else real IlinkAdapter
  const adapter = options.adapter || new IlinkAdapter({
    fetchImpl: options.fetchImpl,
    timeoutMs: config.pollTimeoutMs,
  });
  const sleep = options.sleep || ((ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  }));
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
  const onText = typeof options.onText === "function"
    ? options.onText
    : async ({ text }) => (config.ackText ? config.ackText : "");

  let controller = null;
  let loopPromise = null;
  let state = {
    phase: "stopped",
    updatesBuf: config.updatesBuf || "",
    accountId: config.accountId || null,
    lastPollAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastError: null,
    receivedCount: 0,
    sentCount: 0,
  };

  function snapshot() {
    return { ...state };
  }

  function setState(patch) {
    state = { ...state, ...patch };
    onEvent({ type: "state", state: snapshot() });
    return snapshot();
  }

  function persistCursor() {
    if (!config.cursorPath) return;
    const absolute = path.resolve(config.cursorPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const tmp = `${absolute}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ updatesBuf: state.updatesBuf }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, absolute);
  }

  async function sendText({ toUserId, contextToken, groupId, text }) {
    const clientId = `worker-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const msg = {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 1, text_item: { text } }],
      ...(groupId ? { group_id: groupId } : {}),
    };
    const response = await adapter.sendMessage({
      baseUrl: config.baseUrl,
      token: config.token,
      msg,
      signal: controller?.signal,
      timeoutMs: Math.min(config.pollTimeoutMs, 15_000),
    });
    const code = Number(response?.errcode ?? response?.ret ?? 0);
    if (code !== 0) throw new Error(`微信发送消息失败 (${code}): ${String(response?.errmsg || "未知错误")}`);
    setState({
      sentCount: state.sentCount + 1,
      lastOutboundAt: new Date().toISOString(),
    });
    return response;
  }

  async function handleMessage(raw) {
    if (Number(raw?.message_type) !== 1) return;
    const fromUserId = String(raw.from_user_id || "").trim();
    if (!fromUserId) return;
    const text = extractText(raw);
    if (!text) return;
    const contextToken = String(raw.context_token || "").trim();
    const groupId = String(raw.group_id || "").trim();
    setState({
      receivedCount: state.receivedCount + 1,
      lastInboundAt: new Date().toISOString(),
    });
    onEvent({ type: "inbound", text, fromUserId, groupId });
    if (!contextToken) return;
    const reply = await onText({
      text,
      fromUserId,
      groupId,
      contextToken,
      raw,
      sendText,
    });
    const out = String(reply ?? "").trim();
    if (!out) return;
    await sendText({
      toUserId: fromUserId,
      contextToken,
      groupId: groupId || undefined,
      text: out,
    });
  }

  async function pollLoop() {
    let consecutiveFailures = 0;
    let timeoutMs = config.pollTimeoutMs;
    while (controller && !controller.signal.aborted) {
      try {
        const response = await adapter.getUpdates({
          baseUrl: config.baseUrl,
          token: config.token,
          cursor: state.updatesBuf || "",
          signal: controller.signal,
          timeoutMs,
          allowTimeout: true,
        });
        if (controller.signal.aborted) break;
        if (!response) {
          setState({ lastPollAt: new Date().toISOString() });
          continue;
        }
        const code = Number(response.errcode ?? response.ret ?? 0);
        if (code === -14) throw new IlinkSessionExpiredError(response);
        if (code !== 0) throw new Error(`微信收取消息失败 (${code}): ${String(response.errmsg || "未知错误")}`);

        consecutiveFailures = 0;
        const suggested = Number(response.longpolling_timeout_ms);
        if (Number.isFinite(suggested) && suggested > 0) {
          timeoutMs = Math.min(65_000, Math.max(5_000, suggested + 3_000));
        }

        for (const message of Array.isArray(response.msgs) ? response.msgs : []) {
          if (controller.signal.aborted) break;
          await handleMessage(message);
        }

        const nextBuf = String(response.get_updates_buf || "");
        if (nextBuf && nextBuf !== state.updatesBuf) {
          setState({ updatesBuf: nextBuf, lastPollAt: new Date().toISOString(), lastError: null });
          try { persistCursor(); } catch { /* best-effort */ }
        } else {
          setState({ lastPollAt: new Date().toISOString(), lastError: null });
        }
      } catch (error) {
        if (controller?.signal.aborted || isAbortError(error)) break;
        if (error instanceof IlinkSessionExpiredError || error?.code === -14) {
          setState({ phase: "session_expired", lastError: error.message });
          break;
        }
        consecutiveFailures += 1;
        const backoffMs = consecutiveFailures >= 3 ? 30_000 : 2_000;
        if (consecutiveFailures >= 3) consecutiveFailures = 0;
        setState({ lastError: error.message || String(error) });
        try {
          await sleep(backoffMs, controller.signal);
        } catch {
          break;
        }
      }
    }
    if (state.phase === "polling") setState({ phase: "stopped" });
  }

  async function start() {
    if (!config.enabled) {
      return setState({ phase: "disabled" });
    }
    if (!config.token) {
      return setState({ phase: "not_configured", lastError: "缺少 BOT_ILINK_TOKEN" });
    }
    if (loopPromise) return snapshot();
    controller = new AbortController();
    setState({ phase: "polling", lastError: null });
    loopPromise = pollLoop().finally(() => {
      loopPromise = null;
      controller = null;
    });
    // 不在 start 内 await 整圈；测试里 await start 时 session_expired 路径需 await loop
    // 约定：start 返回 Promise，在 loop 首次进入稳定态或结束时 resolve
    // 实现建议：await Promise.race([loopPromise, delay(0)]) 不够；
    // 更简：async start() { ...; await loopPromise; return snapshot(); }
    // 测试「poll once」用 fire-and-forget + stop；
    // 测试 session_expired 用 await start() 等 loop 结束。
    // 统一：start() 若 options.awaitLoop === true 则 await loop，否则后台跑。
    if (options.awaitLoop) {
      await loopPromise;
      return snapshot();
    }
    // 后台：给 event loop 一拍让第一轮 getUpdates 发出
    await Promise.resolve();
    return snapshot();
  }

  async function stop() {
    if (controller) controller.abort();
    if (loopPromise) {
      try { await loopPromise; } catch { /* ignore */ }
    }
    if (state.phase === "polling" || state.phase === "starting") {
      setState({ phase: "stopped" });
    }
    return snapshot();
  }

  return {
    start,
    stop,
    getState: snapshot,
    sendText,
  };
}

module.exports = {
  createIlinkTextTransport,
  loadTransportConfig,
  extractText,
};
```

**实现注意（避免测试脆弱）：**

1. `start()` 对 **session_expired** 路径：内部 `await loopPromise` 再返回（可在 `start` 开头检测 `options.awaitLoop`，测试 session_expired 传 `awaitLoop: true`；poll-once 测试不传，用 stop）。
2. 或者更简单：**`start()` 总是启动后台 loop 并立即 resolve snapshot**；session_expired 测试改为：

```js
const p = transport.start();
await delay(50);
assert.equal(transport.getState().phase, "session_expired");
await transport.stop();
await p;
```

优先采用「start 立即返回 + 后台 loop」，与 Worker 集成更自然。相应改写任务 1 中 session_expired 测试为轮询等待 phase。

3. `sendMessage` 参数形态须与 adapter 一致：`adapter.sendMessage({ baseUrl, token, msg, signal, timeoutMs })`（见 `IlinkAdapter.sendMessage` 的 options 对象形态）。
4. Fake adapter 的 `getUpdates`/`sendMessage` 若用 options 对象，测试断言读 `options.msg`。

- [ ] **步骤 4：运行测试验证通过**

```bash
node --test scripts/ilink-text-transport.test.js
```

预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add scripts/ilink-text-transport.js scripts/ilink-text-transport.test.js
git commit -m "$(cat <<'EOF'
feat: add pure Node iLink text transport for worker

EOF
)"
```

---

### 任务 2：Worker 集成 — 失败测试

**文件：**
- 修改：`scripts/bot-worker.test.js`
- 修改：`scripts/bot-worker.js`

- [ ] **步骤 1：追加失败测试到 `bot-worker.test.js`**

```js
test("worker starts text transport after lease when enabled", async () => {
  const timers = createTimers();
  const transportCalls = [];
  let transportPhase = "stopped";
  const worker = createBotWorker({
    runner: "server",
    ownerId: "worker-owner",
    lockFile: "/tmp/fixture-runner.lock",
    heartbeatMs: 10,
    leaseTtlMs: 100,
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: {
      acquire: (options) => ({
        ok: true,
        file: options.file,
        lease: { ownerId: options.ownerId, expiresAt: Date.parse("2026-07-23T12:00:00.000Z") },
      }),
      renew: () => ({ ok: true, lease: { ownerId: "worker-owner", expiresAt: "2026-07-23T12:01:00.000Z" } }),
      release: () => ({ ok: true }),
    },
    createTransport: (config) => {
      transportCalls.push({ type: "create", config });
      return {
        async start() {
          transportPhase = "polling";
          transportCalls.push({ type: "start" });
          return { phase: "polling" };
        },
        async stop() {
          transportPhase = "stopped";
          transportCalls.push({ type: "stop" });
          return { phase: "stopped" };
        },
        getState: () => ({
          phase: transportPhase,
          updatesBuf: "c1",
          accountId: "acc-1",
          lastPollAt: "2026-07-23T12:00:00.000Z",
          lastInboundAt: null,
          lastOutboundAt: null,
          lastError: null,
          receivedCount: 0,
          sentCount: 0,
        }),
      };
    },
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      accountId: "acc-1",
      ackText: "收到",
    },
  });

  assert.equal(worker.start().phase, "running");
  await delay(10);
  assert.equal(worker.getState().transport, "polling");
  assert.equal(worker.getState().persistence, "not_connected");
  assert.equal(worker.getState().transportAccountId, "acc-1");
  assert.deepEqual(
    transportCalls.map((c) => c.type),
    ["create", "start"]
  );

  assert.equal(worker.stop().phase, "stopped");
  assert.ok(transportCalls.some((c) => c.type === "stop"));
  assert.equal(worker.getState().transport, "stopped");
});

test("worker without transport config keeps transport disabled", () => {
  const timers = createTimers();
  const worker = createBotWorker({
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: {
      acquire: () => ({
        ok: true,
        file: "LOCK",
        lease: { ownerId: "o", expiresAt: "2026-07-23T12:00:00.000Z" },
      }),
      renew: () => ({ ok: true, lease: { ownerId: "o", expiresAt: "2026-07-23T12:01:00.000Z" } }),
      release: () => ({ ok: true }),
    },
  });
  worker.start();
  assert.equal(worker.getState().transport, "disabled");
  assert.equal(worker.getState().persistence, "not_connected");
  worker.stop();
});

test("lease loss stops transport before exit", () => {
  const timers = createTimers();
  const transportCalls = [];
  const worker = createBotWorker({
    ownerId: "worker-owner",
    heartbeatMs: 10,
    leaseTtlMs: 100,
    timers,
    exit: () => {},
    logger: { log() {}, error() {} },
    runnerLock: {
      acquire: () => ({
        ok: true,
        file: "LOCK",
        lease: { ownerId: "worker-owner", expiresAt: "2026-07-23T12:00:00.000Z" },
      }),
      renew: () => ({ ok: false, error: "lease taken over" }),
      release: () => ({ ok: true }),
    },
    createTransport: () => ({
      async start() {
        transportCalls.push("start");
        return { phase: "polling" };
      },
      async stop() {
        transportCalls.push("stop");
        return { phase: "stopped" };
      },
      getState: () => ({
        phase: "polling",
        updatesBuf: "",
        accountId: null,
        lastPollAt: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        lastError: null,
        receivedCount: 0,
        sentCount: 0,
      }),
    }),
    transportConfig: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      ackText: "收到",
    },
  });

  worker.start();
  timers.fire();
  assert.equal(worker.getState().phase, "lease_lost");
  assert.ok(transportCalls.includes("stop"));
});
```

- [ ] **步骤 2：运行测试验证失败**

```bash
node --test scripts/bot-worker.test.js
```

预期：新用例 FAIL（`transport` 字段不存在 / `createTransport` 未接线）。旧 4 个用例仍应 PASS。

- [ ] **步骤 3：修改 `createBotWorker` 集成 transport**

关键改动（贴进 `bot-worker.js` 时保持现有租约逻辑）：

1. `require("./ilink-text-transport")` 的 `createIlinkTextTransport` / `loadTransportConfig`。
2. 初始 `state` 增加 transport 字段：
   - `transport: "disabled"`
   - `transportAccountId: null`
   - `lastPollAt/lastInboundAt/lastOutboundAt: null`
   - `receivedCount: 0`, `sentCount: 0`
   - `persistence: "not_connected"` 保持
3. `let transport = null;`
4. `function mergeTransportState()`：若 `transport` 存在，把 `getState()` 映射到 worker state 的 transport 字段。
5. `async function startTransport()`：
   - `const cfg = options.transportConfig || loadTransportConfig({ env })`
   - 若 `!cfg.enabled` → `update({ transport: "disabled" })` return
   - 若 `!cfg.token` → `update({ transport: "not_configured", lastError: ... })` return（**不** throw）
   - `transport = (options.createTransport || createIlinkTextTransport)({ config: cfg, onEvent })`
   - `onEvent`：`type==="state"` 时 `mergeTransportState` + `update`
   - `await transport.start()`（非阻塞 loop 的 start）
6. `start()`：租约成功、`phase=running` 后 **同步调用** `void startTransport().catch(...)` 或在测试里允许 `start` 仍同步返回；为兼容现有同步 `start()` 测试：
   - **保持 `start()` 同步**
   - transport 启动：`void Promise.resolve().then(() => startTransport())`，并用 `onEvent` 更新状态
   - 测试用 `await delay(10)` 已覆盖
7. `stop()` / `handleLeaseLoss()`：先 `void transport?.stop()`（若 stop 返回 Promise，同步路径可 `transport.stop()` 不 await 会 flake；**实现 `stopTransportSyncFriendly`：调用 stop 并把 phase 立即标 stopped，后台 await**）。更稳：

```js
function stopTransport() {
  const current = transport;
  transport = null;
  if (!current) {
    update({ transport: state.transport === "disabled" ? "disabled" : "stopped" });
    return;
  }
  // fire-and-forget stop; tests inject sync stop
  const result = current.stop();
  if (result && typeof result.then === "function") {
    result.catch(() => {});
  }
  update({
    transport: "stopped",
    // 保留计数
  });
}
```

8. `main()` 日志：

```js
const snapshot = worker.getState();
if (snapshot.transport === "disabled") {
  console.log("[bot-worker] lease acquired; iLink transport disabled (set BOT_ILINK_ENABLED=1)");
} else if (snapshot.transport === "not_configured") {
  console.log("[bot-worker] lease acquired; iLink enabled but token missing");
} else {
  console.log("[bot-worker] lease acquired; iLink text transport starting");
}
console.log("[bot-worker] persistence remains not_connected (no durable Inbox/Outbox)");
```

注意：`main` 里 transport 可能异步才变 polling，日志以启动瞬间状态为准即可。

9. `module.exports` 可附带 re-export `loadTransportConfig`（可选）。

- [ ] **步骤 4：跑 Worker + Transport 测试**

```bash
node --test scripts/bot-worker.test.js scripts/ilink-text-transport.test.js
```

预期：全 PASS。旧用例不破坏。

- [ ] **步骤 5：Commit**

```bash
git add scripts/bot-worker.js scripts/bot-worker.test.js
git commit -m "$(cat <<'EOF'
feat: wire bot-worker to optional iLink text transport

EOF
)"
```

---

### 任务 3：`package.json` 测试脚本与全量回归

**文件：**
- 修改：`package.json`（`test:bot-worker` 或 `test` 链）

- [ ] **步骤 1：扩展 test 脚本**

将：

```json
"test:bot-worker": "node --test scripts/bot-worker.test.js"
```

改为：

```json
"test:bot-worker": "node --test scripts/bot-worker.test.js scripts/ilink-text-transport.test.js"
```

- [ ] **步骤 2：跑相关 + 全量**

```bash
npm run test:bot-worker
npm run test:ilink-adapter
# 若时间允许：
npm test
```

预期：bot-worker + ilink-adapter 全绿；全量保持既有绿基线。

- [ ] **步骤 3：Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
test: include iLink text transport in bot-worker suite

EOF
)"
```

---

### 任务 4：文档脚注（最小）

**文件：**
- 修改：`docs/server-deployment.md`（或 `docs/LANDING.md` 中 P2 worker 一节）**仅追加短段落**，不重写全书。

- [ ] **步骤 1：追加「实验性文本 transport」**

说明：

- 开关：`BOT_ILINK_ENABLED=1` + `BOT_ILINK_TOKEN=...`
- 可选：`BOT_ILINK_CURSOR_PATH`、`BOT_ILINK_ACK_TEXT`
- **明确：`persistence: not_connected`；非生产；无 durable Inbox；勿与桌面同账号双开**
- 默认关闭时行为与旧 Worker 一致

- [ ] **步骤 2：Commit**

```bash
git add docs/server-deployment.md
git commit -m "$(cat <<'EOF'
docs: document experimental bot-worker iLink text transport

EOF
)"
```

---

### 任务 5：手动验证清单（不自动化）

- [ ] **无配置：** `npm run bot:worker` → 日志含 transport disabled / not configured；status `transport: disabled`，`persistence: not_connected`；SIGTERM 释锁。
- [ ] **假 token（可选）：** `BOT_ILINK_ENABLED=1 BOT_ILINK_TOKEN=bad` → 进入 polling 后错误退避或 session 错误；进程不假装 Inbox 已连接。
- [ ] **真实账号（可选，人工）：** 用桌面导出的 token（**先停桌面 runner**），设 env，发一条私聊文本，收到 ack「收到」。验证后 `BOT_ILINK_ENABLED=0`，桌面回切。

---

## 自检

| 检查 | 结果 |
| --- | --- |
| 规格覆盖：Worker 接 Adapter 最小文本收发 | 任务 1–2 |
| 不伪装 durable | `persistence` 固定 `not_connected`；日志声明 |
| 未配置不破坏旧行为 | 任务 2「disabled」用例 |
| 丢租停 poll | 任务 2 lease_lost 用例 |
| 无占位符 TODO | 配置表与代码块齐全 |
| 不引入 Core/DB/媒体/Agent | 范围边界表 |
| 类型/字段名一致 | `transport` / `persistence` / `createTransport` |

---

## 明确不在本计划

- MySQL `001_ilink_runtime` 接线  
- `shared/bot-core` 迁移  
- 图片/CSV、Agent Tools、二维码 Web 控制通道  
- 宣称「服务器生产可用」

下一计划候选：DB lease/fencing + Inbox/Cursor 同事务（真正的 B4 主体）。

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-07-24-bot-worker-ilink-text-loop.md`。

**两种执行方式：**

1. **子代理驱动（推荐）** — 每个任务新开子代理，任务间审查  
2. **内联执行** — 当前会话用 executing-plans 批量推进  

**选哪种方式？**
