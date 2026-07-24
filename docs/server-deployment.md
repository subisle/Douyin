# 网页服务器版本部署说明

> 版本：v0.1
> 日期：2026-07-06

> **【文档关系 · 2026-07-22】**
> 本文为 Next/pm2/nginx **部署基线**。
> 生产目标只使用微信 iLink 通道，服务端 Worker 是必选进程。专项架构、游标、幂等和验收见 `docs/ilink-server-agent-design.md`；实施门槛见 `docs/ai-agent-production-plan.md`。同一微信账号严禁由桌面 Electron 与服务器 Worker 同时运行。

> 当前 `scripts/bot-worker.js` 已可选接入**实验性 iLink 文本 transport**，并可选用 **MySQL 账号租约（fencing）+ 文本 Inbox/Cursor 同事务 + 实验性 Outbox 文本出站**。仍 **无完整 reconcile 控制面、无图片/CSV Artifact、无 Agent Core**，**不得标记为生产可用**。完整 P0–P3 见 `docs/ilink-server-agent-design.md`。

### 实验性文本 transport（默认关闭）

默认不启用，行为与旧「仅租约」Worker 一致。开发/应急联调可：

```env
BOT_ILINK_ENABLED=1
BOT_ILINK_TOKEN=...                 # 明文 token；生产后续改加密库
# 可选：
# BOT_ILINK_BASE_URL=https://ilinkai.weixin.qq.com
# BOT_ILINK_ACCOUNT_ID=...
# BOT_ILINK_CURSOR=...
# BOT_ILINK_CURSOR_PATH=/path/to/cursor.json
# BOT_ILINK_ACK_TEXT=收到            # 空字符串=只收不发
# BOT_ILINK_POLL_TIMEOUT_MS=35000
```

### 实验性 MySQL lease + Inbox/Cursor（默认关闭）

在文本 transport 之上，可选把账号互斥与入站文本落到 `001_ilink_runtime` 表：

```env
BOT_ILINK_DB_ENABLED=1
BOT_RUNTIME_SECRET=at-least-16-chars   # AES 字段密钥；缺省则 DB 模式 fail closed
BOT_ILINK_WORKSPACE_ID=default
BOT_ILINK_ACCOUNT_KEY=...              # 缺省回退 BOT_ILINK_ACCOUNT_ID / default
# 以及既有 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
# 先执行: npm run db:migrate
```

行为摘要：

| 模式 | 租约 | 入站持久化 | status.persistence |
| --- | --- | --- | --- |
| 默认 | 本机文件锁 | 无（内存/可选 cursor 文件） | `not_connected` |
| `BOT_ILINK_ENABLED` 仅开 | 文件锁 | 无 | `not_connected` |
| 再开 `BOT_ILINK_DB_ENABLED` | MySQL `bot_runner_leases` + fencing | 文本 `inbox_messages` + `ilink_update_cursors` 同事务 | `mysql` |

约束：

- `transport` 与 `persistence` 分离；`mysql` 表示入站文本/游标可落库，并可随 DB 模式启用**实验性** Outbox 文本出站；**不**表示全链路生产就绪。
- **禁止**与桌面 Electron 同账号同时运行。
- 仅文本；无图片/CSV/Agent；无完整 reconcile 控制面；无自动 unknown 重发。
- 双 Worker 同 `workspace+account`：仅持有效 lease 的一方可 poll；丢租停 transport。
### 实验性 Outbox 文本出站（随 DB 模式）

当 `BOT_ILINK_DB_ENABLED=1` 且配置了 runtime secret / DB 时，出站文本不再直接 `sendMessage`，而是：

1. transport `sendOutbound` → `outbox_messages`（`prepared`，写时校验 fencing）
2. Worker heartbeat / 立即 kick → `claimBatch` → iLink `sendMessage`
3. 成功 `sent`；超时类 `unknown`（`reconcile_status=pending`）；可重试错误 `retry_wait`

过期认领与 unknown 处理（实验语义；**不得**据此标生产）：

- **过期 `sending` 回收（即将支持 `reclaimExpiredClaims`）**：`claim_expires_at` 已过的 `sending` 行回收为 `retry_wait` 并清空 claim 字段，以便再次被 `claimBatch` 认领。HEAD 若尚未合入该方法，以计划实现为准；实现后应在 `claimBatch` 前或心跳中调用。
- **`unknown` + `reconcile_status=pending`**：默认**不**自动重发。需人工或 API `resolveUnknown`（如标 `sent` / `dead_letter` / 显式允许 `retry`）后再继续；无完整 reconcile 控制面。

可选：

```env
# BOT_ILINK_OUTBOX_POLL_MS=500   # 当前实现搭载在租约心跳上；保留配置兼容
# BOT_ILINK_OUTBOX_BATCH=10
```

仍无图片/CSV Artifact、无完整 reconcile 控制面、无自动 unknown 重发；**不得**标记生产可用。

## 1. 目标

将当前抖音数据管理系统作为网站部署，浏览器、后续 iOS App、后续桌面端统一通过网站 API 访问数据。

```text
Web / iOS App / Desktop
  -> HTTPS
  -> Next.js 网站服务器
  -> 网站数据库 MySQL
```

## 2. 环境要求

- Node.js 22 LTS 或兼容版本
- MySQL 8.x 或兼容版本
- Nginx/Caddy/宝塔反代均可
- 推荐使用 PM2 或 systemd 保活

## 3. 数据库配置

数据库连接统一由 `electron/db-config.js` 校验。`DB_HOST`、`DB_PORT`、`DB_USER`、
`DB_PASSWORD`、`DB_NAME` 必须全部通过服务器环境或未提交 Git 的 `.env` 显式注入；
缺少任一项或端口不在 `1-65535` 范围时，应用会拒绝创建数据库连接。

```env
NODE_ENV=production
APP_URL=https://your-domain.com

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=douyin_app
DB_PASSWORD=change_me
DB_NAME=douyin

# iOS App、自动化脚本等非浏览器客户端使用
API_TOKENS=change_me_token

# Web 登录账号和 HttpOnly 会话签名
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_me_to_a_strong_password
SESSION_SECRET=change_me_to_long_random_string
```

注意：

- 数据库环境变量是启动必需项，不存在源码内置凭据或远程数据库 fallback。
- 自定义 `.env` 只放在服务器，不提交 Git。
- 浏览器使用登录后签发的 HttpOnly cookie；不要将 API Token 写入 `NEXT_PUBLIC_*`。
- iOS App 和自动化脚本使用 `Authorization: Bearer <token>` 或 `x-api-token`，不直接连接数据库。
- MySQL 用户建议只授权业务库，不使用 root。

Electron 安装包不内置 `.env` 或数据库密钥。安装后将 `.env.example` 中需要的变量
写入应用用户数据目录的 `douyin.env`，或通过 `DOUYIN_ENV_PATH` 指向受限权限的绝对
路径；进程环境变量优先于文件值。缺少完整 `DB_*` 时安装包保持拒绝启动。

## 4. 构建与启动

```bash
npm ci
npm run db:migrate:status
npm run db:migrate
npm test
npm run build
npm run start
```

`db:migrate` 必须在每次发布前执行；迁移使用 MySQL advisory lock，发现 checksum
不一致或本地缺失迁移文件时会终止。当前 `bot-worker.js` 仍是占位租约进程，部署阶段
只启动 Web，不得把它当作服务器微信收发已完成的证明。

当前 `next.config.ts` 已调整：

- Electron 打包：`ELECTRON=true` 时导出静态产物。
- 网站服务器：默认保留 Next.js API Route 能力。

## 5. PM2 示例

```bash
pm2 start npm --name douyin-web -- run start
pm2 save
```

## 6. Nginx 反向代理示例

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

生产环境建议启用 HTTPS。

## 7. 验证

部署后检查：

```bash
curl https://your-domain.com/api/v1/health
curl https://your-domain.com/api/v1/startup-health \
  -H 'authorization: Bearer change_me_token'
curl https://your-domain.com/api/v1/dashboard/summary \
  -H 'authorization: Bearer change_me_token'
curl -X POST https://your-domain.com/api/v1/flags/settle \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change_me_token' \
  -d '{"period":"2026-07"}'
```

预期响应：

```json
{ "success": true, "data": { "status": "ok" } }
```

## 8. 后续对接

- iOS App：使用 `/api/v1/**` REST 接口。
- 桌面端：短期仍可使用 Electron IPC；后续切换到网站 API。
- 兼容接口：网页内部现阶段还保留 `POST /api/ipc`，用于快速复用旧方法。
