# iLink Outbox 文本发送 + fencing 校验 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 DB 模式（lease + Inbox/Cursor 已接线）下，把出站文本从「transport 直接 `sendMessage`」改为 **Outbox 落库 → Dispatcher 校验 fencing → 再发 iLink**；失败可区分 `retry_wait` / `unknown`。**不**做媒体、reconcile 全量、Agent。

**架构：**

```text
入站 getUpdates
  -> persistBatch (Inbox+Cursor 同事务)   [已有]
  -> onText 生成回复文案
  -> DB 模式: enqueue outbox (prepared)     [本切片]
     非 DB: 仍直接 sendText                 [保持]
  -> outbox dispatcher 循环:
       claim prepared row (FOR UPDATE)
       校验 bot_runner_leases.fencing_token
       sendMessage
       mark sent | unknown | retry_wait
```

**技术栈：** Node CJS、`mysql2` fake 单测、`scripts/ilink-crypto` 加密 payload/context_token。

---

## 文件结构

| 路径 | 职责 |
| --- | --- |
| 创建 `scripts/ilink-outbox.js` | enqueueText / claimBatch / markSent / markUnknown / markRetry |
| 创建 `scripts/ilink-outbox.test.js` | 内存 fake pool 单测 |
| 修改 `scripts/ilink-text-transport.js` | 可选 `sendOutbound` 钩子；默认仍 sendText |
| 修改 `scripts/bot-worker.js` | DB 模式：outbox enqueue + dispatch 循环 |
| 修改 `scripts/bot-worker.test.js` | 注入 outboxStore 断言 enqueue/dispatch |
| 修改 `package.json` | test:ilink-db / test:bot-worker 纳入 outbox 测 |
| 修改 `docs/server-deployment.md` | Outbox 行为脚注 |

---

## 配置

沿用 `BOT_ILINK_DB_ENABLED`；新增可选：

| 变量 | 含义 |
| --- | --- |
| `BOT_ILINK_OUTBOX_POLL_MS` | Dispatcher 轮询间隔，默认 500 |
| `BOT_ILINK_OUTBOX_BATCH` | 每次 claim 条数，默认 10 |

状态字段扩展：

- `outboxPending: number`（可选 best-effort）
- `lastOutboxAt: string | null`
- `outboxSentCount: number`

---

### 任务 1：Outbox 模块 TDD

**API：**

```js
const { createOutboxStore } = require("./ilink-outbox");
const store = createOutboxStore({ pool, crypto, now });

// enqueue 文本回复（不访问网络）
await store.enqueueText({
  workspaceId, accountId, sessionId, fencingToken,
  clientId,              // 稳定；调用方生成一次
  replyToInboxId?,       // optional
  toUserId, groupId?, contextToken, text,
  dedupeKey?,            // optional sha256
})
// -> { ok:true, outboxId } | { ok:false, error, code:'FENCING_MISMATCH'|'DUP_CLIENT'|'ERROR' }

// claim 待发
await store.claimBatch({
  workspaceId, accountId, ownerId, fencingToken, limit
})
// -> { ok:true, rows: [{ id, clientId, payload: {toUserId,groupId,contextToken,text}, fencingToken, attemptCount, maxAttempts }] }
// 将 status prepared/retry_wait -> sending, set claimed_by/claim_token/claim_expires

// 发送结果
await store.markSent({ workspaceId, accountId, outboxId, claimToken, upstreamMessageId? })
await store.markUnknown({ workspaceId, accountId, outboxId, claimToken, error })
await store.markRetry({ workspaceId, accountId, outboxId, claimToken, error, delayMs })
// fencing 失效：markDead 或 markRetry 不再发送 — markFailedFencing
await store.markFailedFencing({ workspaceId, accountId, outboxId, claimToken, error })
```

**enqueue 语义：**

1. BEGIN  
2. SELECT lease FOR UPDATE；fencing 不匹配 → FENCING_MISMATCH  
3. encrypt payload JSON `{ toUserId, groupId, contextToken, text }`；context_token 可单独 ciphertext 或放 payload  
4. INSERT outbox status=`prepared`, message_type=`text`, fencing_token=当前 fencing, client_id 唯一  
5. COMMIT  

**claim 语义：**

1. SELECT ... WHERE status IN ('prepared','retry_wait') AND next_attempt_at <= now AND account 匹配 ORDER BY id LIMIT n FOR UPDATE  
2. UPDATE status=sending, claimed_by, claim_token=uuid, claim_expires_at=now+30s, attempt_count+1  
3. decrypt payload 返回  

**markSent：** status=sent, sent_at=now, clear claim  
**markUnknown：** status=unknown, unknown_at=now, reconcile_status=pending（ADR 超时不确定）  
**markRetry：** status=retry_wait, next_attempt_at=now+delay, last_error  
**markFailedFencing：** status=dead_letter, last_error  

**测试：**

1. enqueue 成功  
2. fencing 错 → fail 不插行  
3. 同 client_id 再 enqueue → DUP_CLIENT 或 ok 返回已有 id（选 **ok:false code DUP_CLIENT**）  
4. claim 返回行并变 sending  
5. markSent  
6. markRetry 后可再 claim  

- [ ] commit `feat: add iLink text outbox store with fencing checks`

---

### 任务 2：Transport 出站钩子

修改 `createIlinkTextTransport`：

```js
// options.sendOutbound?.({ toUserId, contextToken, groupId, text }) 
// 若提供：替代 adapter.sendMessage 路径；仍更新 sentCount
// 若未提供：保持现有 sendText → adapter.sendMessage
```

单测：

1. 注入 sendOutbound 被调用且 adapter.sendMessage 不被调用  
2. 无钩子行为不变  

- [ ] commit `feat: allow iLink transport to delegate outbound text`

---

### 任务 3：Worker 接线 Outbox + Dispatcher

DB 模式：

1. `dbRuntime.outboxStore` 注入；生产懒建 `createOutboxStore`  
2. transport `sendOutbound`：  
   - `clientId = worker-${uuid}`  
   - `outboxStore.enqueueText({..., fencingToken, ownerId, ...})`  
   - 失败 throw（transport 记 lastError；ack 未真正发出）  
3. `startOutboxDispatcher()`：  
   - setInterval / 循环 claimBatch → 对每行：  
     - 再校验当前 worker fencingToken === row.fencingToken（或 claim 内已校验 lease）  
     - `adapter.sendMessage` / 注入 `sendMessage`  
     - 成功 markSent；抛 Abort/timeout 类 markUnknown；业务错 markRetry  
   - lease_lost / stop 时清 dispatcher  
4. 非 DB：无 outbox  

测试（注入）：

1. sendOutbound enqueue 被调用  
2. dispatcher claim + sendMessage + markSent  
3. fencing 变化后 markFailedFencing 不发送  

- [ ] commit `feat: wire bot-worker outbox text dispatcher in DB mode`

---

### 任务 4：脚本与文档

- `test:ilink-db` / `test:bot-worker` 加入 outbox 测  
- `docs/server-deployment.md`：DB 模式出站经 Outbox；仍非生产  
- 全绿 commit `test+docs: cover iLink outbox text dispatch`

---

## 边界

| 做 | 不做 |
| --- | --- |
| 文本 Outbox prepared→sending→sent/unknown/retry | 图片/文件 |
| enqueue 时 fencing 校验 | 完整 reconcile 流程 UI |
| claim + send | 多账号调度器拆分 |
| DB 模式默认走 Outbox | 改桌面 Electron 主链 |

---

## 验证

```bash
npm run test:ilink-db
npm run test:bot-worker
```

手动（有 MySQL + token）：

1. migrate up  
2. DB+transport 开  
3. 私聊 → inbox 有行 → outbox sent → 微信收到 ack  
4. 杀 worker 中途：prepared/sending 可观察；不宣称 exactly-once  
