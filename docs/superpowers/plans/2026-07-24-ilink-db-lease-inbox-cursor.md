# iLink DB Lease + Inbox/Cursor 接线 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在已有 `scripts/ilink-text-transport.js` + `bot-worker` 文本闭环之上，把 `001_ilink_runtime` 的 **DB 账号租约（fencing）** 与 **Inbox+Cursor 同事务** 接到运行链路；默认仍可关闭（文件锁 + 内存游标）。**不**做 Outbox Dispatcher、媒体 Artifact、Agent Core、二维码控制面。

**架构：** 三个可注入的纯模块 + Worker/Transport 可选接线：

1. `scripts/ilink-crypto.js` — 开发级加解密（AES-256-GCM + `BOT_RUNTIME_SECRET`；测试可注入 plain codec）
2. `scripts/ilink-db-lease.js` — 对 `bot_runner_leases`（依赖 `ilink_accounts` 行）做 acquire/renew/release，返回 `fencingToken`
3. `scripts/ilink-inbox-cursor.js` — 单事务：校验 fencing → upsert cursor → insert inbox（dedupe 冲突仅推进 cursor）
4. `bot-worker` / `ilink-text-transport` — 开关 `BOT_ILINK_DB_ENABLED=1` 时用 DB lease 替代文件锁，poll 成功后写 Inbox+Cursor

**技术栈：** Node CommonJS、`mysql2/promise`、`node:test`（fake db / 事务 mock）、现有 `electron/db-config.js`。

**范围边界：**

| 做 | 不做 |
| --- | --- |
| DB lease acquire/renew/release + fencing 递增 | 跨主机文件锁废弃强制（默认双模式） |
| 文本入站 Inbox + Cursor 同事务 | Outbox 发送 / reconcile |
| payload/cursor 开发级加密字段 | 生产 KMS / 凭据库扫码 |
| Worker 可选 `persistence: "mysql"` | 宣称生产可用 / 72h |
| 纯单测（mock connection） | 强制真实 MySQL CI（可选说明手工） |

---

## 文件结构

| 路径 | 职责 |
| --- | --- |
| 创建 `scripts/ilink-crypto.js` | encrypt/decrypt/hash helpers |
| 创建 `scripts/ilink-crypto.test.js` | roundtrip + bad tag |
| 创建 `scripts/ilink-db-lease.js` | ensureAccount + acquire/renew/release |
| 创建 `scripts/ilink-db-lease.test.js` | fencing 与抢占语义（fake db） |
| 创建 `scripts/ilink-inbox-cursor.js` | stageTextMessage 事务 |
| 创建 `scripts/ilink-inbox-cursor.test.js` | 成功 / dedupe / fencing 失败 |
| 修改 `scripts/ilink-text-transport.js` | 可选 `onBatchCommitted` / `persistHooks` |
| 修改 `scripts/bot-worker.js` | DB lease 模式 + persistence 字段 |
| 修改 `scripts/bot-worker.test.js` | DB 模式注入 mock |
| 修改 `package.json` | test 脚本纳入新测 |
| 修改 `docs/server-deployment.md` | env 与「仍非完整 B4」说明 |

---

## 配置契约（冻结）

| 变量 | 含义 |
| --- | --- |
| `BOT_ILINK_DB_ENABLED` | `1` 启用 MySQL lease + Inbox/Cursor |
| `BOT_ILINK_WORKSPACE_ID` | 默认 `default` |
| `BOT_ILINK_ACCOUNT_KEY` | 业务账号键；缺省用 `BOT_ILINK_ACCOUNT_ID` 或 `env-token` |
| `BOT_RUNTIME_SECRET` | ≥16 字符；加密 cursor/payload；缺省时 DB 模式启动 fail closed |
| 既有 `DB_*` | 与 `resolveDbConfig` 相同 |
| 既有 `BOT_ILINK_*` | 文本 transport 不变 |

状态字段：

- `persistence: "not_connected" | "mysql"`  
  - DB 模式且 lease 成功 → `"mysql"`  
  - 否则保持 `"not_connected"`
- 新增可选：`fencingToken: number | null`、`dbAccountId: number | null`

---

### 任务 1：Crypto 模块 TDD

**文件：**
- 创建：`scripts/ilink-crypto.js`、`scripts/ilink-crypto.test.js`

- [ ] **步骤 1：失败测试**

```js
"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntimeCrypto } = require("./ilink-crypto");

test("encrypt/decrypt roundtrip", () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const sealed = cryptoApi.encrypt("hello-cursor");
  assert.equal(sealed.keyId, "v1");
  assert.ok(sealed.ciphertext.includes("."));
  assert.equal(cryptoApi.decrypt(sealed.ciphertext, sealed.keyId), "hello-cursor");
});

test("sha256Hex stable", () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  assert.equal(cryptoApi.sha256Hex("a"), cryptoApi.sha256Hex("a"));
  assert.equal(cryptoApi.sha256Hex("a").length, 64);
});

test("rejects short secret", () => {
  assert.throws(() => createRuntimeCrypto({ secret: "short" }), /BOT_RUNTIME_SECRET/);
});
```

- [ ] **步骤 2：跑测确认 FAIL** → `node --test scripts/ilink-crypto.test.js`

- [ ] **步骤 3：最少实现**

`createRuntimeCrypto({ secret })`：
- secret trim 后 length < 16 → throw
- `encrypt(plain)` → `{ ciphertext: base64(iv)+"."+base64(tag)+"."+base64(data), keyId: "v1" }` AES-256-GCM，key = scrypt(secret, "ilink-runtime-v1", 32)
- `decrypt(ciphertext, keyId)`
- `sha256Hex(text)` → hex

- [ ] **步骤 4：PASS** → commit  
`feat: add runtime crypto helper for iLink DB fields`

---

### 任务 2：DB Lease 模块 TDD

**文件：**
- 创建：`scripts/ilink-db-lease.js`、`scripts/ilink-db-lease.test.js`

**API：**

```js
createDbLeaseStore({ pool, crypto }) // pool.query / pool.getConnection
// store.ensureAccount({ workspaceId, accountKey, apiBaseUrl }) -> { accountId }
// store.acquire({ workspaceId, accountId, ownerId, leaseName, ttlMs })
//   -> { ok, fencingToken, expiresAt } | { ok:false, error }
// store.renew({ workspaceId, accountId, ownerId, leaseName, fencingToken, ttlMs })
// store.release({ workspaceId, accountId, ownerId, leaseName, fencingToken })
```

**语义（对齐 ADR）：**

1. `ensureAccount`：`INSERT ... ON DUPLICATE KEY UPDATE` by `(workspace_id, account_key)`，返回 numeric `id`
2. `acquire`：
   - 若无行：INSERT owner + fencing_token=1 + expires
   - 若有行且 expires 已过或 owner 空：条件 UPDATE 抢占，`fencing_token = fencing_token + 1`
   - 若有效租约属他人：`ok:false`
   - 若属自己：等同 renew
3. `renew`：必须 `owner_id` + `fencing_token` 匹配且未过期，否则 fail
4. `release`：匹配 owner+fencing 时清空 owner、expires=null（**不**回退 fencing）

- [ ] **步骤 1：用内存 fake SQL 适配器写测**（记录 statements / 可编程 rows）

最小测例：
1. ensureAccount 插入后返回 id  
2. acquire 空表成功 fencing=1  
3. 第二 owner 在未过期时 acquire 失败  
4. 过期后第二 owner acquire 成功 fencing=2  
5. renew 错误 fencing 失败  
6. release 后他人可 acquire  

Fake 不必完整 SQL 解析：注入 `db = { async query(sql, params) {...} }` 由测试实现状态机。

- [ ] **步骤 2–4：实现 / 绿 / commit**  
`feat: add MySQL bot runner lease with fencing token`

---

### 任务 3：Inbox+Cursor 同事务 TDD

**文件：**
- 创建：`scripts/ilink-inbox-cursor.js`、`scripts/ilink-inbox-cursor.test.js`

**API：**

```js
createInboxCursorStore({ pool, crypto })
// stageTextBatch({
//   workspaceId, accountId, sessionId, fencingToken,
//   updatesBuf, // next cursor plain
//   messages: [{ upstreamMessageId, fromUserId, groupId, contextToken, text, receivedAt? }]
// }) -> { ok, inserted, deduped, cursorHash } | { ok:false, error, code: 'FENCING_MISMATCH' }
```

**事务步骤：**

1. `BEGIN`
2. 读 `bot_runner_leases` 当前 `fencing_token`+`owner`（或由调用方传入并 `SELECT ... FOR UPDATE` 校验相等）
3. 对每条 message：
   - `dedupe_key = sha256(accountId + ":" + upstreamMessageId || canonical)`
   - `INSERT inbox`（payload 加密 JSON：text/from/context/group）；冲突 → deduped++
4. Upsert `ilink_update_cursors`：写加密 cursor、hash、`fencing_token` 列同步为当前 fencing
5. `COMMIT`；失败 rollback

单测：
1. 空 inbox 插入 1 条 + cursor  
2. 重复 dedupe_key → inserted=0 deduped=1 仍更新 cursor  
3. fencing 不匹配 → ok false 不写 inbox  

- [ ] 实现 / 绿 / commit  
`feat: stage iLink text inbox with cursor in one transaction`

---

### 任务 4：Transport 钩子

**文件：**
- 修改：`scripts/ilink-text-transport.js`、`.test.js`

在 poll 成功处理完本批消息、**推进内存 cursor 之前/同时**：

```js
if (typeof options.persistBatch === "function") {
  await options.persistBatch({
    updatesBuf: nextBuf,
    messages: stagedMeta, // 本批已 handle 的文本元数据
  });
}
```

规则：
- `persistBatch` throw → **不**更新内存 cursor（保持可重试）；记 lastError
- 无 hook → 行为与现网一致
- 单测：hook 失败时 cursor 不前进；成功时前进

- [ ] commit  
`feat: allow iLink text transport to persist inbox batches`

---

### 任务 5：Worker 接线 DB 模式

**文件：**
- 修改：`scripts/bot-worker.js`、`.test.js`

当 `BOT_ILINK_DB_ENABLED`（或 `options.dbRuntime`）开启：

1. `resolveDbConfig` + `mysql.createPool`
2. `ensureAccount` + `acquire` DB lease（**可与文件锁并存**：DB 模式优先；文件锁仍可作本机互斥可选，本切片 **DB 模式跳过文件锁** 以免双语义，测试注入 `runnerLock: null` 路径）
3. heartbeat → `renew` DB；失败 → lease_lost + stop transport
4. stop → `release` DB
5. 创建 transport 时注入 `persistBatch` → `stageTextBatch`
6. `persistence: "mysql"`，写入 `fencingToken`

未开启 DB：完全保持当前文件锁行为。

测试：注入 fake `dbRuntime` 对象，不断言真实 MySQL。

- [ ] commit  
`feat: optional MySQL lease and inbox persistence for bot-worker`

---

### 任务 6：脚本与文档

- [ ] `package.json`：`test:bot-worker` 或新增 `test:ilink-db` 串上 crypto/lease/inbox 测
- [ ] `docs/server-deployment.md` 追加 DB 模式 env 与「仍无 Outbox/媒体/生产门禁」
- [ ] 跑 `npm run test:bot-worker`（及新脚本）全绿
- [ ] commit  
`test+docs: cover iLink DB lease and inbox staging`

---

### 任务 7：手动清单

- [ ] 无 DB：行为与现网一致  
- [ ] 有 MySQL + migrate up：启用 DB 模式，双 worker 同 account 仅一个 acquire 成功  
- [ ] 收一条文本后 `inbox_messages` 有行且 cursor 前进；重放同 message_id 不双插  

---

## 自检

| 项 | 结论 |
| --- | --- |
| 覆盖 ADR 顺序 2 的最小切片 | lease + inbox/cursor |
| 不碰 Outbox/媒体/Agent | 边界表 |
| 默认关闭不破坏现网 | DB 开关 |
| TDD 每模块 | 任务 1–3 |
| 加密字段不落明文 | crypto 模块 |

---

## 明确不做

- Outbox Dispatcher / unknown reconcile  
- Artifact CDN  
- 共享 bot-core 迁移  
- 生产发布声明  

**下一计划候选：** Outbox 文本发送 + 发送前 fencing 校验。
