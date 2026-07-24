# iLink Outbox 卡住回收 + 最小 unknown reconcile 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development。可并行任务已标明。

**目标：** 在现有 Outbox 文本闭环上补两块可靠性缺口：  
1) **过期 `sending` 认领回收**（崩溃/杀进程后不永久卡死）  
2) **最小 `unknown` reconcile API**（人工/脚本把 pending unknown 标成 sent 或 dead_letter，默认**不**盲目重发）  
**不**做：媒体、Agent、完整 Web reconcile UI、宣称生产可用。

**架构：**

```text
claimBatch:
  先 reclaim 过期 sending → retry_wait（clear claim）
  再 claim prepared/retry_wait

unknown 行:
  reconcile_status=pending
  resolveUnknown({ resolution: 'sent'|'dead_letter'|'retry' })
  禁止默认自动 markSent 并重发（无上游幂等证据）
```

**技术栈：** 既有 `scripts/ilink-outbox.js` + fake pool 单测 + `bot-worker` 心跳路径。

---

## 文件结构

| 路径 | 职责 |
| --- | --- |
| 修改 `scripts/ilink-outbox.js` | reclaimExpiredClaims + resolveUnknown；claimBatch 前置 reclaim |
| 修改 `scripts/ilink-outbox.test.js` | 回收与 reconcile 用例 |
| 修改 `scripts/bot-worker.js` | 心跳里调用 reclaim（或依赖 claimBatch 内建） |
| 修改 `scripts/bot-worker.test.js` | 断言 reclaim/dispatch 不卡 |
| 修改 `docs/server-deployment.md` | 修正「无 Outbox」过时约束；说明 reclaim/reconcile |
| 修改 `package.json` | 仅当脚本需扩展时 |

---

## 并行性

| 波次 | 任务 | 可否并行 |
| --- | --- | --- |
| A | 任务1 Outbox reclaim+resolve TDD | 单实现者 |
| A' | 任务4 文档纠偏（仅 docs） | **可与 A 并行**（不同文件） |
| B | 任务2 Worker 接线 | 依赖 A |
| C | 任务3 回归脚本确认 | 依赖 A+B |

---

### 任务 1：Outbox reclaim + resolveUnknown（TDD）

**新增 API：**

```js
// 将 claim_expires_at < now 且 status='sending' 的行改回 retry_wait
await store.reclaimExpiredClaims({
  workspaceId, accountId?, // accountId 可选：缺省 workspace 范围
  now?,
  limit = 50,
})
// -> { ok:true, reclaimed:number }

// 处理 unknown + reconcile_status=pending
await store.resolveUnknown({
  workspaceId, accountId, outboxId,
  resolution: 'sent' | 'dead_letter' | 'retry',
  upstreamMessageId?, // resolution=sent 时可选
  error?,             // dead_letter/retry 说明
  delayMs?,           // retry 默认 2000
})
// -> { ok:true } | { ok:false, error, code? }
```

**claimBatch 变更：** 在 SELECT 可 claim 行之前（同事务或先独立调用）执行 reclaimExpiredClaims for 该 account。测试可只测显式 reclaim + claim 组合。

**reclaim SQL 语义：**

```sql
UPDATE outbox_messages
SET status='retry_wait',
    next_attempt_at = now,
    last_error = COALESCE(last_error, 'claim expired'),
    claimed_by=NULL, claim_token=NULL, claim_expires_at=NULL
WHERE workspace_id=?
  AND (? account filter)
  AND status='sending'
  AND claim_expires_at IS NOT NULL
  AND claim_expires_at < now
LIMIT ?
```

MySQL UPDATE 无 LIMIT 时用主键子查询或逐条；实现可用：

```sql
UPDATE outbox_messages
SET ...
WHERE id IN (
  SELECT id FROM (
    SELECT id FROM outbox_messages WHERE ... LIMIT ?
  ) t
)
```

或 fake 支持简单 UPDATE ... AND claim_expires_at < ?。

**resolveUnknown：**

- 仅当 status=`unknown` 且 reconcile_status=`pending`
- `sent` → status=sent, reconcile_status=resolved, sent_at=now, optional upstream_message_id
- `dead_letter` → status=dead_letter, reconcile_status=resolved
- `retry` → status=retry_wait, reconcile_status=not_required, next_attempt_at=now+delay（**允许再次 claim 发送**——仅人工选择）

**测试：**

1. 手动插入 sending + 过期 claim_expires → reclaim → retry_wait → claimBatch 可再拿到  
2. reclaim 未过期 sending 不动  
3. resolveUnknown sent / dead_letter / retry  
4. resolve 非 unknown 行 → ok:false  

- [ ] commit `feat: reclaim expired outbox claims and resolve unknown rows`

---

### 任务 2：Worker 接线

- `dispatchOutboxOnce` 开头：`await outboxStore.reclaimExpiredClaims({ workspaceId, accountId })`（若 API 存在）  
- 状态可选 `outboxReclaimed` 计数（YAGNI 可只 lastError/日志）  
- 测试：mock outboxStore.reclaimExpiredClaims 在 dispatch 被调用  

- [ ] commit `feat: reclaim expired outbox claims before dispatch`

---

### 任务 3：文档纠偏 + 脚本

- 删除/改写 `docs/server-deployment.md` 中「无 Outbox 发送与 reconcile」旧约束  
- 写明：  
  - reclaim 过期 sending  
  - unknown 需 `resolveUnknown`（CLI/未来 API），默认不自动重发  
- `npm run test:bot-worker` / `test:ilink-db` 全绿  

- [ ] commit `docs: document outbox reclaim and unknown resolve`

---

### 任务 4（并行文档，可先做）

仅修部署文档漂移，不改代码逻辑；可与任务 1 并行。

---

## 边界

| 做 | 不做 |
| --- | --- |
| reclaim expired sending | 自动对 unknown 重发 |
| resolveUnknown 三态 | Web reconcile UI |
| 文档与测试 | 媒体/Agent |

## 验证

```bash
npm run test:ilink-db
npm run test:bot-worker
```
