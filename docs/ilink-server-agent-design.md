# 微信 iLink 单通道 AI Agent 服务器化设计

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.3 |
| 核对日期 | 2026-07-24 |
| 结论 | **可落地，但当前代码尚未达到服务器生产条件**（实验文本 Worker 可开关，非生产） |
| 通道约束 | **只使用微信 iLink；不引入公众号、企业微信、Webhook 或其他 IM 通道** |
| 通道能力 | **收发文字、接收文件、发送文件/图片** 均经 iLink；不另建用户侧文件站/CDN 产品通道 |
| 适用范围 | 抖音数据查询、CSV 导入、日报图片、CSV 导出、帮助/RAG、Agent、账号管理、服务器部署 |

> 本文是 iLink 单通道服务器化的专项设计。产品路线见 `ai-agent-production-plan.md`，跨文档运行契约与顺序以 `docs/adr/0001-agent-runtime-contract.md` 为准，可执行数据库结构只以 `migrations/` 为准；框架借鉴和扩展路线见 `agent-framework-reference-and-extension-plan.md`，部署参数和命令以 `server-deployment.md` 为准。

> **业务智能形态：** 服务器化解决的是 **通道与运维**（租约、Inbox/Outbox、扫码控制面等）；面向用户的数据智能仍是 **单 Agent + Tools**，见 `docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md`。

## 1. 可行性结论

### 1.1 已具备的基础

- `electron/weixin-bot.js` 已实现 iLink 二维码登录、`getupdates` 长轮询、文本发送、媒体上传和图片/文件发送（桌面主链仍是生产路径）。
- `shared/ilink-adapter.js` 已抽出无 Electron 的 iLink HTTP 协议层，覆盖二维码、状态、长轮询、上传地址和消息发送，并对 API origin、路径、方法、query、redirect、超时和响应大小做白名单校验。
- `scripts/bot-worker.js` 已具备**可开关的实验文本闭环**：可选 iLink 文本 transport（长轮询 + ack + 出站），以及可选 MySQL lease / Inbox / Outbox 接线（模块见 `scripts/ilink-text-transport.js`、`ilink-crypto.js`、`ilink-db-lease.js`、`ilink-inbox-cursor.js`、`ilink-outbox.js`）。默认可关；**非生产标签**。
- 业务路由、FastRoute、Agent Tool、CSV 解析、日报生成、会话串行已有可复用实现（仍主要在 electron 侧）。
- Next.js、MySQL、Node.js 运行环境适合拆出无窗口的服务器进程。

### 1.2 必须先补齐的阻塞项

| 阻塞项 | 当前状态 | 完成条件 |
| --- | --- | --- |
| 服务器 iLink Worker | 实验文本收发 + DB transport + 登录控制实验已接；**缺**真号 E2E 留证、媒体全链路、`shared/bot-core`、72h | 登录/收发/重连/优雅退出 + 媒体 + Core + E2E/72h 证据 |
| Core 解耦 | Web 通过 `electron/*.js` 间接加载；`shared/bot-core` 仅薄 RAG re-export | `shared/bot-core` 不依赖 Electron、Next、BrowserWindow |
| 凭据与游标 | 桌面仍本地 JSON；服务器：加密凭据 store + seed + Worker 读库（实验）；游标事务（文本） | 无 env token 的稳定生产路径 + 真机证明；重启后 Inbox/effect 抑制重复副作用 |
| 二维码登录控制通道 | **实验已接**：`003` 表 + `ilink-login-control` + Worker poller + `/api/bot/login/*` | 真机扫码 E2E、step-up/RBAC 生产级、Electron 应急入口、审计完备 |
| 单账号互斥 | 文件锁仍可用；DB lease/fencing 模块已实验接线 | 跨主机演练证明同账号有效 lease 始终 `<= 1` |
| 全功能适配 | 文本路径实验；Artifact **仅** local store + media policy 地基，Worker 未接 | iLink Artifact 全链路（见 S3 规格）；失败有明确回执 |
| 服务器字体/文件 | 依赖桌面环境 | 镜像固定字体、临时目录、大小上限和清理策略 |
| 真实运维证据 | runbook 齐；缺已填 E2E/72h 记录 | 单账号 72 小时、断网/重启/抢占演练通过 |

因此，目标是**工程上可实现**，但实验文本 Worker **尚未达到服务器生产完成标准**。

## 2. 产品边界与“全部功能”定义

### 2.1 iLink 是唯一用户通道

账号连接完成后，所有最终用户业务交互都从 iLink 入站并由 iLink 出站：私聊、群聊、文字、图片和 CSV 文件。首次登录或重新登录时账号尚未建立 iLink 出站能力，因此二维码只由认证后的 Web/Electron 管理控制面展示，不尝试通过同一未登录账号发送。Web 不作为第二个最终用户聊天通道；Web Agent API 仅供后台和自动化调用，并按同一 Core 执行。

### 2.2 服务器版本必须覆盖的功能

1. 指令模式、智能模式、FastRoute 和会话串行。
2. 主播搜索、档案、音浪、时长、未播天数、排名、对比和趋势分析。
3. 男团、女队、双团日报图片，通过 iLink 发送。
4. 音浪/时长 CSV 导入，通过 iLink 接收并回执；受控 CSV 导出，通过 iLink 发送。
5. 帮助、字段口径、业务日规则和知识库检索。
6. Agent 的受控 Tool 调用、来源标注、超时和固定命令降级。
7. 多微信账号配置，但每个账号同一时刻只能由一个 runner 持有。

以上是当前主链能力，不代表完整项目功能。仪表盘、主播维护、红旗、PK、监控、争霸、奖励、族谱、海报、机器人和设置的逐项覆盖，以 `agent-framework-reference-and-extension-plan.md` 的 Capability Catalog 为验收源。

抖音主页/作品等需要桌面签名的补充数据仍是独立可选能力；服务器版本必须明确返回缓存状态，不得伪装为实时抓取。

## 3. 目标部署拓扑

```text
                 HTTPS
 管理员浏览器 ───────────────> Next Web/API
                                  |
                                  v
                        shared/bot-core + MySQL
                                  ^
                                  |
                     ilink-worker (按账号获取 DB 租约)
                                  |
                         iLink HTTPS 长轮询
                                  |
                          微信 iLink 服务
```

推荐单机起步：`next-web`、`ilink-worker`、MySQL、反向代理、持久卷。首期 Workflow/Scheduler 是 `ilink-worker` 内部模块；规模或故障隔离需要明确后再拆进程。Next 和 Worker 均可扩实例，但每个账号只由持有有效 DB lease/fencing token 的 Worker 执行。

## 4. 进程与接口职责

### 4.1 `shared/bot-core`

包含 ModeRouter、Agent Loop、Tool Registry、RAG Policy、Analytics、日期规则、Session Port 和 Artifact Port。依赖只通过接口注入；环境变量、本地文件和 iLink HTTP 均由 Adapter 负责。

### 4.2 `ilink-adapter`

从现有 `WeixinBotService` 抽出纯 Node 适配层：

- `loginQr()` / `waitLogin()`，结果只交给认证后的管理控制面
- `pollUpdates(cursor, abortSignal)`
- `sendText(conversation, text)`
- `sendImage(conversation, buffer, metadata)`
- `sendFile(conversation, buffer, metadata)`
- `downloadInboundFile(item)`

网络出口分开管理，不使用 `*.weixin.qq.com` 通配：

- iLink API 默认 origin 只允许 `https://ilinkai.weixin.qq.com:443`；服务端返回的其他 API base URL 必须命中随协议版本发布的精确 origin 清单，运行时配置和数据库值不能自行扩权。
- API 只开放已实现的方法/路径对：二维码登录、状态查询、`getupdates`、`sendmessage` 和 `getuploadurl`。默认路径位于 `/ilink/bot/`，新增路径必须随 Adapter 协议测试发布，不能只按主机放行。
- CDN 只开放 `GET https://novac2c.cdn.weixin.qq.com:443/c2c/download` 和 `POST https://novac2c.cdn.weixin.qq.com:443/c2c/upload`；query key、请求方法和 Content-Type 同样按协议校验。
- API/CDN 都拒绝 URL userinfo、fragment、非 443 端口和非预期路径。HTTP 客户端使用 `redirect: manual` 并把 3xx 视为协议变化；确需跟随时，每一跳重新执行相同 allowlist 校验并限制跳数。
- Token、context token、媒体参数和密钥只在服务端内存或加密字段中出现，不写 URL 日志。

### 4.3 `bot-worker`

启动时按 `accountId` 获取 DB 租约，加载加密凭据和游标，进入长轮询；每次发送和提交游标前校验 fencing token。租约丢失、Token 失效或连续错误达到阈值时立即停止收发并告警。

### 4.4 二维码登录控制通道

二维码属于账号接入控制面，不属于已登录账号的 iLink 出站消息。首期不为 Worker 开公网管理端口，登录链路固定为：

1. 管理员在 Web 完成 step-up 登录、RBAC 和 CSRF 校验后发起一次性登录请求；请求绑定 `workspaceId + loginSlotId + actorId + requestId` 和短 TTL。首次登录尚无 iLink `accountId`，`loginSlotId` 是控制面预先生成的本地标识；重登时再附带预期账号标识。
2. `next-web` 把受审计的控制命令写入 MySQL。Worker 先 claim 对应 login slot 的一次性控制租约，重登时还必须持有目标账号有效 lease/fencing token；Electron 应急入口也调用同一受保护控制 API，不直接分发明文 Token。
3. Worker 调用 `loginQr()` / `waitLogin()`，将二维码和状态作为加密、短 TTL 的控制结果写回；Web 通过认证后的轮询或 SSE 读取，响应设置 `Cache-Control: no-store`，代理和应用日志不记录二维码内容。
4. 登录成功后 Worker 加密保存凭据并使二维码、challenge 和控制命令失效；失败、过期、取消和换 Worker 都留下脱敏审计记录。

控制命令、结果和审计的可执行字段由后续 migration 定义。登录、凭据轮换、断开和 runner 切换必须走此控制通道；iLink 对话只可发起申请或查看状态。

## 5. 消息与文件生命周期

```text
iLink getupdates batch
  -> 归一化 envelope，生成稳定 dedupe key，校验消息类型、大小声明和媒体 descriptor
  -> 先查 Inbox：已持久化 update 复用其 Artifact 引用，在事务内仅推进 next cursor
  -> 新媒体：校验 CDN URL -> 限流下载/解密/MIME sniff -> 幂等 Artifact staging
  -> MySQL 事务校验 fencing token，绑定 Artifact，写入 Inbox 与 next cursor
  -> Session Dispatcher 按会话串行取 Inbox
  -> Core 路由/工具执行
  -> 生成 AgentResult + Artifact
  -> 业务写、Run/Step、Effect Ledger 与 Outbox 在同一事务提交
  -> Outbox Dispatcher 上传并发送 iLink
  -> 持久 sent 或 unknown/reconcile 结果和审计
```

- 文本最大 4,000 字；图片、CSV、入站文件分别限制大小和 MIME 类型。
- Poller 在任何媒体网络请求前，先由 `accountId + upstream messageId` 生成 dedupe key；上游没有稳定 ID 时使用版本化 canonical envelope hash。已存在 Inbox 的重放在带 fencing 校验的事务内推进 cursor，不重新下载可能已过期的 CDN URL，也不再次产生业务副作用。
- 新入站媒体先校验 descriptor、CDN 精确 allowlist、声明大小和加密参数，再以流式字节上限下载到随机隔离文件；解密后执行实际大小、MIME sniff 和 hash 校验。staging key 由 `accountId + dedupeKey + partId` 稳定派生，相同内容重试复用同一对象。
- staging Artifact 初始为不可消费状态，默认 TTL 30 分钟且配置范围限制在 10-120 分钟。只有所需媒体全部落入 durable storage 后，MySQL 事务才校验 fencing token、绑定 Artifact、写 Inbox 并推进 cursor；提交后 Artifact 才成为 `ready`。事务回滚、唯一键竞争、取消或崩溃留下的未绑定 staging 由周期 GC 删除，清理任务可重入并记录指标。
- 媒体 staging 失败时不推进该批次游标；超过重试阈值后持久化 `blocked_media` 原因、dedupe key 和处理人可见状态。管理员只能选择重试或经 step-up 审计后隔离/跳过，禁止留下“消息已持久化但媒体已过期”的记录。
- 纯文本新消息在同一事务插入 Inbox 并推进 next cursor。Poller 不等待 LLM；Dispatcher 异步执行业务。并发插入命中 Inbox 唯一约束时转为重放路径，而不是重复执行。
- 出站媒体也先校验 Artifact 状态、实际 MIME、大小和 hash，再上传；随机临时文件发送后删除，Artifact 按保留策略和 TTL 清理。
- Outbox 创建时只生成一次稳定 `client_id`，所有重试复用该值；请求超时且上游结果未知时进入 `unknown/reconcile`，不立即生成新消息。
- 目标语义是 effectively-once 和可抑制重复，不宣称分布式严格 exactly-once。
- 报告生成失败时发送文字错误；文件上传失败时不声称已发送。

## 6. 数据与安全

数据库结构只由 `migrations/` 定义。当前 `001_ilink_runtime` 已建立 `ilink_accounts`、`ilink_update_cursors`、`bot_runner_leases`、`inbox_messages`、`outbox_messages`、`artifacts` 和 `import_records`；`003_ilink_login_control` 建立 `ilink_login_requests`。**文本路径**已通过 `scripts/bot-worker.js` + `ilink-*` 模块实验接入 lease / Inbox / Cursor / Outbox；**二维码登录控制通道已实验接入**（Web API → DB → Worker poller），缺真机与生产级 RBAC。**媒体 Artifact 管线尚未接入** Poller/Dispatcher（仅有 local store + policy 地基）。Session、Run/Step、effect、approval、audit、知识版本和评测必须通过后续 migration 增量增加。

- 凭据使用服务器密钥加密，密钥来自 Secret Manager 或受限环境变量；数据库备份不包含明文 Token。
- 管理员接口必须登录并按角色授权；未配置生产认证时启动失败。
- 日志脱敏 Token、AI Key、文件内容和完整模型上下文；以 `traceId` 关联消息、工具和发送结果。
- MySQL 使用最小权限账号；Worker 不开放公网管理端口。

## 7. 交付批次与验收

### P0：架构收敛

- 建立 `shared/bot-core` Ports 和跨桌面/服务器契约测试。
- 抽出 iLink Adapter，删除 Worker 对 `BrowserWindow`、QR UI 和 Electron IPC 的依赖。
- 合并 RAG 和 Analytics 的重复实现。
- 保留 Worker 的二维码协议能力，但二维码数据只返回认证后的 Web/Electron 控制面。
- 落地 Web -> MySQL 控制命令 -> Worker -> Web 的二维码链路，并覆盖 step-up、RBAC、TTL、取消和日志脱敏测试。
- 为 API/CDN 精确 origin、方法、路径、query、端口和 redirect 策略建立协议测试；任何通配主机仍存在时 P0 不通过。

### P1：服务器收发闭环

- 把 `001_ilink_runtime` 接入 DB lease/fencing、Inbox/Cursor、Artifact staging 和 Outbox，再实现登录、文本/图片/文件收发、重连和优雅退出。
- 覆盖 duplicate-before-stage、过期 CDN 重放、staging 事务回滚/崩溃和孤儿 GC；重复 update 不触发第二次媒体下载。
- 完成 CSV 入站、日报 PNG 和 CSV 出站的真实 iLink E2E。
- 完成账号级 MySQL 租约和 fencing token。
- 验证 `context_token` 的持久化、TTL 和主动发送边界；定时报表不得假设可以向任意历史会话发送。

### P2：生产基础设施

- 会话、知识库、审计迁 MySQL；鉴权、限流、超时、指标和告警上线。
- Docker/Node 部署、持久卷、备份恢复、字体和临时目录检查完成。

### P3：灰度与全量

- 单账号灰度 24 小时，再连续观察 72 小时；期间无已确认的重复业务副作用、游标回退或未闭合租约，所有不确定出站均有 `unknown/reconcile` 记录。
- 演练断网、iLink 5xx、Token 失效、DB 短断、进程重启和双 Worker 抢占。
- 关闭 `AGENT_ENABLED` 后，固定命令、CSV 和日报仍可用；可在 5 分钟内回切桌面 runner。

只有 P0-P3 全部通过，才将状态写为“服务器生产可用”。

## 8. 关键指标

| 指标 | 目标 |
| --- | --- |
| 入站重放与去重 | 按账号记录 `inbox_received_total`、`inbox_dedupe_hit_total` 和 dedupe hit rate；命中表示上游重放被正常抑制，不记作业务故障 |
| 已确认重复业务副作用 | Inbox/effect 故障注入用例 100% 抑制；线上独立计数并逐次告警，72 小时灰度不得出现已确认重复，不把该观察门槛表述为分布式 exactly-once 保证 |
| 出站不确定结果 | `unknown/reconcile` 记录覆盖率 100%，禁止盲目重发；72 小时灰度内无已确认重复发送 |
| 入站持久化覆盖 | 已接受 update 的 Inbox/Cursor 或 `blocked_media` 状态可追踪率 100% |
| Artifact staging 回收 | 未绑定 staging 均带 10-120 分钟 TTL；GC 扫描、删除成功/失败和最老孤儿年龄可观测，健康存储下不得存在超过两个扫描周期的过期孤儿，失败持续重试并告警 |
| iLink 收发成功率 | >= 99.5%（剔除上游故障） |
| Tool 数据黄金用例正确率 | 100% |
| Worker 重启恢复 | 5 分钟内恢复；已提交 Inbox 不重复产生业务副作用，未知出站按 reconcile 策略处理 |
| 租约冲突 | 同账号有效 lease 持有数始终 `<= 1`；启用账号另报 lease 可用率、续租失败和无主时长 |
| 报告/CSV 发送失败 | 有明确失败回执，禁止伪成功 |

## 9. 回滚与故障策略

1. 先关闭 Agent/RAG 开关，保留固定命令和数据 Tool。
2. 停止服务器 Worker，等待租约释放或过期，确认游标和幂等表完整。
3. 将账号 runner 切回桌面；不删除会话、审计和游标数据。
4. 按 traceId 留存样本，修复并完成回归后再灰度。

## 10. 首个执行清单

实现进度真值见 `docs/ilink-implementation-progress.md`；顺序路线见 `docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md`。

- [x] 建立 migration runner 和 `001_ilink_runtime` transport schema，并通过 checksum、锁和历史校验单测。
- [x] 在 `docs/adr/0001-agent-runtime-contract.md` 冻结 `AgentResult`、拓扑、可靠性语义和实施顺序。
- [~] lease/fencing、Inbox/Cursor、Outbox **文本实验路径**已接入 `bot-worker`（env 可关）；**Artifact 仍未接**；集成 MySQL 备份/恢复演练与双机 fencing 证据仍缺。
- [x] 从 `electron/weixin-bot.js` 抽出无 Electron 的 iLink HTTP Adapter；完成精确 API origin/路径/方法/query allowlist、redirect、超时、响应上限和 typed session-expired 协议测试。
- [ ] 将媒体加密、CDN 收发和 Artifact 生命周期收敛到服务器可复用的 Artifact Adapter，并完成真实文字/图片/CSV E2E。
- [ ] 建立受 step-up/RBAC 保护的 Web -> MySQL -> Worker 二维码控制通道；二维码、challenge 和结果均短 TTL、no-store、可审计。
- [ ] 实现 dedupe-before-stage、幂等 staging、事务绑定和孤儿 Artifact GC，并完成崩溃点测试。
- [~] `scripts/bot-worker.js`：**文本实验 Poller/Outbox ✅**（transport + 可选 DB）；**媒体 / Workflow / Core 业务分发 ❌**。
- [ ] 让 Electron/Web/Worker Adapter 全部实现 ADR 的 `AgentResult` 与 Artifact 发送契约。
- [ ] 完成真实微信账号的文字、图片、CSV E2E 与 72 小时记录。
- [ ] 更新 `server-deployment.md` 的服务编排、持久卷、Secret 和健康检查。

## 11. 扩展前置约束

- 参考 LangChain/LangGraph、CrewAI、AutoGen、MetaGPT 和 Dify 时只吸收状态机、Flow、SOP、评测和控制面模式，首期不引入整套运行时。
- 任何扩展功能都通过共享 Core、Workflow 和 Tool Policy 接入，iLink 仍是唯一最终用户通道。
- 定时报表、异常预警、审批、知识治理和多 Agent 的具体顺序以 `agent-framework-reference-and-extension-plan.md` 为准。
- 真实 Worker、Inbox/Outbox、幂等、租约和恢复测试未完成前，不上线多 Agent 或可视化编排。
