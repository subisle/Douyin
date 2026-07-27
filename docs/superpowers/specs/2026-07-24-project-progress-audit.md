# 项目进度审计 · 设计对照报告

| 项 | 内容 |
| --- | --- |
| 版本 | v1.2.0 |
| 日期 | 2026-07-27 |
| 分支 | `615`（相对 origin 领先；以本地 HEAD 为准） |
| 方法 | 代码优先 + 多代理对照设计文档 + Verify 对抗校验；冲突时 **代码 / migrations / CLAUDE.md > 进度表 > 旧设计段落** |
| 关联 | 路线图 S0–S8 · 单 Agent 规格 · `ilink-implementation-progress.md` · ADR 0001 · 执行切片 `2026-07-24-next-execution-slice.md` · 进度回执 / 用户记忆设计（2026-07-27） |

---

## 1. 一句话结论

| 维度 | 结论 |
| --- | --- |
| 用户智能 | **桌面单 Agent + 11 技能 + 微信 iLink**（默认 agent；AI 就绪后业务文本进 Agent）；进度回执 / 用户记忆一期已落地，可演示 |
| 服务器 Worker | **实验性文本闭环 + S2 登录/凭据主链已接线**；**非生产** |
| 相对路线图 | **S0 基本完成；S1 剧本齐、真号留证缺；S2 代码大半完成、退出准则未证；S3 仅地基；S4–S8 未开** |
| 生产标签 | **禁止**写「服务器生产可用」（未过 S7 / G1–G4） |
| 正确下一刀 | **S3 Artifact 全链路为主**；S1 真号留证有 token 再做；**S2 扫码退出非本阶段必做**（env token / seed 凭据即可）；禁止先 S4 大迁 / S8 多 Agent |

---

## 2. 设计文档 vs 代码 · S0–S8 矩阵

| 阶段 | 设计退出准则（摘要） | 代码/文档证据 | 状态 | 完成度 |
| ---: | --- | --- | --- | ---: |
| **S0** 文档对齐 | 三份核心文档与 worker 一致；LANDING/README 入口 | `ilink-server-agent-design` / `ai-agent-production-plan` / `LANDING` / `README` / `CLAUDE.md` 已指向实验 Worker 与单 Agent；仍有「下一刀=仅 S0」与进度表「S2 已推进」漂移 | **部分** | ~85% |
| **S1** 真号文本 E2E | 1 次真实私聊闭环记录 + 双 worker 仅一方 lease | Runbook ✅ `docs/runbooks/ilink-text-e2e.md` + 模板 + ops checklist；**无已填成功记录** | **部分** | ~45% |
| **S2** 凭据 + 扫码控制 | 加密凭据；Worker 读库；Web 发起/轮询；Worker claim 登录槽 | `ilink-account-credentials` / seed / worker 读库 ✅；`003_ilink_login_control` + `ilink-login-control` + `ilink-login-poller` 接线 ✅；`/api/bot/login/{start,status,cancel}` + `requireApiAccess` ✅；**缺**完整 step-up/RBAC 矩阵、Electron 应急入口、真机扫码 E2E | **部分** | ~75% |
| **S3** Artifact | 入站媒体 + 出站图/CSV 真机 | `ilink-artifact-store` + `ilink-media-policy` + 单测 ✅；**bot-worker / transport / outbox 未接线**；表 `artifacts` schema 已有 | **地基** | ~20% |
| **S4** shared/bot-core | API 零 electron require；Mode/Tools/Agent 迁出 | `shared/` 仅 `ilink-adapter`；`src/server/bot-core/rag.js` 仍 re-export electron；`/api/agent/chat` require electron | **未完成** | ~10% |
| **S5** Session/Run/Step | migration + 可恢复 | 无对应 migration / 实现 | **未开始** | 0% |
| **S6** Web 控制面 DB 真源 | status 读 lease/Inbox/Outbox | `/api/bot/status` 仍偏文件心跳；登录 API 已有 | **未开始/极少** | ~15% |
| **S7** 门禁灰度 | G1–G4 + 24h/72h | 无证据 | **未开始** | 0% |
| **S8** 扩展 | Catalog / 调度 / 有界多 Agent | 仅文档 | **后置** | 0% |

### 2.1 S2 任务级对照（相对 `ilink-s2-credentials-login` 计划）

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| A1 凭据仓库 | ✅ | `scripts/ilink-account-credentials.js` + test |
| A2 Worker 读库 | ✅ 实现 / ⚠️ 退出未证 | `bot-worker.js`：env token **优先**，空则 `credentialStore.getCredential`；对抗校验将「仅库凭据生产路径」标 partial |
| A3 seed CLI | ✅ | `scripts/ilink-seed-credential.js` · `bot:seed-credential` · runbook |
| B1 migration 003 | ✅ | `migrations/003_ilink_login_control.js` → `ilink_login_requests` |
| B2 login-control store | ✅ | `scripts/ilink-login-control.js` |
| B3 login poller 接线 | ✅ | `bot-worker` 默认 DB 模式启 poller（`BOT_ILINK_LOGIN_POLL=0` 可关） |
| B4 Web API | ✅ 最小 | `src/app/api/bot/login/{start,status,cancel}` 鉴权 + no-store |
| 设计退出：Web 扫码→Worker 收文本 | ⏸ **本阶段不要求** | 代码已有；产品/运维确认当前可用 env token 或 `bot:seed-credential`，扫码 E2E 后置 |
| S2.6 Electron 应急入口 | ⏸ 后置 | 未做；非当前阻塞 |

### 2.2 文本闭环（S0 基线已声明）— 仍成立

```text
getUpdates → persistBatch(Inbox+Cursor) → onText
  → sendOutbound(enqueue Outbox + fencing)
  → reclaimExpiredClaims → claimBatch → sendMessage
  → sent | retry_wait | unknown(resolveUnknown)
```

模块：`ilink-text-transport` / `ilink-db-lease` / `ilink-inbox-cursor` / `ilink-outbox` / `bot-worker`。

---

## 3. 桌面单 Agent 规格对齐

规格：`docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md`  
扩展：`2026-07-27-weixin-agent-progress-status-design.md` · `2026-07-27-weixin-agent-user-memory-design.md`

| 检查项 | 结果 |
| --- | --- |
| 唯一用户通道 iLink | ✅ `CLAUDE.md` + 桌面 `weixin-bot.js`；无第二 IM 主通道 |
| 恰好一个 Agent | ✅ `main.js` 单例 `WeixinBotAgent` |
| 11 技能一技能一功能 | ✅ `weixin-bot-skills.js`：`search_anchors` … `rag_search` |
| 默认 agent（无独立指令模式入口） | ✅ 产品默认 `agent`；`weixin-bot-mode.js` 仍可存 `instruction` 兼容态，**无**独立「指令模式」用户入口 |
| FastRoute | ⚠️ **非**当前产品主路径：`matchFastRoute` 仅兼容/单测导出；**AI 就绪后业务文本进 Agent**（commands 注释与测一致） |
| AI 超时默认 90s | ✅ `WeixinBotAgent` / 设置页 / `AI_TIMEOUT_MS` 覆盖（`weixin-bot-agent.js`、security 测） |
| 进度回执（开场 + 工具） | ✅ 默认开、可关；`progressEnabled` / `AI_PROGRESS`（进度回执规格 + agent 测） |
| 用户记忆 / 习惯一期 | ✅ 线程落盘加长 + 成功技能自动学习画像注入；「清空对话」只清线程；「清除习惯」清 profile（用户记忆规格 + `weixin-bot-user-memory.js` + commands） |
| 数字只来自 DB/工具 | ✅ 规格 + analytics；RAG 禁答实时数字 |
| 多 Agent 默认路径 | ✅ **未实现**（符合冻结） |

**桌面主路径完成度：~85%（产品可用 MVP）**；7/27 补齐超时/进度/记忆一期。缺口仍在共享 Core、会话 MySQL、抖音画像桩等，不阻塞桌面日常使用。

---

## 4. 产品门禁 / LANDING / 本地存储

| 项 | 设计要求 | 现状 |
| --- | --- | --- |
| G1 统一 Core | `shared/bot-core` | ❌ 未迁 |
| G2 Web 管理生产化 | 会话/知识/审计 | 部分 MVP |
| G3 安全鉴权 | 生产强制登录 | 部分（Agent/Bot login 有鉴权） |
| G4 72h / 黄金集 | 发布证据 | ❌ |
| LANDING L1 防爆满 | runtime 不写系统 tmp | ✅ **代码已有** `electron/local-paths.js`；LANDING / local-storage-plan 已同步为已落地 |
| LANDING L2 板卡库 | douyinxs | 运维依赖，与 iLink 主线正交 |

---

## 5. 文档漂移清单

| 文档 | 问题 | 状态 |
| --- | --- | --- |
| `ilink-server-sequential-roadmap.md` §当前下一刀 | 曾写「只做 S0→S1」 | ✅ 已改为审计下一刀；生产门禁改为 S7 |
| `ilink-implementation-progress.md` | S2/代码地图/下一阶段滞后 | ✅ 已刷新 |
| `ilink-server-agent-design.md` §1.2/§6 | 「二维码尚未接入」 | ✅ 已改为实验已接 |
| `ai-agent-production-plan.md` §2 | 「缺二维码通道」 | ✅ 已改为实验接线 |
| `LANDING.md` L1 / 会话锁路径 | 仍写默认 tmp | ✅ 已标代码落地 |
| `local-storage-plan.md` | 路径建议未编码 | ✅ 已对齐 `local-paths.js` |
| `/api/bot/status` 文案 | 「Inbox/Outbox 尚未接入」 | ✅ 已改为实验路径说明 |
| S0 残余 | 个别段落/status 字段与生产语义仍可再抠 | 部分（不阻塞主路径） |

---

## 6. 风险

1. **文档领先/滞后混杂** → 执行者可能跳过 S1 留证直接开 S4。  
2. **S2 代码「看起来完成」但无扫码 E2E** → 假绿。  
3. **S3 store 默认 root 仍可能落 tmp**（`os.tmpdir()/douyin-artifacts`）→ 与防爆满原则冲突，全链路前必须绑 `ARTIFACT_ROOT`。  
4. **Web 仍 require electron** → 服务器部署脆弱，S4 前勿标生产。  
5. **工作区脏改动**（desktop 4 页）勿与 bot 提交混装（`CLAUDE.md` §5）。

---

## 7. 正确下一刀（冻结）

```text
① 文档漂移已收口（持续小修即可）
② S3.1 根目录 ✅ → S3.2 入站 pipeline → S3.3 出站媒体 → S3.4 确定性 CSV/日报
③ S1 真号文本留证：有 token 时顺手做，不阻塞 S3 编码
④ S2 扫码控制面：代码保留；**不作为当前退出门禁**（env / seed 足够开发与实验）
⑤ S4 Core 仍须 S3 媒体能力与文本稳后再迁
```

**禁止：** 未完成 S7 前宣称服务器生产可用；禁止先多 Agent / Core 大搬家插队。

---

## 8. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-24 | 初版：多代理审计 + 本地代码接线核对 |
| 2026-07-24 | v1.1：漂移项落地修复；并入 workflow Verify 附录；S2.2 对抗降为「实现 done / 退出 partial」 |
| 2026-07-27 | v1.2：桌面单 Agent 对齐 7/27 真值——默认 agent、FastRoute 仅兼容/测试、超时 90s、进度回执、用户记忆一期；不升服务器生产标签 |

---

## 9. 多代理对抗校验附录（workflow journal）

> 来源：`wf_25d91c6d-4f4` Verify 阶段 StructuredOutput。合成代理长文 StructuredOutput 超时/中断，**未**覆盖主结论；以本节 + 正文为准。  
> 规则：有代码/测试/接线证据才维持 done；仅文档或模板不得升为 done。

| claimId | 原状态 | 校验状态 | conf | 要点 |
| --- | --- | --- | ---: | --- |
| pre-S0-text-baseline | done | **done** | 0.93 | bot-worker 文本+DB 闭环真实接线（实验非生产） |
| S0 / S0.1–S0.3 | partial | **partial** | ~0.9 | 文档大体对齐，残余语义/入口可再抠 |
| S1 | partial | **partial** | 0.92 | runbook 齐；**无真号成功记录** |
| S1.1 | done | **done** | 0.9 | `ilink-text-e2e.md` 可执行 |
| S1.2 / S1.3 / S1.5 | partial | **partial** | ~0.9 | 模板/剧本/ops 有；执行证据缺 |
| S2 | partial | **partial** | 0.86 | 代码接线齐；缺扫码→收文本退出证据 |
| S2.1 / S2.3 / S2.5 / S2.A3 | done | **done** | ~0.9 | 凭据 store、003、poller、seed 为真实现 |
| S2.2 | done | **partial** | 0.88 | 读库已实现但 **env token 优先**；无「仅库凭据」联调记录 |
| S2.4 | partial | **partial** | 0.9 | login API 真；非完整 step-up/RBAC |
| S3 / S3.1 / S3.5 | partial | **partial** | ~0.9 | store/policy/GC 库级地基；**未接 worker** |
| S6.3 | partial | **partial** | 0.9 | 知识库仅部分 CRUD |
| S6.5 | partial | **missing** | 0.9 | 缺完整「5 分钟回滚演练」手册条目 |
| P0 / P1 design | partial | **partial** | ~0.9 | 设计批次未全过 |

### 校验结论摘要

- **done：** S1.1、S2.1、S2.3、S2.5、S2.A3、pre-S0-text-baseline  
- **关键 partial：** S1 留证、S2 退出、S3 全链路、S0 残余  
- **无 claim 被升格为生产完成**；**不修改** §7 下一刀顺序  
- 桌面单 Agent 基线对齐（11 技能 / 默认 agent / iLink）；**注意：** 附录当时的「双模式 / FastRoute 优先」表述已被 v1.2 正文 §3 纠正为当前产品行为
