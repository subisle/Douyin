# PK 监控四阶段记分与晋级 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** PK 监控按小组赛/复活赛/晋级赛/决赛记本场终分，结算后自动写入 PK 分组命名存档。

**架构：** 纯函数 rules 负责出线与切组；store 管 localStorage 阶段态并调用已有 `saveNamedGroupPreset`；`pk-monitor-page` 加阶段 UI，复用 multi/单房 IPC 采分。不改分组引擎与业务 DB。

**技术栈：** React/TS、localStorage、现有 Electron live-pk multi IPC、`pk-roster-config` preset API。

**规格：** `docs/superpowers/specs/2026-08-04-pk-monitor-tournament-design.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/components/desktop/pk-tournament-rules.ts` | 组内出线、顺序切组、复活目标人数、晋级取 N |
| `src/components/desktop/pk-tournament-rules.test.ts` | 纯函数单测（node:test 风格，与 shared 测试一致可用 node --test） |
| `src/components/desktop/pk-tournament-store.ts` | TournamentState load/save、导入分组、结算、回写 preset |
| `src/components/desktop/pk-monitor-page.tsx` | 四阶段 UI + 记分/结算/多房 |

---

### 任务 1：pk-tournament-rules

**文件：**
- 创建：`src/components/desktop/pk-tournament-rules.ts`
- 测试：`src/components/desktop/pk-tournament-rules.test.ts`（若仓库前端测不便，可放 `shared/` 旁用 node:test；优先与 `shared/*.test.js` 同跑法：把关键纯逻辑用可被 node 加载的方式导出，或用 tsx/node --import）

本仓库 shared 测试为 `.js` + `node:test`。为少摩擦：**rules 用 TS 供页面 import**；测试文件用动态 import 或并行写一份逻辑清晰的 assert 脚本 `node --experimental-strip-types`（Node 22+）跑 TS。若环境不支持，测试写成 `.mjs` 复制关键函数——优先 **一条 node 可跑的 test**。

- [ ] **步骤 1：实现 rules 模块**

导出：

```ts
export type RankedPerson = { key: string; score: number };

export function sortByScoreDesc(rows: RankedPerson[]): RankedPerson[]

/** 组内：前 top 直晋，从末位取 reviveTail 进复活（与 top 不重叠） */
export function splitGroupAdvanceRevive(
  ranked: RankedPerson[], // 已按分降序
  top: number,
  reviveTail: number
): { advance: string[]; revive: string[]; eliminated: string[] }

export function chunkKeys(keys: string[], groupSize: number): string[][]

export function resolveReviveTarget(opts: {
  directAdvanceCount: number;
  idealPromoPool: number;
  reviveTarget: number | null;
}): number

/** 复活池按分排序后取前 reviveOut 人 */
export function pickAdvanceFromRanked(ranked: RankedPerson[], count: number): string[]

/** 晋级：所有组员合并排序取 promoTarget；或按组 topK 再补齐——规格：整阶段共出 promoTarget，用全局排序 */
export function pickPromoToFinals(ranked: RankedPerson[], promoTarget: number): string[]

export const DEFAULT_TOURNAMENT_RULES = {
  groupSize: 8,
  groupTop: 4,
  groupReviveTail: 3,
  promoTarget: 8,
  idealPromoPool: 32,
  reviveTarget: null as number | null,
};
```

- [ ] **步骤 2：单测覆盖 8 人前4后3、5 人尾组、reviveTarget 自动、promo 取 8、chunk**

- [ ] **步骤 3：跑测试通过**

---

### 任务 2：pk-tournament-store

**文件：**
- 创建：`src/components/desktop/pk-tournament-store.ts`

依赖：
- `getActiveGroupPreset` / `loadSavedGroupsLayout` / `listSavedGroupPresets` / `saveNamedGroupPreset` / `canonicalRosterName` from `./pk-roster-config`
- rules from `./pk-tournament-rules`

- [ ] **步骤 1：类型 + load/save TournamentState**

key：`pk-monitor-tournament-v1`

- [ ] **步骤 2：`importGroupStageFromPreset(nameGroups, membersMeta?)`**

把 `string[][]` 变成 `stages.group.groups`，memberKey = canonical name。

- [ ] **步骤 3：记分 API**

`setMemberScore(state, stage, groupKey, memberKey, score, manual?)`  
`applyScoresToGroup(state, stage, groupKey, scores: {key|name|anchorId, score}[])`

- [ ] **步骤 4：结算**

- `settleGroupStage` → advance/revive keys；`chunkKeys(revive, groupSize)` → revive.groups；`saveNamedGroupPreset({ name: "复活赛", nameGroups, makeActive: false })`
- `settleReviveStage` → pickAdvance；merge direct+reviveAdvance 按 key 稳定序；chunk → promo；save「晋级赛」
- `settlePromoStage` → pick 8 → finals 一组；save「决赛」
- 各组 status → settled；stage.settled = true

成员展示名：用 StageMemberScore.name；nameGroups 用 name 字符串（与分组页一致）。

- [ ] **步骤 5：导出 STAGE_TABS 标签**

```ts
export const STAGE_TABS = [
  { key: "group", label: "小组赛" },
  { key: "revive", label: "复活赛" },
  { key: "promo", label: "晋级赛" },
  { key: "finals", label: "决赛" },
] as const;
```

---

### 任务 3：改造 pk-monitor-page

**文件：**
- 修改：`src/components/desktop/pk-monitor-page.tsx`

- [ ] **步骤 1：状态**

保留单房 URL 监控；增加 `tournament` state、`activeStage`、`selectedGroupKey`、roster 可选加载 `getPkRoster` 补 anchor/douyin。

- [ ] **步骤 2：工具条**

- 「导入小组赛分组」→ active preset 或 layout nameGroups  
- 阶段 Tab  
- 结算本阶段按钮  

- [ ] **步骤 3：组列表 + 成员分**

- [ ] **步骤 4：开本组监控**

解析成员 rid → `startLivePkMultiMonitor`；从 multi status 房间 scores / owner 分写入（取该房主播分或房间 top 与成员匹配）。

简化策略（YAGNI）：多房时每个 room 对应一个成员，**用该 room 的 fanTicket 或 scores 里本人/最高分** 作为该成员本场分；点「采终分」时快照当前 multi status 写入。

- [ ] **步骤 5：单房路径保留** — 采分时若只有单房 PK 多人榜，按名匹配写入当前选中组。

- [ ] **步骤 6：手工验证 tsc 无新增错误**

---

### 任务 4：验证

- [ ] rules 测试通过  
- [ ] 页面可编译  
- [ ] 手动：导入 → 填分 → 结算小组 → localStorage 出现「复活赛」preset  

---

## 自检

1. 规格四阶段、前4后3、回写命名存档、不抢激活、本场分可手改 — 均有任务  
2. 无 TBD 步骤  
3. preset 名与规格一致：复活赛 / 晋级赛 / 决赛  
