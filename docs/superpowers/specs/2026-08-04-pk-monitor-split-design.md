# PK 监控拆分设计

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-04 |
| 状态 | **approved**（方案 A） |
| 落点 | 桌面 Electron 监控导航；本期交付精简 PK 页 |
| 相关 | 协议进房 `LivePkWatcher` / multi IPC；旧 `douyin-monitor-page.tsx` |

---

## 1. 目标

把「大而全」的单一监控页拆成职责清晰的四页：

1. **PK 监控** — 只看对局形态 + 实时音浪（主舞台）
2. **采集监控** — 观众抖音号、礼物、进场/弹幕身份与导出
3. **多主播监控** — 主播列表多选并行分数（二期，IPC 已具备）
4. **外部导入监控** — 外部源观众 ID / 礼物（二期骨架）

成功标准（本期）：

- 贴直播间 URL → 开始 → 显示 单人 / 连麦 / PK → N 人音浪刷新 → 停止清空或保留终分
- PK 页无事件流、无用户表、无 Cookie 面板、无导出墙、无 BrowserWindow 预览
- 新建页目标 &lt; 400 行，不继承旧页状态机

非目标（本期不做）：

- 多主播 UI、外部导入完整能力
- 争霸赛 ledger / 名单同步入口迁入 PK 页
- 后端协议改造（复用现有 `startLivePkMonitorFromUrl` 等）

---

## 2. 信息架构

侧栏 **一个「监控」父项**，展开后挂四个子页（不是四个顶栏并列入口）：

| PageId | 标签 | 本期 |
|--------|------|------|
| `pk-monitor` | PK 监控 | 新建精简页（组默认页） |
| `collect-monitor` | 采集监控 | 原 `douyin-monitor` 改名/默认观众向 |
| `multi-monitor` | 多主播监控 | 占位页 + 已有 multi IPC |
| `import-monitor` | 外部导入监控 | 占位页 |

实现：`NAV_TREE` 中 `type: "group"` + `MONITOR_NAV_ITEMS`；收起侧栏时点「监控」直接进默认 `pk-monitor`。

---

## 3. PK 监控页（本期）

### 3.1 字段

保留：

- 直播间 URL + 开始 / 停止
- 连接状态：`idle` / `connecting` / `running` / `error`（及 closed 映射）
- 对局形态：单人 · 连麦 · PK（来自 `live-mode` / `isPkActive`）
- 进度：官方倒计时（`pkCountDown`，有则显示）/ 进行中提示
- 本房主播昵称（`room-info` / owner 字段，可选一行）
- 实时音浪榜：排名 · 名 · 分 · 相对进度条（N 人，常见 8）
- 简短错误/状态文案一行

砍掉（本页不出现）：

- 7 过滤器事件流、用户表/缓存、礼物明细墙
- Cookie 大面板（后台静默 `readLivePkCookie`）
- 多导出按钮、可拖拽直播预览
- 场次 ledger 长列表、争霸赛同步入口

### 3.2 数据

- 启停：`startLivePkMonitorFromUrl` / `stopLivePkMonitor` / `getLivePkMonitorStatus`
- 订阅：`onLivePkStatus`、`onLivePkEvent`（只消费 `live-mode`、`pk-battle`、`pk-score-snapshot`、`linkmic-score`、`room-info`）、`onLivePkError`、可选 `onLivePkCaptureStatus` 写入状态行
- Cookie：启动前静默读取本机已存，不展示 UI
- 单房与 multi 互斥：现有 multi-start 已 stop 单房；本页不启 multi

### 3.3 组件

- 新建 `src/components/desktop/pk-monitor-page.tsx`
- 自包含轻量 helpers（safeText/score 解析），不 import 旧 3900 行模块内部状态
- UI 布局：顶栏 URL+启停 → 状态条（形态/倒计时/本房）→ 音浪主舞台列表

---

## 4. 其它三页

### 4.1 采集监控

- 文件仍为 `douyin-monitor-page.tsx`（可后续 rename 文件；本期先改导航与默认行为）
- 默认 filter 改为礼物/观众向（非「分数监控」）
- 「分数监控」Tab 可保留作次要能力，但不再作为默认主舞台
- 争霸赛 ledger 同步仍挂此页或名单页，不进 PK 页

### 4.2 多主播监控（二期）

- 主播表多选 → `startLivePkMultiMonitor`
- 卡片网格：各房 source/status/top score
- 本期：占位说明 + 链到已有 IPC 能力说明即可

### 4.3 外部导入监控（二期）

- 导入 URL/名单 → 采观众 ID + 礼物
- 本期：占位骨架

---

## 5. 导航与 Shell

- `PageId` 扩展：`pk-monitor` | `collect-monitor` | `multi-monitor` | `import-monitor`
- 移除或降级侧栏单一 `douyin-monitor` 项
- `shell.tsx`：PK 页可 keep-alive（与旧 monitor 类似，避免切页丢订阅状态）；采集页沿用 `monitorMounted` 模式
- topbar 标题随 `NAV_ITEMS` 自动更新

---

## 6. 边界与测试

- PK 页无 BrowserWindow 预览；纯协议
- 验收：贴 URL 开始 → 显示 PK/连麦 → 8 人音浪刷新 → 停止
- 回归：采集页仍可启停、看礼物/用户
- 单房与 multi 互斥行为不变

---

## 7. 实现顺序

1. 规格 + 计划文档
2. `types` 导航四页
3. 新建 `pk-monitor-page.tsx`
4. shell 挂载 + 占位页
5. 采集页默认 filter 调整
6. 本地 dev 语法/启动验证
