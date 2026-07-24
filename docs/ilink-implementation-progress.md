# iLink 服务器机器人 · 实现进度与落地状态

| 项 | 内容 |
| --- | --- |
| 版本 | v1.0.0 |
| 核对日期 | 2026-07-24 |
| 分支 | `615`（相对 `origin/615` 含实验切片，以本地 HEAD 为准） |
| 文档角色 | **实现进度真值表**（代码优先）；产品愿景仍以 `ai-agent-production-plan.md` 为准 |
| 用户智能对话真值 | `docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md`（**单 Agent + 多技能**） |
| 顺序路线 | `docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md`（S0–S8；多 Agent 仅 S8） |
| 部署开关 | `docs/server-deployment.md` |

> 冲突时：**运行代码与 `migrations/` > 本文 > 旧段落日期早于 2026-07-24 的设计表述**。  
> **用户侧智能客服主路径 = 桌面微信单 Agent**；服务器 Worker 实验不改变该产品形态，也不等于「多 Agent 已上线」。

---

## 1. 一句话结论

| 维度 | 结论 |
| --- | --- |
| 用户 AI 对话 | **桌面单 Agent + 多技能 + 微信 iLink**（见 single-agent 规格） |
| 桌面微信 Bot | **可用**（指令 + FastRoute + Agent + 日报/CSV） |
| 服务器 Worker | **实验性文本闭环已接线**（transport + 可选 DB lease/Inbox/Outbox） |
| 生产标签 | **不得**标记「服务器生产可用」 |
| 正确下一阶段 | **S1 真实账号文本 E2E 实跑 / S2 登录通道**（勿先迁 Core / 勿上多 Agent） |

---

## 2. 能力完成度（按生产门槛加权）

| 模块 | 完成度 | 说明 |
| --- | ---: | --- |
| 产品/ADR/路线图 | ~90% | 契约 Accepted；部分基线段落滞后代码 |
| 桌面 iLink 主链 | ~80% | `electron/weixin-bot*.js` |
| `shared/ilink-adapter` | ~90% | 协议层 + 单测；媒体契约仍可增强 |
| 服务器文本 transport | ~75% | 默认可关；明文 token 仅开发 |
| S2 凭据加密落库 | 部分 | seed CLI + 文档；store（A1）/ Worker 读库（A2）进行中；env token 仍可用 |
| DB lease + fencing | ~70% | 模块+Worker 接线；缺真实双机演练记录 |
| Inbox/Cursor 同事务 | ~70% | 仅文本；加密字段 |
| Outbox 文本 + reclaim/resolve | ~65% | 无完整 reconcile UI；unknown 不自动重发 |
| 图片/CSV Artifact | ~5% | 表有，管线无 |
| `shared/bot-core` | ~10% | 仅 RAG 薄 re-export；业务仍在 electron |
| Web 管理面生产化 | ~30% | `/agent` `/bot` MVP |
| 真实账号 E2E / 72h | ~0% | 缺 runbook 证据 |
| G1–G4 生产门禁 | ~10% | 鉴权部分勾选 |

---

## 3. 代码地图（实现真值）

### 3.1 服务器路径（新增/主链）

| 路径 | 职责 | 状态 |
| --- | --- | --- |
| `shared/ilink-adapter.js` | 纯 Node iLink HTTP | ✅ |
| `scripts/ilink-text-transport.js` | 长轮询 + ack + persistBatch + sendOutbound | ✅ 实验 |
| `scripts/ilink-crypto.js` | `BOT_RUNTIME_SECRET` AES-GCM | ✅ |
| `scripts/ilink-db-lease.js` | `bot_runner_leases` fencing | ✅ |
| `scripts/ilink-inbox-cursor.js` | 文本 Inbox + Cursor 同事务 | ✅ |
| `scripts/ilink-outbox.js` | enqueue/claim/mark* + reclaim + resolveUnknown | ✅ |
| `scripts/ilink-account-credentials.js` | `createAccountCredentialStore` 加解密凭据 | ⏳ A1 进行中/依赖合并 |
| `scripts/ilink-seed-credential.js` | 运维 seed：env token → 加密落库 | ✅ 脚本+文档（依赖 A1 store） |
| `scripts/bot-worker.js` | 文件锁 **或** DB 模式文本闭环 | ✅ 实验 |
| `migrations/001_ilink_runtime.js` | transport 表 | ✅ schema |
| `migrations/002_outbox_tenant_fk.js` | outbox FK | ✅ schema |

### 3.2 桌面主链（未替代）

| 路径 | 职责 | 状态 |
| --- | --- | --- |
| `electron/weixin-bot.js` | 登录/轮询/收发 | ✅ 生产主用 |
| `electron/weixin-bot-commands.js` / `mode` / `agent` / `skills` | 指令与 Agent | ✅ |
| `electron/weixin-bot-report.js` | 日报 PNG | ✅ 桌面 |
| `src/server/bot-core/rag.js` | re-export electron RAG | ⚠️ 非独立 Core |

### 3.3 测试入口

```bash
npm run test:ilink-adapter
npm run test:ilink-db          # crypto + lease + inbox + outbox
npm run test:bot-worker        # worker + transport + ilink-db
npm run test:weixin-bot
```

单元/注入测为主；**不含**真实微信账号 E2E。

---

## 4. 运行模式矩阵

| 模式 | 环境变量 | 租约 | 入站 | 出站 | `persistence` |
| --- | --- | --- | --- | --- | --- |
| 默认 Worker | （关） | 文件锁 | 无 | 无 | `not_connected` |
| 仅文本 | `BOT_ILINK_ENABLED=1` + `TOKEN` | 文件锁 | 内存/cursor 文件 | 直接 send | `not_connected` |
| DB 文本闭环 | 上表 + `BOT_ILINK_DB_ENABLED=1` + `BOT_RUNTIME_SECRET` + `DB_*` | MySQL fencing | Inbox+Cursor | Outbox→send | `mysql` |

**约束：** 禁止与桌面同账号双开；DB 模式出站经 Outbox；`unknown` 需 `resolveUnknown`，默认不自动重发。

---

## 5. 与设计文档批次对照

| 设计批次 | 文档目标 | 代码现状 |
| --- | --- | --- |
| iLink P0 Adapter | 协议抽出 | ✅ |
| iLink P1 文本收发 | Worker 真 poll | ✅ 实验文本 |
| iLink P1 DB transport | lease/Inbox/Outbox | ✅ 文本；❌ 媒体 Artifact |
| iLink P1 二维码通道 | Web→DB→Worker | ❌ |
| iLink P2 会话/知识 MySQL | 生产基建 | ❌ / 部分鉴权 |
| iLink P3 72h 灰度 | 生产标签 | ❌ |
| 生产 B1 Core | `shared/bot-core` | ❌ |
| 生产 B4 Worker | 发布阻塞 | ⚠️ 文本实验，非 B4 完成 |
| 生产 G1–G4 | 门禁 | 大部分未勾 |

---

## 6. 顺序路线 S0–S8（摘要）

完整任务表见：

`docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md`

```text
S0 文档对齐（进行中）
S1 真实账号文本 E2E + runbook
S2 凭据加密 + 二维码控制通道  ← 部分：seed+store（A3/A1）；A2 Worker 读库 / B 登录通道未完
S3 图片/CSV Artifact
S4 shared/bot-core
S5 Session/Run/Step/Effect
S6 Web 控制面 + Bot DB 状态
S7 门禁与 24h+72h → 才可标生产
S8 扩展（Catalog / 调度 / 多 Agent）
```

**硬规则：** 未完成 S7 不得宣称服务器生产可用；S1 前不做 Core 大迁与多 Agent。

---

## 7. 已合入实验切片（git 线索）

近期 bot/iLink 相关提交主题（不完全列表）：

- extract `shared/ilink-adapter`
- pure Node text transport + bot-worker 接线
- crypto / db-lease / inbox-cursor / outbox
- outbox reclaim + resolveUnknown
- server-deployment 实验开关说明

切片实现计划（过程稿）：

- `docs/superpowers/plans/2026-07-24-bot-worker-ilink-text-loop.md`
- `docs/superpowers/plans/2026-07-24-ilink-db-lease-inbox-cursor.md`
- `docs/superpowers/plans/2026-07-24-ilink-outbox-text-dispatch.md`
- `docs/superpowers/plans/2026-07-24-ilink-outbox-reclaim-reconcile.md`
- `docs/superpowers/plans/2026-07-24-ilink-s2-credentials-login.md`
- seed runbook：`docs/runbooks/ilink-credential-seed.md`

---

## 8. 阻塞项（上生产前）

1. 真实账号文字 E2E 与双 Worker 抢租约记录  
2. 加密凭据 + 扫码控制面（去掉明文 token 生产路径；S2 部分：seed 已有，store/Worker/登录通道未齐）  
3. 图片/CSV Artifact 全链路  
4. `shared/bot-core` 与 API 脱离 `electron/*`  
5. 72h + G1–G4 证据  

---

## 9. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-24 | 初版：对齐 615 上实验性文本+DB transport 实现 |
| 2026-07-24 | S2 部分：`bot:seed-credential` + credential seed runbook；凭据 store/Worker 读库仍进行中 |
| 2026-07-24 | 用户智能真值：`weixin-single-agent-skills-design`；入口文档对齐 |
| 2026-07-24 | S2 登录通道：login-control store + login-poller + `/api/bot/login/*`；仍实验 |
