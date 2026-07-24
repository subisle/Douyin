# iLink 服务器机器人 · 按序总计划

> **面向执行者：** 严格按 **阶段顺序** 推进；阶段内任务按编号串行，除非标注「可并行」。  
> 推荐：`subagent-driven-development`（每任务一代理 + 审查）或 `executing-plans`。  
> 相关切片计划见同目录既有文件（text-loop / db-lease-inbox / outbox-dispatch / reclaim-reconcile）。

> **产品智能：** 实时微信问答为 **单 Agent + 多技能**（`docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md`）。**多 Agent 仅 S8 后置**，不得插入 S0–S7 主路径。

**目标：** 把微信 iLink 数据客服从「桌面 MVP + 实验性服务器文本闭环」推进到 **可灰度的服务器生产通道**（文字 → 图片/CSV → 共享 Core → 门禁），且 **不得跳步**。
**架构锚点：**

- 契约：`docs/adr/0001-agent-runtime-contract.md`（拓扑、`AgentResult`、交付不变量、实施顺序 1–6）
- 产品：`docs/ai-agent-production-plan.md`（B1–B6、G1–G4）
- 服务器专项：`docs/ilink-server-agent-design.md`（P0–P3）
- DB 真源：`migrations/`
- 当前 Worker：`scripts/bot-worker.js` + `scripts/ilink-*.js` + `shared/ilink-adapter.js`

**技术栈：** Node CommonJS、mysql2、Next 管理面、Electron 桌面回切、`node:test`。

---

## 0. 现状基线（2026-07-24，分支 `615`）

### 0.1 已完成（实验性，**非**生产）

| 切片 | 证据（模块） | 能力 |
| --- | --- | --- |
| 文本 transport | `scripts/ilink-text-transport.js` | 长轮询、ack、`persistBatch`、`sendOutbound` |
| 协议层 | `shared/ilink-adapter.js` | HTTP 白名单 + getUpdates/sendMessage |
| 加密 | `scripts/ilink-crypto.js` | AES-GCM 字段加解密 |
| DB lease | `scripts/ilink-db-lease.js` | acquire/renew/release + fencing |
| Inbox+Cursor | `scripts/ilink-inbox-cursor.js` | 同事务 stage 文本 + 游标 |
| Outbox | `scripts/ilink-outbox.js` | enqueue/claim/mark* + reclaim + resolveUnknown |
| Worker 接线 | `scripts/bot-worker.js` | 文件锁 **或** DB 模式文本闭环 |
| 测试 | `npm run test:bot-worker` | 单元/注入测（非真实微信 E2E） |

**DB 模式闭环（文本）：**

```text
getUpdates → persistBatch(Inbox+Cursor) → onText
  → sendOutbound(enqueue Outbox, fencing 校验)
  → reclaimExpiredClaims → claimBatch → sendMessage
  → sent | retry_wait | unknown(需 resolveUnknown)
```

### 0.2 明确未完成

- 真实账号 E2E、72h 运维证据  
- 加密凭据库 + Web 二维码控制通道（step-up/RBAC）  
- 图片/CSV Artifact staging + CDN  
- `shared/bot-core`（ModeRouter/Agent/Tools/RAG 仍在 `electron/`）  
- MySQL Session/Run/Step/effect/approval  
- Web 控制面闭环、黄金评测、G1–G4  
- 全项目 Capability Catalog 机器验收  

### 0.3 硬规则（全程）

1. **禁止**桌面 Electron 与服务器 Worker **同微信账号**双开。  
2. 未完成阶段 **S7**（及 G1–G4）前不得写「服务器生产可用」；S3 完成也不等于生产。  
3. **不要**先堆 Tool / 多 Agent / 可视化编排。  
4. 每个阶段结束：自动化测试绿 + 文档与代码一致 + 独立 commit 串。  
5. 默认开关关闭时行为与旧「仅租约」兼容。

---

## 总顺序图

```text
S0 文档与基线对齐
  → S1 真实账号文本 E2E + 运维剧本
  → S2 凭据加密与二维码控制通道
  → S3 图片/CSV Artifact（入站+出站）
  → S4 shared/bot-core 收敛（API 脱离 electron）
  → S5 MySQL Session/Run/Step + 可恢复执行
  → S6 Web 控制面与 Bot 状态（DB 真源）
  → S7 黄金集 / 门禁 / 24h+72h 灰度
  → S8 扩展（Capability Catalog / 调度 / 有界多 Agent）
```

对应 ADR 顺序：S0–S1 ≈ 顺序 1–3 收口；S2–S3 ≈ 顺序 2–3 补齐；S4–S5 ≈ 顺序 4–5；S7 ≈ 发布证据；S8 ≈ 顺序 6。

---

## 阶段 S0 · 文档与基线对齐（先做）

**目的：** 消除「文档仍写 Worker 占位 / 表未接线」的漂移，固定真值。

| 序 | 任务 | 产出 | 验收 |
| ---: | --- | --- | --- |
| S0.1 | 更新 `docs/ilink-server-agent-design.md` §1.2 / §10 | 阻塞表反映「文本闭环实验已接，E2E/媒体/Core 未接」 | 无自相矛盾 |
| S0.2 | 更新 `docs/ai-agent-production-plan.md` §2 基线表 | Worker / migration / Outbox 状态与代码一致 | 勾选可核对路径 |
| S0.3 | `docs/LANDING.md` / README 入口 | 指向本总计划 + 实验 env | 新人 5 分钟看懂开关 |
| S0.4 | （可选）收口工作区脏文件 | 业务日默认昨天 4 页 或 独立 PR | 不与 bot 提交混装 |

**退出：** 三份核心文档与 `scripts/bot-worker.js` 头注释一致。  
**可并行：** S0.1 / S0.2 / S0.3 文档互不阻塞（多代理）。

---

## 阶段 S1 · 真实账号文本 E2E + 运维剧本

**依赖：** S0 完成（可弱依赖，但建议先做）。  
**目的：** 用**真实 iLink 账号**证明 DB 模式文本闭环可复现；形成可回切桌面的 runbook。

| 序 | 任务 | 文件/动作 | 验收 |
| ---: | --- | --- | --- |
| S1.1 | 编写 `docs/runbooks/ilink-text-e2e.md` | 环境、migrate、env、停桌面、发消息、查表、停机 | 逐步可抄 |
| S1.2 | 手工 E2E 记录模板 | Inbox 1 行、Outbox sent、微信收到 ack | 附件或日志路径 |
| S1.3 | 故障剧本 4 项 | 杀进程中途 / token 失效 / 双 worker 抢租约 / 断网重连 | 每项：期望状态机 |
| S1.4 | （可选）`scripts/ilink-e2e-smoke.js` | 仅在有 secret 的 CI 或本地跑 | 无 token 时 skip |
| S1.5 | 修正部署文档健康检查 | `server-deployment.md`：worker status 字段含义 | `persistence=mysql` 不误解为生产 |

**退出：** 至少 1 次真实私聊文本闭环成功记录 + 双 worker 仅一方持 lease。  
**禁止：** 在本阶段开始 Core 大搬家。

---

## 阶段 S2 · 凭据加密与二维码控制通道

**依赖：** S1。  
**目的：** 去掉明文 `BOT_ILINK_TOKEN` 作为唯一生产路径；登录与收发解耦。

| 序 | 任务 | 说明 | 验收 |
| ---: | --- | --- | --- |
| S2.1 | 账号凭据加密落库 | `ilink_accounts.credential_ciphertext` + key id；seed 脚本 | 备份无明文 token |
| S2.2 | Worker 启动读库解密 | 替代/优先于 env token | env 仅开发 fallback |
| S2.3 | migration：login 控制命令/结果表 | 短 TTL、requestId、actorId | migration 单测 |
| S2.4 | Web step-up API | 发起登录 / 轮询二维码状态 / 取消；CSRF+RBAC | 未登录 401/403 |
| S2.5 | Worker claim 登录槽 | `loginQr`/`waitLogin` → 写回加密结果 | 二维码不进应用日志 |
| S2.6 | Electron 应急入口 | 调同一控制 API，不直写明文 | 与桌面互斥仍成立 |

**退出：** 无窗口服务器可用「Web 扫码 → Worker 收文本」；文档写清 Secret 与轮换。  
**可并行：** S2.3 与 S2.1 设计冻结后可双开实现。

---

## 阶段 S3 · 图片 / CSV Artifact（入站 + 出站）

**依赖：** S2（凭据稳定）；S1 文本已稳。  
**目的：** 服务器具备与桌面同级的**日报图 / CSV** 能力，且遵守 dedupe-before-stage。

| 序 | 任务 | 说明 | 验收 |
| ---: | --- | --- | --- |
| S3.1 | Artifact 存储适配 | 本地卷或对象存储；TTL；hash | 单测 + 磁盘限额 |
| S3.2 | 入站媒体管线 | CDN allowlist、流式上限、MIME sniff、staging→ready 事务 | 重放不二次下载 |
| S3.3 | Outbox 媒体项 | getuploadurl + 上传 + send；client_id 稳定 | 失败不伪成功 |
| S3.4 | Worker 接日报/CSV 路径 | 先确定性命令，不强制 LLM | 真机发图/收 CSV |
| S3.5 | GC 与指标 | 孤儿 staging、最老年龄 | 可观测 |
| S3.6 | 字体/镜像 | 服务器中文字体；部署文档卷挂载 | PNG 不方块字 |

**退出：** 真实账号：收 CSV 入库回执 + 推送日报 PNG。  
**禁止：** 未完成 S3 就宣称「服务器覆盖全部 iLink 功能」。

---

## 阶段 S4 · `shared/bot-core` 收敛

**依赖：** S1 必选；S3 建议并行启动前至少文本稳。  
**目的：** Web / Worker / Electron **同一业务内核**；API 不再 `require('electron/*')`。

| 序 | 任务 | 说明 | 验收 |
| ---: | --- | --- | --- |
| S4.1 | 建 `shared/bot-core` Ports | Session / Data / Artifact / Model | 纯 Node 可测 |
| S4.2 | 迁 ModeRouter + FastRoute + 日期规则 | 从 `weixin-bot-mode` / commands | 桌面测试不回退 |
| S4.3 | 迁 Analytics + 11 Tools | skills 注册表一份 | 契约测：同输入同 route |
| S4.4 | 迁 Agent loop | 桌面与 server-agent 共用 | 无 BrowserWindow |
| S4.5 | 迁 RAG 所有权 | `weixin-bot-rag` → core；`src/server/bot-core` 薄适配删除或反向 | G1 部分勾选 |
| S4.6 | 通道适配器 | Electron IPC / Web API / Worker Dispatcher 只做边界 | `src/app/api/**` 零 electron require |
| S4.7 | 跨通道 `AgentResult` 契约测 | ADR 类型 | CI 绿 |

**退出：** G1 清单可勾选项全部完成；微信 bot 既有单测仍绿。  
**可并行：** S4.2–S4.5 在 Ports 冻结后按模块分代理，但 **合并顺序** 仍建议 mode → tools → agent → rag。

---

## 阶段 S5 · MySQL Session / Run / Step / Effect

**依赖：** S4（内核稳定后再持久化运行态）。  
**目的：** 可恢复执行、审批占位、崩溃点测试。

| 序 | 任务 | 说明 | 验收 |
| ---: | --- | --- | --- |
| S5.1 | migration：sessions / runs / steps / effects / approvals | 仅 migrations 真源 | runner + 单测 |
| S5.2 | Session Port 实现 | 替换 JSON 文件会话 | 多实例不丢串话 |
| S5.3 | Run/Step 状态机 | RECEIVED→…→SUCCEEDED/FAILED | 崩溃恢复测 |
| S5.4 | Effect ledger | 业务写与 Outbox 同事务 | 故障注入无重复副作用 |
| S5.5 | 审批最小路径 | CSV 覆盖类 Confirmed Write（可后置到 S8 前） | 可选本阶段只留表 |

**退出：** 进程重启后 waiting 会话可恢复；Inbox 已处理不重复业务写。

---

## 阶段 S6 · Web 控制面与 Bot 状态

**依赖：** S2（登录通道）、S4（Core）、S5（会话）。  
**目的：** 管理面可用，不再读「仅文件心跳」。

| 序 | 任务 | 说明 | 验收 |
| ---: | --- | --- | --- |
| S6.1 | Bot status API 读 DB | lease/fencing/cursor/Inbox·Outbox 积压 | `/bot` 真数据 |
| S6.2 | 会话列表/清空/审计 | 用户隔离 | 无裸 session 越权 |
| S6.3 | 知识库 CRUD 闭环 | 写后可检索；角色 | 与 RAG 同源 |
| S6.4 | 答案来源展示 | 数据日 vs 文档标题 | UI 可辨 |
| S6.5 | 运维手册 | 启动/备份/回滚/关 Agent | 5 分钟回滚演练条目 |

**退出：** G2/G3 中 Web 相关项可演示。

---

## 阶段 S7 · 门禁与灰度（生产标签）

**依赖：** S3 + S4 + S5 + S6。  
**目的：** 唯一允许标记「服务器生产可用」的阶段。

| 序 | 任务 | 验收 |
| ---: | --- | --- |
| S7.1 | 黄金评测集 | 数据/日期/RAG 边界/越权；结构化查询 100% 走 Tool |
| S7.2 | 实机 E2E 矩阵 | 帮助、查询、日报图、CSV、人工客服、退出 |
| S7.3 | 24h 内部 + 72h 单账号 | 无已确认重复副作用；unknown 全可追踪 |
| S7.4 | 抢占/断网/重启/Token 失效 | 剧本全过 |
| S7.5 | 5 分钟回滚 | 关 Agent 后固定指令仍可用；可回切桌面 |
| S7.6 | 更新设计文档结论 | 显式写「服务器生产可用」+ 版本号 |

**退出：** G1–G4 全部勾选；`ilink-server-agent-design` P0–P3 全过。

---

## 阶段 S8 · 扩展（仅在 S7 之后）

按 ADR 顺序 6 与框架扩展计划 **F3+**，**有量化需求再开**：

| 序 | 方向 | 备注 |
| ---: | --- | --- |
| S8.1 | Capability Catalog 机器可读 + 逐模块 iLink E2E | 无 unsupported 才可宣称全功能 |
| S8.2 | 定时日报 / 订阅告警 | 出站仍走 Outbox |
| S8.3 | CSV 预检审批 | 用 S5 approval |
| S8.4 | 周月报 / 异常检测 | 确定性优先 |
| S8.5 | 有界多 Agent | 低频异步；禁实时主路径 |
| S8.6 | 抖音画像缓存（B6） | 服务器只读缓存 |

---

## 环境开关总表（按阶段暴露）

| 开关 | 阶段 | 含义 |
| --- | --- | --- |
| `BOT_ILINK_ENABLED` | 已有 | 文本 transport |
| `BOT_ILINK_DB_ENABLED` + `BOT_RUNTIME_SECRET` + `DB_*` | 已有 | lease + Inbox + Outbox |
| `BOT_ILINK_OUTBOX_BATCH` | 已有 | claim 批量 |
| （S2）凭据 key / login API | S2 | 扫码控制面 |
| （S3）`ARTIFACT_ROOT` / 字体路径 | S3 | 媒体 |
| （S4+）`AGENT_*` 模型配置 | S4 | 仅智能模式 |

---

## 建议 commit 节奏

- **每阶段** 以 `docs:` / `feat:` / `test:` 小步提交，与现网 `615` 风格一致。  
- 大阶段结束打 tag：`ilink-s1-e2e` … `ilink-s7-prod`。  
- **禁止**把桌面业务脏改动与 bot 阶段混在同一 commit。

---

## 多代理执行建议

| 模式 | 用法 |
| --- | --- |
| 文档波次 | S0.1–S0.3 三代理并行 |
| 实现波次 | **同一阶段内** 无共享文件冲突的任务才并行（例：S3.1 存储 vs S3.6 字体文档） |
| 默认 | 每阶段 **一个** 实现代理 + 规格审查 + 质量审查 |
| 禁止 | 并行改 `bot-worker.js` 与 `ilink-outbox.js` 的同一接口而不先合并 |

---

## 当前「正确下一刀」（2026-07-24 审计刷新）

> 详表：`docs/superpowers/specs/2026-07-24-project-progress-audit.md`  
> 执行切片：`docs/superpowers/plans/2026-07-24-next-execution-slice.md`  
> S3 规格：`docs/superpowers/specs/2026-07-24-ilink-s3-artifact-pipeline-design.md`

代码已越过「仅 S0」：`S2` 凭据/登录控制通道与 `S3` Artifact 地基已合入。按总序与证据完备性，**下一步**：

1. **S3** Artifact Worker 全链路（S3.1 根目录已落地 → 入站/出站/命令）。  
2. **S1** 有 token 时补文本 E2E 留证（不阻塞 S3 编码）。  
3. **S2 扫码退出** 非当前门禁；env token / seed 凭据足够；控制通道代码保留后置验收。  
4. 文档漂移持续小修。  

**不要**在 S3 媒体未稳前开 S4 Core 大迁或 S8 多 Agent；未过 S7 不得标生产。

---

## 阶段检查清单（打印用）

```text
[ ] S0 文档对齐
[ ] S1 真实文本 E2E + runbook
[ ] S2 凭据加密 + 二维码控制通道
[ ] S3 图片/CSV Artifact
[ ] S4 shared/bot-core
[ ] S5 Session/Run/Step/Effect
[ ] S6 Web 控制面 / Bot DB 状态
[ ] S7 门禁与 24h+72h → 才可标生产
[ ] S8 扩展按需
```

---

## 关联文件索引

| 类型 | 路径 |
| --- | --- |
| 本总计划 | `docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md` |
| 已做切片 | `2026-07-24-bot-worker-ilink-text-loop.md` |
|  | `2026-07-24-ilink-db-lease-inbox-cursor.md` |
|  | `2026-07-24-ilink-outbox-text-dispatch.md` |
|  | `2026-07-24-ilink-outbox-reclaim-reconcile.md` |
| ADR | `docs/adr/0001-agent-runtime-contract.md` |
| 部署 env | `docs/server-deployment.md` |
