# 开播自动监控 · 代理池 · 外部导入 — 设计规格

> 状态：已批准（2026-08-04）  
> 前置：多主播协议并行 + `scoreOnly` 音浪监控已落地  
> 范围：桌面 Electron；不改微信/QQ 通道形态

## 1. 目标

在现有「多主播只监控音浪」底座上，交付三件能力：

1. **开播自动监控**：用户开启后，清单内目标探测到开播即挂音浪监控；下播释放。
2. **代理全链路**：HTTP 进房 + WSS 推送均走代理；约 **10 个活跃房 / 1 个代理**。
3. **外部导入**：直播间 URL / web_rid 导入，填满「外部导入监控」页，与自动/多主播共用引擎。

### 1.1 非目标

- 自定义礼物/弹幕可选监控任务（已搁置）
- PK 单房页、采集页产品大改
- 代理自动采购/爬取
- 服务器 `bot-worker` 同款跟播
- 浏览器 Web 模式真实监控
- running 房在代理间**热迁移**（默认不做）

## 2. 内存硬约束（不可破）

| 规则 | 含义 |
|------|------|
| **未开播 = 零会话** | Watchlist 仅轻量元数据；不开 `LivePkWatcher`、不开 WSS |
| **只音浪** | 自动 / 导入 / 多主播统一 `scoreOnly` + `bootstrapMode: "score"` |
| **下播即毁** | `watcher.stop()` + 从 `sessions` 删除 + 代理 `refCount--`；禁止僵尸会话 |
| **代理按池复用** | 每个代理**一个** `Agent` 实例；禁止每房/每请求 `new Agent` |
| **探针无载荷滞留** | `enter` 只读 status/room_id；响应用完即丢 |
| **状态卡有界** | 每房 scores 最多 Top **8**；status 推送维持现有 ~250ms coalesce |
| **清单可大、会话必小** | Watchlist ≤ **200**；同时 running ≤ **maxRooms(32)** |
| **探针 inflight** | ≤ **4**，与进房 `captureConcurrency` 分槽 |

资源模型：

```
Watchlist N 条（字符串+开关）     ≈ KB 级
LiveProbe  inflight ≤ 4           短生命周期
Running    ≤ 32 × scoreOnly       主要内存/句柄
ProxyPool  M 个 agent             与房数解耦，一代理一实例
```

## 3. 架构

```
[档案勾选 · 多主播页]   [URL 粘贴 · 外部导入页]
           \                     /
            ↘                 ↙
              Watchlist（持久化）
                     │
              autoEnabled 目标
                     │
                 LiveProbe ──(status===2)──► AutoScheduler
                     │                            │
              慢轮询未开播                   ProxyPool.acquire
                     │                            │
                     │                     MultiMonitor.addRooms
                     │                     (scoreOnly + agent)
                     │                            │
                     ◄──────── 下播/错误 ─ destroy + release
```

**唯一 running 执行器**：现有 `LivePkMultiMonitor`（扩展增量加房）。  
不复制第二套 watcher 池。

### 3.1 主进程模块

| 模块 | 职责 |
|------|------|
| `electron/live-watchlist.js` | 清单读写、URL 规范化、去重 |
| `electron/live-proxy-pool.js` | 代理解析/持久化、acquire/release、熔断 |
| `electron/live-probe.js` | watched 目标轻量 `room/web/enter` 轮询 |
| `electron/live-auto-scheduler.js` | 总开关、开播附着、下播回收 |
| `electron/live-pk-multi-monitor.js` | **扩展** `addRooms` / `removeRoom`；传入 `agent` |
| `electron/live-pk-protocol.js` | HTTP 请求接受 per-call `agent` |
| `electron/live-pk-watcher.js` | `WebSocket(url, { headers, agent })` |

main 内各单例一份：Watchlist、ProxyPool、Probe、Scheduler、MultiMonitor。

## 4. Watchlist

### 4.1 条目形状

```ts
type WatchTarget = {
  id: string;                  // 稳定 id（优先 webRid，冲突时 personId+rid）
  liveRoomUrl: string;         // https://live.douyin.com/{rid}
  webRid: string;
  name: string;
  source: "anchor" | "import";
  personId?: string;
  anchorId?: string;
  douyinNo?: string;
  autoEnabled: boolean;
  createdAt: string;
  // 运行态不落盘
};
```

- 路径：`app.getPath("userData")/live-watchlist.v1.json`
- **不存**：scores、cookie、ws 状态、enter 整包
- 上限：**200**；超出拒绝新增并提示
- 去重键：规范化后的 `liveRoomUrl`（同一 rid 一条；档案来源可补全 name/personId）

### 4.2 总开关

- `autoFollowEnabled: boolean`（与清单同文件或并列字段）
- **关闭时**：停探针；**默认优雅停止**由自动逻辑拉起的 running 会话
- 手动「立即监控」批次不受总开关阻止（用户显式开始）

## 5. 自动跟播状态机

```
[listed]     autoEnabled=false → 仅清单，零网络
    │
[watched]    进入探针队列（无 watcher）
    │ enter 得 status===2
[arming]     申请并发槽 + 代理 → protocol score 进房
    │
[running]    scoreOnly WSS；scores 截断 Top-8
    │ 下播 / 断连失败 / re-enter 非 living
[watched]    销毁 session，release 代理，回探针（backoff）
```

### 5.1 LiveProbe

- 对象：`autoEnabled && 非 running` 的目标
- 手段：复用协议 `room/web/enter`（可与 score 路径共用 ttwid 获取逻辑），**只读** `room.status` / `room_id` / 展示名
- 开播判定：与现捕获一致，**`status === 2` 视为 living**（其它非 0 状态可记录但不附着）
- 并发：**≤ 4**
- 间隔：
  - 基线 **75s ± 15s** 抖动
  - 刚从 running 回到 watched：从 **30s** 指数回到 75s
  - 连续失败：退避至 **3–5 min**
- inflight：`id → 超时句柄`；结束即删；**无**探测历史数组

### 5.2 附着与满载

- `runningCount < maxRooms(32)` → `MultiMonitor.addRooms([target], { agent })`
- 已满 → 目标 `queued-live`；有空槽时优先消费「已确认开播」队列

### 5.3 下播 / 销毁触发

任一条即 `removeRoom` + `ProxyPool.release`：

1. 协议房间结束类 IM（若可得）
2. WSS 断开且短侧重连失败
3. running 期间低频 re-enter（建议 5–10 min）发现非 living

## 6. MultiMonitor 必要扩展

今日 `start()` 会清空再起，**不能**直接用于自动附着。

必须新增：

- **`addRooms(rooms, { cookie?, agentsBySession? })`**  
  - 不 `stop` 已有 session  
  - 仍受 `maxRooms` 约束  
  - 新房走同一 `runQueue` / scoreOnly 路径  
  - 每房可带 `agent`（来自 ProxyPool）
- **`removeRoom(sessionId)`**（可复用/对齐现有 `stop({ sessionId })`）  
  - 必做：watcher stop、sessions delete、可选回调 release proxy
- **scores 写入截断 Top-8**（按 score 降序），降低 IPC/UI 载荷
- status 增加可选字段：`autoAttached?: boolean`、`proxyId?: string`（无密钥）

手动「开始」与自动附着**共享** `maxRooms` 与 ProxyPool。

## 7. ProxyPool

### 7.1 来源与存储

- 用户粘贴列表，支持：
  - `http://host:port` / `https://host:port`
  - `http://user:pass@host:port`
  - `socks5://host:port` / `socks5://user:pass@host:port`
- 路径：`userData/live-proxy-pool.v1.json`
- 含账密的条目：`safeStorage.encryptString`（与 live cookie 同模式）
- 列表为空：**全直连**（兼容现网）
- UI 提示代理条数建议 ≤ **50**
- 可选 **`requireProxy`**（默认 **false**）：为 true 且无可用代理时房间报错、不直连

### 7.2 槽位模型

```ts
type ProxySlot = {
  id: string;
  raw: string;
  kind: "http" | "https" | "socks5";
  agent: import("http").Agent; // 或 socks agent
  refCount: number;            // 仅计 running 会话
  roomIds: Set<string>;        // sessionId
  failCount: number;
  disabledUntil: number;
  lastError?: string;
};
```

| 规则 | 值 |
|------|-----|
| 每代理最大 running | **10**（`ROOMS_PER_PROXY`） |
| Agent / 代理 | **恰好 1**，keepAlive；`maxSockets` 建议 ≤ 16 |
| 探针 | **走同一 agent**，**不**增加 refCount（不占 10 名额） |
| 分配 | 过滤未熔断且 `refCount < 10`，选 refCount 最小 |
| 释放 | session 结束 `refCount--`；refCount=0 **不立刻** destroy（保留 keep-alive） |
| destroy 时机 | 用户删除代理、池重置、进程退出 |

撑满 32 房理论最少代理数：`ceil(32/10) = 4`。

### 7.3 全链路挂点

```
ProxyPool.acquire(sessionId)
  → agent | null(直连)

resolveDouyinLiveOptions(url, { agent, bootstrapMode: "score", ... })
  → ttwid / enter / linkmic 全部 request 带 agent
  → 返回 options 含 agent 引用（同一对象）

LivePkWatcher.start({ ..., agent, scoreOnly: true })
  → new WebSocket(cleanUrl, { headers, agent })  // ws@8
```

- **禁止**在热路径每次 `new HttpsProxyAgent(url)`
- HTTP(S) 代理：复用已有 `https-proxy-agent`（或等价）
- SOCKS：实现时将 `socks-proxy-agent` 写入 dependencies（若尚未直接依赖）

### 7.4 熔断

| 事件 | 行为 |
|------|------|
| 单房失败 | 房级 backoff；不整池重试风暴 |
| 同代理短窗连续失败 ≥ 3 | `disabledUntil = now + 5min` |
| 明显代理层错误（ECONNREFUSED / 407 等） | 可加速熔断 |
| 默认 | **不**自动把 running 房热迁到其它代理 |
| 用户删代理 | 先 stop 或释放绑定会话，再 `agent.destroy()` |

## 8. 外部导入与页面分工

### 8.1 外部导入监控页（替换 placeholder）

- 多行 URL / 纯数字 web_rid（规则对齐现 `parseExtraUrls`）
- **加入清单**（可勾选 `autoEnabled`）
- **立即监控**（直接 `addRooms` / 或空池时 `start`，不依赖总开关）
- 清单表：名称、rid、来源、自动开关、状态、删除
- 实时区：复用多主播分数卡组件（可抽 `RoomCard`）
- **无 Cookie UI**
- 代理列表编辑 + 总开关「开播自动监控」放本页（或本页为主编辑入口）

### 8.2 多主播监控页

- 保留档案多选 + 立即开始
- 增加「加入自动清单」
- 只读展示自动总开关与代理摘要（避免两处编辑代理列表）

### 8.3 状态文案

`未开播` / `探测中` / `排队开播` / `进房中` / `运行中` / `错误` / `代理不可用` / `已直连`

## 9. IPC

```
// Watchlist
getLiveWatchlist()
saveLiveWatchlist({ targets, autoFollowEnabled })
addLiveWatchTargets({ urls?: string[], rooms?: LivePkMultiRoomInput[], autoEnabled?: boolean })
removeLiveWatchTargets({ ids: string[] })
setLiveWatchAutoEnabled({ id, autoEnabled })
setLiveAutoFollowEnabled({ enabled })

// Proxy
getLiveProxyPool()
  // data: { proxies: PublicProxyRow[], requireProxy, roomsPerProxy: 10 }
saveLiveProxyPool({ proxies: string[], requireProxy?: boolean })

// Multi 扩展
addLivePkMultiRooms({ rooms, /* 可选继承 scoreOnly */ })
// 已有 start/stop/get/on status；status 可带 watch/proxy 摘要

// 推送
onLivePkMultiStatus  // 扩展：autoFollowEnabled、watchSummary、proxySummary、room 附加字段
```

- preload + `src/types/electron.d.ts` + `http-electron-api` Web stub 同步
- Web stub：监控类返回不支持/空闲结构（与现 multi 一致）

## 10. 错误处理

| 场景 | 用户可见 | 系统 |
|------|----------|------|
| 非法 URL/rid | 该行拒绝 | 不入清单 |
| 未开播 | 「未开播」 | 仅探针 |
| running 已满 | 「等待空闲槽」 | queued-live |
| 单房进房失败 | lastError | 不杀其它房 |
| 无代理且非强制 | 「已直连」 | 直连 agent=null |
| 强制代理且无槽 | 错误 | 不直连 |
| 代理保存/解密失败 | 明确错误 | 不写半份文件 |

## 11. 测试计划

1. **Watchlist**：规范化、去重、200 上限、磁盘 round-trip  
2. **Probe**：mock enter `status` 0/2；inflight≤4；未开播 `sessions.size===0`  
3. **Scheduler**：开播 → addRooms；下播 → remove + release；满载排队  
4. **ProxyPool**：21 房 + 2 代理 → 10/10，第 21 直连或排队（视 requireProxy）；同一 agent 引用；release 后 refCount；熔断 `disabledUntil`  
5. **Protocol/Watcher**：`options.agent` 进入 request 与 `WebSocket` 构造（mock）  
6. **Multi**：`addRooms` 不停止已有 running；scoreOnly 仍忽略 gift/chat/member  
7. **内存断言**：下播后 sessions 减少、proxy refCount 下降；scoreOnly 下无 giftCatalog 膨胀

## 12. 实现顺序

1. ProxyPool + protocol/watcher 接受 `agent`（可单测、可直连回归）  
2. MultiMonitor：`addRooms` / scores Top-8 / status 附加字段  
3. Watchlist 持久化 + IPC  
4. LiveProbe + AutoScheduler  
5. 外部导入页 UI + 多主播「加入清单」  
6. 代理 UI 与 safeStorage  

每步保持：未开播零会话、scoreOnly、代理单例复用。

## 13. 与现有文档关系

- `2026-08-04-pk-monitor-split-design.md` 中「多主播 / 外部导入为 phase-2 占位」：**多主播 UI 已实现**；本规格覆盖**自动跟播、代理、外部导入实装**。
- 冲突时：**本文件 + 运行代码 > 过期 phase 表述**。

## 14. 批准记录

- 方案：统一 Watchlist + Probe + Scheduler + Multi(scoreOnly) + ProxyPool（方案 A）
- §1 目标与内存原则：通过  
- §2 Watchlist / 自动 / 导入：通过  
- §3 ProxyPool 全链路 10 房：通过  
- §4 IPC/UI/测试/非目标：通过  
- 附加约束：用户明确要求 **确保不浪费内存占用** → 已写入第 2 节硬约束并贯穿各模块
