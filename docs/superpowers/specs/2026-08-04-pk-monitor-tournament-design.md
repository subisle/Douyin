# PK 监控四阶段记分与晋级

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-04 |
| 状态 | **approved** |
| 落点 | `pk-monitor-page.tsx` + 阶段 store/rules；结算结果回写 PK 分组存档 |
| 相关 | 已有 `pk-group-presets-v1` / multi IPC / 单房 live-pk |

---

## 1. 目标

在 **PK 监控** 上按赛程四阶段记本场音浪终分，并在阶段结束时按规则出线，**自动写入 PK 分组命名存档**，供分组页继续拖改。

阶段：

1. **小组赛** — 读已分好的 8 人组  
2. **复活赛** — 各组后 3 汇总再分组  
3. **晋级赛** — 小组前 4 + 复活出线，再分组，**共出 8 人**  
4. **决赛** — 8 人一桌  

成功标准：

- 从激活/指定 PK 分组导入小组赛组列表  
- 选组后多房或单房采分，写入成员本场分（可手改）  
- 结算小组赛 → 自动存档「复活赛」「晋级赛」所需池；复活/晋级结算后写「晋级赛」「决赛」  
- PK 分组页能打开对应命名存档看到 `nameGroups`  
- 监控分不写业务 DB  

非目标：

- 改分组引擎核心 / 女团 / bot 播报  
- 日音浪与本场分混累  
- 付费验证码等无关能力  

---

## 2. 职责

| 模块 | 做 | 不做 |
|------|----|------|
| PK 分组 | 维护小组赛布局；展示/编辑结算写入的复活/晋级/决赛存档 | 不负责现场采分 |
| PK 监控 | 阶段 Tab、组内记分、结算出线、调用 `saveNamedGroupPreset` | 不替代分组拖拽为唯一编辑入口 |

---

## 3. 默认规则（可配置）

| 键 | 默认 | 含义 |
|----|------|------|
| `groupSize` | 8 | 每组人数 |
| `groupTop` | 4 | 小组赛组内直晋晋级池 |
| `groupReviveTail` | 3 | 小组赛组内进复活（按排名从末位向前取 3，与前 4 不重叠） |
| `promoTarget` | 8 | 晋级赛出线进决赛人数 |
| `reviveTarget` | 自动 | `max(0, idealPromoPool - directAdvance)`；`idealPromoPool` 默认 32（4×8），可改 |

组内排名：本场 `score` 降序；同分 `memberKey` 升序。

尾组人数 `< groupSize`：  
`top = min(groupTop, n)`，`revive = min(groupReviveTail, max(0, n - top))`。

切组：名单按当前顺序（结算出线名单已按分排好）**顺序切块** `chunk(list, groupSize)`，与 PK 分组「从高到低/顺序」一致；写入存档的 `mode` 标 `high_to_low`。

---

## 4. 结算与回写存档

| 动作 | 写阶段 store | 写 PK 分组 preset 名 |
|------|----------------|----------------------|
| 导入小组赛 | `stages.group` 从 layout/preset | 不覆盖源存档 |
| 结算小组赛 | `advanceIds` / `reviveIds`；生成 `revive.groups`、预生成晋级池草稿 | **「复活赛」**（复活池切组）；可选先不写晋级直到复活结束 |
| 结算复活赛 | 复活 `advanceIds`；合并直晋+复活出线 → `promo.groups` | 更新/创建 **「晋级赛」** |
| 结算晋级赛 | `advanceIds` 共 8 人 → `finals.groups` | **「决赛」** |
| 决赛 | 仅记分排名 | 不强制下一档 |

同名 preset：**按 name 查找已有 id 则更新**，否则新建；`makeActive` 默认 `false`（避免打断用户正在看的小组赛存档），结算 toast 提示「已写入 PK 分组 · xxx」。

`note` 建议带 period + 结算时间 + 规则摘要。

---

## 5. 数据模型

Storage key：`pk-monitor-tournament-v1`

```ts
type StageKey = "group" | "revive" | "promo" | "finals";

interface TournamentRules {
  groupSize: number;
  groupTop: number;
  groupReviveTail: number;
  promoTarget: number;
  idealPromoPool: number; // default 32
  reviveTarget: number | null; // null = auto
}

interface StageMemberScore {
  memberKey: string; // canonical name 优先，兼 personId
  name: string;
  personId?: number;
  anchorId?: string;
  douyinNos?: string[];
  score: number | null; // null = 未记分
  manual?: boolean;
}

interface StageGroup {
  key: string;
  label: string;
  members: StageMemberScore[];
  status: "pending" | "live" | "scored" | "settled";
  battleId?: string;
  updatedAt?: string;
}

interface StageState {
  groups: StageGroup[];
  settled: boolean;
  advanceKeys: string[];
  reviveKeys?: string[]; // only group stage
  presetId?: string; // 回写的存档 id
  presetName?: string;
}

interface TournamentState {
  version: 1;
  period?: string;
  sourcePresetId?: string;
  sourcePresetName?: string;
  rules: TournamentRules;
  stages: Record<StageKey, StageState>;
  activeStage: StageKey;
  updatedAt: string;
}
```

成员匹配（采分 → 组员）：`anchorId` / `douyinNos` / `canonicalRosterName(name)` 与 multi/单房 score 行对齐；命中写 `score`。

---

## 6. UI（PK 监控）

1. 顶栏保留 URL 单房能力；旁加「从 PK 分组导入小组赛」  
2. 阶段 Tab 四态  
3. 左/上：当前阶段组卡片列表（标签、人数、已记分人数、最高分）  
4. 选中组：成员表（名、分、手改 input）、「开本组监控」「采终分」「结算本组」  
5. 阶段操作：「结算本阶段并写入分组」  
6. 简短 message 行  

多房：用组员 `douyinNo` / `anchorId` 拼 `https://live.douyin.com/{rid}`，走 `startLivePkMultiMonitor`；无 URL 的成员跳过并提示。

---

## 7. 模块文件

| 文件 | 职责 |
|------|------|
| `src/components/desktop/pk-tournament-rules.ts` | 纯函数：组内出线、切组、复活目标人数、晋级取 8 |
| `src/components/desktop/pk-tournament-store.ts` | load/save、从 preset 导入、结算、回写 `saveNamedGroupPreset` |
| `src/components/desktop/pk-monitor-page.tsx` | 接入 UI + multi/单房采分 |

单测：`pk-tournament-rules` 用 node:test 或现有 vitest/jest 习惯；至少覆盖前4后3、尾组、晋级出8、切组。

---

## 8. 测试要点

| 用例 | 期望 |
|------|------|
| 8 人分 100…1 | 前4 advance，后3 revive，1 淘汰 |
| 5 人组 | top4 全晋（min），revive 1 |
| 24 直晋 ideal 32 | reviveTarget=8 |
| 32 人晋级 4×8 每组记分 | 全局/按组取满 8 进决赛 |
| 结算回写 | localStorage presets 出现「复活赛」等 nameGroups |
| 同名再结算 | 更新同一 preset id |

---

## 9. 已决摘要

| 问题 | 结论 |
|------|------|
| 交互主轴 | 记分 + 自动结算晋级 |
| 小组名单 | 已有 PK 分组，监控只读导入 |
| 组规模 | 8 |
| 出线 | 前 4 直晋 · 后 3 复活 |
| 晋级终点 | 出 8 进决赛 |
| 分来源 | 本场监控终分，可手改，不累计日音浪 |
| 分组落点 | 自动写入 PK 分组命名存档 |
| 激活存档 | 默认不抢激活，仅写入 |
