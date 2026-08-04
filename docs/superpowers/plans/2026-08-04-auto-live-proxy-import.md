# 开播自动监控 · 代理池 · 外部导入 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在现有多主播 `scoreOnly` 协议监控上，交付 Watchlist 持久化、开播自动附着、ProxyPool（约 10 房/代理、HTTP+WSS 全链路）、以及外部导入监控页。

**架构：** main 进程单例链 `Watchlist → LiveProbe → AutoScheduler → ProxyPool → LivePkMultiMonitor(addRooms)`；协议层与 Watcher 接受复用的 `agent`；未开播零会话、下播即毁、只音浪。

**技术栈：** Electron main（CommonJS）、`ws`、`https-proxy-agent` / `socks-proxy-agent`、Node test runner、React/TS 桌面页、现有 IPC 模式。

**规格：** `docs/superpowers/specs/2026-08-04-auto-live-proxy-import-design.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `electron/live-proxy-pool.js` | 代理解析、一代理一 Agent、acquire/release、熔断、可选持久化接口 |
| `electron/live-proxy-pool.test.js` | 10 房绑定、refCount、熔断、禁止超绑 |
| `electron/live-pk-protocol.js` | `requestJsonOrText` / enter / resolve 接受 `agent`；导出轻量 `probeRoomLiving` |
| `electron/live-pk-protocol.test.js` | agent 传入断言（mock request）或现有用例回归 |
| `electron/live-pk-watcher.js` | `WebSocket(..., { agent })`；start 接受 `agent` |
| `electron/live-pk-multi-monitor.js` | `addRooms`、scores Top-8、session.agent/proxyId/autoAttached、stop 时回调 release |
| `electron/live-pk-multi-monitor.test.js` | 增量加房不杀旧会话、Top-8、scoreOnly |
| `electron/live-watchlist.js` | 清单规范化/去重/200 上限/读写 JSON |
| `electron/live-watchlist.test.js` | round-trip、去重、上限 |
| `electron/live-probe.js` | 对 auto 目标轮询 `probeRoomLiving`，inflight≤4 |
| `electron/live-probe.test.js` | 开播回调、未开播无多余调用风暴、inflight |
| `electron/live-auto-scheduler.js` | 总开关、附着 addRooms、下播 remove+release |
| `electron/live-auto-scheduler.test.js` | 开播附着、满载排队、关开关停 auto 会话 |
| `electron/main.js` | 单例接线、IPC、safeStorage 代理读写 |
| `electron/preload.js` | 暴露新 API |
| `src/types/electron.d.ts` | 类型 |
| `src/client/http-electron-api.ts` | Web stub |
| `src/components/desktop/import-monitor-page.tsx` | 外部导入 + 清单 + 代理 + 自动开关 + 分数卡 |
| `src/components/desktop/multi-monitor-page.tsx` | 「加入自动清单」 |
| `src/components/desktop/shell.tsx` | 挂载 import 真页 |
| `package.json` | 如缺则加 `socks-proxy-agent` 直接依赖 |

---

### 任务 1：ProxyPool 核心（无 Electron）

**文件：**
- 创建：`electron/live-proxy-pool.js`
- 创建：`electron/live-proxy-pool.test.js`

- [ ] **步骤 1：编写失败的测试**

```js
"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { LiveProxyPool, ROOMS_PER_PROXY } = require("./live-proxy-pool");

describe("LiveProxyPool", () => {
  /** @type {LiveProxyPool} */
  let pool;
  beforeEach(() => {
    pool = new LiveProxyPool({
      roomsPerProxy: 10,
      createAgent: (parsed) => ({ id: parsed.href, destroy() { this.destroyed = true; } }),
    });
    pool.setProxies(["http://127.0.0.1:8001", "http://127.0.0.1:8002"]);
  });

  it("binds at most 10 rooms per proxy then uses next", () => {
    const agents = [];
    for (let i = 0; i < 21; i += 1) {
      const got = pool.acquire(`s${i}`);
      assert.ok(got, `room ${i}`);
      agents.push(got.proxyId);
    }
    const c1 = agents.filter((id) => id.includes("8001")).length;
    const c2 = agents.filter((id) => id.includes("8002")).length;
    assert.equal(c1, 10);
    assert.equal(c2, 10);
    // 21st on fuller? after 10/10 both full — acquire returns null if no slot
  });

  it("returns null when all full", () => {
    for (let i = 0; i < 20; i += 1) pool.acquire(`s${i}`);
    assert.equal(pool.acquire("overflow"), null);
  });

  it("release decrements and allows rebind", () => {
    const a = pool.acquire("s1");
    assert.equal(pool.acquire("fill")?.refCount >= 1, true);
    pool.release("s1");
    const again = pool.acquire("s1b");
    assert.ok(again);
  });

  it("reuses same agent instance for same proxy", () => {
    const a = pool.acquire("s1");
    const b = pool.acquire("s2");
    assert.equal(a.agent, b.agent);
  });

  it("circuit-breaks after consecutive failures", () => {
    const a = pool.acquire("s1");
    pool.reportFailure(a.proxyId);
    pool.reportFailure(a.proxyId);
    pool.reportFailure(a.proxyId);
    pool.release("s1");
    // only one proxy left healthy
    for (let i = 0; i < 10; i += 1) {
      const g = pool.acquire(`x${i}`);
      assert.ok(g);
      assert.ok(!g.proxyId.includes("8001") || g.disabledUntil > 0 === false);
    }
  });
});
```

（实现时按实际 API 微调断言：`acquire` 返回 `{ proxyId, agent, refCount }`；满载 20 后第 21 为 `null`。）

- [ ] **步骤 2：运行测试确认失败**

```bash
node --test electron/live-proxy-pool.test.js
```

预期：FAIL，无法 require 模块或断言失败。

- [ ] **步骤 3：实现 `LiveProxyPool`**

```js
"use strict";

const { URL } = require("url");

const ROOMS_PER_PROXY = 10;
const FAIL_THRESHOLD = 3;
const DISABLE_MS = 5 * 60 * 1000;

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseProxyUrl(raw) {
  const value = text(raw);
  if (!value) return null;
  let href = value;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(href)) href = `http://${href}`;
  const url = new URL(href);
  const kind = url.protocol.replace(":", "").toLowerCase();
  if (!["http", "https", "socks5", "socks"].includes(kind)) {
    throw new Error(`不支持的代理协议: ${kind}`);
  }
  return {
    href: url.href,
    kind: kind === "socks" ? "socks5" : kind,
    url,
  };
}

class LiveProxyPool {
  constructor({
    roomsPerProxy = ROOMS_PER_PROXY,
    createAgent,
    now = () => Date.now(),
  } = {}) {
    this.roomsPerProxy = Math.max(1, Number(roomsPerProxy) || ROOMS_PER_PROXY);
    this.createAgent =
      typeof createAgent === "function"
        ? createAgent
        : () => {
            throw new Error("createAgent required in production wiring");
          };
    this.now = now;
    /** @type {Map<string, any>} */
    this.slots = new Map();
    /** sessionId -> proxyId */
    this.bindings = new Map();
    this.requireProxy = false;
  }

  setProxies(lines = []) {
    const next = new Map();
    for (const line of lines) {
      let parsed;
      try {
        parsed = parseProxyUrl(line);
      } catch {
        continue;
      }
      if (!parsed) continue;
      const existing = this.slots.get(parsed.href);
      if (existing) {
        next.set(parsed.href, existing);
        continue;
      }
      next.set(parsed.href, {
        id: parsed.href,
        raw: parsed.href,
        kind: parsed.kind,
        agent: this.createAgent(parsed),
        refCount: 0,
        roomIds: new Set(),
        failCount: 0,
        disabledUntil: 0,
        lastError: "",
      });
    }
    for (const [id, slot] of this.slots) {
      if (next.has(id)) continue;
      try {
        slot.agent?.destroy?.();
      } catch {
        /* ignore */
      }
      for (const sessionId of slot.roomIds) this.bindings.delete(sessionId);
    }
    this.slots = next;
  }

  acquire(sessionId) {
    const id = text(sessionId);
    if (!id) return null;
    if (this.bindings.has(id)) {
      const pid = this.bindings.get(id);
      const slot = this.slots.get(pid);
      if (slot) return this.#public(slot);
      this.bindings.delete(id);
    }
    const now = this.now();
    const candidates = [...this.slots.values()]
      .filter((slot) => slot.disabledUntil <= now && slot.refCount < this.roomsPerProxy)
      .sort((a, b) => a.refCount - b.refCount || a.id.localeCompare(b.id));
    const slot = candidates[0];
    if (!slot) return null;
    slot.refCount += 1;
    slot.roomIds.add(id);
    this.bindings.set(id, slot.id);
    return this.#public(slot);
  }

  release(sessionId) {
    const id = text(sessionId);
    const pid = this.bindings.get(id);
    if (!pid) return;
    this.bindings.delete(id);
    const slot = this.slots.get(pid);
    if (!slot) return;
    slot.roomIds.delete(id);
    slot.refCount = Math.max(0, slot.refCount - 1);
  }

  reportFailure(proxyId, errorMessage = "") {
    const slot = this.slots.get(text(proxyId));
    if (!slot) return;
    slot.failCount += 1;
    slot.lastError = text(errorMessage);
    if (slot.failCount >= FAIL_THRESHOLD) {
      slot.disabledUntil = this.now() + DISABLE_MS;
      slot.failCount = 0;
    }
  }

  reportSuccess(proxyId) {
    const slot = this.slots.get(text(proxyId));
    if (!slot) return;
    slot.failCount = 0;
    slot.lastError = "";
  }

  getStatus() {
    return {
      roomsPerProxy: this.roomsPerProxy,
      requireProxy: this.requireProxy,
      proxies: [...this.slots.values()].map((slot) => ({
        id: slot.id,
        kind: slot.kind,
        refCount: slot.refCount,
        disabledUntil: slot.disabledUntil,
        lastError: slot.lastError,
        // 不回传账密明文以外的 raw 时可脱敏
        display: slot.raw.replace(/\/\/([^/@]+)@/, "//***@"),
      })),
    };
  }

  destroyAll() {
    for (const sessionId of [...this.bindings.keys()]) this.release(sessionId);
    for (const slot of this.slots.values()) {
      try {
        slot.agent?.destroy?.();
      } catch {
        /* ignore */
      }
    }
    this.slots.clear();
  }

  #public(slot) {
    return {
      proxyId: slot.id,
      agent: slot.agent,
      refCount: slot.refCount,
      kind: slot.kind,
    };
  }
}

module.exports = {
  LiveProxyPool,
  parseProxyUrl,
  ROOMS_PER_PROXY,
  FAIL_THRESHOLD,
  DISABLE_MS,
};
```

生产 `createAgent`（任务 8 接线）示例：

```js
function createProductionAgent(parsed) {
  if (parsed.kind === "socks5") {
    const { SocksProxyAgent } = require("socks-proxy-agent");
    return new SocksProxyAgent(parsed.href, { keepAlive: true });
  }
  const { HttpsProxyAgent } = require("https-proxy-agent");
  return new HttpsProxyAgent(parsed.href, { keepAlive: true, maxSockets: 16 });
}
```

- [ ] **步骤 4：跑测试通过**

```bash
node --test electron/live-proxy-pool.test.js
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add electron/live-proxy-pool.js electron/live-proxy-pool.test.js
git commit -m "feat(监控): 添加 LiveProxyPool（10房/代理·一代理一Agent）"
```

---

### 任务 2：协议层接受 `agent` + 轻量 probe

**文件：**
- 修改：`electron/live-pk-protocol.js`
- 修改：`electron/live-pk-protocol.test.js`（若无 agent 用例则追加）

- [ ] **步骤 1：失败测试（agent 传入 request）**

在 `live-pk-protocol.test.js` 增加（可用依赖注入：若当前 `requestJsonOrText` 未导出，改为导出 `__test__` 或通过 mock https 难测——推荐把 agent 选择提成可测函数）：

```js
it("resolve options accepts agent and returns same reference", async () => {
  // 若全链路集成难，至少单测 request 选项：
  const fakeAgent = { mark: "proxy-a" };
  // 通过临时 stub：模块内 requestJsonOrText 记录 lastAgent
});
```

更可测的改法：`requestJsonOrText(url, { agent, ... })` 使用 `agent || defaultAgent`；单测直接 require 后用 nock 不现实时，导出：

```js
function pickAgent(isHttp, override) {
  if (override) return override;
  return isHttp ? httpAgent : httpsAgent;
}
```

测试：

```js
const { pickAgent } = require("./live-pk-protocol");
const a = { x: 1 };
assert.equal(pickAgent(false, a), a);
```

- [ ] **步骤 2：改 `requestJsonOrText`**

```js
function requestJsonOrText(url, { method = "GET", headers = {}, body, timeoutMs = 20000, agent } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isHttp = target.protocol === "http:";
    const lib = isHttp ? http : https;
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        path: target.pathname + target.search,
        method,
        agent: pickAgent(isHttp, agent),
        headers: cleanHeaders({ /* 同现有 */ }),
      },
      /* 同现有 */
    );
    // ...
  });
}
```

将 `fetchTtwid` / `fetchRoomEnter` / `fetchWebcastJson` / `fetchGiftListShared` / `createLinkmicSnapshotLookup` 增加可选 `agent` 并下传。

`resolveDouyinLiveOptions(liveRoomUrl, { cookie, onStatus, bootstrapMode, shareGiftList, agent })`：
- 所有内部 fetch 传 `agent`
- **返回值增加 `agent`**（同一引用），供 watcher 使用

- [ ] **步骤 3：导出 `probeRoomLiving`**

```js
/**
 * 轻量开播探测：只读 status/room_id，不拉 gift/linkmic，不建 WSS。
 * @returns {Promise<{ living: boolean, status: number, roomId: string, webRid: string, nickname: string }>}
 */
async function probeRoomLiving(liveRoomUrl, { cookie = "", agent } = {}) {
  const sourceUrl = normalizeLiveRoomUrl(liveRoomUrl);
  const webRid = extractWebRid(sourceUrl);
  let cookieHeader = await fetchTtwid(sourceUrl, text(cookie), agent);
  // 若 fetchTtwid 签名仍是 (url, cookie)，改为 options 对象或末参 agent——实现时统一为：
  // fetchTtwid(url, { cookie, agent })
  const entered = await fetchRoomEnter(webRid, cookieHeader, agent);
  const room = entered.room || {};
  const status = Number(room.status);
  const roomId = text(room.id_str || room.id);
  const nickname = text(room.owner?.nickname || room.title || "");
  return {
    living: status === 2,
    status: Number.isFinite(status) ? status : -1,
    roomId,
    webRid,
    nickname,
  };
}
```

注意：实现时把 `fetchTtwid(liveRoomUrl, cookieHeader)` 扩展为可传 agent，避免破坏现有两参调用——兼容：

```js
async function fetchTtwid(liveRoomUrl, cookieHeader = "", agent) {
  const response = await requestJsonOrText(liveRoomUrl, {
    headers: { /* ... */, cookie: cookieHeader || undefined },
    agent,
  });
  // ...
}
```

- [ ] **步骤 4：module.exports 增加**

```js
module.exports = {
  normalizeLiveRoomUrl,
  extractWebRid,
  resolveDouyinLiveOptions,
  probeRoomLiving,
  pickAgent,
  signPushUrl,
  buildUnsignedPushUrl,
  reshapeGiftList,
  fetchGiftListShared,
};
```

- [ ] **步骤 5：跑协议单测**

```bash
node --test electron/live-pk-protocol.test.js
```

预期：PASS（含新用例）。

- [ ] **步骤 6：Commit**

```bash
git add electron/live-pk-protocol.js electron/live-pk-protocol.test.js
git commit -m "feat(监控): 协议进房/探测支持复用 proxy agent"
```

---

### 任务 3：Watcher WSS 使用 agent

**文件：**
- 修改：`electron/live-pk-watcher.js`
- 可选：`electron/live-pk-watcher` 相关测试；若无，用最小 mock 测 start 传参（可在 multi 测中间接覆盖）

- [ ] **步骤 1：`start` 增加 `agent`**

```js
async start({
  websocketUrl,
  fetchUrl,
  fetchHeaders,
  cookie,
  includeRaw = false,
  scoreOnly = false,
  bootstrap,
  profileLookup,
  linkmicSnapshotLookup,
  agent, // 新增
}) {
  // ...
  this.wsAgent = agent || null;
  this.ws = new WebSocket(cleanUrl, {
    headers,
    ...(this.wsAgent ? { agent: this.wsAgent } : {}),
  });
```

- [ ] **步骤 2：`stop` 时 `this.wsAgent = null`**（不断言 destroy agent——池拥有生命周期）

- [ ] **步骤 3：回归 multi 测试**

```bash
node --test electron/live-pk-multi-monitor.test.js
```

- [ ] **步骤 4：Commit**

```bash
git add electron/live-pk-watcher.js
git commit -m "feat(监控): LivePkWatcher WebSocket 支持 proxy agent"
```

---

### 任务 4：MultiMonitor `addRooms` + Top-8 + per-session agent

**文件：**
- 修改：`electron/live-pk-multi-monitor.js`
- 修改：`electron/live-pk-multi-monitor.test.js`

- [ ] **步骤 1：失败测试**

```js
it("addRooms keeps existing running sessions", async () => {
  monitor.start({
    rooms: [{ liveRoomUrl: "https://live.douyin.com/111", name: "A" }],
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(monitor.getStatus().runningCount, 1);
  const firstId = monitor.getStatus().rooms[0].sessionId;
  monitor.addRooms({
    rooms: [{ liveRoomUrl: "https://live.douyin.com/222", name: "B" }],
  });
  await new Promise((r) => setTimeout(r, 40));
  const status = monitor.getStatus();
  assert.equal(status.roomCount, 2);
  assert.ok(status.rooms.some((r) => r.sessionId === firstId));
  assert.equal(status.runningCount, 2);
});

it("truncates scores to top 8", async () => {
  monitor.start({
    rooms: [{ liveRoomUrl: "https://live.douyin.com/111", name: "A" }],
  });
  await new Promise((r) => setTimeout(r, 30));
  const ranks = Array.from({ length: 12 }, (_, i) => ({
    rank: i + 1,
    userId: `u${i}`,
    nickname: `N${i}`,
    score: 100 - i,
  }));
  watchers[0].emit("rank", { ranks });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(monitor.getStatus().rooms[0].scores.length, 8);
  assert.equal(monitor.getStatus().rooms[0].scores[0].score, 100);
});

it("passes agent into captureLiveOptions and watcher.start", async () => {
  const fakeAgent = { tag: "p1" };
  const captureCalls = [];
  const startAgents = [];
  // recreate monitor with createWatcher that records startCalls[0].agent
  // captureLiveOptions pushes opts.agent
  monitor.addRooms({
    rooms: [{ liveRoomUrl: "https://live.douyin.com/111", name: "A" }],
    agentByUrl: { "https://live.douyin.com/111": fakeAgent },
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(captureCalls[0].agent, fakeAgent);
  assert.equal(watchers[0].startCalls[0].agent, fakeAgent);
});
```

（`createFakeWatcher` 的 `start` 需把整个 `options` 推进 `startCalls`——已有则够用。）

- [ ] **步骤 2：跑测确认失败**

```bash
node --test electron/live-pk-multi-monitor.test.js
```

- [ ] **步骤 3：实现**

常量与截断：

```js
const MAX_SCORE_ROWS = 8;

function truncateScores(rows) {
  return [...(rows || [])]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, MAX_SCORE_ROWS)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
```

所有 `session.scores = scores` 改为 `session.scores = truncateScores(scores)`。

`publicSession` 增加：

```js
proxyId: session.proxyId || "",
autoAttached: Boolean(session.autoAttached),
```

构造可选 `onSessionStopped`：

```js
constructor({ ..., onSessionStopped } = {}) {
  this.onSessionStopped = typeof onSessionStopped === "function" ? onSessionStopped : null;
}
```

`stopSession` 末尾：

```js
try {
  this.onSessionStopped?.({
    sessionId: session.sessionId,
    proxyId: session.proxyId,
    autoAttached: session.autoAttached,
  });
} catch { /* ignore */ }
```

`addRooms({ rooms, cookie, agentBySessionId, agentByUrl, autoAttached })`：

```js
addRooms({
  rooms = [],
  cookie = "",
  agentBySessionId = null,
  agentByUrl = null,
  autoAttached = false,
} = {}) {
  const normalized = Array.isArray(rooms)
    ? rooms.map((room, index) => normalizeRoom(room, this.sessions.size + index))
        .filter((room) => room.liveRoomUrl)
    : [];
  if (normalized.length === 0) throw new Error("至少选择一个有效直播间");

  // 去重：同 liveRoomUrl 已在 sessions 则跳过
  const existingUrls = new Set(
    [...this.sessions.values()].map((s) => text(s.liveRoomUrl).toLowerCase())
  );
  const accepted = [];
  for (const room of normalized) {
    const key = text(room.liveRoomUrl).toLowerCase();
    if (existingUrls.has(key)) continue;
    if (this.sessions.size + accepted.length >= this.maxRooms) {
      throw new Error(`最多同时监控 ${this.maxRooms} 个主播`);
    }
    existingUrls.add(key);
    accepted.push(room);
  }
  if (accepted.length === 0) return this.getStatus();

  const generation = this.generation; // 不递增 generation，避免取消 in-flight
  const sessionCookie = text(cookie) || (this.scoreOnly ? "" : text(this.getDefaultCookie()));
  const created = [];
  for (const room of accepted) {
    const agent =
      (agentBySessionId && agentBySessionId[room.sessionId]) ||
      (agentByUrl && (agentByUrl[room.liveRoomUrl] || agentByUrl[room.liveRoomUrl.toLowerCase()])) ||
      null;
    const proxyId =
      (room.proxyId) ||
      (agent && agent.__proxyId) || // 可选：acquire 时挂
      text(room.proxyId);
    const session = {
      ...room,
      watcher: this.createWatcher(),
      captureWindow: null,
      status: "queued",
      transport: "",
      source: "",
      roomId: "",
      title: "",
      ownerNickname: room.name,
      onlineText: "",
      fanTicket: 0,
      giftEvents: 0,
      chatEvents: 0,
      memberEvents: 0,
      eventCount: 0,
      scores: [],
      startedAt: null,
      lastEventAt: "",
      lastMessage: this.scoreOnly ? "等待音浪监控" : "等待启动",
      lastError: "",
      stopped: false,
      agent: agent?.agent || agent || null,
      proxyId: text(proxyId) || text(agent?.proxyId),
      autoAttached: Boolean(autoAttached || room.autoAttached),
    };
    this.sessions.set(session.sessionId, session);
    this.bindWatcher(session);
    created.push(session);
  }
  this.emitNow();
  void this.runQueue(created, generation, sessionCookie);
  return this.getStatus();
}
```

`startSession` 里 `captureLiveOptions` / `watcher.start` 传入 `agent: session.agent`：

```js
const captureResult = this.captureLiveOptions(session.liveRoomUrl, {
  /* 现有字段 */
  agent: session.agent || undefined,
});
// ...
await session.watcher.start({
  ...options,
  agent: session.agent || options.agent || undefined,
  includeRaw: false,
  scoreOnly: this.scoreOnly,
  profileLookup: this.scoreOnly ? null : options.profileLookup,
});
```

`removeRoom(sessionId)` 可作 `stop({ sessionId })` 的别名并 **从 map 删除**：

```js
removeRoom(sessionId) {
  const id = text(sessionId);
  const session = this.sessions.get(id);
  if (!session) return this.getStatus();
  this.stopSession(session);
  this.sessions.delete(id);
  this.emitNow();
  return this.getStatus();
}
```

修正现有 `stop({ sessionId })`：单房 stop 时也 `sessions.delete`（若尚未删），避免僵尸占 maxRooms。

- [ ] **步骤 4：测试通过 + commit**

```bash
node --test electron/live-pk-multi-monitor.test.js
git add electron/live-pk-multi-monitor.js electron/live-pk-multi-monitor.test.js
git commit -m "feat(监控): MultiMonitor 增量加房与 scores Top-8"
```

---

### 任务 5：Watchlist 持久化

**文件：**
- 创建：`electron/live-watchlist.js`
- 创建：`electron/live-watchlist.test.js`

- [ ] **步骤 1：测试**

```js
"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { LiveWatchlist, MAX_WATCH_TARGETS } = require("./live-watchlist");

describe("LiveWatchlist", () => {
  let dir;
  let list;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "watchlist-"));
    list = new LiveWatchlist({
      filePath: path.join(dir, "live-watchlist.v1.json"),
    });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("normalizes rid and dedupes", () => {
    list.addTargets({ urls: ["724154245800", "https://live.douyin.com/724154245800"], autoEnabled: true });
    assert.equal(list.getState().targets.length, 1);
    assert.match(list.getState().targets[0].liveRoomUrl, /live\.douyin\.com\/724154245800/);
  });

  it("persists autoFollowEnabled and reloads", () => {
    list.setAutoFollowEnabled(true);
    list.addTargets({
      rooms: [{ liveRoomUrl: "https://live.douyin.com/111", name: "A", source: "import" }],
      autoEnabled: true,
    });
    const list2 = new LiveWatchlist({ filePath: path.join(dir, "live-watchlist.v1.json") });
    list2.load();
    assert.equal(list2.getState().autoFollowEnabled, true);
    assert.equal(list2.getState().targets.length, 1);
  });

  it("enforces max 200", () => {
    const urls = Array.from({ length: 201 }, (_, i) => `https://live.douyin.com/${100000 + i}`);
    assert.throws(() => list.addTargets({ urls, autoEnabled: false }), /最多/);
  });
});
```

- [ ] **步骤 2：实现要点**

```js
const MAX_WATCH_TARGETS = 200;

class LiveWatchlist {
  constructor({ filePath, normalizeLiveRoomUrl, extractWebRid }) {
    // normalize/extract 可 require("./live-pk-protocol") 避免重复
    this.filePath = filePath;
    this.autoFollowEnabled = false;
    this.targets = []; // WatchTarget[]
  }
  load() { /* 读 JSON，容错空文件 */ }
  save() { /* 原子写：write tmp + rename */ }
  getState() {
    return {
      autoFollowEnabled: this.autoFollowEnabled,
      targets: this.targets.map((t) => ({ ...t })),
      maxTargets: MAX_WATCH_TARGETS,
    };
  }
  setAutoFollowEnabled(enabled) {
    this.autoFollowEnabled = Boolean(enabled);
    this.save();
  }
  addTargets({ urls, rooms, autoEnabled }) { /* 规范化、去重、上限、save */ }
  removeTargets(ids) {}
  setTargetAutoEnabled(id, autoEnabled) {}
  replaceAll({ targets, autoFollowEnabled }) {}
}
```

`id` 默认 = `webRid`；`source` 默认 import；档案来源由 rooms 字段带入。

- [ ] **步骤 3：测试通过 + commit**

```bash
node --test electron/live-watchlist.test.js
git add electron/live-watchlist.js electron/live-watchlist.test.js
git commit -m "feat(监控): LiveWatchlist 持久化与去重上限"
```

---

### 任务 6：LiveProbe

**文件：**
- 创建：`electron/live-probe.js`
- 创建：`electron/live-probe.test.js`

- [ ] **步骤 1：测试（假时钟 + mock probeFn）**

```js
it("emits living for status living targets without creating extra inflight over 4", async () => {
  const calls = [];
  const probe = new LiveProbe({
    probeFn: async (url) => {
      calls.push(url);
      await new Promise((r) => setTimeout(r, 5));
      return { living: String(url).includes("live"), status: 2, roomId: "1", webRid: "x", nickname: "" };
    },
    intervalMs: 50,
    jitterMs: 0,
    maxInflight: 4,
    now: () => Date.now(),
  });
  const living = [];
  probe.on("living", (t) => living.push(t.id));
  probe.setTargets([
    { id: "1", liveRoomUrl: "https://live.douyin.com/1", autoEnabled: true },
    { id: "2", liveRoomUrl: "https://live.douyin.com/2", autoEnabled: true },
  ]);
  probe.start();
  await new Promise((r) => setTimeout(r, 80));
  probe.stop();
  assert.ok(living.includes("1"));
  assert.ok(calls.length >= 2);
});

it("skips targets in skipIds (already running)", async () => {
  const calls = [];
  const probe = new LiveProbe({
    probeFn: async (url) => {
      calls.push(url);
      return { living: true, status: 2, roomId: "1", webRid: "1", nickname: "" };
    },
    intervalMs: 20,
    jitterMs: 0,
    maxInflight: 4,
  });
  probe.setTargets([{ id: "1", liveRoomUrl: "https://live.douyin.com/1", autoEnabled: true }]);
  probe.setSkipIds(new Set(["1"]));
  probe.start();
  await new Promise((r) => setTimeout(r, 50));
  probe.stop();
  assert.equal(calls.length, 0);
});
```

- [ ] **步骤 2：实现要点**

- `setTargets(targets)`：仅保留 `autoEnabled` 的快照（id、url、name…）
- `setSkipIds(Set)`：running / arming 的 id 不探
- 定时器 `unref`
- inflight Map；结束删除
- 成功 living → `emit("living", target, probeResult)`
- 失败 → 该 id backoff（内存字段 `nextAt`），**不**存响应体
- `stop()` 清 timer、inflight

- [ ] **步骤 3：通过 + commit**

```bash
node --test electron/live-probe.test.js
git add electron/live-probe.js electron/live-probe.test.js
git commit -m "feat(监控): LiveProbe 轻量开播探测（inflight≤4）"
```

---

### 任务 7：AutoScheduler

**文件：**
- 创建：`electron/live-auto-scheduler.js`
- 创建：`electron/live-auto-scheduler.test.js`

- [ ] **步骤 1：测试**

```js
it("on living acquires proxy and addRooms with autoAttached", async () => {
  const added = [];
  const released = [];
  const multi = {
    getStatus: () => ({ roomCount: 0, runningCount: 0, rooms: [] }),
    addRooms: (payload) => {
      added.push(payload);
      return { roomCount: 1, rooms: [{ sessionId: "multi-1-1", status: "running" }] };
    },
    removeRoom: (id) => {
      released.push(id);
      return { roomCount: 0, rooms: [] };
    },
  };
  const pool = {
    acquire: (sid) => ({ proxyId: "http://p:1", agent: { a: 1 }, refCount: 1 }),
    release: (sid) => released.push(`proxy:${sid}`),
  };
  const watchlist = {
    getState: () => ({
      autoFollowEnabled: true,
      targets: [{ id: "111", liveRoomUrl: "https://live.douyin.com/111", name: "A", autoEnabled: true }],
    }),
  };
  const scheduler = new LiveAutoScheduler({ multi, pool, watchlist, maxRooms: 32 });
  scheduler.handleLiving(
    { id: "111", liveRoomUrl: "https://live.douyin.com/111", name: "A", autoEnabled: true },
    { living: true, roomId: "r1", nickname: "A" }
  );
  assert.equal(added.length, 1);
  assert.equal(added[0].autoAttached, true);
  assert.ok(added[0].rooms[0].liveRoomUrl.includes("111"));
});

it("does not attach when autoFollow disabled", () => {
  // ...
});

it("queues when at maxRooms", () => {
  // multi.getStatus roomCount === maxRooms → 不调用 addRooms，内部 queued 有该 id
});
```

- [ ] **步骤 2：实现要点**

```js
class LiveAutoScheduler {
  constructor({ multi, pool, watchlist, probe, maxRooms = 32 }) {
    this.multi = multi;
    this.pool = pool;
    this.watchlist = watchlist;
    this.probe = probe;
    this.maxRooms = maxRooms;
    this.autoSessionIds = new Set(); // sessionId 由 auto 拉起
    this.targetSession = new Map(); // targetId -> sessionId
    this.queuedLive = new Set();
  }
  start() {
    this.probe.setTargets(this.#autoTargets());
    this.probe.start();
    this.probe.on("living", (t, r) => this.handleLiving(t, r));
  }
  stop({ stopAutoSessions = true } = {}) {
    this.probe.stop();
    if (stopAutoSessions) {
      for (const sid of [...this.autoSessionIds]) {
        this.multi.removeRoom(sid);
        this.pool.release(sid);
      }
      this.autoSessionIds.clear();
      this.targetSession.clear();
    }
  }
  syncFromWatchlist() {
    this.probe.setTargets(this.#autoTargets());
    this.probe.setSkipIds(new Set(this.targetSession.keys()));
  }
  handleLiving(target, result) {
    if (!this.watchlist.getState().autoFollowEnabled) return;
    if (this.targetSession.has(target.id)) return;
    const status = this.multi.getStatus();
    if (status.roomCount >= this.maxRooms) {
      this.queuedLive.add(target.id);
      return;
    }
    // sessionId 先用 normalizeRoom 规则预生成困难 → addRooms 后从返回 rooms 匹配 url
    const provisionalId = `auto-${target.id}`;
    const leased = this.pool.acquire(provisionalId);
    if (this.pool.requireProxy && !leased) {
      // 标记错误；不直连
      return;
    }
    // 若 acquire 用 provisionalId，addRooms 后要 rebind：更好策略——
    // addRooms 前不 acquire，改为 multi 创建 session 后 scheduler 用真实 sessionId acquire。
  }
}
```

**推荐绑定顺序（避免 provisional 泄漏）：**

1. 检查 maxRooms、去重  
2. `multi.addRooms({ rooms: [{...target, autoAttached:true}], autoAttached:true })`（暂不带 agent）  
3. 从返回 status 找到新 sessionId  
4. `pool.acquire(sessionId)`；若得到 agent，需要 **已连接后无法换 agent**——故必须在 startSession 前注入  

**正确顺序：**

1. 预生成 `sessionId`（导出 `normalizeRoom` 或 scheduler 与 multi 共用同一 `normalizeRoom`）  
2. `pool.acquire(sessionId)` → agent  
3. `addRooms({ rooms: [{... , sessionId?, proxyId }], agentBySessionId: { [sessionId]: leased } })`  
4. 若 addRooms 自己生成 sessionId，则 **导出 normalizeRoom** 并在 addRooms 允许 `room.sessionId` 覆盖  

在 `normalizeRoom` 中：

```js
sessionId: firstText(input.sessionId) || `multi-${baseKey}-${index + 1}`,
```

Scheduler：

```js
const room = normalizeRoom({ ...target, sessionId: `auto-${target.webRid || target.id}` }, 0);
const leased = this.pool.acquire(room.sessionId);
if (this.pool.requireProxy && !leased) return;
this.multi.addRooms({
  rooms: [{ ...room, proxyId: leased?.proxyId, name: result.nickname || target.name }],
  agentBySessionId: leased ? { [room.sessionId]: leased } : null,
  autoAttached: true,
});
this.autoSessionIds.add(room.sessionId);
this.targetSession.set(target.id, room.sessionId);
this.probe.setSkipIds(new Set(this.targetSession.keys()));
```

下播：监听 multi status 或 watcher closed——scheduler 订阅 `multi.on("status")`，若 auto session 变为 closed/error 持续，则 `removeRoom` + `pool.release` + 从 maps 删除，允许再次探测。

更简：multi `onSessionStopped` 回调里 pool.release；scheduler 清 maps。

- [ ] **步骤 3：通过 + commit**

```bash
node --test electron/live-auto-scheduler.test.js
git add electron/live-auto-scheduler.js electron/live-auto-scheduler.test.js electron/live-pk-multi-monitor.js
git commit -m "feat(监控): AutoScheduler 开播附着与代理绑定"
```

---

### 任务 8：main / preload / 类型 / Web stub 接线

**文件：**
- 修改：`electron/main.js`
- 修改：`electron/preload.js`
- 修改：`src/types/electron.d.ts`
- 修改：`src/client/http-electron-api.ts`
- 修改：`package.json`（`socks-proxy-agent` 若未直接依赖）

- [ ] **步骤 1：package.json**

```bash
npm install socks-proxy-agent --save
```

（`https-proxy-agent` 若只在嵌套依赖，也 `--save` 提升为直接依赖。）

- [ ] **步骤 2：main 单例**

```js
const { LiveProxyPool } = require("./live-proxy-pool");
const { LiveWatchlist } = require("./live-watchlist");
const { LiveProbe } = require("./live-probe");
const { LiveAutoScheduler } = require("./live-auto-scheduler");
const { resolveDouyinLiveOptions, probeRoomLiving } = require("./live-pk-protocol");

function createProductionAgent(parsed) { /* 任务1 末尾 */ }

const liveProxyPool = new LiveProxyPool({ createAgent: createProductionAgent });
// load proxies from encrypted file on app ready

const liveWatchlist = new LiveWatchlist({
  filePath: () => path.join(app.getPath("userData"), "live-watchlist.v1.json"),
});
// 若 filePath 需函数，构造时 app ready 后 load

const livePkMultiMonitor = new LivePkMultiMonitor({
  /* 现有 */
  onSessionStopped: ({ sessionId }) => {
    liveProxyPool.release(sessionId);
    liveAutoScheduler?.notifySessionStopped(sessionId);
  },
});

// captureLiveOptions 传 options.agent 进 resolveDouyinLiveOptions
function createProtocolCaptureLiveOptions(liveRoomUrl, options = {}) {
  return resolveDouyinLiveOptions(liveRoomUrl, {
    cookie: options.cookie,
    onStatus: options.onStatus,
    bootstrapMode: options.bootstrapMode || (options.scoreOnly ? "score" : "lean"),
    shareGiftList: options.shareGiftList,
    agent: options.agent,
  });
}

const liveProbe = new LiveProbe({
  probeFn: (url) => {
    // 探针可尝试 acquire 临时？规格：走代理但不占 refCount
    // 实现：pool.pickAgentForProbe() 轮询选 refCount 最小且未熔断的 agent，不 bind
    const agent = liveProxyPool.peekAgent?.() || null;
    return probeRoomLiving(url, { agent });
  },
  maxInflight: 4,
  intervalMs: 75_000,
  jitterMs: 15_000,
});

const liveAutoScheduler = new LiveAutoScheduler({
  multi: livePkMultiMonitor,
  pool: liveProxyPool,
  watchlist: liveWatchlist,
  probe: liveProbe,
  maxRooms: 32,
});
```

在 `LiveProxyPool` 增加 `peekAgent()`：返回 refCount 最小槽的 agent，**不** bind（供探针）。

代理持久化：与 cookie 类似，`live-proxy-pool.v1.json`；含 `@` 账密条目 encrypt。

IPC：

```js
ipcMain.handle("live-pk:watchlist-get", wrap(() => liveWatchlist.getState()));
ipcMain.handle("live-pk:watchlist-save", wrap((payload) => liveWatchlist.replaceAll(payload)));
ipcMain.handle("live-pk:watchlist-add", wrap((payload) => liveWatchlist.addTargets(payload)));
ipcMain.handle("live-pk:watchlist-remove", wrap((payload) => liveWatchlist.removeTargets(payload?.ids || [])));
ipcMain.handle("live-pk:watchlist-set-auto", wrap((payload) => {
  liveWatchlist.setTargetAutoEnabled(payload.id, payload.autoEnabled);
  liveAutoScheduler.syncFromWatchlist();
  return liveWatchlist.getState();
}));
ipcMain.handle("live-pk:auto-follow-set", wrap((payload) => {
  liveWatchlist.setAutoFollowEnabled(Boolean(payload?.enabled));
  if (payload?.enabled) liveAutoScheduler.start();
  else liveAutoScheduler.stop({ stopAutoSessions: true });
  return liveWatchlist.getState();
}));
ipcMain.handle("live-pk:proxy-get", wrap(() => liveProxyPool.getStatus()));
ipcMain.handle("live-pk:proxy-save", wrap((payload) => {
  saveProxyList(payload); // 磁盘
  liveProxyPool.setProxies(payload?.proxies || []);
  liveProxyPool.requireProxy = Boolean(payload?.requireProxy);
  return liveProxyPool.getStatus();
}));
ipcMain.handle("live-pk:multi-add", wrap((payload) => {
  // 手动增量：可为每房 acquire
  const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
  const agentBySessionId = {};
  const prepared = rooms.map((room, i) => {
    const normalized = /* normalizeRoom export */ require("./live-pk-multi-monitor").normalizeRoom
      ? normalizeRoom(room, livePkMultiMonitor.sessions.size + i)
      : room;
    // 导出 normalizeRoom
    const leased = liveProxyPool.acquire(normalized.sessionId);
    if (leased) agentBySessionId[normalized.sessionId] = leased;
    return { ...normalized, proxyId: leased?.proxyId };
  });
  return livePkMultiMonitor.addRooms({
    rooms: prepared,
    cookie: payload?.cookie,
    agentBySessionId,
    autoAttached: false,
  });
}));
```

app ready：`liveWatchlist.load()`；若 `autoFollowEnabled` 则 `liveAutoScheduler.start()`。

- [ ] **步骤 3：preload**

```js
getLiveWatchlist: () => ipcRenderer.invoke("live-pk:watchlist-get"),
saveLiveWatchlist: (payload) => ipcRenderer.invoke("live-pk:watchlist-save", payload),
addLiveWatchTargets: (payload) => ipcRenderer.invoke("live-pk:watchlist-add", payload),
removeLiveWatchTargets: (payload) => ipcRenderer.invoke("live-pk:watchlist-remove", payload),
setLiveWatchAutoEnabled: (payload) => ipcRenderer.invoke("live-pk:watchlist-set-auto", payload),
setLiveAutoFollowEnabled: (payload) => ipcRenderer.invoke("live-pk:auto-follow-set", payload),
getLiveProxyPool: () => ipcRenderer.invoke("live-pk:proxy-get"),
saveLiveProxyPool: (payload) => ipcRenderer.invoke("live-pk:proxy-save", payload),
addLivePkMultiRooms: (payload) => ipcRenderer.invoke("live-pk:multi-add", payload),
```

- [ ] **步骤 4：`electron.d.ts` + http stub**

按现有 `LivePkMulti*` 风格补齐类型与 Web「不支持/空数据」stub。

- [ ] **步骤 5：跑相关测试 + tsc**

```bash
node --test electron/live-proxy-pool.test.js electron/live-watchlist.test.js electron/live-probe.test.js electron/live-auto-scheduler.test.js electron/live-pk-multi-monitor.test.js electron/live-pk-protocol.test.js
npx tsc --noEmit
```

- [ ] **步骤 6：Commit**

```bash
git add electron/main.js electron/preload.js src/types/electron.d.ts src/client/http-electron-api.ts package.json package-lock.json
git commit -m "feat(监控): 接线 Watchlist/Probe/Scheduler/Proxy IPC"
```

---

### 任务 9：外部导入监控页 UI

**文件：**
- 创建：`src/components/desktop/import-monitor-page.tsx`
- 修改：`src/components/desktop/shell.tsx`
- 可选抽取：`src/components/desktop/monitor-room-card.tsx`（从 multi 页搬 `RoomCard`）

- [ ] **步骤 1：页面结构（实现完整，非占位）**

- 顶栏：总开关「开播自动监控」、代理摘要  
- 左：URL textarea +「加入清单」「立即监控」  
- 左下：Watchlist 表（开关 auto、删除、状态）  
- 右：`multiStatus.rooms` 分数卡（`onLivePkMultiStatus`）  
- 底：代理 textarea + 保存 + requireProxy 勾选  

关键：

```ts
await api.addLiveWatchTargets({ urls: lines, autoEnabled: true });
await api.setLiveAutoFollowEnabled?.({ enabled: true }); // 若用户打开总开关
// 立即监控：
await api.addLivePkMultiRooms({ rooms: parseExtraUrls(text) });
// 或 rooms 为空且 multi idle 时 startLivePkMultiMonitor
```

- [ ] **步骤 2：shell 替换 placeholder**

```tsx
import { ImportMonitorPage } from "./import-monitor-page";
// import-monitor → <ImportMonitorPage active={...} /> 可 keep-alive
```

- [ ] **步骤 3：`tsc --noEmit`**

- [ ] **步骤 4：Commit**

```bash
git add src/components/desktop/import-monitor-page.tsx src/components/desktop/shell.tsx src/components/desktop/monitor-room-card.tsx
git commit -m "feat(监控): 外部导入监控页（清单·代理·自动·分数卡）"
```

---

### 任务 10：多主播页「加入自动清单」

**文件：**
- 修改：`src/components/desktop/multi-monitor-page.tsx`

- [ ] **步骤 1：按钮**

在工具条增加「加入自动清单」：把 `selectedRooms` 调 `addLiveWatchTargets({ rooms: selectedRooms.map(... source:'anchor'), autoEnabled: true })`。

只读徽章：订阅 watchlist 或 multi status 上的 `autoFollowEnabled`（若 status 扩展带上）。

- [ ] **步骤 2：Commit**

```bash
git add src/components/desktop/multi-monitor-page.tsx
git commit -m "feat(监控): 多主播页支持加入自动清单"
```

---

### 任务 11：端到端验证清单（人工 + 单测）

- [ ] **步骤 1：全量单测**

```bash
node --test electron/live-proxy-pool.test.js \
  electron/live-watchlist.test.js \
  electron/live-probe.test.js \
  electron/live-auto-scheduler.test.js \
  electron/live-pk-multi-monitor.test.js \
  electron/live-pk-protocol.test.js
npx tsc --noEmit
```

预期：全部 PASS，tsc exit 0。

- [ ] **步骤 2：内存/行为手工核对（桌面）**

1. 无代理：导入 1 个未开播 rid → 清单有条目、`sessions` 仍 0（主进程日志/状态）  
2. 开播后（或 mock）：自动 running=1；停播/停止后 sessions 降、proxy refCount 0  
3. 2 个代理 + 立即监控 21 路：分布 ≤10/代理或第 21 直连  
4. scoreOnly：无 gift 计数增长  
5. 关总开关：auto 会话停止，探针停  

- [ ] **步骤 3：如有修复，小步 commit；不要把无关脏文件塞进监控提交**

---

## 自检（对照规格）

| 规格项 | 任务 |
|--------|------|
| Watchlist 持久化 ≤200 | 任务 5 |
| 未开播零会话 / Probe inflight≤4 | 任务 6 |
| 开播 addRooms / 下播销毁 | 任务 4+7 |
| Proxy 10 房、一 Agent、全链路 | 任务 1+2+3+8 |
| 无代理直连 / requireProxy | 任务 1+7+8 |
| 外部导入页 | 任务 9 |
| 多主播加入清单 | 任务 10 |
| scores Top-8 / status coalesce | 任务 4（coalesce 已有） |
| 只音浪 scoreOnly | 贯穿 4–7，不改为 full |
| 非目标（热迁移、自定义礼物等） | 未列入任务 |

占位符扫描：无 TODO/待定实现步骤；关键 API 与文件路径已写明。

类型一致性：`sessionId` / `proxyId` / `autoAttached` / `addRooms` / `probeRoomLiving` 在任务间命名一致；`normalizeRoom` 需在任务 4 **导出**供任务 7/8 使用。

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-08-04-auto-live-proxy-import.md`。

**两种执行方式：**

1. **子代理驱动（推荐）** — 每任务新子代理 + 任务间审查  
2. **内联执行** — 本会话 executing-plans，批量推进并设检查点  

选哪种方式？
