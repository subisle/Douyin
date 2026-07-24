# 抖音项目 · 可直接落地执行单

| 项 | 内容 |
|----|------|
| 版本 | **v1.1.0** |
| 日期 | 2026-07-24 |
| 用途 | **唯一落地清单**：按序执行即可；不重复讲愿景 |
| 权威分工 | 功能：`ai-agent-production-plan.md` · 本地盘：`local-storage-plan.md` · 数据 API：`api-design.md` · 部署：`server-deployment.md` · 板卡：`/Volumes/2t/it/服务器/ssh/server-status-2026-07-20.md` |
| **智能客服架构真值** | `docs/superpowers/specs/2026-07-24-weixin-single-agent-skills-design.md`（**单 Agent + 多技能 + 微信 iLink**；非多 Agent） |
| **项目硬规则** | 仓库根目录 `CLAUDE.md`：**唯一用户通道 = 微信 iLink**（收发消息与文件）；一 Agent 多技能 |
| iLink 服务器进度真值 | `docs/ilink-implementation-progress.md` |
| 进度审计 / 下一刀 | `docs/superpowers/specs/2026-07-24-project-progress-audit.md` |
| 近周执行切片 | `docs/superpowers/plans/2026-07-24-next-execution-slice.md` |
| S3 Artifact 规格 | `docs/superpowers/specs/2026-07-24-ilink-s3-artifact-pipeline-design.md` |
| iLink 顺序路线 | `docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md` |
| iLink 服务器设计 | `docs/ilink-server-agent-design.md` |

---

## 0. 30 秒结论

| 维度 | 结论 |
|------|------|
| **P0 桌面智能内核** | **已落地，可测**（ModeRouter / analytics / 串行 / 测试绿） |
| **P1 RAG + Web 对话** | **已落地 MVP**（BM25、`/api/agent/chat`、`/agent`） |
| **P2 控制台 / worker** | **实验性文本 + DB transport + 登录控制 API/poller**（**非生产**；媒体全链路/Core/真号留证未齐） |
| **P3 抖音旁路** | **仅桩** |
| **rk3318 业务库** | **隧道方案已定**；板卡尚无 `douyinxs` 库/用户时需一次建库授权 |
| **本地防爆满** | **设计+基准已有**；**代码默认仍可能写系统盘 tmp** → 下表 L1 必做 |

**现在就能跑的：** 桌面微信机器人（指令模式 + 配置 AI 后发「人工客服」进**单助手多技能**）、`npm run test:weixin-bot` / `test:bot-worker` / `test:ilink-db`、项目盘存储基准、Web `/agent` 知识问答；**实验开关下**可在服务器路径收发**文本**（非生产）。  
**现在不能假设已好的：** 直连 `192.168.5.12:3306`、**服务器生产可用 / 媒体 Artifact / 扫码控制面**、**多 Agent 已实现**、抖音主页爬取、会话默认已在项目盘。

---

## 1. 环境事实（落地前必知）

### 1.1 磁盘

| 卷 | 可用 | 含义 |
|----|------|------|
| 系统盘（含 `$HOME` `/tmp`） | ~**11 GB / 95%** | 禁止再堆会话/大缓存 |
| `/Volumes/2t`（本项目） | ~**1.8 TB / 3%** | 会话/锁/RAG/基准应写这里 |

项目约 **4.5 GB**；Electron userData 相关约 **1.2 GB 在系统盘**。

### 1.2 数据库（rk3318）

| 项 | 值 |
|----|-----|
| 板卡 IP | **`192.168.5.12`**（不要用错误 DNS `rk3318→198.18.x`） |
| MariaDB | 板卡 **`127.0.0.1:3306` 仅本机** |
| 现有库 | 主要是 **`verification`**；**无 douyinxs 时需建库** |
| 开发接入 | `ssh -f -N -L 3307:127.0.0.1:3306 root@192.168.5.12` |
| 应用 `.env` | `DB_HOST=127.0.0.1` `DB_PORT=3307` + 用户库名密码 |

### 1.3 验证命令（拷贝即用）

```bash
cd /Volumes/2t/it/抖音

# 单元/集成（不依赖真实微信/板卡）
npm run test:weixin-bot
npm run test:bot-worker   # worker + 文本 transport + ilink-db
npm run test:ilink-db     # crypto + lease + inbox + outbox
npm run test:ilink-adapter

# 磁盘与路径
npm run storage:doctor
npm run storage:bench

# DB 隧道（另开终端保持）
ssh -f -N -L 3307:127.0.0.1:3306 root@192.168.5.12
# 连通后（密码正确且库已存在时）
node -e "require('dotenv').config(); const mysql=require('mysql2/promise');
(async()=>{const c=await mysql.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
console.log(await c.query('SELECT DATABASE() db, COUNT(*) c FROM information_schema.tables WHERE table_schema=DATABASE()')); await c.end();})().catch(e=>{console.error(e.message);process.exit(1);})"
```

---

## 2. 已实现 ↔ 代码映射（审计真值）

| 能力 | 状态 | 证据路径 |
|------|------|----------|
| 多账号微信通道 | ✅ | `electron/weixin-bot.js` |
| 指令命令 + CSV 默认昨天 | ✅ | `electron/weixin-bot-commands.js` |
| ModeRouter + FastRoute | ✅ | `electron/weixin-bot-mode.js` + commands agent 分支 |
| analytics 共用 | ✅ | `electron/weixin-bot-analytics.js` |
| skills 11 tools | ✅ | `electron/weixin-bot-skills.js` |
| 会话串行 | ✅ | `createSessionQueues` in `weixin-bot.js` |
| Runner 锁 | ✅ 模块+startMonitoring | `weixin-bot-runner-lock.js` |
| RAG BM25 | ✅ | `electron/weixin-bot-rag.js` · `data/rag/` |
| Web chat API | ✅ | `src/app/api/agent/chat/route.ts` · `weixin-bot-server-agent.js` |
| Web 页 | ✅ MVP | `/agent` `/knowledge` `/bot` |
| 会话文件默认路径 | ✅ 默认 `data/runtime/sessions/` | `electron/local-paths.js` → `weixin-bot-session-store.js` |
| 锁默认路径 | ✅ 默认 `data/runtime/locks/` | `electron/local-paths.js` → `weixin-bot-runner-lock.js` |
| 板卡 douyinxs 库 | ❌ 需运维一步 | 仅 `verification` 时存在 |
| 服务器微信长轮询 | ⚠️ **实验**（env 开关；文本 + 可选 DB） | `scripts/bot-worker.js` · `scripts/ilink-text-transport.js` · `scripts/ilink-{crypto,db-lease,inbox-cursor,outbox}.js` · `shared/ilink-adapter.js` |
| 抖音 profile 真拉 | ❌ 桩 | `weixin-bot-douyin-insight.js` |

---

## 3. 落地批次（严格按序）

### L0 · 今天可验收（已具备，只跑命令）

- [ ] `npm run test:weixin-bot` → 期望全绿（当前 27）  
- [ ] `npm run electron:dev` → 微信：帮助 / 艺名 / 每日报告 / 人工客服→每日报告→退出客服  
- [ ] `npm run dev` → 打开 `http://localhost:3000/agent` 问「CSV怎么导入」  
- [ ] `npm run storage:doctor` → 确认系统盘告警存在则进入 L1  

**完成定义：** 不改代码也能演示 P0+P1 主路径。

---

### L1 · 本地防爆满（**代码已落地**，文档/验收勾选）

> 实现：`electron/local-paths.js`（`resolveRuntimeDir` 优先 `BOT_STORAGE_DIR` → 项目 `data/runtime` → 最后才 tmp 回落）。  
> 仍建议显式设置 `BOT_STORAGE_DIR` 到项目盘；打包环境见 `main.js` userData/runtime 回落。

| # | 任务 | 改哪里 | 状态 |
|---|------|--------|------|
| L1.1 | 统一 runtime 根目录 | `electron/local-paths.js` | ✅ |
| L1.2 | 会话路径 | `weixin-bot-session-store.js` | ✅ |
| L1.3 | 锁路径 | `weixin-bot-runner-lock.js` | ✅ |
| L1.4 | 硬顶 | 会话 20MB、RAG custom 5MB | ✅ 代码有 cap |
| L1.5 | 启动 doctor 一行日志 | `local-paths` / storage doctor | ✅ `npm run storage:doctor` |
| L1.6 | 文档 | `local-storage-plan.md` 与代码一致 | ⏳ 同步中 |

**推荐默认 env（写进 `.env.example`）：**

```env
BOT_STORAGE_DIR=/Volumes/2t/it/抖音/data/runtime
AGENT_SESSION_PATH=/Volumes/2t/it/抖音/data/runtime/sessions/weixin-agent-sessions.json
BOT_LOCK_PATH=/Volumes/2t/it/抖音/data/runtime/locks/weixin-bot-runner.lock
```

**完成定义：** `storage:doctor` 显示 session/lock 在项目盘；杀进程后 `/tmp` 无新增 `weixin-agent-sessions.json`。

---

### L2 · 板卡库可用（运维 + 可选授权，0.5 天）

| # | 任务 | 谁做 | 完成定义 |
|---|------|------|----------|
| L2.1 | 隧道常开 | 开发者 | `nc -z 127.0.0.1 3307` 成功 |
| L2.2 | 板卡创建 `douyinxs` 库+用户 | **需你授权或 1Panel 手建** | `SHOW DATABASES` 含 douyinxs |
| L2.3 | `.env` 密码与用户一致 | 开发者 | 隧道下 `SELECT 1` 成功 |
| L2.4 | `node init-db.js` | 开发者 | 表 persons/accounts/wave_snapshots… 存在 |
| L2.5 | 桌面读库 | 开发者 | 主播列表/日报不再报连接失败 |

**未授权前不要**在文档中写「已连上业务库」。

---

### L3 · P1 打磨（1 天）

| # | 任务 | 完成定义 |
|---|------|----------|
| L3.1 | `/api/agent/chat` 在 DB 通时 FastRoute 艺名查数 | 返回 `summaryText` 含音浪/时长 |
| L3.2 | 配置 `AI_*` 时 LLM tool loop 冒烟 | 一句含糊对比能出工具结果 |
| L3.3 | 会话只写 runtime 目录 | 同 L1.2 |
| L3.4 | 测试保持 `npm run test:weixin-bot` 全绿 | CI 可跑 |

---

### L4 · P2 最小可用（2～3 天，可砍）

| # | 任务 | 完成定义 |
|---|------|----------|
| L4.1 | Runner 双开拒绝可复现 | 先 `bot:worker` 再桌面 start → 明确报错 |
| L4.2 | `/knowledge` 写 custom 受 5MB cap | 超额 413 |
| L4.3 | 服务器 iLink **仅实验文本**（env 开关）；不承诺生产/媒体/扫码控制面 | 文档与 `/bot` 文案一致；进度见 `ilink-implementation-progress.md` |

---

### L5 · 明确不做（本阶段）

- 服务器无窗口抖音爬取  
- pgvector 绑业务库  
- 桌面+服务器同时跑同一微信账号  
- 本地 dump 全表 CSV 到 `/tmp`  

---

## 4. 文档审计（可落地性）

| 文档 | 问题 | 处理 |
|------|------|------|
| `ai-agent-production-plan.md` | §0 仍有「未实现/可开工」**过时**；§0.B 测试数 24 已旧 | **以本文 §2 为准**；下节同步补丁 |
| `local-storage-plan.md` | L1 代码已落地 | 以 `electron/local-paths.js` 为准；文档勾选同步 |
| `api-design.md` | 仅数据 `/api/v1` | 正确；Agent 路由见本文 §2 |
| `server-and-app-design.md` | 历史「今日」表述 | 横幅已裁定业务日=昨天 |
| 多文档并行 | 易分叉 | **落地只跟 `LANDING.md` 批次** |

---

## 5. 一页「现在就做」

```text
1. npm run test:weixin-bot
2. export BOT_STORAGE_DIR="$PWD/data/runtime"   # L1 代码合入前先手动
3. npm run electron:dev          # 测微信 P0
4. ssh -f -N -L 3307:127.0.0.1:3306 root@192.168.5.12
5. （库就绪后）node init-db.js && 桌面打开数据页
6. npm run dev → /agent 测 RAG
```

---

## 6. 回滚

| 动作 | 回滚 |
|------|------|
| `.env` 改板卡 | 恢复 `.env.bak-sqlpub` |
| runtime 路径 | 删 `BOT_STORAGE_DIR`；或删 `data/runtime` |
| 代码 | `git checkout -- electron/ ...` |

---

**维护：** 新完成项只更新本文件 §2 状态表 + 勾选 §3；大设计仍回写对应专题文档。
