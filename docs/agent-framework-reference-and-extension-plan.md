# Agent 框架借鉴与功能扩展设计

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.0 |
| 核对日期 | 2026-07-22 |
| 适用范围 | 微信 iLink 单通道、Node.js Agent Core、服务器 Worker、Web 管理后台 |
| 参考项目 | LangChain/LangGraph、CrewAI、AutoGen、MetaGPT、Dify |
| 冻结结论 | **借鉴成熟机制，首期不直接引入任一整套运行时** |

> iLink 仍是唯一用户会话通道。本文件只扩展 Agent 编排、管理、评测和业务能力，不增加公众号、企业微信、Webhook 或其他 IM 通道。

## 1. 执行结论

项目可以继续扩展，而且扩展空间很大，但顺序必须是：

1. 先完成真实服务器 iLink Worker、共享 Core、MySQL 会话、租约、幂等和 Outbox。
2. 再建立可恢复的工作流内核、Tool Policy、配置版本和评测体系。
3. 然后上线定时报表、异常预警、导入审批、知识库治理和高级数据分析。
4. 最后只在低频、异步、结果可校验的任务中启用角色型多 Agent。

普通微信问答继续使用“确定性路由 + 单 Agent + 受控 Tool”。多 Agent 不是默认路径，也不是能力先进程度的指标。

能力等级统一定义为：

| 等级 | 定义 | 当前判断 |
| --- | --- | --- |
| L0 | 确定性命令、固定数据查询和文件处理 | 桌面链路已具备 |
| L1 | 单 Agent + 受控 Tool + 会话 | 桌面 MVP 已具备，服务器链路不完整 |
| L2 | 可恢复、版本化、有审批和评测门禁的工作流 | 服务器生产目标 |
| L3 | 有界多 Agent、SOP 和可视化编排 | 后续按收益启用 |

### 1.1 当前实现差距

| 现状 | 代码证据 | 需要补齐 |
| --- | --- | --- |
| Agent 是同步请求内 Tool Loop | `electron/weixin-bot-agent.js`、`weixin-bot-server-agent.js` | Run/Step、checkpoint、resume、cancel、审批和版本 |
| Tool 按名称直接执行 | `electron/weixin-bot-skills.js` | schema 校验、ACL、风险级别、超时、重试、幂等和审计 |
| iLink 批次处理完成后才推进游标，去重主要在内存 | `electron/weixin-bot.js` | Inbox + cursor 同事务、异步 Session Dispatcher、稳定 Outbox |
| Web 会话写本地 JSON | `electron/weixin-bot-session-store.js` | MySQL 会话、租户隔离、并发控制和 TTL |
| 模型和 Prompt 内嵌在模块中 | `electron/weixin-bot-agent.js` | Model Port、Prompt Version、降级和预算 |
| RAG 有 Electron 与 Next 两套实现 | `electron/weixin-bot-rag.js`、`src/server/bot-core/rag.js` | 单一 Repository、分块、ACL、索引版本和评测 |
| Worker 和 Bot 状态仍是桩 | `scripts/bot-worker.js`、`src/app/api/bot/status/route.ts` | 真实 iLink 收发、心跳、积压和恢复 |
| 没有可执行评测数据模型 | 当前只有测试与文档用例清单 | Dataset、Runner、Scorer、Baseline 和发布门禁 |

## 2. 五个参考项目的取舍

| 项目 | 借鉴内容 | 本项目落点 | 当前不采用 |
| --- | --- | --- | --- |
| LangChain / LangGraph | 标准 Model/Tool 接口、显式状态图、持久检查点、短期/长期记忆分离、人工中断、评测与追踪 | `Orchestrator Port`、节点状态机、checkpoint、middleware、统一 Tool schema | 不引入 Python LangChain；首期也不依赖 LangGraph.js |
| CrewAI | Flow 与 Crew 分离、typed state、事件路由、条件分支、结构化输出、角色和任务边界 | CSV 导入、日报、知识摄取使用确定性 Flow；复杂异步任务可组合角色 | 不用层级 Crew 处理普通查询，不让 Manager Agent 自由派工 |
| AutoGen | Core/AgentChat/Extension 分层、事件消息、终止条件、多 Agent 协作模式、Bench 思路 | 统一 Event Envelope、运行预算、Extension Registry、评测集 | AutoGen 已进入维护模式，不作为新依赖；不使用 Studio 作为生产后台 |
| MetaGPT | `Code = SOP(Team)`、角色到动作、结构化交付物、可复用 SOP | 运营流程版本化，步骤输入输出和产物可审计 | 不照搬“软件公司”角色和自由讨论式协作 |
| Dify | 控制面/执行面、草稿发布、模型管理、知识摄取、节点追踪、LLMOps、Worker 化 | Web 管理后台、不可变运行版本、知识库管线、运行日志和评测 | 不嵌入或二开 Dify 整站，不复制其 Python/Redis/PostgreSQL/插件守护进程栈 |

### 2.1 为什么首期不直接引入框架

- 当前项目是 Next.js + Electron + CommonJS + MySQL；CrewAI、AutoGen、MetaGPT 主要是 Python 运行时。
- Dify 是完整平台，部署和数据模型会与现有 Web、Worker、知识库、权限和 MySQL 重叠。
- 当前业务主链只有少量高价值 Tool，手写明确状态机更易保证日期、数据权限、幂等和回滚。
- 引入框架不会代替 iLink 游标、账号租约、媒体 Outbox、生产鉴权和真实账号 E2E。

保留 `Orchestrator Port`。当工作流数量、人工中断和长任务恢复的复杂度明显超过自研内核时，再用契约测试评估 LangGraph.js 或其他 Node 方案。

借鉴优先级冻结为：**LangGraph 状态与检查点 > Dify 控制面与治理 > CrewAI Flows > AutoGen 分层与事件 > MetaGPT SOP**。五项当前依赖决策均为 `NO`。未来评估 `@langchain/langgraph` 的触发条件是：至少已有 3 个跨请求长流程、需要人工中断恢复，并且手写 checkpoint 的维护成本已有量化证据。

## 3. 目标架构

```text
iLink Adapter
  -> Inbox / Dedupe
  -> Normalize / Identity / Policy
  -> Workflow Orchestrator
       -> Deterministic Command Flow
       -> File Import Flow
       -> FastRoute Data Flow
       -> Agent Tool Flow
       -> Approval / Resume Flow
       -> Scheduled Insight Flow
  -> Result Validator
  -> Artifact Store
  -> Transactional Outbox
  -> iLink Sender

Web Control Plane
  -> Prompt / Model / Workflow / Tool Policy
  -> Knowledge / Evaluation / Run Trace
  -> Draft -> Test -> Publish -> Rollback
```

### 3.1 控制面与执行面

**控制面**只由登录后的 Web 管理后台访问，负责配置、测试、发布、权限、观察和回滚。

**执行面**由 iLink Worker、Workflow Worker 和 Scheduler 组成，只读取已发布的不可变版本。一次运行开始后固定 `runtimeVersion`，中途不热切换 Prompt、模型、Tool 或知识库策略。

### 3.2 推荐进程

| 进程 | 职责 | 首期部署 |
| --- | --- | --- |
| `next-web` | 管理后台和受保护 API | 独立进程 |
| `ilink-worker` | 长轮询、入站归一化、出站发送、账号租约 | 独立进程 |
| `workflow-worker` | Agent、工具、导入、报告和异步任务 | 低负载可与 iLink Worker 同机，进程独立 |
| `scheduler` | 定时报表、预警、清理和评测 | 可先单实例 |
| MySQL | 状态、租约、会话、工作流、Outbox、审计 | 必须持久化 |

首期用 MySQL 队列和 `SKIP LOCKED`/租约即可。只有队列吞吐或延迟证明确有需要时再引入 Redis。

## 4. 可恢复工作流内核

### 4.1 标准状态

```text
RECEIVED
  -> ROUTED
  -> RUNNING
  -> WAITING_INPUT | WAITING_APPROVAL | RETRY_WAIT
  -> SUCCEEDED | FAILED | CANCELLED | EXPIRED
```

Tool、文件写入、数据库写入、Artifact、Outbox 和 iLink Send 都是副作用边界。每个边界前后写 checkpoint 和 effect ledger，进程恢复后不得重复导入或重复发送。

### 4.2 统一事件包络

```ts
type AgentEvent = {
  eventId: string;
  traceId: string;
  runId: string;
  workspaceId: string;
  accountId: string;
  sessionId: string;
  actorId: string;
  type: string;
  schemaVersion: number;
  causationId?: string;
  occurredAt: string;
  payload: unknown;
};
```

禁止把 Token、AI Key、完整文件内容或未脱敏模型上下文放入事件表。

### 4.3 运行终止预算

每次运行必须同时具备：

- `deadlineMs`
- `maxSteps`
- `maxToolCalls`
- `maxModelCalls`
- `maxInputTokens` / `maxOutputTokens`
- `maxCost`（模型提供用量时）
- `cancelSignal`

任一上限命中即停止后续 Agent 循环，返回可追踪的业务结果。终止由运行时强制，禁止依赖 Prompt 要求模型自行结束。

### 4.4 工作流定义

工作流采用版本化 JSON/TypeScript 定义，核心字段为：

```ts
type WorkflowDefinition = {
  id: string;
  version: number;
  trigger: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  inputSchema: object;
  outputSchema: object;
  budgets: RunBudgets;
  status: "draft" | "published" | "retired";
};
```

首期不做任意拖拽执行器。Web 可先提供表单式编辑和只读流程图，发布仍经过 schema、黄金集和权限校验。

### 4.5 统一运行结果

现有 `AgentResult` 扩展为：

```ts
type AgentResult = {
  runId: string;
  workflowId: string;
  workflowVersion: number;
  runtimeVersion: string;
  status: "succeeded" | "waiting_input" | "waiting_approval" | "failed";
  reply: string;
  route: string;
  artifacts: ArtifactRef[];
  sources: SourceRef[];
  usage: { modelCalls: number; toolCalls: number; inputTokens?: number; outputTokens?: number };
  pendingApproval?: { actionId: string; expiresAt: string };
  errorCode?: string;
  traceId: string;
};
```

Artifact 使用持久引用，包含 `artifactId/ownerId/checksum/mime/size/ttl/deliveryState`；模型上下文只接收元数据或受控摘要，不接收大 Buffer。

## 5. Tool、模型与 Agent 策略

### 5.1 Tool Manifest

每个 Tool 除函数 schema 外，必须声明：

- `riskLevel`: `read`、`export`、`write`、`admin`
- `requiredScopes`
- 输入/输出 JSON Schema
- 超时、重试和并发限制
- 是否幂等及幂等键生成规则
- 可访问的数据域和账号域
- 日志脱敏规则
- 是否需要人工确认

Tool Registry 按账号、用户、角色、会话场景和 Workflow 动态暴露工具，不把全部工具交给模型选择。

### 5.2 中间件顺序

```text
identity
 -> authorization
 -> input validation
 -> rate / concurrency / budget
 -> idempotency
 -> timeout / retry / circuit breaker
 -> tool execution
 -> output validation
 -> redaction / audit / metrics
```

自由 SQL、Shell、任意文件系统、任意 URL 请求和浏览器控制默认不注册为模型 Tool。后续 MCP 只允许经管理员安装的服务端、固定能力清单和网络出口策略。

### 5.3 模型网关

新增 Model Profile，而不是在代码中散落 `baseUrl/model/apiKey`：

- 任务类型到模型的映射
- 主模型和降级模型
- 温度、超时、上下文和 Token 上限
- 每日/每账号预算
- 健康状态和熔断
- Prompt 版本与模型版本绑定

结构化查询、日报和导入不因模型不可用而中断；它们继续走确定性路径。

### 5.4 多 Agent 使用边界

允许的低频异步角色：

| 角色 | 输入 | 输出 | 校验方式 |
| --- | --- | --- | --- |
| Data Analyst | 结构化查询结果 | 趋势、异常和解释草稿 | 数值重新计算、schema 校验 |
| Knowledge Curator | 待入库文档 | 分块、标签和冲突提示 | 管理员审核、检索评测 |
| Report Writer | 已校验指标 | 周报/月报文字 | 数据引用核对 |
| Reviewer | 前述结构化产物 | 问题清单或通过 | 规则和黄金用例 |

多 Agent 运行默认最多 3 个角色、6 个步骤、1 次复核，必须设置总超时和成本预算。实时 iLink 普通问答不进入此路径。

## 6. 记忆与知识库

### 6.1 四层数据

| 层级 | 内容 | 生命周期 |
| --- | --- | --- |
| Run State | 当前工作流变量、工具结果引用 | 随运行归档 |
| Session Memory | 最近对话摘要、待补充参数 | TTL 2 小时或业务配置 |
| Confirmed Preference | 用户明确确认的团别、报表偏好、订阅时间 | 可查看、修改、删除 |
| Organization Knowledge | 规则、口径、帮助文档、版本和来源 | 管理员治理 |

模型推断出的个人属性、实时业务数字、密钥、原始文件内容和内部错误不得写入长期记忆。

### 6.2 知识摄取流水线

```text
upload
 -> MIME / size / malware policy
 -> extract
 -> normalize
 -> chunk
 -> metadata / ACL / version
 -> index
 -> retrieval evaluation
 -> publish
```

首期完成严格 BM25/全文检索和评测；只有命中质量证明确有不足时再引入 embedding 与混合检索。知识答案必须保留文档、版本和片段来源。

## 7. 人工确认与暂停恢复

以下操作进入 `WAITING_APPROVAL`：

- 会覆盖或批量写入业务数据的 CSV 导入
- 修改订阅、规则、Prompt、Tool Policy 或模型配置
- 批量推送、跨群发送或高成本长任务
- 任何 `riskLevel=admin` 的 Tool

iLink 返回预览和短审批号；审批命令绑定 `accountId + approverId + runId`，设置 TTL 和一次性 nonce。批准后从 checkpoint 继续，拒绝或过期后结束，不重新执行前序副作用。

## 8. 可靠收发与数据表

在 iLink 设计已有表基础上新增：

| 表 | 用途 |
| --- | --- |
| `workflow_definitions` | 草稿和已发布工作流版本 |
| `agent_runs` | 运行状态、版本、预算和最终结果 |
| `agent_run_steps` | 节点、attempt、输入输出引用和耗时 |
| `effect_ledger` | 已提交副作用，防恢复后重复执行 |
| `inbox_messages` | iLink 入站幂等和处理状态 |
| `outbox_messages` | 待发送文字/图片/文件及重试状态 |
| `tool_policies` | Tool 权限、风险、超时和版本 |
| `prompt_versions` | Prompt 草稿、发布和回滚 |
| `model_profiles` | 模型路由、预算和降级策略 |
| `approval_tasks` | 审批主体、状态、TTL 和 nonce |
| `schedules` / `subscriptions` | 定时任务和微信订阅 |
| `evaluation_cases` / `evaluation_runs` | 黄金用例、结果和回归差异 |

关键唯一键：

- `agent_run_steps(run_id, node_id, attempt)`
- `effect_ledger(run_id, effect_key)`
- `inbox_messages(account_id, ilink_message_id)`
- `outbox_messages(account_id, client_id)`

发送采用 Outbox Dispatcher。业务事务只提交 Outbox，不直接声明发送成功；Dispatcher 收到 iLink 成功响应后再标记 `sent`。

Outbox 状态统一为 `prepared/sending/sent/retry_wait/unknown/reconcile/dead_letter/cancelled`。创建记录时生成一次稳定 `client_id`，重试复用；`unknown` 表示请求超时且上游是否接收不确定，只能走核对或抑制重复流程。

所有 Session、Run、Step、Tool、Document、Artifact、Approval、Usage 和 Audit 记录必须带 `workspace_id/account_id/actor_id` 中适用的隔离字段。多微信账号不自动等于多租户，身份声明和数据过滤必须由服务端生成。

## 9. Web 管理后台

借鉴 Dify 的控制面，但只实现本项目需要的功能：

1. Agent 版本：Prompt、模型、Tool Policy、Workflow 的草稿、测试、发布、历史和回滚。
2. 运行记录：按 traceId 查看路由、节点、Tool、耗时、用量、Outbox 和错误。
3. 知识库：文档版本、ACL、启停、试检索、冲突提示和检索评测。
4. 评测中心：黄金集、批量回归、版本对比、数据正确率、成本和 P95。
5. Bot 运维：账号、租约、游标、积压、最近错误和安全停机。
6. 审批中心：待审批导入、配置发布和批量任务。

首期不做通用低代码平台。每个页面都服务于 iLink Agent 的管理和生产运行。

### 9.1 评测与发布门禁

每个评测用例固定：

- `input`、用户/账号/角色和数据库 fixtures
- 期望 `route/tool/args/source/status`
- 数值、日期、权限、Artifact 和失败行为 invariants
- 允许的时延、模型调用、Token 和成本上限

每次评测记录 Model、Prompt、Workflow、Tool、RAG Index 和 Runtime 版本。草稿版本必须与当前生产 baseline 对比；数据正确性、安全用例、越权和重复副作用为硬门禁，硬门禁失败不受平均文案得分豁免。线上纠错和人工反馈先脱敏进入候选集，管理员审核后才能成为回归用例。

## 10. 全功能 Capability Catalog

“Agent 支持项目所有功能”必须按现有 12 个导航模块逐项验收。页面存在不等于 Agent 已支持，11 个现有 Tool 也不等于全功能。

| 模块 | 只读/查询能力 | 写入或动作能力 | iLink 输出 | 落地类型 |
| --- | --- | --- | --- | --- |
| 仪表盘 | 数据概览、趋势、排名、人数变化、系统健康 | 无普通用户写操作 | 文字、图表、CSV | Server-native Read |
| 主播 | 列表、档案、重复项、师徒关系、趋势 | 新增、批量导入、改资料、设师傅、合并、删除、日快照 | 文字、预览、CSV | Read + Confirmed Write |
| 数据 | 音浪/时长查询、导入预览、每日报告 | 音浪/时长 CSV 导入 | 文字、日报图、CSV | Read + Confirmed Write + Artifact |
| 红旗 | 流动红旗、分组、得主、等级规则 | 结算分数、修改等级规则 | 文字、结果图 | Read + Confirmed Write |
| PK | 月度名单、分组、名单校验 | 调整受控名单/配置 | 文字、名单图、CSV | Read + Confirmed Config + Artifact |
| 监控 | 直播状态、事件流、PK/连麦场次、分数账本 | 启停采集、关联赛事、补发告警 | 文字、事件摘要、CSV | Collector Required + Admin Action |
| 争霸 | 赛程、分组、各轮比分、晋级结果 | 保存/同步比分、调整受控赛程 | 文字、赛事图、CSV | Read + Confirmed Write + Artifact |
| 奖励 | 奖励报表、计算明细 | 调整受控计算配置 | 文字、报表图、CSV | Read + Confirmed Config + Artifact |
| 族谱 | 关系树、师徒查询 | 关系修改复用主播“设师傅” | 族谱图、CSV | Read + Confirmed Write + Artifact |
| 海报 | 海报数据和预览信息 | 生成指定模板 | PNG/文件 | Artifact |
| 机器人 | 账号、租约、游标、积压、最近错误 | 登录、启停、断开、切换 runner | 管理员文字状态、登录二维码 | Admin Only |
| 设置 | 数据库健康、版本、容量、Agent 配置状态 | 发布 Prompt/Workflow/Tool Policy；桌面自动更新仍留在 UI | 管理员文字状态 | Control Plane / Admin Only |

### 10.1 两阶段写入协议

模型仅可创建 Action Proposal，写 Tool 由确认后的确定性 Executor 调用：

```ts
type ActionProposal = {
  actionId: string;
  actionType: string;
  argsHash: string;
  impactPreview: string;
  requestedBy: string;
  requiredRole: string;
  expiresAt: string;
};
```

管理员在微信回复 `确认 ACTION_ID` 后，由确定性 Executor 校验主体、角色、nonce、TTL、数据版本和幂等键再执行。主播删除、合并、批量覆盖等高影响动作要求二次确认或 Web 审批。拒绝、过期和数据版本变化都终止 Proposal。

### 10.2 抖音监控服务器化

实时监控当前依赖 Electron BrowserWindow/CDP，需先重构再进入无窗口 Worker。独立建设 `douyin-collector` Adapter，可选服务器 Chromium/Playwright 或受控桌面采集器；采集结果写入缓存和事件表，Agent 只读缓存、生成摘要和创建订阅告警。最终用户收发仍只经过 iLink。

### 10.3 全功能验收

Capability Catalog 必须落为机器可读清单。每项记录 `capabilityId/module/mode/scopes/tool/workflow/artifact/e2e/status`，并至少具备一个 iLink E2E。状态只能是 `unsupported/read-only/confirmed-write/collector-required/admin-only/supported`；存在 `unsupported` 项时不得宣称“项目全功能已支持”。

## 11. 可扩展功能路线

### E1：核心运营增强

- 定时发送男团、女队、双团日报。
- 订阅最新数据、无数据、直播异常和排名变化提醒。
- CSV 预检、差异预览、重复文件识别、审批后导入。
- 微信内任务状态查询、取消和失败重试。
- 按账号、群、用户配置可见团别和数据范围。

### E2：数据分析增强

- 周报/月报、环比/同比、目标完成度和主播分层。
- 异常检测：音浪突增突降、连续未播、直播时长异常、数据缺口。
- 主播组合对比、同层级基准、趋势解释和可下载图表。
- 数据质量 Agent：缺失、重复、冲突、跨表不一致提示。
- 自定义报告模板和订阅计划。

### E3：知识与管理增强

- PDF、DOCX、XLSX 等文档摄取，保留版本和 ACL。
- 规则冲突检测、过期文档提醒和知识负责人审核。
- Prompt/模型 A/B 评测，只对内部测试账号灰度。
- 多模型路由、熔断、成本看板和使用预算。
- 自然语言创建受控查询模板，由管理员审核后发布为新 Tool。

### E4：高级 Agent 能力

- 异步周/月运营分析 Crew：取数、校验、分析、写作、复核、发送。
- 管理员可视化查看 Workflow DAG 和节点状态。
- 只读 MCP 数据工具接入，经过 Tool Policy、网络出口和 schema 审核。
- 离线评测 Agent 自动聚类失败样本并生成待办，不自动修改生产 Prompt。
- 跨账号统一运营看板，但数据权限和会话继续按租户隔离。

### E5：条件成熟后再评估

- 可视化拖拽编排器。
- 向量检索或混合检索。
- 分布式队列和多区域 Worker。
- 更多 iLink 官方支持的媒体类型。

这些能力必须由真实需求、容量数据或质量评测触发；参考框架具备相应功能本身不是引入理由。

## 12. 实施批次

### F0：生产前置

完成 `ilink-server-agent-design.md` 的 P0-P3。没有真实 Worker 和可靠收发时，不实施高级 Agent。

### F1：工作流内核

- Event Envelope、Run/Step、状态机、预算、checkpoint、effect ledger。
- Tool Manifest、Policy Middleware、输出 schema 和统一错误分类。
- Inbox/Outbox Dispatcher 与恢复测试。

### F2：控制面与评测

- Prompt/Model/Workflow 版本发布和回滚。
- Trace、OpenTelemetry、用量、黄金集和版本对比。
- 知识摄取、ACL、全文检索和评测。

### F3：首批扩展

- 定时报表、异常提醒、订阅。
- CSV 预检、审批、导入结果和补偿流程。
- 周报/月报和数据质量检查。

### F4：受控多 Agent

- 只上线一个异步报告流程。
- 对单 Agent 基线比较正确率、P95、成本和故障率。
- 收益未达到门槛时回退为确定性 Flow + 单 Agent。

## 13. 发布门槛

| 能力 | 发布标准 |
| --- | --- |
| 工作流恢复 | 在每个副作用点杀进程，恢复后无重复导入和重复发送 |
| 版本一致性 | 单次运行所有节点使用同一 `runtimeVersion` |
| Tool 权限 | 越权、Prompt 注入和动态工具暴露测试全部阻断 |
| 评测 | 数据黄金用例 100%，知识用例达到设定门槛且保留来源 |
| 多 Agent | 相比单 Agent 有可量化收益，且未突破成本、步骤和时延预算 |
| 回滚 | 5 分钟内回到上一个已发布版本或确定性命令模式 |

## 14. 明确不做

- 不让多个 Agent 在实时微信请求中自由讨论直到“达成共识”。
- 不让 Agent 自行安装插件、创建 Tool 或修改生产 Prompt。
- 不向模型提供自由 SQL、Shell、任意文件访问、任意公网请求或桌面控制。
- 不用长期记忆保存模型推断的个人画像或实时业务数据。
- 不为了框架一致性而重写现有已验证的日期、CSV、报告和 Analytics 规则。
- 不把 Web 工作流测试页变成第二个最终用户聊天通道。

## 15. 官方参考

- LangChain: <https://github.com/langchain-ai/langchain>
- LangGraph: <https://github.com/langchain-ai/langgraph>
- CrewAI: <https://github.com/crewAIInc/crewAI>
- AutoGen: <https://github.com/microsoft/autogen>
- Microsoft Agent Framework: <https://github.com/microsoft/agent-framework>
- MetaGPT: <https://github.com/geekan/MetaGPT>
- Dify: <https://github.com/langgenius/dify>

资料核对日期为 2026-07-22。AutoGen 官方仓库当前标注为 Maintenance Mode，并推荐新项目使用 Microsoft Agent Framework；本设计因此仅参考 AutoGen 的模式，不把它列为依赖候选。
