# 抖音数据管理

**直接落地：** [docs/LANDING.md](docs/LANDING.md)

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md](docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md) | **微信单 Agent + 多技能架构真值** |
| [docs/ilink-implementation-progress.md](docs/ilink-implementation-progress.md) | **实现进度真值**（代码优先，2026-07-24） |
| [docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md](docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md) | **按序路线 S0–S8**（多 Agent 仅 S8 后置） |
| [docs/server-deployment.md](docs/server-deployment.md) | 部署与实验 env 开关 |
| [docs/ai-agent-production-plan.md](docs/ai-agent-production-plan.md) | 产品门禁与批次 |
| [docs/ilink-server-agent-design.md](docs/ilink-server-agent-design.md) | iLink 服务器专项设计 |
| [docs/local-storage-plan.md](docs/local-storage-plan.md) | 本地防爆满 |
| [docs/api-design.md](docs/api-design.md) | 数据 API |

## 机器人 / Worker

- **用户智能对话：** 桌面 Electron 微信 Bot · **一个 Agent + 多技能** · 微信 iLink（见单 Agent 规格）
- 使用：配置 AI → 微信发「人工客服」→ 自然语言问数据；默认指令模式不调模型
- 服务器：`npm run bot:worker` — 实验文本/DB 通道，**不**替代桌面单 Agent 定义
- 测试：`npm run test:weixin-bot` · `npm run test:bot-worker` · `npm run test:ilink-db`
- **不得**将服务器 Worker 标为生产可用，除非路线图 S7 完成
