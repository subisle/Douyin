# 微信 Agent 用户记忆与习惯 实现计划

> **面向 AI 代理：** 当前会话内联实现。TDD。

**目标：** 桌面 Agent 每用户对话落盘加长 + 成功技能自动学习习惯并注入 system。

**架构：** 新建 `weixin-bot-user-memory.js` 负责 threads/profiles 持久化；`WeixinBotAgent` 接入 load/save/learn/inject。

**规格：** `docs/superpowers/specs/2026-07-27-weixin-agent-user-memory-design.md`

---

## 文件

| 文件 | 职责 |
| --- | --- |
| `electron/weixin-bot-user-memory.js` | 存储、prune、learn、summary |
| `electron/weixin-bot-user-memory.test.js` | 单元测试 |
| `electron/weixin-bot-agent.js` | 接入 memory |
| `electron/weixin-bot-agent.test.js` | 集成：注入、学习、清空 |
| `electron/main.js` | 可选传入 storage 路径（默认 runtime/memory） |

---

### 任务 1：user-memory 模块 TDD
### 任务 2：Agent 接入 TDD
### 任务 3：main 接线 + 回归测试
