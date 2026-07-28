# PK 三阶段分组设计

| 项 | 内容 |
|----|------|
| 日期 | 2026-07-28 |
| 状态 | 待实现 |
| 落点 | 扩展现有 **PK 名单页**（`src/components/desktop/pk-roster-page.tsx` + `pk-roster-config.ts`） |
| 相关 | 导入名单 / 排除人员已有；星嗨争霸页监控分**不入库**、**不参与自动分组** |

---

## 1. 目标

把月度 PK 从「15 号内置小组/晋级 + 月底自动切块」升级为：

1. **三阶段时间槽**：初赛（月初）→ 中级赛（约 15 号）→ 终极赛（月末最后 3 天）
2. **分组按已导入音浪**（`wave_snapshots` / 现有 `getPkRoster` 的去峰日均等），不写监控分入业务库
3. **约束分组**：保留并产品化「不同组」「首尾间隔对」
4. **自动出组后可拖改并保存**；支持导出图片
5. **终极赛**才有完整四轮：小组 → 复活 → 晋级 → 决赛；初赛 / 中级赛只做直接分组

非目标（本规格不做）：

- 把直播 PK 监控分写入数据库
- 服务器 / 微信通道联动
- 自动从初赛出线名单生成中级赛名单（可后续加；本版三阶段名单各自导入/过滤）

---

## 2. 阶段模型

| 阶段 key | 展示名 | 默认时间窗（可配置） | 分组形态 |
|----------|--------|----------------------|----------|
| `early` | 初赛 | 当月 1 日–14 日 | **单轮直接分组** |
| `mid` | 中级赛 | 当月 15 日前后（默认 15 日当天/可扩） | **单轮直接分组** |
| `final` | 终极赛 | 当月最后 3 天 | **四轮**：`group` 小组 → `revive` 复活 → `promo` 晋级 → `finals` 决赛 |

说明：

- 三阶段是**不同时间段**的赛事槽，分数与每日导入音浪**累积到月**（月度榜/种子可后续用阶段窗内音浪；本版分组输入 = 当前拉取的成员音浪指标）。
- 原 15 号「小组赛 / 晋级赛」内置固定表，**终极赛四轮**可先复用/迁移既有 `PRESET_*` 与星嗨结构思路；初赛、中级**不再**走多轮淘汰 UI。
- 阶段时间窗只用于 UI 默认与说明；真正参与分组的人数以**当前阶段名单配置**为准。

---

## 3. 分数与数据源

| 用途 | 来源 | 禁止 |
|------|------|------|
| 自动分组排序 / 组内展示音浪 | 已有 `getPkRoster` 结果（去峰日均 `trimmedAvg`、总音浪 `wave` 等，来自每日报告导入） | 监控分入库 |
| 现场 PK 赛事监控 | 星嗨争霸 / live-pk 现有路径，仅展示 | 写入 `wave_snapshots` 或分组持久化 |
| 导出图上的数字 | 与分组同一套导入音浪 | 编造 |

排序键（自动入组前）：

1. `trimmedAvg` 降序  
2. `wave` 降序  
3. `personId` 升序（稳定）

---

## 4. 名单与约束配置

在现有 `RosterConfig`（include / exclude 文本、mode）上扩展为**按阶段**存储（localStorage，版本化 key，避免旧 v2 配置串台）。

### 4.1 每阶段配置字段

```ts
type StageKey = "early" | "mid" | "final";
type FinalRoundKey = "group" | "revive" | "promo" | "finals";

interface StageRosterConfig {
  mode: "include" | "exclude";
  includeText: string;
  excludeText: string;
  /** 不同组：两人尽量/必须不在同一组。文本一行一对：`A,B` 或 `A 和 B` */
  differentGroupText: string;
  /** 首尾间隔对：第一个进第 1 组，第二个进末组。一行一对 */
  headTailText: string;
  groupSize: number; // 默认 8
  /** 用户拖改后的保存结果；null 表示用引擎结果 */
  savedGroups: SavedGroupState[] | null;
}

interface SavedGroupState {
  key: string;
  label: string;
  gender: "male" | "female";
  memberIds: number[];
  captainId: number | null;
  /** 仅终极赛 */
  round?: FinalRoundKey;
}
```

- 导入打 PK 名单：继续用 include 文本 / 粘贴（已有）。
- 排除人员：继续用 exclude 对话框 + 文本（已有）。
- **不同组**、**首尾间隔**：新增文本区 + 可选点选（从当前名单挑两人写入文本）；解析复用 `canonicalRosterName` / 别名表。

### 4.2 约束语义

| 约束 | 强制程度 | 算法行为 |
|------|----------|----------|
| 不同组 `(A,B)` | 硬约束 | A、B 不得进入同一 `group.key`；无法满足时该对进入 `unsatisfied` 列表并 UI 标红 |
| 首尾间隔 `(A,B)` | 硬约束 | 排序后：A 固定到组序号 0，B 固定到组序号 `groupCount-1`（同性别池内）；与不同组冲突时**首尾优先**，冲突对进入 `unsatisfied` |
| 多对叠加 | 支持 | 多对首尾：按文本顺序依次占「次首 / 次末」若组数不够则标记无法满足 |

性别：约束只在**同一性别分组池**内生效；跨性别对忽略并提示。

---

## 5. 分组引擎

纯函数（建议新文件 `src/components/desktop/pk-group-engine.ts`，便于单测）：

```
buildConstrainedGroups({
  members,          // 已按名单过滤
  gender,
  groupSize,
  differentPairs,   // personId 对
  headTailPairs,
  assignCaptains,
}) → { groups, unsatisfied, meta }
```

### 5.1 步骤

1. 去重 → 按 §3 排序得 `eligible`
2. `groupCount = max(1, ceil(n / groupSize))`，建空组
3. **预放置首尾对**：按对顺序，A→最低空档组（优先 0,1,…），B→最高空档组（优先 last,last-1,…）；组内人数不超过 `groupSize`
4. **剩余人蛇形（serpentine）入组**：按排序下标 `i`，方向在组间折返，使强弱更均（替换当前「按块切 `floor(i/groupSize)`」）
5. **修复不同组**：若同组出现约束对，尝试与邻组交换非锁定成员；失败则记 `unsatisfied`
6. 组内再按 §3 排序；可选队长 = 组内第一（月底/需要队长的阶段；初赛/中级默认与现 midmonth 一致可不派队长，终极可配置）
7. 若存在 `savedGroups` 且 memberId 仍在池内：以保存结果为准，仅把**新增未入组**的人按引擎补入，并校验约束（破坏约束时提示「已保存分组违反约束」）

### 5.2 与旧 `buildAutoGroups` 关系

- 页面改为调用 `buildConstrainedGroups`
- 无约束、无保存时行为 ≈ 蛇形版自动分组（比旧切块更均衡）
- 旧 15 号 `PRESET_BATTLE_GROUPS` / `PRESET_PROMOTION_GROUPS`：迁移为**终极赛**对应轮次的可选「加载内置预设」动作，不作为初赛/中级默认

---

## 6. 终极赛四轮

| round | 标签 | 默认来源 |
|-------|------|----------|
| `group` | 小组赛 | 引擎自动 或 加载原小组赛内置表 |
| `revive` | 复活赛 | 引擎 / 手工；本版不自动从小组败者生成（可后续） |
| `promo` | 晋级赛 | 引擎 或 原晋级内置表 |
| `finals` | 决赛 | 引擎 / 手工 |

每轮独立：`savedGroups` 带 `round`；约束文本可**阶段共享**（默认）或后续再拆每轮。

初赛 / 中级：无 round 切换，只有一组 `savedGroups`。

---

## 7. UI（PK 名单页）

1. **阶段 Tab**：初赛 | 中级赛 | 终极赛（替换或上移原「15号 / 月底」主语义；月底名单能力并入终极或保留副槽——**默认：原 `monthend` 配置迁移提示到终极，原 `midmonth` 迁移到中级**）
2. 工具条保留：月份、排除人员、刷新、导出图片
3. 名单区：只打名单 / 排除名单文本（已有）
4. **新增约束区**：不同组、首尾间隔（文本 + 匹配数/未匹配名）
5. **分组操作**：重新自动分组（清空 saved 用引擎）、保存当前拖拽、恢复自动
6. **拖拽**：成员在组间拖动（同性别）；拖后未点保存则仅会话内预览，点保存写入 localStorage
7. 终极赛额外 **轮次 Tab**：小组 / 复活 / 晋级 / 决赛
8. 导出：沿用现有出海报组件；标题带阶段（及终极轮次）名
9. 不满足约束：顶部警告条列出对与原因

星嗨争霸页：继续现场记分；**明确文案**：监控分不入库、不驱动本页自动分组。

---

## 8. 持久化

- localStorage key：`pk-roster-stage-config-v1`
- 结构：`{ period?: string, stages: Record<StageKey, StageRosterConfig> }`
- 启动时若仅有旧 `pk-roster-list-config-v2`：一次性映射  
  - `midmonth` → `stages.mid`  
  - `monthend` → `stages.final`  
  - `early` 用 default  
  不删旧 key（只读迁移）

不写服务器 DB 表（与「监控分不入库」一致；分组方案本机即可）。

---

## 9. 测试

| 用例 | 期望 |
|------|------|
| 无约束蛇形 | 强弱交错，组人数 ≤ groupSize |
| 一对首尾 | A 在组 1，B 在末组 |
| 一对不同组 | 自动结果不同组；若保存强制同组则警告 |
| 名单 include + 排除 | 与现逻辑一致 |
| 拖改保存再刷新页面 | 恢复 saved 成员顺序/组别 |
| 跨性别约束对 | 忽略并进 unsatisfied |
| 终极轮次切换 | 各组独立 saved，互不覆盖 |

实现：`pk-group-engine` 用 `node:test` 或现有前端可跑的纯函数测试；页面交互至少手工验收导出与保存。

---

## 10. 实现边界（文件）

| 文件 | 变更 |
|------|------|
| `src/components/desktop/pk-group-engine.ts` | **新建** 引擎 + 解析约束文本 |
| `src/components/desktop/pk-group-engine.test.ts`（或 `.test.js` 视仓库习惯） | 单测 |
| `src/components/desktop/pk-roster-config.ts` | 阶段配置类型、默认值、load/save/迁移、内置预设挂到终极 |
| `src/components/desktop/pk-roster-page.tsx` | 三阶段 UI、约束区、拖拽、保存、终极轮次 |
| `docs` | 本规格；落地后可在 LANDING 加一行能力映射（非必须同 commit） |

不改：`electron/db.js` 的 `getPkRoster` 核心算法（继续只吐 flat males/females）；不改 bot / iLink。

---

## 11. 成功标准

1. 用户能在 PK 名单页切换初赛 / 中级 / 终极，各自维护导入名单与约束  
2. 一键按导入音浪自动分组；首尾对、不同组在可解时被满足  
3. 拖改后保存，刷新不丢  
4. 导出图片含阶段标题与分组  
5. 终极赛四轮可切换；初赛/中级无四轮 UI  
6. 监控分仍不出现在分组持久化与业务库写入路径  

---

## 12. 已决问题摘要

| 问题 | 结论 |
|------|------|
| 应用范围 | 扩展 15 号体系为月度三阶段，落在 PK 名单页 |
| 阶段时间 | 初赛月初、中级约 15 号、终极最后 3 天 |
| 晋级链 | 本版名单各自配置，不做自动出线流水线 |
| 初/中形态 | **仅直接分组** |
| 终极形态 | **小组 / 复活 / 晋级 / 决赛** |
| 间隔 | **首尾间隔对** + **不同组** |
| 引擎 | 蛇形 + 约束 + **可拖改保存** |
| 分数 | **仅已导入音浪**；监控分不入库、不驱动自动分组 |
