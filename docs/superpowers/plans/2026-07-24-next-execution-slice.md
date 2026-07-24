# 执行切片 · 下一 1–2 周（进度收口 + S3 设计落地）

| 项 | 内容 |
| --- | --- |
| 版本 | v1.0.0 |
| 日期 | 2026-07-24 |
| 输入 | `docs/superpowers/specs/2026-07-24-project-progress-audit.md` |
| S3 规格 | `docs/superpowers/specs/2026-07-24-ilink-s3-artifact-pipeline-design.md` |
| 总序 | `docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md` |

---

## 目标

1. 消除关键文档漂移，使「下一刀」全库一致。  
2. **主路径：S3 Artifact 全链路**（S3.1 根目录 → S3.2 入站 → S3.3 出站 → S3.4 命令）。  
3. **S1 真号文本留证**：有 token 时做；无 token 可 skip，不阻塞 S3。  
4. **S2 扫码退出：本阶段不做**（控制通道代码保留；开发用 env token 或 `bot:seed-credential`）。  

**不做：** S2 扫码真机门禁、S4 Core 大迁、S8 多 Agent、生产标签、与 bot 无关的桌面 4 页脏改动混提。

---

## 波次 0 · 文档对齐（0.5 天，可 3 代理并行）

| ID | 任务 | 文件 |
| --- | --- | --- |
| D0.1 | 更新 progress §1/§2/§6 与代码地图（S2 登录已接线、S3 地基） | `docs/ilink-implementation-progress.md` |
| D0.2 | 路线图「当前下一刀」改为审计结论 | `docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md` |
| D0.3 | server-agent-design §1.2 二维码「未接入」→「实验已接」 | `docs/ilink-server-agent-design.md` |
| D0.4 | production-plan §2 基线表同步 | `docs/ai-agent-production-plan.md` |
| D0.5 | README / LANDING 入口链到 audit + S3 规格 | `README.md` · `docs/LANDING.md` |

**验收：** 五处文档对 S2/S3/下一刀无互斥表述。

---

## 波次 1 · S1 留证（1 天，串行，需真号）

| ID | 任务 | 产出 |
| --- | --- | --- |
| S1.a | 停桌面同账号 runner | 检查项 |
| S1.b | migrate + DB 模式 worker | status `persistence=mysql` |
| S1.c | 私聊文本 → Inbox + Outbox sent + 微信 ack | 截图/日志路径脱敏 |
| S1.d | 双 worker 抢租约 | 仅一方持 lease |
| S1.e | 填 `ilink-text-e2e-record.template.md` 副本 | `docs/runbooks/records/` 或本地附件索引 |

无 token：**至少**完成 migrate + 双 worker SQL 演练，记录 skip，不得标 S1 退出完成。

---

## 波次 2 · S2 扫码退出（**本阶段跳过**）

> 产品确认：当前**不需要**扫码退出门禁。凭据路径维持：`BOT_ILINK_TOKEN`（开发）和/或 `bot:seed-credential` 加密落库。  
> 已合入的 login API / poller **保留**，待以后要无窗口换号再开真机验收。

| ID | 任务 | 状态 |
| --- | --- | --- |
| S2.x* | Web 扫码 → 写凭据 → 无 env 收文本 | ⏸ 后置 |
| S2.x5 | 文档写清「扫码非当前门禁」 | 本切片同步 |

可选更后置：Electron 应急入口、完整 RBAC（S6/G3）。

---

## 波次 3 · S3 开工（2–4 天，设计已冻结）

| ID | 任务 | 代理建议 |
| --- | --- | --- |
| S3.0 | 规格评审勾选非目标/开关默认 off | 主会话 |
| S3.1 | Artifact root 绑定 `ARTIFACT_ROOT`/`BOT_STORAGE_DIR` + doctor | ✅ `local-paths` + store + tests + deployment |
| S3.2 | `ilink-media-pipeline` 入站 + 单测（mock download） | 1 代理 |
| S3.3 | Outbox 媒体发送 | 依赖 adapter；1 代理 |
| S3.4 | 确定性 CSV/日报命令接线 | 1 代理；勿与 S3.2 同改 worker 无协调 |
| S3.6 | 字体/卷文档 | 可并行 |

合并顺序：**S3.1 → S3.2 → S3.3 → S3.4**；S3.6 随时。

---

## 多代理约束

- 禁止两代理同时无协调改 `bot-worker.js` 公共接口。  
- 文档波次可全并行。  
- 每任务结束：相关 `npm run test:bot-worker` 或子集绿 + 独立 commit。  
- 桌面 `src/components/desktop/*` 脏改动另分支/另 PR。

---

## 完成定义（本切片结束时）

- [ ] 文档无「二维码完全未做 / 下一刀仅 S0」类过时句  
- [ ] S1 记录存在或正式 skip 说明  
- [ ] S2 最小扫码或「凭据读库收文本」真机/模拟证据  
- [ ] S3 规格 Accepted；S3.1+S3.2 代码与测试合入或明确 WIP PR  
- [ ] **未**出现生产可用表述  

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-24 | 初版执行切片 |
