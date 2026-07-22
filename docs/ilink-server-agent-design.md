# 微信 iLink 单通道 AI Agent 服务器化设计

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.1 |
| 核对日期 | 2026-07-22 |
| 结论 | **可落地，但当前代码尚未达到服务器生产条件** |
| 通道约束 | **只使用微信 iLink；不引入公众号、企业微信、Webhook 或其他 IM 通道** |
| 适用范围 | 抖音数据查询、CSV 导入、日报图片、CSV 导出、帮助/RAG、Agent、账号管理、服务器部署 |

> 本文是 iLink 单通道服务器化的专项设计。产品路线、通用 Agent 门槛仍以 `ai-agent-production-plan.md` 为准；框架借鉴和扩展路线见 `agent-framework-reference-and-extension-plan.md`；部署参数和命令以 `server-deployment.md` 为准。

## 1. 可行性结论

### 1.1 已具备的基础

- `electron/weixin-bot.js` 已实现 iLink 二维码登录、`getupdates` 长轮询、文本发送、媒体上传和图片/文件发送。
- 业务路由、FastRoute、Agent Tool、CSV 解析、日报生成、会话串行已有可复用实现。
- Next.js、MySQL、Node.js 运行环境适合拆出无窗口的服务器进程。

### 1.2 必须先补齐的阻塞项

| 阻塞项 | 当前状态 | 完成条件 |
| --- | --- | --- |
| 服务器 iLink Worker | `scripts/bot-worker.js` 仍只保活锁 | Worker 直接调用 iLink Adapter，能登录、收发、重连、优雅退出 |
| Core 解耦 | Web 通过 `electron/*.js` 间接加载 | `shared/bot-core` 不依赖 Electron、Next、BrowserWindow |
| 凭据与游标 | 凭据本地 JSON，游标跟随账号进程 | 加密凭据库 + 持久 `get_updates_buf`，重启不重复消费 |
| 单账号互斥 | 本机文件锁 | MySQL 账号租约 + fencing token，跨主机只有一个 runner |
| 全功能适配 | Web 目前不直接推 PNG/CSV | iLink Artifact Adapter 统一处理文本、图片、文件；失败有明确回执 |
| 服务器字体/文件 | 依赖桌面环境 | 镜像固定字体、临时目录、大小上限和清理策略 |
| 真实运维证据 | 无连续运行记录 | 单账号 72 小时、断网/重启/抢占演练通过 |

因此，目标是**工程上可实现**，但当前占位 Worker 尚未达到完成标准。

## 2. 产品边界与“全部功能”定义

### 2.1 iLink 是唯一用户通道

所有用户交互都从 iLink 入站并由 iLink 出站：私聊、群聊、二维码登录、文字、图片、CSV 文件。Web 页面只用于管理员配置、观察和知识库维护，不作为第二个用户聊天通道；Web Agent API 仅供后台和自动化调用，并按同一 Core 执行。

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
                     bot-worker (每账号一个受控进程)
                                  |
                         iLink HTTPS 长轮询
                                  |
                          微信 iLink 服务
```

推荐单机起步：`next`、`bot-worker`、MySQL、反向代理、持久卷。规模增加后，Next 可多实例，Worker 仍按账号租约调度；不要让多个 Worker 直接竞争同一账号。

## 4. 进程与接口职责

### 4.1 `shared/bot-core`

包含 ModeRouter、Agent Loop、Tool Registry、RAG Policy、Analytics、日期规则、Session Port 和 Artifact Port。依赖只通过接口注入；环境变量、本地文件和 iLink HTTP 均由 Adapter 负责。

### 4.2 `ilink-adapter`

从现有 `WeixinBotService` 抽出纯 Node 适配层：

- `loginQr()` / `waitLogin()`
- `pollUpdates(cursor, abortSignal)`
- `sendText(conversation, text)`
- `sendImage(conversation, buffer, metadata)`
- `sendFile(conversation, buffer, metadata)`
- `downloadInboundFile(item)`

所有请求仅允许 `https://ilinkai.weixin.qq.com` 及其官方子域；Token 只在服务端内存和加密凭据表中出现。

### 4.3 `bot-worker`

启动时按 `accountId` 获取 DB 租约，加载加密凭据和游标，进入长轮询；每次发送和提交游标前校验 fencing token。租约丢失、Token 失效或连续错误达到阈值时立即停止收发并告警。

## 5. 消息与文件生命周期

```text
iLink getupdates batch
  -> MySQL 事务写入 Inbox(accountId, messageId, envelope) 与 next cursor
  -> Session Dispatcher 按会话串行取 Inbox
  -> 下载入站媒体到临时目录
  -> Core 路由/工具执行
  -> 生成 AgentResult + Artifact
  -> 事务写入 Effect Ledger 与 Outbox
  -> Outbox Dispatcher 上传并发送 iLink
  -> 持久发送结果和审计
```

- 文本最大 4,000 字；图片、CSV、入站文件分别限制大小和 MIME 类型。
- 媒体文件使用随机临时名，发送成功后删除；异常文件按 TTL 清理。
- Poller 不等待 LLM。先在同一事务持久化批次消息和 next cursor，再由 Dispatcher 异步执行业务；重复 update 命中 Inbox 唯一键后跳过。
- Outbox 创建时只生成一次稳定 `client_id`，所有重试复用该值；请求超时且上游结果未知时进入 `unknown/reconcile`，不立即生成新消息。
- 目标语义是 effectively-once 和可抑制重复，不宣称分布式严格 exactly-once。
- 报告生成失败时发送文字错误；文件上传失败时不声称已发送。

## 6. 数据与安全

新增或落实以下表：`ilink_accounts`、`ilink_update_cursors`、`bot_runner_leases`、`inbox_messages`、`outbox_messages`、`effect_ledger`、`agent_sessions`、`agent_messages`、`agent_audit_logs`、`rag_documents`、`idempotency_keys`。

- 凭据使用服务器密钥加密，密钥来自 Secret Manager 或受限环境变量；数据库备份不包含明文 Token。
- 管理员接口必须登录并按角色授权；未配置生产认证时启动失败。
- 日志脱敏 Token、AI Key、文件内容和完整模型上下文；以 `traceId` 关联消息、工具和发送结果。
- MySQL 使用最小权限账号；Worker 不开放公网管理端口。

## 7. 交付批次与验收

### P0：架构收敛

- 建立 `shared/bot-core` Ports 和跨桌面/服务器契约测试。
- 抽出 iLink Adapter，删除 Worker 对 `BrowserWindow`、QR UI 和 Electron IPC 的依赖。
- 合并 RAG 和 Analytics 的重复实现。

### P1：服务器收发闭环

- 实现登录、游标、幂等、文本/图片/文件收发、重连和优雅退出。
- 完成 CSV 入站、日报 PNG 和 CSV 出站的真实 iLink E2E。
- 完成账号级 MySQL 租约和 fencing token。

### P2：生产基础设施

- 会话、知识库、审计迁 MySQL；鉴权、限流、超时、指标和告警上线。
- Docker/Node 部署、持久卷、备份恢复、字体和临时目录检查完成。

### P3：灰度与全量

- 单账号灰度 24 小时，再连续 72 小时无重复收发、游标回退或未闭合租约。
- 演练断网、iLink 5xx、Token 失效、DB 短断、进程重启和双 Worker 抢占。
- 关闭 `AGENT_ENABLED` 后，固定命令、CSV 和日报仍可用；可在 5 分钟内回切桌面 runner。

只有 P0-P3 全部通过，才将状态写为“服务器生产可用”。

## 8. 关键指标

| 指标 | 目标 |
| --- | --- |
| 重复消息率 | 0 |
| 丢失消息率 | 0（以持久化 update 为准） |
| iLink 收发成功率 | >= 99.5%（剔除上游故障） |
| Tool 数据黄金用例正确率 | 100% |
| Worker 重启恢复 | 5 分钟内恢复且不重复消费 |
| 租约冲突 | 同账号同时持有数始终为 1 |
| 报告/CSV 发送失败 | 有明确失败回执，禁止伪成功 |

## 9. 回滚与故障策略

1. 先关闭 Agent/RAG 开关，保留固定命令和数据 Tool。
2. 停止服务器 Worker，等待租约释放或过期，确认游标和幂等表完整。
3. 将账号 runner 切回桌面；不删除会话、审计和游标数据。
4. 按 traceId 留存样本，修复并完成回归后再灰度。

## 10. 首个执行清单

- [ ] 从 `electron/weixin-bot.js` 抽出无 Electron 的 iLink Adapter。
- [ ] 把 `scripts/bot-worker.js` 从占位进程改为真实收发进程。
- [ ] 增加账号、游标、幂等键和租约迁移。
- [ ] 统一 `AgentResult` 与 Artifact 发送契约。
- [ ] 完成真实微信账号的文字、图片、CSV E2E 与 72 小时记录。
- [ ] 更新 `server-deployment.md` 的服务编排、持久卷、Secret 和健康检查。

## 11. 扩展前置约束

- 参考 LangChain/LangGraph、CrewAI、AutoGen、MetaGPT 和 Dify 时只吸收状态机、Flow、SOP、评测和控制面模式，首期不引入整套运行时。
- 任何扩展功能都通过共享 Core、Workflow 和 Tool Policy 接入，iLink 仍是唯一最终用户通道。
- 定时报表、异常预警、审批、知识治理和多 Agent 的具体顺序以 `agent-framework-reference-and-extension-plan.md` 为准。
- 真实 Worker、Inbox/Outbox、幂等、租约和恢复测试未完成前，不上线多 Agent 或可视化编排。
