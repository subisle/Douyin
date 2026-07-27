# 微信 Agent 进度回执 实现计划

> **面向 AI 代理的工作者：** 可在当前会话内联实现。步骤用复选框跟踪。

**目标：** 为桌面 `WeixinBotAgent` 增加默认开启、可关闭的「开场 + 工具进度」微信文本回执。

**架构：** 在 `handleMessage` 的 LLM 循环前后用现有 `args.replyText` 发送短进度；配置经 `getAiRuntimeConfig().progressEnabled` 与 `AI_PROGRESS` 解析。进度 fail-open。

**技术栈：** Node（electron 主进程）、现有 node:test、React 设置页。

**规格：** `docs/superpowers/specs/2026-07-27-weixin-agent-progress-status-design.md`

---

## 文件

| 文件 | 职责 |
| --- | --- |
| `electron/weixin-bot-agent.js` | 进度文案映射、发送、开场/工具钩子 |
| `electron/weixin-bot-agent.test.js` | 进度顺序 / 关闭 / fail-open / 去重 |
| `electron/weixin-bot.js` | progressEnabled 默认、存盘、env、runtime |
| `src/components/desktop/weixin-bot-page.tsx` | 开关 UI |
| `src/client/http-electron-api.ts` | mock 默认 |
| `.env.example` | AI_PROGRESS 注释 |

---

### 任务 1：Agent 进度 + 测试

- [ ] 先写 `weixin-bot-agent.test.js` 失败用例
- [ ] 实现 agent 进度逻辑
- [ ] `node --test electron/weixin-bot-agent.test.js` 通过

### 任务 2：配置贯通

- [ ] `weixin-bot.js` 默认 true、env、save/load/getAiRuntimeConfig
- [ ] UI + http mock + .env.example
- [ ] 相关 security/config 测试扩展（若适用）

### 任务 3：验证

- [ ] `node --test electron/weixin-bot-agent.test.js electron/weixin-bot-security.test.js`
- [ ] 不主动 commit（除非用户要求）
