# 抖音数据管理

**直接落地：** [docs/LANDING.md](docs/LANDING.md)

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md](docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md) | **微信单 Agent + 多技能架构真值** |
| [docs/ilink-implementation-progress.md](docs/ilink-implementation-progress.md) | **实现进度真值**（代码优先，2026-07-24） |
| [docs/superpowers/specs/2026-07-24-project-progress-audit.md](docs/superpowers/specs/2026-07-24-project-progress-audit.md) | **进度审计**（设计对照 + 下一刀） |
| [docs/superpowers/specs/2026-07-24-ilink-s3-artifact-pipeline-design.md](docs/superpowers/specs/2026-07-24-ilink-s3-artifact-pipeline-design.md) | **S3 图片/CSV Artifact 设计规格** |
| [docs/superpowers/plans/2026-07-24-next-execution-slice.md](docs/superpowers/plans/2026-07-24-next-execution-slice.md) | **近 1–2 周执行切片** |
| [docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md](docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md) | **按序路线 S0–S8**（多 Agent 仅 S8 后置） |
| [docs/server-deployment.md](docs/server-deployment.md) | 部署与实验 env 开关 |
| [docs/deployment-rk3318.md](docs/deployment-rk3318.md) | **RK3318 BOX（arm64 / Docker）部署**（分支 `3318`） |
| [docs/ai-agent-production-plan.md](docs/ai-agent-production-plan.md) | 产品门禁与批次 |
| [docs/ilink-server-agent-design.md](docs/ilink-server-agent-design.md) | iLink 服务器专项设计 |
| [docs/local-storage-plan.md](docs/local-storage-plan.md) | 本地防爆满 |
| [docs/api-design.md](docs/api-design.md) | 数据 API |

## 机器人 / Worker

**硬规则（详见 [`CLAUDE.md`](CLAUDE.md)）：**

- **用户通道：微信 iLink**（收发文字、收文件、发文件/图片均走 iLink）+ **QQ 开放平台官方机器人**（群 @ / 私聊）
- **无 AI 能力**：没有模型调用、没有 Agent、没有知识库与会话记忆；只有固定指令 + 确定性技能
- 桌面为用户主路径；服务器 Worker 实验且未达生产前不得标生产

- **指令示例：** 「每日报告」「艺名 9.11音浪」「音浪文件 18号」，发「帮助」看全部
- **当日数据导入：** 先发「9.11」，再连传音浪、时长两个 CSV；同一日期口令 10 分钟内可覆盖 2 个文件
- **多 QQ 机器人：** `data/builtin/qq-bots/*.json` 一份配置一个机器人（`appId` / `clientSecret` / 可选 `label`）
- 服务器：`npm run bot:worker` — 实验文本/DB 通道
- RK3318 盒子（arm64 / Docker）部署：`docs/deployment-rk3318.md`
- 测试：`npm run test:weixin-bot` · `npm run test:bot-worker` · `npm run test:ilink-db`
