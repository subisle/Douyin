# S3 · 图片 / CSV Artifact 全链路 · 设计规格

| 项 | 内容 |
| --- | --- |
| 版本 | v1.0.0-draft |
| 日期 | 2026-07-24 |
| 状态 | **Draft（S3.1 根目录已落地；全链路未接）** |
| 依赖 | S1 文本 E2E 可复现（建议）；S2 凭据/登录实验可用；既有 Outbox/Inbox/lease |
| 非目标 | shared/bot-core 搬家、LLM 必经路径、生产标签、多 Agent |
| 通道约束 | **仅微信 iLink** 收发文件/图片；不另建用户 CDN/文件站（`CLAUDE.md`） |
| 地基代码 | `scripts/ilink-artifact-store.js` · `scripts/ilink-media-policy.js` · `migrations/001` 表 `artifacts` · 桌面 `electron/weixin-bot-media.js` / `weixin-bot-report.js` |

---

## 1. 问题与目标

服务器 Worker 已能在实验开关下完成**纯文本** Inbox→业务回执→Outbox→send。桌面已能收 CSV、发日报 PNG/文件。服务器要达到「与桌面同级的 Artifact 能力」，必须：

1. **入站**：iLink 媒体 descriptor → CDN allowlist 下载 → MIME/大小/hash → durable staging → 同事务 Inbox+Cursor（**dedupe-before-stage**）。  
2. **出站**：业务产生 PNG/CSV → Artifact ready → Outbox 媒体项 → `getuploadurl` + 上传 + send → sent/unknown。  
3. **运维**：TTL/GC、指标、失败不伪成功、重放不二次下载。

**成功标准（退出）：** 真实账号至少各 1 次：

- 私聊发 CSV → 入库/回执（确定性命令路径优先，不强制 LLM）  
- 触发日报 → 微信收到 PNG  
- 触发音浪导出 → 微信收到 CSV 文件  

失败路径：超限/坏 MIME/CDN 拒绝 → 明确中文回执；无「已发送」假成功。

---

## 2. 架构

```text
iLink getupdates (mixed batch)
        │
        v
  normalize envelope + dedupeKey
        │
        ├─ text-only ──► 现有 persistBatch(Inbox+Cursor)
        │
        └─ media ──► media-policy.validateInboundDescriptor
                       │
                       ├─ Inbox 已存在? ──► 复用 Artifact ref，仅推进 cursor
                       │
                       └─ 新 ──► stream download (byte cap)
                                  │
                                  v
                           media-policy sniff + size
                                  │
                                  v
                           artifactStore.stageBuffer → storage_key
                                  │
                                  v
                           TX: fencing + bind artifacts row + Inbox + cursor
                                  │  status staging→ready 仅在 TX 成功后
                                  v
                           Dispatcher（S3.4 先接确定性命令）
                                  │
                                  ├─ CSV import path
                                  └─ 日报/导出 path → render → stage outbound
                                                  │
                                                  v
                                           Outbox media item
                                           (stable client_id)
                                                  │
                                                  v
                                           getuploadurl → CDN POST
                                           → sendmessage(file/image)
                                           → mark sent | unknown
```

**进程边界：** 全部在 `scripts/bot-worker.js` + 新/扩 `scripts/ilink-*-media*.js` 内完成；**不**引入第二用户通道。

---

## 3. 与既有模块的契约

### 3.1 复用

| 模块 | 职责 |
| --- | --- |
| `ilink-media-policy` | CDN host/path/port、入站 descriptor、出站 MIME/大小 |
| `ilink-artifact-store` | 本地 stage/ready/discard/gc/hash；`toDbRow` |
| `ilink-outbox` | 扩展 payload kind：`text` \| `image` \| `file` |
| `ilink-inbox-cursor` | 扩展 stage 字段：artifact_ids / media meta（加密体可含引用） |
| `shared/ilink-adapter` | getuploadurl、download 若未完备则按桌面协议补齐并单测 |
| `ilink-db-lease` | 一切 TX 带 fencing |
| 桌面 report/analytics | S3.4 **可暂时** `require` 桌面渲染（技术债，S4 再迁）；或抽纯函数到 `scripts/` 最小拷贝——**优先最小可测拷贝避免 Electron 依赖** |

### 3.2 新增（建议文件）

| 文件 | 职责 |
| --- | --- |
| `scripts/ilink-media-pipeline.js` | 入站下载+stage+TX 编排；可注入 store/policy/adapter |
| `scripts/ilink-outbox-media.js` 或扩展 `ilink-outbox.js` | claim 后上传+发送+状态 |
| `scripts/ilink-artifact-store` 增强 | 强制 `rootDir` 来自 `ARTIFACT_ROOT` / `BOT_STORAGE_DIR/artifacts`；禁止默默写系统盘 |

---

## 4. 数据模型

### 4.1 表 `artifacts`（已有 migration 001）

沿用字段：`workspace_id`、`account_id`、`artifact_id`、`storage_provider`、`storage_key`、`content_sha256`、`byte_size`、`mime_type`、`expires_at`、owner 等。

**状态语义（应用层）：**

| status | 含义 |
| --- | --- |
| `staging` | 文件已在盘，未与 Inbox/业务提交绑定 |
| `ready` | 可被 Dispatcher / Outbox 消费 |
| `discarded` | GC 或失败丢弃 |

### 4.2 Inbox

- `dedupe_key` = `accountId + upstreamMessageId` 或 versioned envelope hash  
- payload 引用 `artifact_id[]`，**不**把二进制塞进 MySQL  
- 重放：已存在则 **不** 下载 CDN

### 4.3 Outbox 媒体项

```json
{
  "kind": "image" | "file",
  "artifactId": "…",
  "mimeType": "image/png",
  "fileName": "daily-report-2026-07-23.png",
  "conversationId": "…",
  "clientId": "stable-once"
}
```

`client_id` 创建一次，所有重试复用；超时未知 → `unknown`，**禁止**新 client_id 盲重发。

---

## 5. 安全与限额

| 规则 | 值/行为 |
| --- | --- |
| CDN | 仅 `https://novac2c.cdn.weixin.qq.com` + `/c2c/download|upload`；reject userinfo/fragment/非 443 |
| 下载/上传硬顶 | 默认 20MB（与 store/policy 一致，可 env 下调） |
| MIME | 图：png/jpeg/gif/webp；文件：csv/plain/octet-stream（sniff 优先于声明） |
| 路径 | storage_key 禁 `..`；root 外拒绝 |
| 日志 | 禁 token、完整 CDN query、文件正文 |
| 磁盘 | `ARTIFACT_ROOT` 必须在项目盘或服务器数据卷；启动 doctor 检查 free space |
| TTL | staging 默认 30min（10–120 可配）；GC 可重入 |

---

## 6. Worker 行为变更

### 6.1 入站 poll 循环

1. 解析 batch 每条 message_type  
2. 文本 → 现路径  
3. 文件/图片 → `mediaPipeline.ingest(update)`  
4. `blocked_media`：超阈值不推进该条 cursor 策略与设计 `ilink-server-agent-design` §5 一致（批次策略实现时写清：整批 vs 单条——**建议单条失败隔离，能提交的文本仍提交**，需单测）

### 6.2 出站

1. `reclaimExpiredClaims`  
2. `claimBatch`  
3. kind=text → 现 sendMessage  
4. kind=image/file → validate ready Artifact → getuploadurl → upload → send → mark  

### 6.3 确定性业务（S3.4，先不做 LLM）

| 触发 | 行为 |
| --- | --- |
| 入站 CSV + 指令模式/导入命令 | 解析 CSV → DB 导入（复用桌面解析规则：日期优先级）→ 文本回执 |
| 出站「每日报告」类固定命令 | 生成 PNG buffer → stage → enqueue image outbox |
| 出站「导出音浪」 | 生成 CSV → stage → enqueue file outbox |

Agent 技能导出可后置到 S4 与 Core 一并接线。

---

## 7. 环境变量

| 变量 | 含义 |
| --- | --- |
| `ARTIFACT_ROOT` | Artifact 根目录（优先） |
| `BOT_STORAGE_DIR` | 若无 ARTIFACT_ROOT，使用 `$BOT_STORAGE_DIR/artifacts` |
| `ARTIFACT_MAX_BYTES` | 覆盖默认 20MB |
| `ARTIFACT_TTL_MS` | staging TTL |
| `BOT_ILINK_MEDIA_ENABLED` | 显式开关；默认随 DB 模式 off→on 需文档写清（**建议默认 off**，与文本实验一致） |

---

## 8. 测试计划

| 层 | 用例 |
| --- | --- |
| policy | 坏 host/端口/http/超大/MIME sniff 不一致 |
| store | stage→ready、path escape、gc 过期、hash 稳定 |
| pipeline | 重放不二次 download（mock adapter 计数）；TX 回滚留 orphan 可 GC |
| outbox media | 上传失败不 mark sent；unknown 不换 client_id |
| worker 注入 | media enabled 时文本回归不破 |
| 真机 | CSV 入 + PNG 出 + CSV 出 各 1 次，填 runbook 记录 |

---

## 9. 实施顺序（S3 内）

| 序 | 任务 | 可并行 |
| ---: | --- | --- |
| S3.0 | 设计冻结（本文）+ env/doctor | — |
| S3.1 | store 根目录策略 + 指标钩子 | 与 S3.6 文档 |
| S3.2 | `ilink-media-pipeline` 入站 + worker 接线 | — |
| S3.3 | Outbox 媒体发送 | 依赖 adapter upload |
| S3.4 | CSV 导入 + 日报/导出确定性命令 | 可与 S3.3 后半并行 |
| S3.5 | GC cron/tick + 指标 | 与 S3.4 |
| S3.6 | 服务器中文字体与卷挂载文档 | 可早做 |
| S3.7 | 真机 E2E 记录 | 全部之后 |

**Commit 节奏：** 每任务独立 `feat:`/`test:`；禁止与桌面业务脏改动混提交。

---

## 10. 退出检查清单

```text
[x] ARTIFACT_ROOT 不在系统盘 tmp（默认走 data/runtime/artifacts；env 可绑数据卷）
[ ] 单测：policy + store + pipeline + outbox media 绿
[ ] bot-worker 文本回归绿
[ ] 真机 CSV 入站回执
[ ] 真机日报 PNG 出站
[ ] 真机 CSV 出站
[ ] 重放不二次下载（日志/mock 计数）
[ ] unknown 媒体出站可 resolve，无伪成功
[ ] 文档：progress / server-deployment / LANDING 同步
[ ] 仍不标记「服务器生产可用」
```

---

## 11. 与 P0–P3 / ADR 映射

- ADR 交付不变量 3、6、7（媒体先 stage 再推进 cursor；网络发送在业务 TX 外；client_id/unknown）  
- iLink 设计 P1 媒体 E2E 子集  
- 生产计划 B4 Worker 媒体缺口  

S3 完成后 **仍不等于** 生产：缺 Core(S4)、Session(S5)、门禁(S7)。

---

## 12. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-24 | Draft：基于地基模块与服务器设计 §5 冻结实现规格 |
| 2026-07-24 | S3.1：`resolveArtifactRoot` + store 默认根 + env 限额 + 单测 |
