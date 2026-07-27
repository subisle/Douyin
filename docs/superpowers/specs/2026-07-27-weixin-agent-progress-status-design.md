# 微信 Agent 进度回执（Hermes 风格轻量版）· 设计规格

| 项 | 内容 |
| --- | --- |
| 版本 | v1.0.0 |
| 日期 | 2026-07-27 |
| 状态 | Accepted（用户确认「开场 + 工具进度」「默认开可关」「开始实现」） |
| 范围 | 桌面 `WeixinBotAgent` 自然语言路径的进度文本回执 |
| 非范围 | 流式吐字、多 Agent、编辑上一条消息、服务器 worker 进度、轮次提示 |
| 参考 | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) 的 `status_callback` / `tool_progress_callback` 思路 |

> 冲突时：本规格 + `electron/weixin-bot-agent.js` 实现 > 过时段落。  
> 仍遵守：`CLAUDE.md` 单 Agent + iLink 唯一通道；数字只来自技能。

---

## 1. 问题

AI 就绪后业务文本全部进 tool-loop。`grok-4.5` 单轮常 20–40s，整次对话可能更长。  
当前用户从发消息到最终 `replyText` 之间**无任何反馈**，体感为「卡住」或「超时」。

## 2. 目标

1. 处理开始时立刻有一条进度回执。  
2. 真正调用技能前有一条工具进度回执。  
3. 默认开启，可关闭。  
4. 进度发送失败不影响主流程（fail-open）。  
5. 不增加 Agent 数量，不改变数字可信约束。

## 3. 方案选择

**采用方案 A：Agent 内直接 `replyText` 发进度。**

| 方案 | 结论 |
| --- | --- |
| A. Agent 内 replyText | **采用**：改动集中、对齐 Hermes 回调语义 |
| B. 通道层 replyProgress API | 不做：命令路径收益小、接口面更大 |
| C. 仅开场 | 不做：不满足「开场 + 工具进度」 |

## 4. 行为规格

### 4.1 触发条件

同时满足才发进度：

- `WeixinBotAgent.isEnabled()` 为真  
- 进入 `handleMessage` 且将调用 LLM（非 disabled / empty 早退）  
- `progressEnabled === true`（见 §5）  
- `typeof args.replyText === "function"`

不发进度：

- AI 未就绪走固定指令兜底  
- CSV 文件导入等确定性路径  
- 系统口令（帮助 / 清空对话）由 commands 直接回复  

### 4.2 消息时机与文案

| 时机 | 文案 | 说明 |
| --- | --- | --- |
| 进入 tool-loop 前（首次） | `收到，正在处理…` | 每条用户消息最多一次 |
| 每个 `skills.execute` 之前 | 见技能中文映射 | 同轮同一 `name` 连续重复时跳过，避免刷屏 |
| 最终 | 现有 finalText / 附件 | 不变 |

技能中文映射（未知技能回退 `正在执行工具…`）：

| skill name | 进度文案 |
| --- | --- |
| `search_anchors` | `正在搜索主播…` |
| `get_anchor_full_profile` | `正在查询主播数据…` |
| `get_anchor_wave_profile` | `正在查询音浪…` |
| `get_anchor_wave_days` | `正在查询音浪天数…` |
| `compare_anchor_wave` | `正在对比音浪…` |
| `get_anchor_duration` | `正在查询直播时长…` |
| `analyze_anchor_wave` | `正在分析音浪…` |
| `get_daily_report_data` | `正在查询日报数据…` |
| `export_daily_report_image` | `正在生成日报图…` |
| `export_wave_file` | `正在导出音浪文件…` |
| `rag_search` | `正在检索说明…` |

### 4.3 Fail-open

```text
try { await replyText(progress) } catch { /* 忽略，继续 LLM/工具 */ }
```

进度不得覆盖/替换最终答案；最终答案仍独立发送。

### 4.4 明确不做

- 不发 reasoning / 内部 tool JSON  
- 不发「第 N 轮分析中」  
- 不尝试编辑/撤回进度消息（iLink 无稳定编辑语义则保持追加）  
- 不引入流式 token  
- 不默认恢复 FastRoute  

## 5. 配置

| 来源 | 键 | 默认 | 优先级 |
| --- | --- | --- | --- |
| 环境变量 | `AI_PROGRESS` | 未设则不覆盖 | 最高：`0/false/off` 关，`1/true/on` 开 |
| 桌面设置 | `settings.ai.progressEnabled` | `true` | env 未设时用此值 |
| 运行时 | `getAiRuntimeConfig().progressEnabled` | 解析后布尔 | Agent `getConfig()` 读取 |

UI：AI 设置区增加勾选「处理时发送进度回执（默认开）」。  
`.env.example` 增加可选 `AI_PROGRESS=1` 注释说明。

## 6. 实现落点

| 文件 | 变更 |
| --- | --- |
| `electron/weixin-bot-agent.js` | 进度发送辅助、开场 + 工具前钩子、读 `progressEnabled` |
| `electron/weixin-bot.js` | 默认/存盘/getAiRuntimeConfig/saveSettings 读写 `progressEnabled` + env |
| `src/components/desktop/weixin-bot-page.tsx` | 开关 UI + 默认 true |
| `src/client/http-electron-api.ts` | mock 默认 true |
| `electron/weixin-bot-agent.test.js` | 验证进度顺序与 fail-open、关闭时不发 |
| `electron/weixin-bot-security.test.js` 或等价 | env/settings 解析（若有现成 AI config 测则扩展） |

## 7. 测试与验收

### 自动化

1. progress 开：mock replyText 记录顺序为  
   `收到，正在处理…` → `正在查询音浪…`（或对应技能文案）→ 最终答案  
2. progress 关：仅最终答案  
3. 进度 replyText 抛错：仍返回 handled 最终答案  
4. 同轮同技能两次 execute：进度文案不连续重复两条相同  

### 实机

1. 重启桌面机器人，微信问「查某艺名音浪」  
2. 应先看到「收到，正在处理…」，再可能看到工具进度，最后正式数据  
3. 关闭进度开关后仅最终答案  

## 8. 成功标准

- 慢模型下用户 1–2 秒内看到开场回执  
- 工具阶段有可读中文进度  
- 可一键关闭  
- 不破坏现有超时/租约/技能数字约束  

## 9. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-27 | 初版；用户确认开场+工具进度、默认开可关、开始实现 |
