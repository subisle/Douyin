# 微信 iLink 单 Agent + 多技能 · 架构真值规格

| 项 | 内容 |
| --- | --- |
| 版本 | v1.0.0 |
| 日期 | 2026-07-24 |
| 状态 | **Accepted（对齐桌面实现）** |
| 范围 | Electron 桌面微信机器人：一个 Agent、多技能、微信 iLink |
| 非范围 | 多 Agent 运行时、服务器 7×24 生产全栈、拖拽编排、全项目 12 模块 Agent 化 |
| 审计依据 | 2026-07-24 代码审计：`electron/weixin-bot*.js`、`electron/main.js` |
| 进度旁路 | 服务器实验见 `docs/ilink-implementation-progress.md`（**非本规格主路径**） |

> **冲突时：** 本规格描述的桌面智能客服行为以 `electron/weixin-bot-skills.js`、`weixin-bot-agent.js`、`weixin-bot-mode.js`、`weixin-bot-commands.js`、`weixin-bot.js` 为准。  
> 过时段落若写「多 Agent 默认」「Worker 即生产 AI」——**作废**。

---

## 1. 产品定位

### 1.1 要解决什么

内部运营/管理通过 **微信** 查询抖音主播 **音浪、时长、日报图、CSV**，并用自然语言得到基于**本库已有数据**的回答。

### 1.2 冻结决策

| 决策 | 内容 |
| --- | --- |
| 用户通道 | **仅微信 iLink**（私聊/群聊）；Web `/agent` 仅为管理/诊断，不是最终用户主通道 |
| 通道能力 | iLink 须覆盖 **收发文字、接收文件（如 CSV）、发送文件/图片（如日报图、CSV 导出）**；不另建用户侧 CDN/文件站/其他 IM |
| 智能形态 | **恰好一个** AI Agent + **多个技能（Tools）** |
| 技能原则 | **一技能一功能**；扩展 = 加技能，不是加 Agent |
| 多 Agent | **不实现、不作为默认能力**；远期文档（L3/S8）不纳入本规格交付 |
| 数字来源 | 仅数据库 + 技能；**禁止**模型编造；**禁止**用 RAG 回答实时音浪/时长数字 |
| 项目规则 | 同上硬约束亦写入仓库根目录 `CLAUDE.md`，开发须遵守 |

### 1.3 成功标准

1. 微信可完成：帮助、查艺名数据、日报图、CSV（指令或智能路径）。  
2. 配置 AI 并进入客服模式后，自然语言可触发技能并返回带数据截止日期的回答。  
3. 未配置 AI 时，指令模式仍可用；Agent 明确不处理（不假装成功）。  
4. 规格与代码技能表、双模式、FastRoute **无矛盾**。

---

## 2. 架构总览

```text
微信用户
  │  iLink 长轮询 / 发送
  ▼
WeixinBotService          electron/weixin-bot.js
  │  文本入站 message_type=1
  ▼
createWeixinCommandHandler   electron/weixin-bot-commands.js
  │  系统口令 / CSV / 模式分流
  ├─ instruction → parseBotCommand → analytics/命令执行
  └─ agent 模式
        ├─ matchFastRoute → 命中则直接执行（无 LLM）
        └─ 未命中 → agentHandler
              ▼
         WeixinBotAgent      electron/weixin-bot-agent.js
              │  OpenAI-compatible chat/completions + tools
              ▼
         createWeixinBotSkills   electron/weixin-bot-skills.js
              │  11 × function tools
              ▼
         analytics / rag / report
              ▼
         replyText / 图片 / 文件 → 回微信
```

### 2.1 装配（真值）

`electron/main.js`：

- `createWeixinBotSkills({ db, renderReportPng })`
- `new WeixinBotAgent({ skills, getConfig, modeStore, … })`
- `weixinBot.setCommandHandler(…)`
- `weixinBot.setModeStore(…)`
- `weixinBot.setAgentHandler((args) => weixinBotAgent.handleMessage(args))`

**单实例 Agent**，全局一套 skills 定义。

---

## 3. 会话模式

### 3.1 两种模式

| 模式 | 默认 | 进入 | 退出 | 行为 |
| --- | --- | --- | --- | --- |
| `instruction` | **是** | 默认；「退出客服」等 | — | 固定命令；**不调用 LLM** |
| `agent` | 否 | 「人工客服」「智能客服」「客服」等 | 「退出客服」等 | FastRoute → 否则单 Agent + 技能 |

实现：`createModeStore`（`weixin-bot-mode.js`），按 `accountId + 用户/群` 分会话；TTL 约 2h；默认 `instruction`。

### 3.2 系统口令（优先于模式业务）

| 类型 | 示例 | 行为 |
| --- | --- | --- |
| 帮助 | 帮助、菜单、命令、`/help` | 按当前模式返回说明文案 |
| 开启智能 | 人工客服、智能客服、客服… | `setMode(agent)` + `agent.enableSession`；需 AI 已配置否则提示 |
| 退出智能 | 退出客服、关闭客服… | `setMode(instruction)` + 清线程 |

### 3.3 产品含义（必须写进用户说明）

- **不是**扫码后默认全程 AI。  
- 要自然语言智能答疑：先保证 **AI 已配置**，再发 **「人工客服」**（或等价口令）。  
- 未进 agent 模式时，口语长句可能既不匹配固定命令、也不进 Agent。

---

## 4. 入站处理顺序（不变量）

对每条文本消息，逻辑顺序固定为：

1. 通道层校验（已连接、会话上下文、可选白名单）  
2. **系统口令**（帮助 / 开客服 / 退客服）  
3. **CSV / 文件导入**（若适用）  
4. 读取 `mode`  
5. **`agent` 模式：** 仅 FastRoute；命中则执行并结束；未命中则 **不** 在 commandHandler 内吞掉，交给 `agentHandler`  
6. **`instruction` 模式：** 自定义命令 → `parseBotCommand` → 执行  
7. 若仍未 handled 且存在 `agentHandler` → `WeixinBotAgent.handleMessage`  
8. Agent 内再次：未配置 / 会话未 enable → `handled: false`；否则 FastRoute（若注入）→ LLM tool loop  

**确定性优先：** 能 FastRoute / 固定命令完成的，不调用模型。

---

## 5. 单 Agent 规格

### 5.1 组件

| 项 | 规格 |
| --- | --- |
| 类 | `WeixinBotAgent` |
| 模型协议 | OpenAI-compatible `POST {baseUrl}/chat/completions` |
| 启用条件 | `config.enabled && apiKey && model`（`baseUrl` 参与 configured 展示） |
| 工具面 | **仅** `skills.definitions` / `skills.execute` |
| 多 Agent | **禁止**第二套并行 Agent 角色运行时 |

### 5.2 循环与预算

| 参数 | 默认 / 硬顶 | 含义 |
| --- | --- | --- |
| `maxToolRounds` | 默认 4，硬顶 6 | 模型↔工具往返轮数 |
| 单轮 tool 截断 | 有上限 | 防止一次刷爆工具 |
| 线程轮次 / 字数 | 约 8 轮对话侧、12k 字量级 | 内存线程裁剪 |
| 线程 TTL | 约 30 min | 过期清理 |
| 超时 | 默认 45s 级，可配 | 单次 completion |

超限：明确中文提示缩小范围，不抛内部栈给用户。

### 5.3 系统人设（行为契约）

与 `SYSTEM_PERSONA` 一致，摘要：

- 身份：内部「数据客服」，中文，简洁专业  
- 只能通过已提供工具读/导本地数据  
- 禁止编造数字、排名、日期、主播信息  
- 禁止无关闲聊域（天气、股票、医疗等）  
- 禁止输出 Key/Token/路径/密码  
- 禁止删除、改权限、改档案；只查询与导出  
- 有数据尽量带 `asOfDate`；要图/文件必须走导出技能  
- 单次文字宜控制在约 1200 字内  

### 5.4 AI 连接安全

- 默认 **HTTPS**；HTTP 仅放行 localhost / 127.0.0.1 / ::1  
- 错误信息脱敏 Bearer / sk-  

---

## 6. 技能目录（一技能一功能）

**注册处：** `electron/weixin-bot-skills.js` → `createWeixinBotSkills`  
**数据实现：** 多数委托 `weixin-bot-analytics.js`；报告图 `weixin-bot-report.js`；帮助 `weixin-bot-rag.js`

| 技能 name | 功能 | 主要参数 | 执行 |
| --- | --- | --- | --- |
| `search_anchors` | 按姓名/抖音号/ID 搜索主播，消歧 | `query`, `limit?` | analytics.searchAnchors |
| `get_anchor_full_profile` | 库内音浪/时长汇总（对齐发艺名） | `query` | analytics.getAnchorFullProfile |
| `get_anchor_wave_profile` | 音浪表现（日/累计/排名等） | `query`, `date?` | analytics.getAnchorWaveProfile |
| `get_anchor_wave_days` | 本月有音浪天数与累计 | `query`, `date?` | analytics.getAnchorWaveDays |
| `compare_anchor_wave` | 2–5 人音浪对比 | `queries[]`, `date?` | analytics.compareAnchorWave |
| `get_anchor_duration` | 累计直播时长（累计分钟） | `query`, `date?` | analytics.getAnchorDuration |
| `analyze_anchor_wave` | 音浪序列：最新/峰值/均值/环比 | `query`, `range?` 7d/14d/30d | analytics.analyzeAnchorWave |
| `get_daily_report_data` | 男团/女队日报摘要数据 | `date?`, `gender?` male/female/both | analytics.getDailyReportData |
| `export_daily_report_image` | 生成日报图（both=两张） | `date?`, `gender?`, `title?` | analytics.exportDailyReportImage |
| `export_wave_file` | 导出某日音浪 CSV | `date?` | analytics.exportWaveFile |
| `rag_search` | 运营知识库（帮助/规则/口径） | `query`, `topK?`, `collection?` | ragSearch；**禁止**答具体音浪/时长数字 |

### 6.1 技能契约

每个技能必须具备：

1. **稳定 name**（snake_case，对模型暴露）  
2. **description**（中文，说明何时用、何时不用）  
3. **parameters** JSON Schema  
4. **execute(args) →** 结构化结果（含失败时 `ok: false` / error）  
5. **单一职责**（不在一个 skill 里混「改库 + 发广播」）

未知 `name`：`execute` 返回明确错误，不抛未捕获异常到用户。

### 6.2 明确不在当前技能面

红旗、PK、监控实时采集、争霸写分、族谱图、海报板、设置发布等——**未**注册为 Agent 技能。  
需要时：**新增技能**，不新增 Agent。

### 6.3 指令模式与技能的关系

- 指令模式通过 `parseBotCommand` + 命令处理函数走 **同一 analytics 能力**。  
- 智能模式通过 **skills 表** 暴露给模型。  
- **规范：** 新数据能力应先落 analytics（或等价数据层），再挂 skill；避免命令与 skill 两套互不一致的业务规则。

---

## 7. FastRoute（确定性快路）

**位置：** `matchFastRoute`（mode/commands）  
**原则：** agent 模式下，高置信、可解析为固定命令的输入 **不调用 LLM**。

典型（以实现/测试为准）：

- 「每日报告」类 → 报告  
- 纯艺名等高置信查询 → 档案类  
- 口语对比/模糊问法 → **不**进 FastRoute，交给 Agent  

FastRoute 失败或抛错：Agent 可回退 LLM（agent 内 catch 后继续）。

---

## 8. 数据与日期规则（实现已验证口径）

与生产计划/命令层一致的要点：

- 未指定日期：使用对应数据集 **最新可用业务日**（业务日习惯上贴近「昨天」，以数据层为准）。  
- 显式日期无数据：**不**静默跳日。  
- CSV 导入日期：消息明确日期 > 短时预告 > 本地昨天；**不用文件名当日期**。  
- 音浪/时长/排名/对比/报告/导出：**必须**走结构化工具；RAG 不得提供实时业务数字。

---

## 9. 安全与权限

| 规则 | 要求 |
| --- | --- |
| 只读 + 受控导出 | 技能不得提供任意写库/删库 |
| 密钥 | 不进回复、不进完整工具 JSON 给用户 |
| 日志 | Token/Bearer 脱敏 |
| 访问控制 | 账号级 allowlist（若配置）在通道层执行 |
| 群聊 | session key 含 group + user，避免串会话 |

---

## 10. 与服务器 Worker 的边界

| 路径 | 角色 |
| --- | --- |
| **本规格（桌面）** | 用户智能客服主路径：扫码 + 单 Agent + 技能 |
| `scripts/bot-worker` 等 | 实验性服务器文本收发/租约；**不是**本规格的 Agent 实现完成定义 |
| 同账号 | **禁止**桌面与 Worker 同时跑同一微信账号 |

用户文档应写：**日常智能对话用桌面微信机器人。**

---

## 11. 扩展规则（加功能时）

1. 只允许 **一个** `WeixinBotAgent` 实例作为智能入口。  
2. 新功能 = 新 skill 行 + analytics（或专用模块）实现 + 单测。  
3. 更新本规格 §6 表格。  
4. 禁止引入第二 Agent「经理/派工」处理微信实时问答。  
5. 多 Agent / 周月报 Crew 等属 **S8 以后** 可选，须单独规格，且不得污染本文件成功标准。

---

## 12. 测试与验收

### 12.1 自动化（现状锚点）

- `npm run test:weixin-bot` — 命令、mode、FastRoute、agent 相关测  
- 技能逻辑多经 analytics / commands 测覆盖  

### 12.2 实机验收清单（桌面）

- [ ] 未配 AI：指令「帮助」「艺名」「每日报告」可用  
- [ ] 配 AI 后发「人工客服」：进入智能说明  
- [ ] 自然语言查音浪/时长：调用技能，数字与库一致或明确无数据  
- [ ] 要日报图：收到图片而非纯空话  
- [ ] 「退出客服」：回到指令模式  
- [ ] 无关问题：拒绝或不编造业务数字  

---

## 13. 代码锚点索引

| 职责 | 路径 |
| --- | --- |
| 通道 / 入站 | `electron/weixin-bot.js` |
| 命令 / 模式分流 | `electron/weixin-bot-commands.js` |
| 模式 / FastRoute | `electron/weixin-bot-mode.js` |
| 单 Agent | `electron/weixin-bot-agent.js` |
| 技能注册 | `electron/weixin-bot-skills.js` |
| 数据 | `electron/weixin-bot-analytics.js` |
| 日报图 | `electron/weixin-bot-report.js` |
| RAG | `electron/weixin-bot-rag.js` |
| 装配 | `electron/main.js` |

---

## 14. 审计结论（固化）

| 项 | 结论 |
| --- | --- |
| 架构 | **通过**：一 Agent + 多技能 + 微信 iLink |
| 实现 | **桌面主路径已实现**（MVP） |
| 条件 | AI 配置 + 进入 agent 模式 |
| 多 Agent | **未实现；本规格明确不做** |
| 文档 | 以本文件 + skills 源码为智能客服真值 |

---

## 15. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-24 | v1.0.0 初版：基于代码审计固化单 Agent 架构真值 |
| 2026-07-24 | 通道能力写明收发文件；对齐仓库 `CLAUDE.md` 硬规则 |
