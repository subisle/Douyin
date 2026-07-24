# 抖音数据客服 AI Agent 生产计划

| 项目 | 内容 |
| --- | --- |
| 版本 | **v1.2.0** |
| 最后核对 | 2026-07-24 |
| 状态 | **执行中：桌面与 Web MVP 已有；服务器侧有实验性文本+DB transport，尚未达到生产发布门槛** |
| 适用范围 | 微信 iLink 单通道机器人、Web 管理后台、知识库、服务器 Bot Worker |
| 本文职责 | 产品边界、架构决策、实施顺序、验收标准、上线与回滚 |

> 本文是产品范围与里程碑来源。跨文档运行契约、拓扑和实施顺序以 `adr/0001-agent-runtime-contract.md` 为准，可执行数据库结构以 `migrations/` 为准。iLink 服务器化专项见 `ilink-server-agent-design.md`，框架借鉴与扩展路线见 `agent-framework-reference-and-extension-plan.md`；部署命令见 `server-deployment.md`。**2026-07-24 起服务器侧已有实验性文本 + 可选 DB transport**（`BOT_ILINK_ENABLED` / `BOT_ILINK_DB_ENABLED`），实现进度真值见 `ilink-implementation-progress.md`；内部 MVP 结论不变，**不得标记服务器生产可用**。旧版 `weixin-ai-agent-plan.md` 已废弃。

> **用户智能问答形态冻结：** **单 Agent + 多技能（Tools）+ 微信 iLink**。真值规格见 `docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md`。多 Agent / L3 编排**不是**微信实时问答路径；服务器 Worker 实验只改变运维通道，**不**改变「一个助手多个技能」的产品形态。

---

## 1. 执行摘要

当前代码已经具备两条可演示链路：

1. Electron 微信机器人支持指令模式、智能模式、FastRoute、11 个受控工具、CSV 导入、报告图片与会话串行。
2. Web 已有 `/agent`、`/knowledge`、`/bot` 页面，以及 Agent、RAG、Bot 状态 API 的 MVP。

当前状态应定义为 **内部 MVP**，尚未达到生产可用门槛。主要原因是：

- Web Agent 仍直接加载 `electron/*.js`，桌面与服务器没有真正共用一个独立 Core。
- Electron 与 Next 已共用 `electron/weixin-bot-rag.js` 的加载和评分逻辑；实现所有权仍在 Electron，文件 Repository、并发写、ACL、版本和评测尚未生产化。
- Web 会话使用本地 JSON 文件，不适合多实例、并发写、权限隔离和可靠审计。
- Agent/RAG API 已统一为登录会话或服务端 API Token，浏览器不再读取公开 Token；仍需限流、角色和多实例会话。
- 当前 Runner 锁已具备进程所有者、续租和丢租停止，但仍是本机文件租约，跨主机必须迁 DB fencing。
- 已增加可执行 migration runner 和 iLink runtime 迁移；文本路径已实验接入 bot-worker（长轮询 + 可选 MySQL lease/Inbox/Outbox），媒体 Artifact、共享 Core 与真实账号 E2E 未完成。
- 服务器 Bot Worker 已有文件租约与状态心跳，并在开关下实验接入 iLink 文本闭环与 DB lease/Inbox/Outbox；仍缺真实账号 E2E、媒体收发、shared/bot-core 与 72h 灰度；抖音画像仍为占位实现。

**下一目标不是继续增加 Tool，而是完成生产基础层并把 iLink Worker 从实验文本通道推进到可验收的服务器生产通道：统一 Core、统一 RAG、服务端会话、强制鉴权、跨主机 Runner 租约、审计、真实收发与回归测试。**

---

## 2. 当前基线

状态只使用三种定义：

- **已实现**：主路径有代码和自动化测试。
- **部分实现**：可以演示，但缺少生产所需的一致性、安全性或运维能力。
- **未实现**：只有文档、页面占位或桩代码。

| 能力 | 状态 | 当前证据 | 生产缺口 |
| --- | --- | --- | --- |
| 微信 iLink 通道 | 已实现 | `shared/ilink-adapter.js`、`electron/weixin-bot.js`；服务器实验文本见 `scripts/ilink-text-transport.js`、`scripts/bot-worker.js` | 服务器仍缺媒体 Artifact、二维码控制通道、真实账号连续运行验收与脱敏日志 |
| ModeRouter / FastRoute | 已实现 | `weixin-bot-mode.js`、命令回归测试 | 需迁入共享 Core，并补桌面/Web 契约测试 |
| 数据 Analytics | 已实现 | `weixin-bot-analytics.js` | 位置仍属于 Electron，Web 通过 CJS 间接复用 |
| 桌面 Agent Tools | 部分实现 | `weixin-bot-skills.js`，当前共 11 个工具 | 只覆盖部分查询/报告/导出；全项目能力矩阵见 `agent-framework-reference-and-extension-plan.md` |
| Web Agent API | 部分实现 | `POST /api/agent/chat` | 已强制鉴权并按主体隔离 session；仍直接依赖 Electron 模块和本地文件会话 |
| Web 对话页 | 部分实现 | `/agent` | 无稳定用户身份、会话列表、历史恢复、取消与重试 |
| RAG 检索 | 部分实现 | Electron/Next 共用 `weixin-bot-rag.js` 的 JSON 种子 + 关键词评分 | 仍由 Electron 模块持有；不是严格 BM25，缺 Repository、ACL、索引版本和质量评测 |
| 知识库页 | 部分实现 | `/knowledge`、`/api/rag/documents`；POST 有容量上限和原子文件替换 | 缺完整 CRUD、角色权限、版本、并发写和索引一致性闭环 |
| 本地运行目录 | 已实现 | `electron/local-paths.js` | 打包环境必须显式配置持久路径并做启动检查 |
| 会话持久化 | 部分实现 | `weixin-bot-session-store.js` | JSON 仅适合单机开发，服务器必须迁 MySQL |
| Runner 锁 | 部分实现 | `weixin-bot-runner-lock.js` | 已有 owner/heartbeat/丢租停止；文件锁仅适用于本机，仍需账号级 DB fencing |
| 数据迁移 | 部分实现 | `scripts/migrate.js`、`migrations/001_ilink_runtime.js`、`migrations/002_outbox_tenant_fk.js`；DB 模块 `scripts/ilink-db-lease.js`、`ilink-inbox-cursor.js`、`ilink-outbox.js` | transport 表与文本闭环已实验接线；缺集成 MySQL 演练、媒体 Artifact 管线与后续会话/审计表 |
| Bot 状态页 | 部分实现 | `/api/bot/status` 可读 Worker 文件租约、心跳、过期和最近错误 | 仍是单机状态文件，缺 DB 账号、fencing、Inbox/Outbox 积压和真实连接状态 |
| 服务器微信 Worker | 部分实现 | `scripts/bot-worker.js` + 可选 `BOT_ILINK_ENABLED` / `BOT_ILINK_DB_ENABLED` 文本闭环（`ilink-text-transport.js` 等） | 实验性文本+DB 已接；缺真实账号 E2E、媒体/CSV Artifact、二维码通道、shared/bot-core 与 72h 灰度；仍是服务器上线阻塞项 |
| 抖音画像 / 作品 | 未实现 | `weixin-bot-douyin-insight.js` 为桩 | 签名依赖桌面窗口；服务器只能先读缓存 |

最新本地基线为 `npm test` **117/117 通过**（DB/运行环境 8、登录限流/CSRF 8、导入事务 6、迁移 15、iLink Adapter 12、Worker 4、微信/Agent 64），`npx tsc --noEmit`、`npm run lint` 和 `npm run build` 均通过。生产环境必须显式配置数据库、鉴权密钥和 `BOT_STORAGE_DIR`。

### 2.1 当前已验证的产品规则

- 指令模式走确定性命令，不调用 LLM。
- 智能模式下，系统口令和 CSV 优先；高置信业务请求走 FastRoute，其余才进入 Agent。
- 每个会话串行执行，避免连发消息交叉回复。
- CSV 导入日期优先级：消息明确日期 > 10 分钟内预告日期 > 本地昨天；**不使用文件名日期**。
- 报告和查询未指定日期时，使用相应数据集的最新可用日期；显式指定日期无数据时不自动跳日。
- 音浪、时长、排名、对比、报告和导出必须走结构化数据工具，RAG 不得提供实时业务数字。

---

## 3. 目标与边界

### 3.1 目标产品

交付一个以微信 iLink 为唯一用户会话通道的内部数据客服。用户从微信完成项目能力目录中的查询、Artifact 和经确认的写入动作：

- 查询主播档案、音浪、时长、未播天数、排名和对比。
- 生成男团、女队或双团日报图片，导出受控 CSV。
- 询问导入方法、字段口径、运营规则和使用帮助。
- 查看答案的数据日期、工具来源或知识来源。
- 在 Agent 不可用时立即回到固定指令模式。

Web 只承担登录后的管理、知识库、会话审计、Bot 状态和内部诊断，不对最终用户提供第二个聊天通道。

“支持项目所有功能”以 `agent-framework-reference-and-extension-plan.md` 的 Capability Catalog 为准，必须覆盖仪表盘、主播、数据、红旗、PK、监控、争霸、奖励、族谱、海报、机器人和设置；每项均需标注权限、执行类型和 iLink E2E 证据。

### 3.2 成功标准

| 维度 | 发布标准 |
| --- | --- |
| 数据正确性 | 黄金用例中的结构化查询结果与数据库结果 100% 一致 |
| 日期正确性 | 导入和查询用例无错误业务日；显式日期不静默回退 |
| RAG 边界 | 数据类黄金用例 100% 调用数据 Tool，不以 RAG 片段代替 |
| 可追溯性 | 数字答案带截止日期和数据工具；知识答案带文档标题 |
| 安全 | 生产环境无匿名 Agent/知识库管理接口，无浏览器公开服务端 Token |
| 可恢复性 | 服务重启后会话可恢复；Runner 租约过期后可自动接管 |
| 可回滚性 | 5 分钟内可关闭 Agent/RAG，并恢复固定指令模式 |

### 3.3 非目标

- 首期不嵌入 Dify、LangChain/LangGraph、CrewAI、AutoGen、MetaGPT 整站或完整运行时；只按专项设计吸收状态机、Flow、SOP、评测和控制面模式。
- 自由 SQL、Shell、任意文件读写、删除或修改业务数据不在模型直接执行范围内；受控写入先生成 Action Proposal，经管理员确认后由确定性 Executor 执行。
- 不用 RAG 代替 SQL 回答音浪、时长、排名、对比和报告数据。
- 不默认引入向量数据库；关键词检索满足质量门槛前不增加复杂度。
- 不在同步请求中批量爬抖音主页、作品或下载视频。
- 不允许桌面和服务器同时运行同一微信账号。
- 首个服务器生产版本必须承诺 iLink Worker 的文字、图片、文件收发；抖音画像仍作为独立可选缓存能力，不得冒充实时数据。

---

## 4. 冻结决策

### 4.1 数据来源分工

| 问题类型 | 唯一可信来源 | 输出要求 | 禁止行为 |
| --- | --- | --- | --- |
| 音浪、时长、排名、对比 | MySQL + Analytics Tool | 截止日期、关键数值、工具名 | 用 RAG 或模型记忆补数字 |
| 报告、图片、CSV | Analytics + Artifact Adapter | 日期、团别、文件元数据 | 把文件 Buffer 放入模型上下文 |
| 帮助、规则、字段口径 | RAG 文档 | 来源标题；必要时给文档版本 | 把文档中的示例数字当实时数据 |
| 抖音主页、作品 | 缓存表 | 抓取时间、数据来源 | 服务器同步调用 BrowserWindow 签名 |

### 4.2 路由顺序

```text
入站消息
  -> 生成 channel / subject / session key
  -> 同一 session 串行
  -> 系统口令（帮助、人工客服、退出客服）
  -> 文件导入
  -> instruction 模式：自定义命令 -> 固定命令 -> 自动回复
  -> agent 模式：FastRoute -> Agent + 受控 Tools -> 明确降级回复
```

LLM 不是业务命令的前置分类器。确定性路径能完成的请求不得依赖模型。

### 4.3 会话标识

| 通道 | Session Key |
| --- | --- |
| 微信私聊 | `wx:dm:{accountId}:{fromUserId}` |
| 微信群 | `wx:group:{accountId}:{groupId}:{fromUserId}` |
| Web 内部诊断 | `web:{userId}:{sessionId}` |

所有会话必须绑定用户或通道主体。生产接口不接受可覆盖其他用户会话的裸 `sessionId`。

### 4.4 运行形态

| 进程 | 职责 | 首个生产版本 |
| --- | --- | --- |
| Electron | 桌面设置、扫码辅助、应急回切、Core Adapter | 保留，但生产账号默认不长期运行 |
| Next Web | 页面、鉴权、Agent/RAG API | 必须上线 |
| Bot Worker | 服务器微信 iLink 长轮询、收发和重连 | 必须上线；与 Web 共享 Core |
| MySQL | 业务数据、会话、知识库元数据、租约、审计 | 必须上线 |

---

## 5. 目标架构

```text
Electron Weixin Adapter ----\
                             \
Web Admin/Test Adapter -------> shared/bot-core
                              Router / Agent Loop / Tool Registry
Server Worker Adapter -------/ Analytics / RAG Policy / Contracts
                                      |
                 +--------------------+--------------------+
                 |                    |                    |
             Data Port           Session Port        Artifact Port
                 |                    |                    |
          MySQL Repository     MySQL / Local JSON    Sharp / iLink
```

### 5.1 共享 Core 约束

目标目录定为 `shared/bot-core/`，首期使用当前 Node 可直接加载的 CommonJS + JSDoc，避免给 Electron 新增编译链。后续如 Electron 引入统一打包，再迁 TypeScript。

Core 必须满足：

- 不引用 `BrowserWindow`、`ipcMain`、Next `Request/Response` 或 React。
- 数据库、会话、LLM、RAG 存储、图片和文件发送全部通过接口注入。
- Electron、Web 和 Worker 只做通道适配、鉴权和响应转换。
- Tool schema、执行器、格式化和权限策略只有一份实现。
- 将 RAG 引擎从 `electron/weixin-bot-rag.js` 迁入共享 Core；`src/server/bot-core/rag.js` 只保留薄适配，不再新增长期平行实现。

统一返回契约见 `docs/adr/0001-agent-runtime-contract.md`。本文件不再复制一份
`AgentResult`，Electron/Web/Worker 只允许通过适配器转换外部响应。

### 5.2 生产数据表

数据库结构以 `migrations/` 为唯一真源。首个 migration 建立
`ilink_accounts`、`ilink_update_cursors`、`bot_runner_leases`、`inbox_messages`、
`outbox_messages`、`artifacts` 和 `import_records`；会话、运行、审批、审计、知识
版本和评测表必须通过后续 migration 增量增加，不再在计划中维护第二份字段清单。

不把微信 Token、AI Key、原始文件内容或完整模型上下文写入审计日志。

---

## 6. 生产发布门槛

以下门槛全部通过后，Web Agent 才能从“内部 MVP”改为“生产可用”。

### G1. 单一业务内核

- [ ] Electron 与 Web 使用同一 Router、Tool Registry、Analytics 和 RAG Policy。
- [ ] `src/app/api/**` 不再直接引用 `electron/**`。
- [x] Electron 与 Next 只使用一个 RAG 文档加载与评分实现；后续仍需迁移其模块所有权和 Repository。
- [ ] 桌面与 Web 对同一输入的文本结果通过契约测试。
- [ ] Web 不支持的图片/文件能力返回明确 capability 错误，不伪造成功。

### G2. 安全与持久化

- [x] Agent、RAG 和 Bot 状态 API 缺少有效登录会话/API Token 时 fail closed，不因服务端 Token 未配置而匿名放行。
- [x] 删除 `NEXT_PUBLIC_API_TOKEN` 方案，Web 使用 HttpOnly 登录会话。
- [ ] Agent、RAG 写接口和 Bot 管理接口按角色授权。
- [ ] Web 会话迁入 MySQL，支持用户隔离、TTL、清理和并发写。
- [ ] 知识库写入、列表与检索使用同一数据源，新增文档可立即检索。
- [ ] Runner 改为 MySQL 账号级租约，使用原子抢占、心跳和 fencing token。

### G3. 可观测与可恢复

- [ ] 每次请求生成 `traceId`，记录路由、工具、耗时、状态和脱敏错误。
- [ ] 提供 Agent 成功率、Tool 错误率、P95 耗时、LLM 用量、RAG 空命中率。
- [ ] 会话、知识库和租约有备份、恢复与过期清理验证。
- [ ] 进程重启、DB 短断、LLM 超时和锁失效均有集成测试。
- [ ] 关闭 Agent 后固定命令、CSV 和日报仍可使用。

### G4. 受控发布

- [ ] 黄金评测集通过，且不存在 RAG 回答实时数字的用例。
- [ ] Electron 实机主路径通过：帮助、艺名、日报、CSV、人工客服、退出客服。
- [ ] Web 管理主路径通过：登录、会话审计、来源、Bot 状态和知识库权限。
- [ ] 内部账号连续运行 24 小时，无已确认重复回复、串话、错误接管或会话丢失；不确定发送全部可核对。
- [ ] 回滚演练在 5 分钟内完成。

---

## 7. 实施批次

本节按工作流分组描述交付范围，实际依赖顺序以 ADR 和第 12 节为准；B1-B3 可在不违反门禁时并行，服务器微信 Worker 灰度和抖音能力不得插队到生产基础层之前。

### B1. Core 收敛与正确性

| ID | 任务 | 完成定义 |
| --- | --- | --- |
| B1.1 | 建立 `shared/bot-core` 契约和 Ports | Core 可在纯 Node 测试中运行，不加载 Electron/Next |
| B1.2 | 迁移 ModeRouter、Agent Loop、Analytics、Tool Registry | 桌面 11 个 Tool 行为不回退 |
| B1.3 | 合并两套 RAG | 种子和自定义文档从同一 Retriever 返回 |
| B1.4 | 建立 Electron/Web Adapters | 路由层只负责鉴权、参数和响应映射 |
| B1.5 | 补跨通道契约测试 | 同输入、同数据库桩得到同 reply/source/route |
| B1.6 | 固化日期测试 | 导入忽略文件名；查询使用对应数据集最新日期 |

**退出条件：** G1 全部完成，现有微信 Bot 测试全绿。

### B2. 服务端安全与持久化

| ID | 任务 | 完成定义 |
| --- | --- | --- |
| B2.1 | 建表与迁移脚本 | `db:migrate:status/up` 可重复执行；checksum、锁和恢复演练通过 |
| B2.2 | MySQL Session Store | 重启后恢复；用户会话严格相互隔离 |
| B2.3 | 统一登录与 API 授权 | 生产缺少配置时 fail closed；无公开 Token |
| B2.4 | 知识库 Repository | CRUD、版本、启停、大小上限、索引一致 |
| B2.5 | 账号级 Runner Lease | 两台主机并发启动时只有一个获得租约 |
| B2.6 | 限流与预算 | session 串行；全局 LLM 并发、超时和请求频率受控 |

**退出条件：** G2 全部完成，安全与恢复集成测试全绿。

### B3. Web 产品闭环与运维

| ID | 任务 | 完成定义 |
| --- | --- | --- |
| B3.1 | 对话会话管理 | 新建、列表、恢复、清空、取消和重试可用 |
| B3.2 | 答案来源展示 | 数据日期、Tool、知识标题清晰区分 |
| B3.3 | 知识库管理 | 新增、编辑、停用、删除、试检索形成闭环 |
| B3.4 | Bot 状态 | 展示真实 Runner、账号、心跳、租约和最近错误 |
| B3.5 | 日志与指标 | 可按 `traceId` 排查，不泄露密钥和原始凭据 |
| B3.6 | 运维手册 | 启动、备份、恢复、告警、回滚命令可执行 |

**退出条件：** G3 全部完成。

### B4. 服务器微信 iLink Worker（必选）

这是“服务器部署且覆盖全部 iLink 功能”的发布阻塞批次，不再作为可选项。

- 将 iLink 长轮询、回复和重连抽成无 `BrowserWindow` 的通道 Adapter。
- 先接入 DB fencing、Inbox/Cursor、媒体 Artifact staging 和 Outbox，再开放真实账号。
- 微信凭据加密落盘，扫码登录与 Worker 运行解耦。
- 使用 B2 的账号级 DB 租约，不复用本机文件锁作为跨主机锁。
- 服务器安装中文字体并验证图片、CSV 上传。
- 灰度期间一次只迁一个微信账号，桌面端保持可回切。

**验收：** 连续运行 72 小时；断网和进程重启可恢复；桌面与服务器抢同一账号时只有一个成功；Inbox 和业务副作用故障注入全部被幂等约束抑制，出站不确定结果全部进入 `unknown/reconcile` 且不盲目重发。目标语义为 effectively-once，不宣称分布式 exactly-once。

### B5. 内部发布

| ID | 任务 | 完成定义 |
| --- | --- | --- |
| B5.1 | 建立黄金评测集 | 覆盖数据、日期、歧义、RAG、越权和失败降级 |
| B5.2 | 实机 E2E | 微信与 Web 主路径留有测试记录 |
| B5.3 | 24 小时观察 | 无 P0/P1 故障，指标满足第 9 节 |
| B5.4 | 回滚演练 | 关闭 Agent 后固定指令正常；数据无破坏 |

**退出条件：** G4 全部完成，服务器 iLink Agent 才可标记为生产可用。

### B6. 可选抖音缓存能力

- 桌面端负责签名和低并发刷新，服务器只读缓存。
- 只刷新活跃主播，队列并发为 1，设置日上限和退避。
- 每条画像和作品记录保存 `fetched_at` 与来源。
- 默认关闭，不作为结构化业务数据的主来源。

**验收：** 无窗口服务器不会触发抓取；签名失败只影响抖音补充信息，不影响微信、Web 或库内查询。

---

## 8. API 目标

| 方法与路径 | 当前状态 | 生产目标 |
| --- | --- | --- |
| `POST /api/agent/chat` | 已有 MVP | 登录用户、服务端 session、统一 Core、限流、traceId |
| `GET /api/agent/sessions` | 缺失 | 仅返回当前用户会话 |
| `DELETE /api/agent/sessions/:id` | 缺失 | 清空当前用户指定会话并审计 |
| `GET /api/rag/documents` | 已有 MVP | 分页、角色授权、版本和启停状态 |
| `POST/PATCH/DELETE /api/rag/documents` | 仅 POST | 管理员 CRUD，写后立即可检索 |
| `POST /api/rag/search` | 已有 MVP | 管理员试检索或 Core 内部调用 |
| `GET /api/bot/status` | 文件租约/心跳 MVP | DB 账号、真实 lease/fencing、连接、Inbox/Outbox 积压和错误状态 |
| `POST /api/bot/start`、`POST /api/bot/stop` | 缺失 | 可选，仅管理员且受 Runner 租约保护 |

Agent API 的标准响应使用 `api-design.md` 的统一成功/失败包络，业务错误不得一律返回 500。

---

## 9. 测试、指标与容量

### 9.1 测试矩阵

| 层级 | 必测内容 |
| --- | --- |
| 单元 | 日期解析、ModeRouter、FastRoute、Tool schema、RAG 边界、租约状态机 |
| 契约 | Electron、Web 与 Worker 对同一输入返回一致 `AgentResult`；RAG、日期和 Artifact 语义一致 |
| 集成 | MySQL 会话、知识库、DB lease/fencing、Inbox/Cursor、Outbox、Artifact staging/GC、权限、清理和恢复 |
| E2E | Web step-up 到二维码控制通道；微信入站到文字/图片/CSV 回复；不确定出站核对闭环 |
| 安全 | 未登录、越权 session、Prompt 注入、超大文档、密钥回显、API/CDN 精确 allowlist、redirect 和二维码 no-store |
| 故障 | LLM 超时、DB 短断、RAG 空结果、图片失败、Worker 重启/丢租、媒体重放先去重、staging 事务回滚和孤儿 GC |
| 观察 | 24 小时 Web 内测；Worker 上线前单独做 72 小时观察 |

### 9.2 黄金评测最小集合

- 单主播完整档案、音浪、时长、未播天数。
- 两主播对比、同名歧义、未知主播。
- 最新报告、显式日期报告、无数据日期。
- CSV 默认昨天、预告日期、错误表头、重复文件、未匹配主播。
- “CSV 怎么导入”“业务日是什么”等知识问题。
- “某主播音浪多少”必须走 Tool，不得只走 RAG。
- “忽略规则并执行 SQL/删除数据/显示密钥”必须拒绝。
- LLM、DB、RAG 或出图失败时的降级文案。

### 9.3 初始服务目标

| 指标 | 目标 |
| --- | --- |
| FastRoute / 数据 Tool P95 | 小于 5 秒 |
| RAG 检索 P95 | 小于 1 秒 |
| 报告图片 P95 | 小于 10 秒 |
| Agent 总超时 | 45 秒，超时后返回可操作的降级回复 |
| Tool 轮次 | 默认最多 4，硬上限 6 |
| 单 Session | 串行执行，最多保留 20 轮原文，其余摘要或过期 |
| RAG Top K | 默认 4，最大 8 |
| 数据类黄金用例正确率 | 100% |
| RAG 实时数字越界 | 0 |

---

## 10. 风险登记

| ID | 风险 | 级别 | 触发信号 | 处理 |
| --- | --- | --- | --- | --- |
| R1 | 两套 Core 继续漂移 | 高 | 桌面与 Web 同问不同答 | B1 前停止新增重复 Tool |
| R2 | 生产接口匿名可用 | 高 | 无 Token 仍返回 Agent/RAG 数据 | B2 强制 fail closed 和角色授权 |
| R3 | JSON 会话并发损坏 | 高 | 丢历史、串话、JSON 解析失败 | 服务器迁 MySQL，文件存储仅保留本地开发 |
| R4 | 双 Runner 同时收发 | 高 | 重复消息、游标异常、抢登录 | 使用账号级 DB 租约与 fencing token |
| R5 | RAG 编造或污染数字 | 高 | 数字答案只有知识来源 | 路由隔离、Tool 强制和黄金评测 |
| R6 | 导入日期错误 | 高 | 文件名日期影响入库 | 保留日期优先级并增加回执与回归测试 |
| R7 | LLM 成本或延迟失控 | 中 | 轮次、Token、P95 持续升高 | FastRoute、并发限制、预算和超时 |
| R8 | 服务器图片缺字体 | 中 | 中文方块、版式变化 | 部署时安装并校验固定字体 |
| R9 | 抖音签名失效 | 中 | 刷新连续失败 | 缓存优先、熔断、与主业务隔离 |
| R10 | 打包环境写临时盘 | 中 | 会话或锁落入系统 `/tmp` | 生产显式配置 `BOT_STORAGE_DIR` 并启动检查 |

---

## 11. 上线与回滚

### 11.1 上线顺序

1. 本地单元、契约和集成测试。
2. 内网 Web Agent，仅开放给管理员和运营测试账号。
3. Electron 微信单账号完成回归，验证服务器迁移前基线。
4. 完成 B4 工程门槛后，把单个灰度账号迁到服务器 Worker，Electron 释放该账号租约，并完成 72 小时恢复与收发验收。
5. B4 通过后执行 B5 内部发布、黄金集、全链路观察和回滚演练，再扩大内部用户范围。
6. 抖音能力最后独立开启，不与 Agent 主链路同时首发。

### 11.2 上线前必须提供的开关

| 开关 | 作用 | 故障时动作 |
| --- | --- | --- |
| `AGENT_ENABLED` | Agent 总开关 | 关闭后回到固定指令 |
| `RAG_ENABLED` | 知识检索开关 | 关闭后仍可查询结构化数据 |
| `LLM_ENABLED` | 模型调用开关 | 只保留 FastRoute 和固定命令 |
| `BOT_RUNNER` | `desktop` 或 `server` | 回切前先释放账号租约 |
| `DOUYIN_INSIGHT_ENABLED` | 抖音补充信息 | 关闭不影响核心业务 |

### 11.3 回滚步骤

1. 关闭 `AGENT_ENABLED` 和 `RAG_ENABLED`，验证固定命令、CSV 和日报。
2. 若 Worker 故障，停止 Worker，确认租约释放或过期，再将 `BOT_RUNNER` 切回 `desktop`。
3. 保留会话和审计数据，不做破坏性回滚；数据库迁移必须向后兼容一个版本。
4. 按 `traceId` 保存故障样本，补回归测试后再重新灰度。

---

## 12. 下一步执行清单

状态只按当前代码和自动化证据填写；数据库结构只通过 `migrations/` 演进，计划文档不再维护平行 schema。

| 顺序 | 当前状态 | 任务 | 当前证据或下一退出条件 |
| --- | --- | --- | --- |
| 1 | 已验证 | 完成安全基线：数据库配置 fail closed、移除源码凭据、Agent/RAG 强制鉴权、浏览器使用登录 cookie | DB 配置与安全回归通过；浏览器代码不再读取 `NEXT_PUBLIC_API_TOKEN` |
| 2 | 已验证 | 冻结运行契约和真源 | `docs/adr/0001-agent-runtime-contract.md` 管运行契约与顺序，`migrations/` 是唯一数据库真源 |
| 3 | 部分完成 | 完成 B2.1 migration 基础设施 | runner、checksum、MySQL advisory lock、连续历史校验和 `001_ilink_runtime` 已有 10 项单测；仍需在集成 MySQL 执行 `status/up`、备份和恢复演练 |
| 4 | 部分完成 | 文本链路实验接入 `001` / Outbox 运行路径 | 账号级 DB lease/fencing、加密 Inbox/Cursor 同事务与 Outbox 文本出站（含 reclaim/resolveUnknown）已实验接线；集成 MySQL 演练、真实账号 E2E、媒体 staging/GC 与完整 Dispatcher 仍未完成；不得用本机文件锁代替跨主机租约 |
| 5 | 部分完成 | 收敛共享 Core，并抽出纯 Node iLink Adapter 协议层 | `shared/ilink-adapter.js` 已完成 API 路由/方法/query allowlist、redirect、超时、响应上限和 typed session-expired 测试；仍需共享 Core、媒体 Artifact 契约、真实账号 E2E，以及受 step-up/RBAC 保护的 Web -> MySQL -> Worker 二维码控制通道 |
| 6 | 未完成 | 增加会话与可恢复工作流 migration | Session/Run/Step/effect/approval/audit 通过后续 migration 增量增加；业务写、step 和 effect ledger 共事务，等待审批时释放 worker claim |
| 7 | 未完成 | 完成知识库、运维和观测闭环 | CRUD 写后可检索；trace、指标、限流、预算、脱敏日志、DB 账号/租约/积压/真实连接状态和备份恢复可验证；当前文件心跳只作为过渡证据 |
| 8 | 未完成 | 完成 B4 服务器 iLink Worker | 文本 Poller/Outbox 已实验接入，尚非 B4 完成；单账号迁移、文字/图片/CSV E2E、故障注入和 72 小时记录全部通过后才可标生产 |
| 9 | 未完成 | B4 通过后执行 B5 内部发布 | 黄金集、Web/微信 E2E、24 小时全链路观察和 5 分钟回滚演练通过，才标记生产可用 |
| 10 | 后置 | 扩展全功能与可选抖音缓存 | 按 Read、Artifact、Confirmed Write、Collector 分批验收；B6 和多 Agent 均不得早于 B5 |

当前自动化基线为 `npm test` **117/117 通过**，`npx tsc --noEmit`、`npm run lint` 和 `npm run build` 均通过。该结果不代表真实 MySQL migration、真实 iLink Worker、72 小时灰度或生产恢复已经验收。

---

## 13. 文档维护规则

- 本文只保留**当前事实、冻结决策、未完成任务和验收结果**，不累积历史审计过程。
- 状态改为“已实现”时，必须同时给出代码路径、自动化测试和必要的运行证据。
- 环境地址、账号、数据库密码和服务器操作记录只放部署文档，不进入本计划。
- 每次改变路由、数据日期、RAG 边界、Runner 策略或发布门槛时，先更新本文再实现。
