# 本地存储与防爆满设计（开发机）

| 项 | 内容 |
|----|------|
| 版本 | **v1.0.1** |
| 日期 | 2026-07-22 |
| 目标 | **先在本地测通**，保证**系统盘不写爆**；业务大数据走 **rk3318 MariaDB** |
| 落地勾选 | `docs/LANDING.md` L1 |
| 关联 | `docs/ai-agent-production-plan.md` · `docs/server-deployment.md` · `.env.rk3318.example` |
| 基准测试 | `node scripts/bench-local-storage.mjs` → `data/local-bench/report-*.json` |

---

## 1. 为什么要单独设计

实测开发机磁盘（2026-07-22）：

| 卷 | 挂载 | 容量 | 已用 | 可用 | 占用 |
|----|------|------|------|------|------|
| 系统数据盘 | `/System/Volumes/Data`（含 `$HOME`、`/tmp`） | ~228 GB | ~190 GB | **~11 GB** | **95%** |
| 项目盘 | `/Volumes/2t`（本仓库所在） | ~1.9 TB | ~51 GB | **~1.8 TB** | **3%** |

Electron 相关本地数据已主要落在**系统盘** userData：

| 路径 | 约占用 |
|------|--------|
| `~/Library/Application Support/douyin` | **472 MB**（其中 Partitions ~442 MB） |
| `~/Library/Application Support/douyin-live-monitor` | **627 MB** |
| `~/Library/Application Support/douyin-manager` | **163 MB** |
| 合计量级 | **~1.2 GB+** 仅应用支持目录 |

风险：会话文件、锁、临时报告、Chromium Partitions 若继续写 `$TMPDIR` / 系统 userData，**本地很容易把系统盘打满**，导致 macOS / IDE / 浏览器异常。

原则：

1. **热数据、大体积、可重建** → 项目盘 `/Volumes/2t/...` 或远端库  
2. **小配置、密钥** → 可留 userData，但设上限与清理  
3. **业务主数据** → **禁止**落本地大 JSON；走 **rk3318 MariaDB**（隧道）  
4. 任何本地写路径必须 **可配置 + 可观测 + 有 cap**

---

## 2. 写入面清单（当前代码）

| 写入方 | 默认路径 | 典型体积 | 风险 | 本地策略 |
|--------|----------|----------|------|----------|
| 微信凭据/设置 | `app.getPath('userData')/weixin-bot.v1.json` | < 1 MB | 低 | 保留；原子写；禁止塞消息历史 |
| 直播 cookie | `userData/douyin-live-cookie.v1.json` | ~12 KB | 低 | 保留 |
| Agent 会话 | **默认** `data/runtime/sessions/weixin-agent-sessions.json`（`local-paths.js`） | 默认可到十余 MB | 中（已迁项目盘） | 保持 cap 20MB；显式 `BOT_STORAGE_DIR`/`AGENT_SESSION_PATH` |
| Runner 锁 | **默认** `data/runtime/locks/…`（`local-paths.js`） | < 1 KB | 低 | 保持项目盘；打包注意 userData 回落 |
| RAG 种子 | `data/rag/bot_help.json` | KB | 低 | 留项目盘 |
| RAG 自定义 | `<BOT_STORAGE_DIR>/rag/custom.json` | 可增长 | 中 | **硬顶 5 MB**；超额拒绝写入 |
| Chromium Partitions/Cache | `userData/Partitions` 等 | **百 MB～GB** | **高** | 定期清理脚本；禁把 userData 指到系统盘大缓存用途 |
| 报告 PNG | 内存 Buffer / 偶发 /tmp 预览 | 单张 0.5–3 MB | 中 | 禁止持久堆 /tmp；预览写 `data/runtime/tmp` 且 1h 清理 |
| MySQL 业务 | 远端/板卡 | — | — | **rk3318**（隧道），本地不 mirror 全表 |

---

## 3. 目录布局（本地防爆满）

```text
/Volumes/2t/it/抖音/                 # 项目盘（大、空）
  data/
    rag/                             # 知识库文本（cap）
    runtime/                         # 运行时状态（会话/锁/短时 tmp）
      sessions/
      locks/
      tmp/                           # 24h 清理
    local-bench/                     # 仅基准测试产物
  .env                               # 小配置（含 DB 隧道）

~/Library/Application Support/<app>/ # 系统盘（紧）
  weixin-bot.v*.json                 # 仅小配置+加密 token
  douyin-live-cookie.v1.json
  （尽量不在此堆会话/日志/导出）
```

### 环境变量（统一）

| 变量 | 建议默认（本地开发） | 说明 |
|------|----------------------|------|
| `BOT_STORAGE_DIR` | `<project>/data/runtime` | 会话、锁根目录 |
| `AGENT_SESSION_PATH` | `$BOT_STORAGE_DIR/sessions/weixin-agent-sessions.json` | Agent Web/桌面共用 |
| `BOT_LOCK_PATH` | `$BOT_STORAGE_DIR/locks/weixin-bot-runner.lock` | runner 互斥 |
| `LOCAL_TMP_DIR` | `$BOT_STORAGE_DIR/tmp` | 可删临时文件 |
| `RAG_CUSTOM_PATH` | `<BOT_STORAGE_DIR>/rag/custom.json` | 自定义知识 |
| `RAG_CUSTOM_MAX_BYTES` | `5242880` | 5 MB |
| `AGENT_SESSION_MAX_BYTES` | `20971520` | 20 MB |
| `AGENT_SESSION_MAX_SESSIONS` | `200` | 与代码裁剪一致 |
| `DB_HOST` / `DB_PORT` | 隧道时 `127.0.0.1` / `3307` | 见 rk3318 章节 |

启动时若 `BOT_STORAGE_DIR` 未设且检测到系统盘可用 < 15 GB，应 **自动回落到项目 `data/runtime`** 并打日志警告。

---

## 4. 容量预算（本地）

| 类别 | 软顶 | 硬顶 | 超额行为 |
|------|------|------|----------|
| Agent 会话文件 | 10 MB | **20 MB** | 删最旧会话；拒绝再 append 并告警 |
| 单会话消息 | 40 条 / 2KB | 同左 | 已有裁剪，保持 |
| RAG custom | 2 MB | **5 MB** | POST 返回 413 |
| runtime/tmp 单文件 | 10 MB | 20 MB | 拒绝写 |
| runtime/tmp 总目录 | 100 MB | 200 MB | 启动清理 >24h 文件 |
| userData 总占用 | 500 MB | **800 MB** | 桌面状态栏警告 + 提供清理 Partitions 指引 |
| 系统盘可用 | — | **建议 ≥ 5 GB** | 低于 5 GB：禁止写 tmp 到系统盘 |

**业务表数据不进本地预算**：音浪/时长/主播全在 **rk3318 MariaDB**。

---

## 5. rk3318 数据库（业务主存）

来源：`/Volumes/2t/it/服务器/ssh/server-status-2026-07-20.md`

| 项 | 值 |
|----|-----|
| 板卡 | `192.168.5.12`（`rk3318-box`） |
| MariaDB | **仅** `127.0.0.1:3306` |
| 开发接入 | `ssh -f -N -L 3307:127.0.0.1:3306 root@192.168.5.12` |
| 应用 `.env` | `DB_HOST=127.0.0.1` `DB_PORT=3307` … |

本地**不**做全库 mysqldump 落地到系统盘；备份若需要，写到 **`/Volumes/2t/it/抖音/data/backups/`** 并保留最近 N 份。

---

## 6. 存储速率基准（已测）

命令：

```bash
node scripts/bench-local-storage.mjs
```

**样本**（2026-07-22，写入 `/Volumes/2t/it/抖音/data/local-bench`）：

| 测试 | 结果 |
|------|------|
| 顺序写 32 MiB | **~1309 MiB/s** |
| 顺序读 32 MiB | **~8962 MiB/s** |
| 200×~4KB JSON 突发写 | **~2.1 万 ops/s** |
| 1000 行 append 日志 | **~3.4 万 lines/s** |
| 基准盘可用 | **~1.8 TB**（`/Volumes/2t`） |
| 系统盘可用 | **~11 GB（95%）** |

结论：

- **项目盘 IO 充裕**，会话/锁/RAG/基准应落在此盘。  
- 瓶颈不是速率，而是**系统盘容量**；再快的写也会在 11 GB 余量上爆满。  
- 本地会话即使按 20 MB 硬顶，相对 1.8 TB 可忽略；相对 11 GB 系统盘则必须迁走。

报告文件：`data/local-bench/report-2026-07-22T08-25-00-971Z.json`（勿提交大 bin；脚本已删 32MB 测试文件）。

---

## 7. 运行时策略（实现清单）

### 7.1 路径解析（**已实现** `electron/local-paths.js`）

```text
resolveRuntimeDir():
  if BOT_STORAGE_DIR set → use it
  else if project/data/runtime exists or /Volumes/2t 可写 → project/data/runtime
  else → userData/runtime（并 warn）

resolveSessionPath / resolveLockPath / resolveLocalTmp
```

### 7.2 会话写

- 使用 `AGENT_SESSION_PATH` 于 **runtime**  
- 写前检查文件大小；超硬顶：`pruneOldestSessions()` 后重试一次  
- 禁止默认 `os.tmpdir()`

### 7.3 Runner 锁

- 默认 `data/runtime/locks/...`  
- 与会话同盘，避免 /tmp 清掉锁导致双开

### 7.4 RAG custom

- 写前 `Buffer.byteLength(json) <= RAG_CUSTOM_MAX_BYTES`  
- 超限返回明确错误，不静默截断导致坏文件

### 7.5 启动自检

启动时打印：

```text
[storage] home free=… runtimeDir=… sessionPath=… db=host:port
```

若 home free < 5 GB：`console.warn` + 桌面状态可选提示。

### 7.6 清理

```bash
# 开发清理 runtime tmp（>24h）
find data/runtime/tmp -type f -mtime +1 -delete 2>/dev/null

# 可选：清理 Electron Partitions（需退出 App）
# rm -rf ~/Library/Application\ Support/douyin/Partitions
```

提供 `npm run storage:bench` / `npm run storage:doctor`（doctor = df + 路径 + 体积）。

---

## 8. 本地测试计划（不爆满）

| 步骤 | 动作 | 通过标准 |
|------|------|----------|
| 1 | `df -h` 系统盘与 `/Volumes/2t` | 系统可用 ≥ 5 GB 再开长测 |
| 2 | `node scripts/bench-local-storage.mjs` | 报告生成在 `data/local-bench`；系统盘占用不明显增加 |
| 3 | 配置 `BOT_STORAGE_DIR=$PWD/data/runtime` | 会话/锁出现在项目盘 |
| 4 | 开隧道 + `DB_*` 指向 127.0.0.1:3307 | 业务读写在 rk3318，不在本地长出 wave 文件 |
| 5 | 连续 Agent 对话 50 轮 | sessions 文件 < 20 MB |
| 6 | 知识库写入直到 cap | 第 N 次失败且磁盘不涨失控 |
| 7 | 跑 `npm run test:weixin-bot` | 全绿；不在 /tmp 留大文件 |

**禁止的本地测试：**

- 在 `/tmp` 循环 dump 全表 CSV  
- 无 cap 地保存每次报告 PNG  
- 把 `userData` 指到系统盘后又开多个监控 Partitions 不清理  

---

## 9. 与服务器的边界

| 数据 | 本地开发 | 板卡/服务器 |
|------|----------|-------------|
| 音浪/时长/主播 | 只经 MySQL 客户端 | MariaDB 真源 |
| Agent 会话 | `data/runtime`（可丢） | 日后 Redis/MySQL |
| RAG 种子 | 仓库内小 JSON | 可同步 |
| 微信 token | userData 小文件 | 服务端加密存储（P2） |
| Chromium 缓存 | 尽量少开监控 | 服务器 bot-worker 不跑完整 Browser 缓存 |

---

## 10. 实施分期（存储专项）

### S0（文档 + 基准）— **本版完成**

- [x] 磁盘与 userData 实测  
- [x] `scripts/bench-local-storage.mjs`  
- [x] 本设计文档  

### S1（路径迁出系统盘）— **下一刀必做（见 LANDING L1）**

- [x] 新增 `electron/local-paths.js`（或等价）  
- [ ] session-store / runner-lock 默认 `data/runtime`  
- [ ] main 启动日志 `storage doctor`  
- [ ] `package.json`：`storage:bench` / `storage:doctor`  

### S2（硬顶与清理）

- [ ] 会话 20MB / RAG 5MB 硬顶  
- [ ] runtime/tmp 启动清理  
- [ ] 可选：设置页显示 userData 体积  

### S3（与 rk3318 联调）

- [ ] 隧道脚本 `scripts/db-tunnel-rk3318.sh`  
- [ ] 连通后 `init-db` 仅对板卡库执行（需授权建库）  
- [ ] 确认本地无 `wave_*.csv` 残留增长  

---

## 11. 验收标准（「本地不会爆满」）

1. 默认开发配置下，**会话与锁不在 `/tmp`**。  
2. 连续使用 1 天（正常开发量）系统盘增量 **< 200 MB**（排除手动下载）。  
3. `data/runtime` + `data/rag` 合计硬顶逻辑生效。  
4. 基准脚本可重复跑，产物只在 `data/local-bench`。  
5. 业务数据查询失败时，**不会**回退为本地全表 JSON 缓存。  

---

## 12. 快速命令

```bash
# 存储速率/空间探针（写项目盘）
npm run storage:bench   # 或 node scripts/bench-local-storage.mjs

# 看报告
ls -lt data/local-bench/report-*.json | head

# 系统盘 vs 项目盘
df -h /System/Volumes/Data /Volumes/2t

# userData 体积
du -sh ~/Library/Application\ Support/douyin*

# DB 隧道（业务数据）
ssh -f -N -L 3307:127.0.0.1:3306 root@192.168.5.12
```

---

**维护：** 存储策略变更先改本文，再改路径代码。业务 Agent 功能仍以 `ai-agent-production-plan.md` 为准；**本地防爆满以本文为准**。
