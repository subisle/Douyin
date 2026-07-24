# iLink Worker 运维检查清单（实验）

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-07-24 |
| 适用 | `scripts/bot-worker.js` 实验文本 / DB 模式 |
| 完整 E2E | 见 `docs/runbooks/ilink-text-e2e.md`（若已合入） |
| 进度真值 | `docs/ilink-implementation-progress.md` |

## 1. 启动前

- [ ] 确认**未**与桌面 Electron 同微信账号同时跑
- [ ] `npm run db:migrate:status`（DB 模式）
- [ ] `npm run db:migrate`（有 pending 时）
- [ ] `BOT_RUNTIME_SECRET` ≥ 16 字符（DB 模式）
- [ ] `DB_*` 齐全（DB 模式）

## 2. 启动

```bash
cd /Volumes/2t/it/抖音
# 按需 export BOT_ILINK_* / BOT_ILINK_DB_ENABLED / DB_*
npm run bot:worker
```

## 3. Status 文件字段

默认路径：`BOT_WORKER_STATUS_PATH` 或 runtime 下 `bot-worker-status.json`。

| 字段 | 含义 |
| --- | --- |
| `phase` | starting / running / lease_lost / stopped / error |
| `transport` | disabled / not_configured / polling / session_expired / stopped / error |
| `persistence` | `not_connected`（文件模式）或 `mysql`（DB 模式） |
| `fencingToken` | DB 租约 fencing（文件模式 null） |
| `dbAccountId` | DB 账号数字 id |
| `receivedCount` / `sentCount` | transport 计数（DB 出站经 Outbox 时 sent 语义为 enqueue 侧） |
| `outboxSentCount` / `outboxPending` | Outbox 分发计数（DB） |
| `lastError` | 最近错误（已脱敏 Bearer） |

**解读：** `persistence=mysql` **不等于** 生产就绪，只表示入站/出站文本可走 DB transport。

## 4. 冒烟

- [ ] 无 env：日志含 transport disabled；status `transport=disabled`
- [ ] 仅 ENABLED 无 token：`not_configured`，phase 仍可为 running
- [ ] DB 模式：`persistence=mysql`，双进程同 account 仅一方持锁
- [ ] SIGTERM：phase=stopped，lease 释放

## 5. 测试

```bash
npm run test:bot-worker
npm run test:ilink-db
```

## 6. 升级下一阶段

- S1 真实账号：按 E2E runbook 填记录模板
- S2+：见 sequential-roadmap
