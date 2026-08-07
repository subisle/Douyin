# PK 监控拆分实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将单一监控页拆为四入口；本期交付精简 PK 监控页（音浪主舞台）+ 旧页改作采集监控。

**架构：** 新建独立 `PkMonitorPage`，只订阅 status + 对局相关 event；导航扩展四个 PageId；shell 分别挂载；旧 `DouyinMonitorPage` 改默认 filter 为观众向。不改 Electron 协议层。

**技术栈：** React / TypeScript、现有 `getDataApi()` Electron IPC、shadcn Button/Input/Badge、`cn` 工具。

**规格：** `docs/superpowers/specs/2026-08-04-pk-monitor-split-design.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `docs/superpowers/specs/2026-08-04-pk-monitor-split-design.md` | 已写规格 |
| `src/components/desktop/types.ts` | PageId + NAV_ITEMS 四监控入口 |
| `src/components/desktop/pk-monitor-page.tsx` | 新建精简 PK 页 |
| `src/components/desktop/monitor-placeholder-page.tsx` | 多主播/外部导入占位 |
| `src/components/desktop/shell.tsx` | 挂载新页与 keep-alive |
| `src/components/desktop/douyin-monitor-page.tsx` | 默认 filter 改为 gift |

---

### 任务 1：导航 PageId 与 NAV_ITEMS

**文件：**
- 修改：`src/components/desktop/types.ts`

- [ ] **步骤 1：扩展 PageId 与导航项**

将 `"douyin-monitor"` 替换为四个监控 id（保留类型兼容可选：若他处硬编码 `douyin-monitor`，shell 内映射到 `collect-monitor`）。

```ts
export type PageId =
  | "datacenter"
  | "family-tree"
  | "anchors"
  | "data"
  | "flag"
  | "pk"
  | "pk-monitor"
  | "collect-monitor"
  | "multi-monitor"
  | "import-monitor"
  | "reward"
  | "poster-board"
  | "weixin-bot"
  | "qq-bot"
  | "settings";
```

NAV 中删除单一「监控」，在 PK 分组后插入：

```ts
{
  id: "pk-monitor",
  label: "PK 监控",
  icon: MonitorPlay, // 或 Swords/Activity 区分
  description: "实时音浪与对局状态",
  adminOnly: true,
},
{
  id: "collect-monitor",
  label: "采集监控",
  icon: Users, // 或 Activity
  description: "观众抖音号与礼物采集",
  adminOnly: true,
},
{
  id: "multi-monitor",
  label: "多主播监控",
  icon: Network, // 或 LayoutDashboard
  description: "多选主播并行分数",
  adminOnly: true,
},
{
  id: "import-monitor",
  label: "外部导入监控",
  icon: Database,
  description: "外部源观众与礼物",
  adminOnly: true,
},
```

选用不与现有图标严重冲突的 lucide 图标（可 `BarChart3` / `Radio` / `Download` 等）。

- [ ] **步骤 2：Commit（可选，与后续合并一次亦可）**

---

### 任务 2：新建精简 PK 监控页

**文件：**
- 创建：`src/components/desktop/pk-monitor-page.tsx`

- [ ] **步骤 1：实现完整页面（&lt;400 行）**

要点：

1. Props：`{ active?: boolean }`（与旧页一致，便于 keep-alive）
2. State：`liveRoomUrl`、`status`、`busy`、`message`、`scores[]`、`mode/modeLabel/isPkActive/isLinkmic`、`participantCount`、`countdownMs`、`ownerNickname`、`title`
3. 静默 Cookie：`readLivePkCookie` 存 ref，启动时传入
4. 订阅：仅 status / event(room-info, live-mode, pk-battle, pk-score-snapshot, linkmic-score) / error / captureStatus→message
5. `scoreFromPayload` / `rankedScores` / 倒计时 tick（100ms 或 200ms）
6. UI：Input + 开始/停止；状态 Badge；音浪列表 rank/name/bar/score
7. 停止：`stopLivePkMonitor`；不清终分或按产品：停止时清倒计时、保留最后榜（与旧页一致更友好）
8. 无 preview / cookie 面板 / 导出 / 事件流

伪结构：

```tsx
export function PkMonitorPage({ active = true }: { active?: boolean }) {
  // hooks...
  if (!active) return null; // 或 hidden 保持订阅：推荐 hidden 容器 keep-alive
  return (
    <div className="space-y-4">
      {/* toolbar */}
      {/* status strip */}
      {/* score board */}
      {/* message line */}
    </div>
  );
}
```

Keep-alive 时不要 `return null` 卸载监听；用 `className={cn(!active && "hidden")}` 或 shell 层 hidden。

- [ ] **步骤 2：手工检查无 TS 明显错误**

---

### 任务 3：占位页 + Shell 挂载

**文件：**
- 创建：`src/components/desktop/monitor-placeholder-page.tsx`
- 修改：`src/components/desktop/shell.tsx`

- [ ] **步骤 1：占位组件**

```tsx
export function MonitorPlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <p className="mt-4 text-xs text-muted-foreground">二期交付 · 后端 multi IPC 已就绪</p>
    </div>
  );
}
```

- [ ] **步骤 2：shell 挂载**

- import `PkMonitorPage`、`MonitorPlaceholderPage`
- `pkMonitorMounted` / 继续 `monitorMounted` 给 collect
- 渲染：

```tsx
{(pkMonitorMounted || currentPage === "pk-monitor") && (
  <div className={currentPage === "pk-monitor" ? undefined : "hidden"}>
    <PkMonitorPage active={currentPage === "pk-monitor"} />
  </div>
)}
{(monitorMounted || currentPage === "collect-monitor") && (
  <div className={currentPage === "collect-monitor" ? undefined : "hidden"}>
    <DouyinMonitorPage active={currentPage === "collect-monitor"} />
  </div>
)}
{currentPage === "multi-monitor" && (
  <MonitorPlaceholderPage title="多主播监控" description="从主播列表多选，并行协议进房，卡片展示各房分数。" />
)}
{currentPage === "import-monitor" && (
  <MonitorPlaceholderPage title="外部导入监控" description="导入外部房间/名单，采集观众 ID 与礼物。" />
)}
```

- 页面切换 effect：`if (currentPage === "pk-monitor") setPkMonitorMounted(true)` 等同 collect
- 主分支 `currentPage === "douyin-monitor"` 删除；其它页条件不变

---

### 任务 4：采集页默认 filter

**文件：**
- 修改：`src/components/desktop/douyin-monitor-page.tsx`

- [ ] **步骤 1：默认 filter 改为 `gift`（或 `all`）**

```ts
const [filter, setFilter] = useState<MonitorFilter>("gift");
```

可选：FILTERS 中「分数监控」label 改为「音浪（次要）」或保持，但不默认选中。

---

### 任务 5：验证

- [ ] **步骤 1：TypeScript / 构建抽查**

运行：`npx tsc --noEmit -p tsconfig.json` 或项目既有 check（若过慢可只对改动文件 eslint）

预期：与 pk-monitor / PageId 相关无新增错误。

- [ ] **步骤 2：确认 dev 进程仍可热更**

若 `electron:dev` 已在跑，保存后看 Next 编译；侧栏应出现四监控入口，点「PK 监控」见精简页。

- [ ] **步骤 3：Commit（用户要求时再提交）**

```bash
git add docs/superpowers/specs/2026-08-04-pk-monitor-split-design.md \
  docs/superpowers/plans/2026-08-04-pk-monitor-split.md \
  src/components/desktop/types.ts \
  src/components/desktop/pk-monitor-page.tsx \
  src/components/desktop/monitor-placeholder-page.tsx \
  src/components/desktop/shell.tsx \
  src/components/desktop/douyin-monitor-page.tsx
git commit -m "feat(监控): 拆分 PK/采集四页并交付精简 PK 音浪页"
```

---

## 自检

1. **规格覆盖：** 四页 IA、PK 字段、Cookie 静默、无预览、采集默认、占位 multi/import、shell 挂载 — 均有任务。
2. **无占位符实现步骤：** PK 页需完整代码在任务 2 落地时写出。
3. **类型一致：** PageId 与 shell 分支一致；IPC 名与 `electron.d.ts` 一致。
