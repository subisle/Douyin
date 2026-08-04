# PK 监控主链路：小组赛 → 复活 → 晋级 8 组 → 决赛 8 人

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-04 |
| 状态 | **draft（待用户审规格）** |
| 落点 | `pk-tournament-rules.ts` / `pk-tournament-store.ts` / `pk-monitor-page.tsx` + 相关测试 |
| 相关 | 既有 `2026-08-04-pk-monitor-tournament-design.md`（本文件**覆盖**其中切组与晋级出线口径） |

---

## 1. 目标

PK 监控的主产品路径：

1. **监控小组赛**（导入内置/存档 8 组）
2. **记本场分**（采分 + 可手改）
3. **结算小组赛** → 直晋 + 复活池名单
4. **复活赛记分并结算** → 复活出线
5. **直晋 + 复活出线合并** → **固定切成 8 组晋级赛**
6. **晋级赛每组第 1** → **决赛 8 人**（人人都是组内最强）

成功标准：

- 内置 58 人 8 组小组赛可导入、记分、结算
- 小组结算后生成「复活赛」存档与阶段组
- 复活结算后生成 **恰好 8 组**「晋级赛」存档（人数尽量满编）
- 晋级结算后生成 **1 组 8 人**「决赛」
- 监控分仍只存本机 localStorage，不写业务 DB

非目标：

- 改分组引擎核心 / 女团 / bot 播报
- 日音浪与本场分混累
- 重做整页 UI（仅必要时改文案/默认规则展示）

---

## 2. 与旧规格的差异（覆盖）

| 点 | 旧 `pk-monitor-tournament` | **本规格** |
|----|---------------------------|-----------|
| 晋级切组 | `chunk(list, groupSize=8)` → 人数/8 组 | **固定 8 组均分**（`splitIntoNGroups(list, 8)`） |
| 晋级出线 | 全局 `pickPromoToFinals(ranked, 8)` | **每组第 1 名**，共 8 人 |
| 复活目标 | idealPromoPool 默认 32；内置导入曾用 40 | 内置主链路：**尽量吃满复活池**，使晋级池尽量接近满编（58 人表约 **56=32+24** → 8×7） |
| idealPromoPool | 32 / 40 | 内置导入默认 **56**（或等价：`reviveTarget = 复活池人数`）；通用默认可仍保留可配置 |

---

## 3. 阶段规则（冻结）

### 3.1 小组赛

| 键 | 值 | 含义 |
|----|----|------|
| 组来源 | 内置 `PRESET_BATTLE_GROUPS` 或激活/命名存档 | 导入写入 `stages.group` |
| `groupTop` | 4 | 组内本场分前 4 **直晋** |
| `groupReviveTail` | 3 | 组内从末位向前 3 进**复活池**（与前 4 不重叠） |
| 尾组 | `top=min(4,n)`，`revive=min(3, max(0,n-top))` | 不足 8 人组同样适用 |
| 排名 | score 降序；同分 `memberKey` 升序 | |

结算产物：

- `stages.group.advanceKeys`：直晋
- `stages.group.reviveKeys`：复活池
- `stages.revive.groups`：复活池按规则切组（见 3.2）
- 回写 PK 分组命名存档 **「复活赛」**（`makeActive=false`）

### 3.2 复活赛

| 键 | 值 | 含义 |
|----|----|------|
| 池子 | 小组 `reviveKeys` 切成的组 | 记本场分 |
| 出线人数 | **尽量吃满**：`reviveOut = min(poolSize, max(0, idealPromoPool - directCount))`，内置 ideal=**56** | 58 人表：直晋 32、池 24 → 出 **24**，合并 **56** |
| 合并顺序 | 直晋原序 + 复活出线（按复活全局分降序） | 去重保序 |

结算产物：

- `stages.revive.advanceKeys`
- 合并名单 → **固定 8 组均分** → `stages.promo.groups`
- 回写 **「晋级赛」**

复活阶段自身切组（小组刚结算时）：仍可用 `chunk(reviveKeys, groupSize)` 或均分，**不要求**复活也是 8 组；复活组数随池大小变化。产品主约束落在**晋级 8 组**。

### 3.3 晋级赛（本规格核心）

| 键 | 值 | 含义 |
|----|----|------|
| 组数 | **固定 8** | `splitIntoNGroups(mergedKeys, 8)` |
| 每组人数 | `floor(n/8)` 或 `ceil`，余数从前组顺延 +1 | 例：56 → 全 7；40 → 全 5；52 → 4 组 7 + 4 组 6 |
| 空组 | 若 `merged.length < 8` | **不允许静默少组**：结算复活时若合并人数 `< 8`，仍尽量均分（部分组 1 人）；若 `merged.length === 0` 报错。内置满路径应 ≥32 |
| 出线 | **每组已记分排名第 1** | 8 个组内最强 → 决赛 |
| 组内无人记分 | 该组无法出线 | 结算整阶段失败并提示组名（与小组赛「尚无记分」一致：要求每组至少 1 个有效分，或要求该组有可排名成员） |

实现约定（明确一种）：

- 结算晋级时：**每个 promo 组**必须至少 1 名 `score != null`，否则整阶段结算失败并指出组标签。
- 出线 key = 各组 `rankedMembersOfGroup(group)[0]`，保组序。

结算产物：

- `stages.promo.advanceKeys`（长度 8，或缺组时更短并在 message 说明——内置路径应为 8）
- `stages.finals.groups`：通常 **1 组 8 人**
- 回写 **「决赛」**

### 3.4 决赛

- 仅记分排名，不强制下一档存档。

---

## 4. 切组算法

### 4.1 新增 `splitIntoNGroups(keys, groupCount)`

```
n = keys.length
g = max(1, floor(groupCount))
base = floor(n / g)
rem = n % g
第 i 组人数 = base + (i < rem ? 1 : 0)   // i 从 0
按 keys 当前顺序依次装满
```

- 与旧 `chunkKeys(keys, groupSize)` **并存**；旧函数仍用于「按每组人数切」。
- 晋级池组生成：**只用** `splitIntoNGroups(merged, 8)`。
- 写入 preset 的 `mode` 仍标 `high_to_low`（名单已按出线/合并序）。

### 4.2 内置导入默认规则

`importGroupStageFromBuiltIn`：

```
rules.idealPromoPool = 56   // 32 直晋 + 最多 24 复活
rules.reviveTarget = null   // 走 auto：min(pool, 56-32)
rules.groupSize = 8         // 复活池切组仍按 8 人块（或均分，非本规格强制）
// 新增或约定：
rules.promoGroupCount = 8   // 晋级固定 8 组
rules.promoPick = "group_top1"  // 与旧全局 top8 区分
```

为减少大改模型，也可**不增字段**：硬编码晋级 `splitIntoNGroups(..., 8)` + `settlePromo` 改每组第 1；`idealPromoPool=56` 即可。

**推荐**：最少字段变更——

- `idealPromoPool` 内置改为 **56**
- 新增纯函数 `splitIntoNGroups`
- `settleReviveStage` 用其生成 8 组
- `settlePromoStage` 改为每组 top1
- 可保留 `pickPromoToFinals` 供测试/兼容，晋级主路径不再调用

---

## 5. 数据流

```
导入内置/存档
    → stages.group (8 组)
记分（multi/单房/手改）
    → member.score
结算小组赛
    → advanceKeys + reviveKeys
    → stages.revive 组 + preset「复活赛」
    → activeStage = revive（有池）/ promo（无池）
复活记分
结算复活赛
    → revive.advanceKeys
    → merged = direct + reviveOut
    → splitIntoNGroups(merged, 8) → stages.promo
    → preset「晋级赛」
    → activeStage = promo
晋级记分
结算晋级赛
    → 每组第 1 → advanceKeys (8)
    → stages.finals 一组
    → preset「决赛」
    → activeStage = finals
```

---

## 6. UI 文案（轻量）

- 导入按钮：保持「导入内置小组赛」
- 阶段 Tab：小组赛 / 复活赛 / 晋级赛 / 决赛
- 结算成功 message 示例：
  - 小组：`直晋 32 · 复活 24 · 已写入 PK 分组 · 复活赛`
  - 复活：`出线 24 · 晋级 8 组（7 人/组）· 已写入 · 晋级赛`
  - 晋级：`每组第 1 共 8 人 · 已写入 · 决赛`
- 空态：小组无组时提示导入；晋级未生成时提示先结算复活

不在本规格重做布局。

---

## 7. 测试要点

| 用例 | 期望 |
|------|------|
| 内置表规模 | 8 组、58 人、每组 7–8；直晋 32、复活池 24 |
| ideal=56 + 池 24 | 复活出 24；合并 56 |
| `splitIntoNGroups(56keys, 8)` | 8 组皆 7 |
| `splitIntoNGroups(40keys, 8)` | 8 组皆 5 |
| `splitIntoNGroups(52keys, 8)` | 人数和 52，组数 8，组大小差 ≤1 |
| 晋级 8 组各记分 | 出线 = 各组最高分 key，共 8，**不是**全局 top8（构造全局第 1 与组内第 2 冲突用例） |
| 晋级某组无分 | 结算失败，message 含组名 |
| 结算回写 | presets 出现/更新「复活赛」「晋级赛」「决赛」；同名同 id |
| 回归 | 小组前 4 后 3、尾组 min 仍通过 |

---

## 8. 已决摘要

| 问题 | 结论 |
|------|------|
| 主路径 | 小组记分 → 复活名单 → 合并切晋级 8 组 → 每组最强进决赛 |
| 晋级组数 | **固定 8**，均分人数 |
| 晋级出线 | **每组第 1**，不是全局 top8 |
| 满编策略 | 复活尽量吃满；58 人表 → 56 → 8×7 |
| 存档名 | 复活赛 / 晋级赛 / 决赛；不抢激活 |
| 分 | 仅本场监控分 |

---

## 9. 实现落点（预告，非本文件执行）

1. `pk-tournament-rules.ts`：`splitIntoNGroups`；单测  
2. `pk-tournament-store.ts`：内置 ideal=56；`settleRevive` 用 8 组均分；`settlePromo` 每组 top1  
3. `pk-tournament-builtin.test.js` / `pk-tournament-rules.test.ts`：更新期望  
4. 监控页 message 文案如需同步  

实现前须用户确认本规格文件无误，再走 `writing-plans`。
