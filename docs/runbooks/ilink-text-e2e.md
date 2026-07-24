# iLink 实验性文本 E2E Runbook（真实账号）

| 项 | 内容 |
| --- | --- |
| 版本 | v1.0.0 |
| 日期 | 2026-07-24 |
| 切片 | S1 · 真实账号文本 E2E |
| 进度真值 | [`docs/ilink-implementation-progress.md`](../ilink-implementation-progress.md) |
| 部署开关 | [`docs/server-deployment.md`](../server-deployment.md) |
| 运维清单 | [`docs/runbooks/ilink-worker-ops-checklist.md`](./ilink-worker-ops-checklist.md) |
| 演练记录模板 | [`docs/runbooks/ilink-text-e2e-record.template.md`](./ilink-text-e2e-record.template.md) |

> **本 runbook 可执行，但不要求本机当前持有真实 token。**  
> 有 token 时按编号步骤跑通并填记录模板；无 token 时仍可完成 migrate / 启动前检查 / 故障剧本中的 SQL 与双 Worker 演练（token 相关步骤记为 skip）。

---

## 0. 明确非目标

| 非目标 | 说明 |
| --- | --- |
| 图片 / CSV Artifact | 表可能存在，本 E2E **不**验收 |
| 生产标签 | **不得**因本 runbook pass 宣称「服务器生产可用」 |
| `shared/bot-core` / Agent Core | 不迁 Core；ack 仅为 transport 回执文本 |
| 完整 reconcile 控制面 | 仅 SQL / 代码级 `resolveUnknown`；无 Web UI 要求 |
| 桌面与 Worker 同账号并发 | **禁止**（见前置） |

成功定义（DB 模式优先）：

1. 微信私聊发一条纯文本 → Worker 收到 → 落 `inbox_messages`（DB 模式）→ 出站 ack 经 Outbox → 微信侧可见回执。  
2. status 文件 `phase=running`、`transport=polling`、`persistence=mysql`（DB 模式）。  
3. SIGTERM 后 `phase=stopped`，lease 可被下一进程 acquire。

---

## 1. 前置条件

### 1.1 账号与双开禁令

- **同一微信 iLink 账号禁止**由桌面 Electron Bot 与 `npm run bot:worker` **同时**运行。  
- 演练前必须先停桌面 runner（步骤 1）。  
- 详见 `docs/server-deployment.md` 文首约束与 `docs/ilink-implementation-progress.md` §4。

### 1.2 代码与数据库

```bash
cd /Volumes/2t/it/抖音   # 或你的仓库根

# 查看迁移状态
npm run db:migrate:status

# 有 pending 时执行（MySQL advisory lock；checksum 不一致会失败）
npm run db:migrate
```

依赖表（`migrations/001_ilink_runtime.js` 等）：

- `ilink_accounts`
- `ilink_update_cursors`
- `bot_runner_leases`
- `inbox_messages`
- `outbox_messages`

### 1.3 环境变量完整示例

**推荐：DB 文本闭环（本 E2E 主路径）。** 变量写在进程环境或未提交的 `.env`（勿入库）。

```env
# --- iLink 文本 transport ---
BOT_ILINK_ENABLED=1
BOT_ILINK_TOKEN=REPLACE_WITH_REAL_OR_DEV_TOKEN
BOT_ILINK_ACK_TEXT=收到
# 可选：
# BOT_ILINK_BASE_URL=https://ilinkai.weixin.qq.com
# BOT_ILINK_ACCOUNT_ID=...
# BOT_ILINK_CURSOR=...
# BOT_ILINK_CURSOR_PATH=/path/to/cursor.json
# BOT_ILINK_POLL_TIMEOUT_MS=35000
# BOT_ILINK_OUTBOX_POLL_MS=500
# BOT_ILINK_OUTBOX_BATCH=10

# --- 实验性 MySQL lease + Inbox/Cursor + Outbox ---
BOT_ILINK_DB_ENABLED=1
BOT_RUNTIME_SECRET=at-least-16-chars-secret
BOT_ILINK_WORKSPACE_ID=default
BOT_ILINK_ACCOUNT_KEY=e2e-account-1

# --- MySQL（缺一则 DB 模式 fail closed）---
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=douyin_app
DB_PASSWORD=change_me
DB_NAME=douyin

# --- 可选身份与 status ---
BOT_OWNER_ID=e2e-host-1
BOT_WORKER_STATUS_PATH=/tmp/bot-worker-status-e2e.json
```

| 模式 | 关键开关 | 期望 `persistence` |
| --- | --- | --- |
| 仅文本（文件锁） | `BOT_ILINK_ENABLED=1` + token，**不开** DB | `not_connected` |
| DB 文本闭环 | 上表全开 | `mysql` |

仅文本模式：入站不落 MySQL，出站直接 `sendMessage`，**跳过**步骤 6 中 inbox/outbox SQL（可只查 status 与微信 ack）。

### 1.4 参考文档

- 部署与开关：`docs/server-deployment.md`  
- 实现进度：`docs/ilink-implementation-progress.md`  
- 运维字段：`docs/runbooks/ilink-worker-ops-checklist.md`

---

## 2. 步骤（编号，按序执行）

### 1）停桌面 runner

确保本机/该账号未在跑 Electron 微信 Bot：

- 退出桌面应用中的 Bot / 关闭相关 Electron 窗口；或  
- 确认 runtime 下 `weixin-bot-runner.lock` 无活跃持有者（路径见 `electron/local-paths.js`）。

**验收：** 不会出现桌面与 Worker 抢同一 iLink 会话。

### 2）migrate

```bash
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:status   # 确认无 pending / 无 checksum 错误
```

**验收：** `001_ilink_runtime`（及后续 outbox 相关迁移）已 applied。

### 3）启动 `npm run bot:worker`

```bash
# 先 export / source 上文 env（示例）
export BOT_ILINK_ENABLED=1
export BOT_ILINK_TOKEN='...'
export BOT_ILINK_ACK_TEXT='收到'
export BOT_ILINK_DB_ENABLED=1
export BOT_RUNTIME_SECRET='at-least-16-chars-secret'
export BOT_ILINK_WORKSPACE_ID=default
export BOT_ILINK_ACCOUNT_KEY=e2e-account-1
export DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=... DB_PASSWORD=... DB_NAME=...
export BOT_OWNER_ID=e2e-host-1
export BOT_WORKER_STATUS_PATH=/tmp/bot-worker-status-e2e.json

npm run bot:worker
```

另开终端观察日志；前台跑便于 SIGTERM。

### 4）检查 status 文件：phase / transport / persistence

```bash
# 路径：BOT_WORKER_STATUS_PATH 或 runtime 下 bot-worker-status.json
cat "${BOT_WORKER_STATUS_PATH:-/tmp/bot-worker-status-e2e.json}" | jq .
```

| 字段 | 期望（DB + 有效 token） |
| --- | --- |
| `phase` | `running` |
| `transport` | `polling` |
| `persistence` | `mysql` |
| `fencingToken` | 非 null 整数 |
| `dbAccountId` | 非 null |
| `lastError` | null 或与本次无关的历史空 |

仅文本模式：`persistence=not_connected`，`transport=polling`。  
缺 token：`transport=not_configured`（可记 fail 或 skip，取决于演练目标）。

### 5）微信私聊发文本 → 期望 ack

1. 使用**绑定该 token 的微信**，从另一微信号（或测试号）向 Bot 发一条**纯文本**，如：`e2e-ping-001`。  
2. 期望在数秒～一轮 long poll 内收到 ack：默认 `BOT_ILINK_ACK_TEXT`（示例 `收到`）。  
3. 观察 status：`receivedCount` ≥ 1；DB 模式下 `outboxSentCount` 或 outbox 行 `status=sent` 增加；`lastInboundAt` / `lastOutboundAt` 更新。

**验收：** 微信侧可见回执；记录模板勾选「是否收到 ack」。

### 6）SQL 检查建议

在 MySQL 客户端对**同一** `DB_NAME` 执行（将 `@ws` / 账号替换为实际值；`account_id` 可从 status 的 `dbAccountId` 读取）。

```sql
-- 租约：应有一行 owner 为当前 BOT_OWNER_ID，lease_expires_at 在未来
SELECT workspace_id, account_id, lease_name, owner_id, fencing_token,
       lease_expires_at, heartbeat_at
FROM bot_runner_leases
WHERE workspace_id = 'default'
ORDER BY updated_at DESC
LIMIT 5;

-- 游标：poll 成功后应有 cursor 行（密文字段，只看 hash/时间）
SELECT workspace_id, account_id, session_id, cursor_hash, fencing_token,
       last_update_at, updated_at
FROM ilink_update_cursors
WHERE workspace_id = 'default'
ORDER BY updated_at DESC
LIMIT 5;

-- 入站：应有新 prepared/succeeded 等文本行
SELECT id, workspace_id, account_id, session_id, message_type, status,
       upstream_message_id, received_at, created_at
FROM inbox_messages
WHERE workspace_id = 'default'
ORDER BY id DESC
LIMIT 10;

-- 出站：ack 经 Outbox 后应出现 sent（或短暂 prepared/sending）
SELECT id, workspace_id, account_id, session_id, message_type, status,
       reconcile_status, reply_to_inbox_id, attempt_count,
       claim_expires_at, sent_at, unknown_at, last_error, created_at
FROM outbox_messages
WHERE workspace_id = 'default'
ORDER BY id DESC
LIMIT 10;
```

**建议对照：**

| 表 | 成功时 |
| --- | --- |
| `bot_runner_leases` | 单 owner，`fencing_token` 与 status 一致 |
| `ilink_update_cursors` | `updated_at` 随 poll 前进 |
| `inbox_messages` | 新行 `message_type` 文本相关；记下 `id` 填记录模板 |
| `outbox_messages` | 对应 ack 最终 `status='sent'`，`reconcile_status` 非 pending |

### 7）优雅 SIGTERM

```bash
# 前台：Ctrl+C；或
kill -TERM <worker_pid>
# 等待进程退出
```

**验收：**

- status：`phase=stopped`（或文件停更且进程已退出）  
- `bot_runner_leases.owner_id` 清空或 `lease_expires_at` 过期后可被下一进程 acquire  
- 无僵尸 `sending` 长期占 claim（若有，见故障剧本 reclaim）

### 8）回切桌面

1. 确认 Worker 已停且 lease 释放。  
2. 按桌面流程重新启动 Electron 微信 Bot（**不要**与 Worker 并行）。  
3. 桌面侧冒烟：登录 / 收一条测试消息即可；**不**要求桌面跑 Outbox 路径。

---

## 3. 故障剧本（至少 4）

| 场景 | 操作 | 期望 |
| --- | --- | --- |
| 杀进程中途 | Worker 在 outbox `sending` 期间 `kill -9 <pid>`（可用短 `claim_expires` 或等待默认 claim TTL ≈ 30s） | 下次 Worker 或 `claimBatch` 前 `reclaimExpiredClaims`：过期 `sending` → `retry_wait` 并清空 claim；之后可再次 claim 并发送。**未过期** `sending` 不应被 reclaim |
| 双 Worker | 同一 `BOT_ILINK_WORKSPACE_ID` + `BOT_ILINK_ACCOUNT_KEY` / 账号，两个进程 `npm run bot:worker`（不同 `BOT_OWNER_ID`） | `bot_runner_leases` **仅一方**持有效 lease；另一方 `phase=lease_lost` 或无法持续 poll；**不得**双 poll 同账号 |
| token 失效 | `BOT_ILINK_TOKEN` 设为明显错误值后启动，或运行中替换为坏 token 并重启 | status `transport=session_expired` 或 `lastError` 可观察；**不得**把失败伪装成 durable 全成功（无虚假 `outbox status=sent` 洪泛 / 无「一切正常」假象） |
| unknown | **模拟超时（如何）：** (a) 临时把出站 `sendMessage` 打到极短超时 / 不可达代理，或 (b) 在 DB 手工插入/保留一行 `status='sending'` 后用测试把错误路径走到 `markUnknown`（实现：dispatch 遇 timeout/AbortError/ILINK_TIMEOUT → `unknown` + `reconcile_status=pending`）。也可在单测 / 注入 mock 复现后对照生产表 | 行停在 `unknown` + `reconcile_status=pending`；**默认不自动重发**。人工 `resolveUnknown` 三态见下 |

### 3.1 `resolveUnknown` 三态

实现：`scripts/ilink-outbox.js` → `outboxStore.resolveUnknown({ workspaceId, accountId, outboxId, resolution, ... })`。  
当前无专用 CLI 时，可用一次性 Node 脚本（**演练环境**）：

```bash
node -e '
const { createPool } = require("./electron/db"); // 若项目导出不同，改用现有 mysql 连接工厂
// 推荐：在仓库内已有 test helper / 本地 REPL 中 require("./scripts/ilink-outbox")
// 伪代码：
// const store = createOutboxStore({ pool, crypto, nowFn: () => new Date() });
// await store.resolveUnknown({ workspaceId, accountId, outboxId, resolution: "sent"|"dead_letter"|"retry" });
console.log("see scripts/ilink-outbox.js resolveUnknown");
'
```

| `resolution` | 结果 status | reconcile | 说明 |
| --- | --- | --- | --- |
| `sent` | `sent` | `resolved` | 已确认对端收到；可写 `upstreamMessageId` |
| `dead_letter` | `dead_letter` | `resolved` | 放弃；可写 `error` |
| `retry` | `retry_wait` | `not_required` | 显式允许再发；`next_attempt_at` 可带 `delayMs` |

**禁止：** 把 `unknown` 当成功；禁止未 resolve 就宣称 E2E pass。

### 3.2 reclaim 快速自检 SQL（可选）

```sql
-- 查看是否有过期仍 sending 的行（reclaim 前）
SELECT id, status, claimed_by, claim_expires_at, attempt_count, last_error
FROM outbox_messages
WHERE status = 'sending'
  AND claim_expires_at IS NOT NULL
  AND claim_expires_at < NOW(6);

-- reclaim 后期望变为 retry_wait 且 claim 字段清空
SELECT id, status, claimed_by, claim_token, claim_expires_at
FROM outbox_messages
WHERE id = <outbox_id>;
```

---

## 4. 通过 / 失败判定

| 结果 | 条件 |
| --- | --- |
| **pass** | 步骤 1–8 主路径完成；私聊 ack 收到（有 token 时）；DB 模式 SQL 与 status 一致；无未解释的 `unknown` pending |
| **fail** | 双开违规、lease 双持、ack 未达、token 错误却被标全成功、migrate 失败导致假绿 |
| **skip（部分）** | 无真实 token：完成 1–4、7–8 与双 Worker/reclaim 剧本；步骤 5 与 token 失效记 skip，结论写 **partial** |

每次演练复制 [`ilink-text-e2e-record.template.md`](./ilink-text-e2e-record.template.md) 填写后归档（路径自定，**勿**提交真实 token）。

---

## 5. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-24 | S1 初版：真实账号文本 E2E 可执行步骤 + 四类故障剧本 |
