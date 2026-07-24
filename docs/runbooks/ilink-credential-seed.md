# iLink 加密凭据种子（实验）

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-07-24 |
| 切片 | S2a · 凭据加密落库 |
| CLI | `npm run bot:seed-credential` → `scripts/ilink-seed-credential.js` |
| Store | `scripts/ilink-account-credentials.js` · `createAccountCredentialStore` |
| 进度真值 | [`docs/ilink-implementation-progress.md`](../ilink-implementation-progress.md) |
| 部署说明 | [`docs/server-deployment.md`](../server-deployment.md) |

> **实验路径。** 成功 seed 后仍 **不得** 标记服务器生产可用。  
> CLI **禁止**打印 token / ciphertext；成功只打印 `accountId`。

## 1. 前置

1. 已执行迁移（含 `ilink_accounts.credential_ciphertext` 字段的 schema）：

   ```bash
   npm run db:migrate:status
   npm run db:migrate
   ```

2. 本机可连业务库（`DB_*`），且 `BOT_RUNTIME_SECRET` ≥ 16 字符。
3. 依赖 A1 已合入：`createAccountCredentialStore` 可 require。若仅有本 seed 脚本、A1 未合并，CLI 会在 require 阶段失败。

## 2. 导出环境并 seed

```bash
export BOT_RUNTIME_SECRET='at-least-16-chars'
export DB_HOST=127.0.0.1
export DB_PORT=3306
export DB_USER=douyin_app
export DB_PASSWORD=...
export DB_NAME=douyin

export BOT_ILINK_WORKSPACE_ID=default          # 可选，默认 default
export BOT_ILINK_ACCOUNT_KEY=my-bot-account    # 或 BOT_ILINK_ACCOUNT_ID
export BOT_ILINK_TOKEN='...'                   # 仅 seed 时需要；勿写入日志
# 可选：
# export BOT_ILINK_BASE_URL=https://ilinkai.weixin.qq.com

npm run bot:seed-credential
# 期望: [seed-credential] ok accountId=<n> workspaceId=... accountKey=...
```

也可用项目根 `.env`（`dotenv` 加载，与 `migrate.js` 相同）；**不要**把含 token 的 `.env` 提交 Git。

## 3. 启动 Worker（去掉明文 token）

**A2（Worker 读库凭据）完成后**，DB 模式可在 **不** 设置 `BOT_ILINK_TOKEN` 时启动：

```bash
# 保留 DB + secret + 账号键；不要 export BOT_ILINK_TOKEN
export BOT_ILINK_ENABLED=1
export BOT_ILINK_DB_ENABLED=1
export BOT_RUNTIME_SECRET=...
export BOT_ILINK_WORKSPACE_ID=default
export BOT_ILINK_ACCOUNT_KEY=my-bot-account
# DB_* 同上

npm run bot:worker
```

语义（A2）：

- env `BOT_ILINK_TOKEN` **仍优先**（开发 / 应急）
- 无 env token 时从加密行 `getCredential` 填入 transport
- 仍无 token → `transport=not_configured`

A2 未合入前：Worker 仍只认 env token；seed 仅完成库内落库，不影响旧启动路径。

## 4. 校验与安全

| 做 | 不做 |
| --- | --- |
| 成功日志只看 `accountId` | 打印 / 转发 token |
| seed 后从 shell 历史清理敏感 export（按需） | 把 token 写进 status 文件或 ticket |
| 开发可继续用 env token | 宣称「已去掉明文 = 生产就绪」 |

失败时 CLI exit code `1`；常见原因：缺 `BOT_RUNTIME_SECRET` / `DB_*` / `BOT_ILINK_TOKEN` / account key，或 A1 store 未部署。

## 5. 相关

- 运维清单：[`ilink-worker-ops-checklist.md`](./ilink-worker-ops-checklist.md)
- 文本 E2E：[`ilink-text-e2e.md`](./ilink-text-e2e.md)
- S2 计划：`docs/superpowers/plans/2026-07-24-ilink-s2-credentials-login.md`
