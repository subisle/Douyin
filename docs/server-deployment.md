# 网页服务器版本部署说明

> 版本：v0.1
> 日期：2026-07-06

> **【文档关系 · 2026-07-22】**
> 本文为 Next/pm2/nginx **部署基线**。
> 生产目标只使用微信 iLink 通道，服务端 Worker 是必选进程。专项架构、游标、幂等和验收见 `docs/ilink-server-agent-design.md`；实施门槛见 `docs/ai-agent-production-plan.md`。同一微信账号严禁由桌面 Electron 与服务器 Worker 同时运行。

> 当前 `scripts/bot-worker.js` 已可选接入**实验性 iLink 文本 transport**（长轮询 + 文本回执），但 **`persistence` 仍为 `not_connected`**，无 durable Inbox/Outbox/DB lease fencing，**不得标记为生产可用**。完整媒体收发与 P0–P3 仍见 `docs/ilink-server-agent-design.md`。

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

约束：

- 状态文件字段 `transport` 与 `persistence` 分离；`persistence` 固定 `not_connected`，不表示消息已持久化。
- **禁止**与桌面 Electron 同账号同时运行。
- 仅文本；无图片/CSV/Agent/MySQL transport 表接线。

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
