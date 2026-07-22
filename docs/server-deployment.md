# 网页服务器版本部署说明

> 版本：v0.1
> 日期：2026-07-06

> **【文档关系 · 2026-07-22】**
> 本文为 Next/pm2/nginx **部署基线**。
> 生产目标只使用微信 iLink 通道，服务端 Worker 是必选进程。专项架构、游标、幂等和验收见 `docs/ilink-server-agent-design.md`；实施门槛见 `docs/ai-agent-production-plan.md`。同一微信账号严禁由桌面 Electron 与服务器 Worker 同时运行。

> 当前 `scripts/bot-worker.js` 仍是租约占位进程，尚未接入完整 iLink 长轮询和媒体收发。完成专项设计 P0-P3 前，不应把它标记为生产可用。

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
- MySQL 8.x 或兼容版本（项目默认使用内置远程数据库）
- Nginx/Caddy/宝塔反代均可
- 推荐使用 PM2 或 systemd 保活

## 3. 数据库配置

数据库连接已集中内置在 `electron/db-config.js`。从 GitHub 拉取代码后，即使未设置
`DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`，桌面端和网站 API 也会使用内置数据库。

需要切换数据库时，可通过网站服务器 `.env` 覆盖任意 `DB_*` 配置：

```env
NODE_ENV=production
APP_URL=https://your-domain.com

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=douyin_app
DB_PASSWORD=change_me
DB_NAME=douyin

# 写接口保护：设置后 POST/PUT/PATCH/DELETE 必须携带 Bearer Token 或 x-api-token
API_TOKENS=change_me_token

# 后续登录鉴权使用
SESSION_SECRET=change_me_to_long_random_string
JWT_SECRET=change_me_to_long_random_string
```

注意：

- `.env` 仅用于覆盖内置配置，不是启动必需项。
- 自定义 `.env` 只放在服务器，不提交 Git。
- iOS App 和浏览器仍通过网站 API 访问数据，不直接连接数据库。
- MySQL 用户建议只授权业务库，不使用 root。

## 4. 构建与启动

```bash
npm ci
npm run build
npm run start
```

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
curl https://your-domain.com/api/v1/startup-health
curl https://your-domain.com/api/v1/dashboard/summary
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
