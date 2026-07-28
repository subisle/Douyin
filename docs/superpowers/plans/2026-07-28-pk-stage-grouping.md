# PK 三阶段分组实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 PK 名单页落地初赛/中级/终极三阶段分组：双入组顺序（从高到低 | 均衡合理）、不同组与首尾间隔硬约束、可拖改保存与导出；终极赛四轮；分数仅用已导入音浪。

**架构：** 纯函数引擎 `src/lib/pk-group-engine.ts`（Node 25 `--experimental-strip-types` 可单测）负责排序、双顺序入组、首尾预放置、不同组修复；`pk-roster-config.ts` 扩展阶段配置与 localStorage 迁移；`pk-roster-page.tsx` 换三阶段 UI 并调用引擎。不改 `getPkRoster` / 监控入库。

**技术栈：** TypeScript、React（Next client）、`node:test`、现有 shadcn Button/Badge、localStorage。

**规格：** `docs/superpowers/specs/2026-07-28-pk-stage-grouping-design.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| 创建 `src/lib/pk-group-engine.ts` | 比较、解析姓名对、双顺序入组、首尾/不同组、应用 savedGroups |
| 创建 `src/lib/pk-group-engine.test.ts` | 引擎单测（node:test + strip-types） |
| 修改 `package.json` | 增加 `test:pk-group` 脚本 |
| 修改 `src/components/desktop/pk-roster-config.ts` | StageKey / GroupOrderMode / StageRosterConfig、默认值、load/save v1、旧 v2 迁移；导出阶段 Tab 常量；内置预设挂终极 |
| 修改 `src/components/desktop/pk-roster-page.tsx` | 三阶段 UI、约束区、顺序切换、引擎接线、拖改保存、终极四轮、导出标题 |
| 修改 `src/components/desktop/star-battle-page.tsx` | 只读迁移：仍用 loadRosterConfigs 时兼容新 key 或提供 `loadMidmonthIncludeExclude` 适配，避免星嗨白名单断裂 |
| 可选 `docs/LANDING.md` | §2 加一行 PK 三阶段（非阻塞） |

---

### 任务 1：分组引擎 + 失败测试骨架

**文件：**
- 创建：`src/lib/pk-group-engine.ts`
- 创建：`src/lib/pk-group-engine.test.ts`
- 修改：`package.json`（scripts）

- [ ] **步骤 1：写失败测试（排序 + high_to_low 切块）**

`src/lib/pk-group-engine.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConstrainedGroups,
  comparePkMembers,
  type EngineMember,
} from "./pk-group-engine.ts";

function m(
  personId: number,
  name: string,
  trimmedAvg: number,
  wave = trimmedAvg
): EngineMember {
  return {
    personId,
    name,
    gender: "male",
    anchorId: String(personId),
    trimmedAvg,
    wave,
  };
}

test("comparePkMembers: trimmedAvg desc then wave then personId", () => {
  const a = m(1, "A", 100, 50);
  const b = m(2, "B", 200, 10);
  const c = m(3, "C", 100, 80);
  const d = m(4, "D", 100, 80);
  assert.ok(comparePkMembers(a, b) > 0);
  assert.ok(comparePkMembers(c, a) < 0);
  assert.equal(comparePkMembers(c, d), c.personId - d.personId);
});

test("high_to_low fills strongest group first", () => {
  const members = [m(1, "S1", 90), m(2, "S2", 80), m(3, "S3", 70), m(4, "S4", 60), m(5, "S5", 50)];
  const { groups } = buildConstrainedGroups({
    members,
    gender: "male",
    groupSize: 2,
    groupOrder: "high_to_low",
    differentPairs: [],
    headTailPairs: [],
    assignCaptains: false,
  });
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups[0].members.map((x) => x.personId),
    [1, 2]
  );
  assert.deepEqual(
    groups[1].members.map((x) => x.personId),
    [3, 4]
  );
  assert.deepEqual(
    groups[2].members.map((x) => x.personId),
    [5]
  );
});
```

- [ ] **步骤 2：跑测试确认失败**

```bash
node --experimental-strip-types --test src/lib/pk-group-engine.test.ts
```

预期：FAIL（模块不存在或导出缺失）。

- [ ] **步骤 3：最小引擎实现（比较 + high_to_low，无约束）**

`src/lib/pk-group-engine.ts` 核心形状：

```ts
export type GroupOrderMode = "high_to_low" | "balanced";

export type EngineMember = {
  personId: number;
  name: string;
  gender: string;
  anchorId?: string;
  trimmedAvg: number;
  wave: number;
};

export type EngineGroup = {
  key: string;
  gender: "male" | "female";
  label: string;
  members: EngineMember[];
  captainId: number | null;
};

export type PersonPair = [number, number];

export type UnsatisfiedConstraint = {
  kind: "different" | "head_tail" | "cross_gender";
  leftId: number;
  rightId: number;
  reason: string;
};

export function comparePkMembers(left: EngineMember, right: EngineMember): number {
  const scoreDiff = right.trimmedAvg - left.trimmedAvg;
  if (scoreDiff !== 0) return scoreDiff;
  const waveDiff = right.wave - left.wave;
  if (waveDiff !== 0) return waveDiff;
  return left.personId - right.personId;
}

export function buildConstrainedGroups(input: {
  members: EngineMember[];
  gender: "male" | "female";
  groupSize?: number;
  groupOrder?: GroupOrderMode;
  differentPairs?: PersonPair[];
  headTailPairs?: PersonPair[];
  assignCaptains?: boolean;
  labelPrefix?: string;
}): { groups: EngineGroup[]; unsatisfied: UnsatisfiedConstraint[]; meta: { groupOrder: GroupOrderMode; groupCount: number } } {
  const groupSize = Math.max(1, input.groupSize ?? 8);
  const groupOrder: GroupOrderMode = input.groupOrder ?? "balanced";
  const assignCaptains = Boolean(input.assignCaptains);
  const prefix = input.labelPrefix ?? (input.gender === "male" ? "男团" : "女团");

  const seen = new Set<number>();
  const eligible = input.members
    .filter((member) => {
      if (seen.has(member.personId)) return false;
      seen.add(member.personId);
      return true;
    })
    .sort(comparePkMembers);

  if (eligible.length === 0) {
    return { groups: [], unsatisfied: [], meta: { groupOrder, groupCount: 0 } };
  }

  const groupCount = Math.max(1, Math.ceil(eligible.length / groupSize));
  const buckets: EngineMember[][] = Array.from({ length: groupCount }, () => []);
  const placed = new Set<number>();

  // Task 1: only high_to_low chunk fill; head-tail / different / balanced in later tasks
  if (groupOrder === "high_to_low") {
    eligible.forEach((member, index) => {
      const target = Math.min(groupCount - 1, Math.floor(index / groupSize));
      buckets[target].push(member);
      placed.add(member.personId);
    });
  } else {
    // temporary: same as high_to_low until task 2
    eligible.forEach((member, index) => {
      const target = Math.min(groupCount - 1, Math.floor(index / groupSize));
      buckets[target].push(member);
      placed.add(member.personId);
    });
  }

  const groups: EngineGroup[] = buckets.map((members, index) => {
    const sorted = [...members].sort(comparePkMembers);
    return {
      key: `${input.gender}-${index}`,
      gender: input.gender,
      label: `${prefix} 第${index + 1}组`,
      members: sorted,
      captainId: assignCaptains ? sorted[0]?.personId ?? null : null,
    };
  });

  return {
    groups,
    unsatisfied: [],
    meta: { groupOrder, groupCount },
  };
}
```

- [ ] **步骤 4：再跑测试确认 high_to_low 通过**

```bash
node --experimental-strip-types --test src/lib/pk-group-engine.test.ts
```

预期：PASS（2 tests）。

- [ ] **步骤 5：package.json 加脚本并 commit**

在 `package.json` scripts 增加：

```json
"test:pk-group": "node --experimental-strip-types --test src/lib/pk-group-engine.test.ts"
```

```bash
git add src/lib/pk-group-engine.ts src/lib/pk-group-engine.test.ts package.json
git commit -m "feat(pk): add group engine high-to-low baseline"
```

---

### 任务 2：均衡蛇形入组

**文件：**
- 修改：`src/lib/pk-group-engine.ts`
- 修改：`src/lib/pk-group-engine.test.ts`

- [ ] **步骤 1：写失败测试 balanced**

```ts
test("balanced serpentine spreads strength", () => {
  const members = [
    m(1, "S1", 90),
    m(2, "S2", 80),
    m(3, "S3", 70),
    m(4, "S4", 60),
    m(5, "S5", 50),
    m(6, "S6", 40),
  ];
  const { groups } = buildConstrainedGroups({
    members,
    gender: "male",
    groupSize: 2,
    groupOrder: "balanced",
    differentPairs: [],
    headTailPairs: [],
  });
  assert.equal(groups.length, 3);
  // serpentine into 3 groups size 2: g0=[1,6], g1=[2,5], g2=[3,4] after per-group re-sort by strength
  assert.deepEqual(
    groups.map((g) => g.members.map((x) => x.personId)),
    [
      [1, 6],
      [2, 5],
      [3, 4],
    ]
  );
});
```

- [ ] **步骤 2：跑测确认失败（若仍走切块会得到 [[1,2],[3,4],[5,6]]）**

```bash
npm run test:pk-group
```

- [ ] **步骤 3：实现蛇形填充**

在 `buildConstrainedGroups` 的 `else`（`balanced`）分支替换为：

```ts
  // 蛇形：index 0..n-1 → 组 0,1,...,last, last,...,0, 0,...
  let dir = 1;
  let cursor = 0;
  for (const member of eligible) {
    if (placed.has(member.personId)) continue;
    // find next bucket with capacity
    let guard = 0;
    while (buckets[cursor].length >= groupSize && guard < groupCount * 2) {
      cursor += dir;
      if (cursor >= groupCount) {
        cursor = groupCount - 1;
        dir = -1;
      } else if (cursor < 0) {
        cursor = 0;
        dir = 1;
      }
      guard += 1;
    }
    buckets[cursor].push(member);
    placed.add(member.personId);
    cursor += dir;
    if (cursor >= groupCount) {
      cursor = groupCount - 1;
      dir = -1;
    } else if (cursor < 0) {
      cursor = 0;
      dir = 1;
    }
  }
```

注意：无约束时 `placed` 为空，应对全体 `eligible` 蛇形；可先清空 high_to_low 与 balanced 共用「未放置列表」循环。重构建议：

```ts
  const remaining = eligible.filter((member) => !placed.has(member.personId));
  if (groupOrder === "high_to_low") {
    for (const member of remaining) {
      const target = buckets.findIndex((bucket) => bucket.length < groupSize);
      const idx = target === -1 ? groupCount - 1 : target;
      buckets[idx].push(member);
      placed.add(member.personId);
    }
  } else {
    // serpentine as above over `remaining`
  }
```

无约束时 high_to_low 用「从左找空位」等价于切块。

- [ ] **步骤 4：跑通**

```bash
npm run test:pk-group
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/lib/pk-group-engine.ts src/lib/pk-group-engine.test.ts
git commit -m "feat(pk): serpentine balanced group order"
```

---

### 任务 3：首尾间隔硬约束

**文件：**
- 修改：`src/lib/pk-group-engine.ts`
- 修改：`src/lib/pk-group-engine.test.ts`

- [ ] **步骤 1：失败测试**

```ts
test("head-tail pair pins first and last group", () => {
  const members = [
    m(1, "A", 90),
    m(2, "B", 80),
    m(3, "C", 70),
    m(4, "D", 60),
    m(5, "E", 50),
    m(6, "F", 40),
  ];
  // B first group, E last group — regardless of natural rank placement
  const { groups, unsatisfied } = buildConstrainedGroups({
    members,
    gender: "male",
    groupSize: 2,
    groupOrder: "balanced",
    differentPairs: [],
    headTailPairs: [[2, 5]],
  });
  assert.equal(unsatisfied.length, 0);
  assert.ok(groups[0].members.some((x) => x.personId === 2));
  assert.ok(groups[groups.length - 1].members.some((x) => x.personId === 5));
});

test("head-tail works with high_to_low too", () => {
  const members = [m(1, "A", 90), m(2, "B", 80), m(3, "C", 70), m(4, "D", 60)];
  const { groups } = buildConstrainedGroups({
    members,
    gender: "male",
    groupSize: 2,
    groupOrder: "high_to_low",
    headTailPairs: [[4, 1]], // weakest → group0, strongest → last
  });
  assert.ok(groups[0].members.some((x) => x.personId === 4));
  assert.ok(groups[groups.length - 1].members.some((x) => x.personId === 1));
});
```

- [ ] **步骤 2：跑测确认失败**

```bash
npm run test:pk-group
```

- [ ] **步骤 3：预放置实现**

在建完 `buckets` 后、填充 `remaining` 前：

```ts
  const locked = new Set<number>();
  const byId = new Map(eligible.map((member) => [member.personId, member]));
  const unsatisfied: UnsatisfiedConstraint[] = [];
  const headTailPairs = input.headTailPairs ?? [];

  let lowCursor = 0;
  let highCursor = groupCount - 1;
  for (const [leftId, rightId] of headTailPairs) {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    if (!left || !right) {
      unsatisfied.push({
        kind: "head_tail",
        leftId,
        rightId,
        reason: "成员不在当前分组池",
      });
      continue;
    }
    if (leftId === rightId) {
      unsatisfied.push({
        kind: "head_tail",
        leftId,
        rightId,
        reason: "首尾对不能是同一人",
      });
      continue;
    }
    // pick lowest group with capacity for left
    let placedLeft = false;
    for (let i = lowCursor; i < groupCount; i++) {
      if (buckets[i].length < groupSize && !locked.has(leftId)) {
        buckets[i].push(left);
        locked.add(leftId);
        placed.add(leftId);
        placedLeft = true;
        lowCursor = Math.min(groupCount - 1, i + (groupCount > 1 ? 0 : 0));
        // next pair prefers next slot when same index full later
        break;
      }
    }
    let placedRight = false;
    for (let i = highCursor; i >= 0; i--) {
      if (buckets[i].length < groupSize && !locked.has(rightId)) {
        // avoid same bucket as left if only one group — mark unsatisfied if conflict unavoidable
        if (groupCount > 1 && buckets[i].some((x) => x.personId === leftId)) {
          continue;
        }
        buckets[i].push(right);
        locked.add(rightId);
        placed.add(rightId);
        placedRight = true;
        break;
      }
    }
    if (!placedLeft || !placedRight) {
      unsatisfied.push({
        kind: "head_tail",
        leftId,
        rightId,
        reason: "组数或容量不足以落实首尾间隔",
      });
    }
  }
```

多对时：第二对 A→尽量组 0 若满则组 1，B→尽量末组若满则末-1（与规格「次首/次末」一致）。实现上用递增 `lowProbe` / 递减 `highProbe` 更清晰：

```ts
  let nextLow = 0;
  let nextHigh = groupCount - 1;
  for (const [leftId, rightId] of headTailPairs) {
    // resolve members...
    const lowIdx = findOpenFrom(buckets, groupSize, nextLow, 1, groupCount);
    const highIdx = findOpenFrom(buckets, groupSize, nextHigh, -1, groupCount);
    // place, then nextLow = lowIdx + 1 (clamp), nextHigh = highIdx - 1
  }
```

辅助函数 `findOpenFrom` 写在同文件。

- [ ] **步骤 4：跑通**

```bash
npm run test:pk-group
```

- [ ] **步骤 5：Commit**

```bash
git add src/lib/pk-group-engine.ts src/lib/pk-group-engine.test.ts
git commit -m "feat(pk): head-tail interval hard constraint"
```

---

### 任务 4：不同组硬约束 + 姓名对解析

**文件：**
- 修改：`src/lib/pk-group-engine.ts`
- 修改：`src/lib/pk-group-engine.test.ts`

- [ ] **步骤 1：失败测试**

```ts
test("different-group pair not same bucket after fix", () => {
  const members = [
    m(1, "A", 90),
    m(2, "B", 80),
    m(3, "C", 70),
    m(4, "D", 60),
  ];
  // high_to_low size 2 naturally puts 1+2 together; constrain them apart
  const { groups, unsatisfied } = buildConstrainedGroups({
    members,
    gender: "male",
    groupSize: 2,
    groupOrder: "high_to_low",
    differentPairs: [[1, 2]],
    headTailPairs: [],
  });
  const gOf = (id: number) => groups.findIndex((g) => g.members.some((x) => x.personId === id));
  assert.notEqual(gOf(1), gOf(2));
  assert.equal(unsatisfied.filter((u) => u.kind === "different").length, 0);
});

test("parseNamePairs splits lines", () => {
  const { parseNamePairs } = require("./pk-group-engine.ts"); // use import
});
```

改用 import：

```ts
import { parseNamePairs, resolveNamePairsToIds } from "./pk-group-engine.ts";

test("parseNamePairs", () => {
  assert.deepEqual(parseNamePairs("张三,李四\n王五 和 赵六"), [
    ["张三", "李四"],
    ["王五", "赵六"],
  ]);
});

test("resolveNamePairsToIds", () => {
  const members = [m(1, "张三", 1), m(2, "李四", 1), m(3, "王五", 1)];
  const { pairs, unmatched } = resolveNamePairsToIds(
    [["张三", "李四"], ["王五", "不存在"]],
    members,
    (name) => name.replace(/\s+/g, "")
  );
  assert.deepEqual(pairs, [[1, 2]]);
  assert.deepEqual(unmatched, ["不存在"]);
});
```

- [ ] **步骤 2：跑测失败**

```bash
npm run test:pk-group
```

- [ ] **步骤 3：实现 parse + 不同组修复**

```ts
export function parseNamePairs(text: string): string[][] {
  const pairs: string[][] = [];
  for (const rawLine of String(text || "").split(/\n|;|；/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line
      .split(/\s*[,，、]\s*|\s+和\s+|\s+&\s+|\s+vs\s+/i)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) pairs.push([parts[0], parts[1]]);
  }
  return pairs;
}

export function resolveNamePairsToIds(
  namePairs: string[][],
  members: EngineMember[],
  canonicalName: (name: string) => string = (n) => n.replace(/\s+/g, "").trim()
): { pairs: PersonPair[]; unmatched: string[] } {
  const byName = new Map<string, EngineMember>();
  for (const member of members) {
    const key = canonicalName(member.name);
    if (!byName.has(key)) byName.set(key, member);
  }
  const pairs: PersonPair[] = [];
  const unmatched: string[] = [];
  for (const [a, b] of namePairs) {
    const left = byName.get(canonicalName(a));
    const right = byName.get(canonicalName(b));
    if (!left) unmatched.push(a);
    if (!right) unmatched.push(b);
    if (left && right) pairs.push([left.personId, right.personId]);
  }
  return { pairs, unmatched };
}
```

不同组修复（填充完成后、组内 sort 前）：

```ts
  function groupIndexOf(personId: number): number {
    return buckets.findIndex((bucket) => bucket.some((x) => x.personId === personId));
  }

  for (const [a, b] of input.differentPairs ?? []) {
    let gi = groupIndexOf(a);
    let gj = groupIndexOf(b);
    if (gi < 0 || gj < 0) {
      unsatisfied.push({ kind: "different", leftId: a, rightId: b, reason: "成员未入组" });
      continue;
    }
    if (gi !== gj) continue;
    // try swap b with unlocked member in another group
    let fixed = false;
    for (let t = 0; t < groupCount && !fixed; t++) {
      if (t === gi) continue;
      const swapIdx = buckets[t].findIndex((x) => !locked.has(x.personId));
      if (swapIdx < 0) continue;
      const bIdx = buckets[gi].findIndex((x) => x.personId === b);
      if (bIdx < 0) break;
      if (locked.has(b)) {
        // try move a instead if a not locked
        const aIdx = buckets[gi].findIndex((x) => x.personId === a);
        if (aIdx < 0 || locked.has(a)) break;
        const tmp = buckets[t][swapIdx];
        buckets[t][swapIdx] = buckets[gi][aIdx];
        buckets[gi][aIdx] = tmp;
      } else {
        const tmp = buckets[t][swapIdx];
        buckets[t][swapIdx] = buckets[gi][bIdx];
        buckets[gi][bIdx] = tmp;
      }
      fixed = groupIndexOf(a) !== groupIndexOf(b);
    }
    if (!fixed) {
      unsatisfied.push({
        kind: "different",
        leftId: a,
        rightId: b,
        reason: "无法在不破坏首尾锁定的前提下拆开",
      });
    }
  }
```

规格：与首尾冲突时**首尾优先**（locked 不拆）→ 不同组进 unsatisfied。

加测：

```ts
test("head-tail wins over different when conflict", () => {
  const members = [m(1, "A", 90), m(2, "B", 80), m(3, "C", 70), m(4, "D", 60)];
  const { groups, unsatisfied } = buildConstrainedGroups({
    members,
    gender: "male",
    groupSize: 2,
    groupOrder: "high_to_low",
    headTailPairs: [[1, 2]], // 1 in g0, 2 in last — if only 2 groups and size 2, OK different
    differentPairs: [[1, 2]],
  });
  // 2 groups: should satisfy both
  assert.notEqual(
    groups.findIndex((g) => g.members.some((x) => x.personId === 1)),
    groups.findIndex((g) => g.members.some((x) => x.personId === 2))
  );
});
```

- [ ] **步骤 4：全绿**

```bash
npm run test:pk-group
```

- [ ] **步骤 5：Commit**

```bash
git add src/lib/pk-group-engine.ts src/lib/pk-group-engine.test.ts
git commit -m "feat(pk): different-group constraint and name pair parse"
```

---

### 任务 5：阶段配置类型、默认值、迁移

**文件：**
- 修改：`src/components/desktop/pk-roster-config.ts`
- 创建：`src/components/desktop/pk-roster-config.test.ts`（strip-types 测迁移；或把纯函数迁到可测段落）

为减少 React 依赖，迁移函数保持无 DOM 以外的 `window` 时可注入 storage。

- [ ] **步骤 1：扩展类型与常量**

在 `pk-roster-config.ts` 增加（保留旧 `RosterConfig` / `ROSTER_SLOT_OPTIONS` 供星嗨过渡）：

```ts
export type StageKey = "early" | "mid" | "final";
export type FinalRoundKey = "group" | "revive" | "promo" | "finals";
export type GroupOrderMode = "high_to_low" | "balanced";

export type SavedGroupState = {
  key: string;
  label: string;
  gender: "male" | "female";
  memberIds: number[];
  captainId: number | null;
  round?: FinalRoundKey;
};

export type StageRosterConfig = {
  mode: "include" | "exclude";
  includeText: string;
  excludeText: string;
  differentGroupText: string;
  headTailText: string;
  groupOrder: GroupOrderMode;
  groupSize: number;
  savedGroups: SavedGroupState[] | null;
};

export const STAGE_CONFIG_STORAGE_KEY = "pk-roster-stage-config-v1";

export const STAGE_TAB_OPTIONS: { key: StageKey; label: string; shortLabel: string; description: string }[] = [
  { key: "early", label: "初赛", shortLabel: "初赛", description: "月初 · 直接分组" },
  { key: "mid", label: "中级赛", shortLabel: "中级", description: "约 15 号 · 直接分组" },
  { key: "final", label: "终极赛", shortLabel: "终极", description: "月末 3 天 · 四轮" },
];

export const FINAL_ROUND_OPTIONS: { key: FinalRoundKey; label: string }[] = [
  { key: "group", label: "小组赛" },
  { key: "revive", label: "复活赛" },
  { key: "promo", label: "晋级赛" },
  { key: "finals", label: "决赛" },
];

export const GROUP_ORDER_OPTIONS: { key: GroupOrderMode; label: string }[] = [
  { key: "high_to_low", label: "从高到低" },
  { key: "balanced", label: "均衡合理" },
];

export function defaultStageConfig(): StageRosterConfig {
  return {
    mode: "include",
    includeText: "",
    excludeText: "",
    differentGroupText: "",
    headTailText: "",
    groupOrder: "balanced",
    groupSize: DEFAULT_PK_GROUP_SIZE,
    savedGroups: null,
  };
}

export function defaultStageConfigs(): Record<StageKey, StageRosterConfig> {
  return {
    early: defaultStageConfig(),
    mid: {
      ...defaultStageConfig(),
      includeText: PRESET_ROSTER_TEXT,
      mode: "include",
    },
    final: defaultStageConfig(),
  };
}
```

- [ ] **步骤 2：load/save + v2 迁移**

```ts
export function loadStageConfigs(storage?: Storage | null): Record<StageKey, StageRosterConfig> {
  const defaults = defaultStageConfigs();
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return defaults;
  try {
    const rawV1 = store.getItem(STAGE_CONFIG_STORAGE_KEY);
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as { stages?: Partial<Record<StageKey, Partial<StageRosterConfig>>> };
      const stages = parsed.stages || {};
      return {
        early: { ...defaults.early, ...stages.early },
        mid: { ...defaults.mid, ...stages.mid },
        final: { ...defaults.final, ...stages.final },
      };
    }
    const rawV2 = store.getItem(ROSTER_CONFIG_STORAGE_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Partial<Record<"midmonth" | "monthend", Partial<RosterConfig>>>;
      return {
        early: defaults.early,
        mid: {
          ...defaults.mid,
          mode: parsed.midmonth?.mode ?? defaults.mid.mode,
          includeText: parsed.midmonth?.includeText ?? defaults.mid.includeText,
          excludeText: parsed.midmonth?.excludeText ?? "",
        },
        final: {
          ...defaults.final,
          mode: parsed.monthend?.mode ?? "include",
          includeText: parsed.monthend?.includeText ?? "",
          excludeText: parsed.monthend?.excludeText ?? "",
        },
      };
    }
  } catch {
    return defaults;
  }
  return defaults;
}

export function saveStageConfigs(
  configs: Record<StageKey, StageRosterConfig>,
  storage?: Storage | null
) {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return;
  store.setItem(STAGE_CONFIG_STORAGE_KEY, JSON.stringify({ stages: configs }));
}
```

保留 `loadRosterConfigs`：内部可改为从 `loadStageConfigs` 映射回 midmonth/monthend，避免星嗨页白名单空：

```ts
export function loadRosterConfigs(): Record<RosterSlot, RosterConfig> {
  const stages = loadStageConfigs();
  return {
    midmonth: {
      mode: stages.mid.mode,
      includeText: stages.mid.includeText,
      excludeText: stages.mid.excludeText,
    },
    monthend: {
      mode: stages.final.mode,
      includeText: stages.final.includeText,
      excludeText: stages.final.excludeText,
    },
  };
}
```

- [ ] **步骤 3：迁移单测（内存 storage）**

`src/components/desktop/pk-roster-config.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  loadStageConfigs,
  ROSTER_CONFIG_STORAGE_KEY,
  STAGE_CONFIG_STORAGE_KEY,
  saveStageConfigs,
  defaultStageConfigs,
} from "./pk-roster-config.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as Storage;
}

test("migrates v2 midmonth/monthend into mid/final", () => {
  const storage = memoryStorage({
    [ROSTER_CONFIG_STORAGE_KEY]: JSON.stringify({
      midmonth: { mode: "include", includeText: "甲\n乙", excludeText: "丙" },
      monthend: { mode: "exclude", includeText: "", excludeText: "丁" },
    }),
  });
  const stages = loadStageConfigs(storage);
  assert.equal(stages.mid.includeText, "甲\n乙");
  assert.equal(stages.mid.excludeText, "丙");
  assert.equal(stages.final.excludeText, "丁");
  assert.equal(stages.early.groupOrder, "balanced");
});
```

- [ ] **步骤 4：跑测**

```bash
node --experimental-strip-types --test src/components/desktop/pk-roster-config.test.ts
npm run test:pk-group
```

`package.json` 可扩：

```json
"test:pk-group": "node --experimental-strip-types --test src/lib/pk-group-engine.test.ts src/components/desktop/pk-roster-config.test.ts"
```

- [ ] **步骤 5：Commit**

```bash
git add src/components/desktop/pk-roster-config.ts src/components/desktop/pk-roster-config.test.ts package.json
git commit -m "feat(pk): stage roster config and v2 migration"
```

---

### 任务 6：PK 名单页接引擎 + 三阶段/顺序/约束 UI

**文件：**
- 修改：`src/components/desktop/pk-roster-page.tsx`

- [ ] **步骤 1：替换状态模型**

去掉主路径对 `rosterSlot: midmonth|monthend` + `midmonthView` 的依赖（或保留内部映射），改为：

```ts
const [stage, setStage] = useState<StageKey>("mid");
const [finalRound, setFinalRound] = useState<FinalRoundKey>("group");
const [stageConfigs, setStageConfigs] = useState(() => loadStageConfigs());
const [draftGroups, setDraftGroups] = useState<{
  male: GroupState[];
  female: GroupState[];
} | null>(null); // 拖改未保存
```

`useEffect` → `saveStageConfigs(stageConfigs)`。

`updateActiveConfig(patch)` 写 `stageConfigs[stage]`。

- [ ] **步骤 2：用引擎生成组**

```ts
import {
  buildConstrainedGroups,
  parseNamePairs,
  resolveNamePairsToIds,
} from "@/lib/pk-group-engine";
import { canonical via existing resolve — export canonical from config or reuse normalize + aliases }

// export function canonicalRosterName from pk-roster-config (currently private) → export it
```

先在 `pk-roster-config.ts` **export** `canonicalRosterName`（或 `normalizeRosterName` + aliases 包装）。

```ts
const active = stageConfigs[stage];
const differentPairs = resolveNamePairsToIds(
  parseNamePairs(active.differentGroupText),
  allMembers.map(...),
  canonicalRosterName
);
// same for headTail

const engineMale = buildConstrainedGroups({
  members: rosterMembers.males,
  gender: "male",
  groupSize: active.groupSize,
  groupOrder: active.groupOrder,
  differentPairs: differentPairs.pairs,
  headTailPairs: headTail.pairs,
  assignCaptains: stage === "final", // 与旧 midmonth 无队长、monthend 有队长对齐：初/中 false，终极 true
});
```

若 `active.savedGroups` 非 null：按 gender（及终极 round）还原 `GroupState[]`，缺员用引擎补（调用引擎后 merge；最小实现：**有 saved 则完全按 saved memberIds 建组**，校验约束只产 unsatisfied 警告）。

```ts
function groupsFromSaved(
  saved: SavedGroupState[],
  pool: PkMember[],
  gender: "male" | "female",
  round?: FinalRoundKey
): GroupState[] {
  const byId = new Map(pool.map((m) => [m.personId, m]));
  return saved
    .filter((g) => g.gender === gender && (round ? g.round === round : !g.round))
    .map((g) => ({
      key: g.key,
      gender,
      label: g.label,
      members: g.memberIds.map((id) => byId.get(id)).filter(Boolean) as PkMember[],
      captainId: g.captainId,
    }));
}
```

- [ ] **步骤 3：UI 区块**

1. 阶段 Tab：`STAGE_TAB_OPTIONS`  
2. `stage === "final"` 时 `FINAL_ROUND_OPTIONS`  
3. `GROUP_ORDER_OPTIONS` 切换 → `updateActiveConfig({ groupOrder, savedGroups: null })`  
4. 约束两个 textarea：`differentGroupText` / `headTailText`  
5. 按钮：重新自动分组（`savedGroups: null` + 清 draft）、保存分组（把当前 male+female 写成 savedGroups）、恢复自动  
6. unsatisfied 警告条  
7. 提示文案改三阶段说明；终极可「加载内置小组/晋级预设」按钮调用现有 `resolvePresetBattleGroups` 写入 draft/saved  

- [ ] **步骤 4：导出标题**

`ExportCompareBoard` 增加可选 `titleSuffix`（如 `初赛 · 均衡合理`）；导出文件名带阶段。

- [ ] **步骤 5：手工冒烟 + commit**

```bash
npm run test:pk-group
npm run electron:dev
# 点 PK 名单：切换阶段/顺序、填首尾与不同组、导出
```

```bash
git add src/components/desktop/pk-roster-page.tsx src/components/desktop/pk-roster-config.ts
git commit -m "feat(pk): wire stage UI dual order and constraints"
```

---

### 任务 7：组间拖改

**文件：**
- 修改：`src/components/desktop/pk-roster-page.tsx`

- [ ] **步骤 1：GroupCard 支持拖放**

最小 HTML5 DnD（不引入 dnd 库）：

- 成员行 `draggable`，`onDragStart` 带 `personId` + `fromKey`  
- 组卡片 `onDragOver preventDefault` + `onDrop` → 回调 `onMoveMember(personId, fromKey, toKey)`  

页面：

```ts
const displayMale = draftGroups?.male ?? maleGroupsFromEngineOrSaved;
const move = (personId, fromKey, toKey, gender) => {
  setDraftGroups((prev) => {
    const base = prev ?? { male: maleGroups, female: femaleGroups };
    const list = gender === "male" ? base.male : base.female;
    const next = list.map((g) => ({ ...g, members: [...g.members] }));
    const from = next.find((g) => g.key === fromKey);
    const to = next.find((g) => g.key === toKey);
    if (!from || !to) return prev;
    const idx = from.members.findIndex((m) => m.personId === personId);
    if (idx < 0) return prev;
    const [mem] = from.members.splice(idx, 1);
    to.members.push(mem);
    to.members.sort(comparePkMembers);
    return gender === "male" ? { ...base, male: next } : { ...base, female: next };
  });
};
```

保存：把 draft 写成 `savedGroups`（终极带 `round: finalRound`）。

- [ ] **步骤 2：切换顺序/阶段时处理 draft**

切换 `groupOrder`：若 `draftGroups` 非 null，`window.confirm("丢弃未保存拖改？")` 否 thrn 不切换；是则 `draft=null` 且 `savedGroups=null`。

- [ ] **步骤 3：Commit**

```bash
git add src/components/desktop/pk-roster-page.tsx
git commit -m "feat(pk): drag members between groups with save"
```

---

### 任务 8：星嗨兼容 + 收尾验证

**文件：**
- 修改：`src/components/desktop/star-battle-page.tsx`（若 `loadRosterConfigs` 已适配则可能无需改）
- 可选：`docs/LANDING.md` §2 一行

- [ ] **步骤 1：确认星嗨仍能读 mid 白名单**

`loadRosterConfigs()` 已从 stage 映射则 star-battle 不用改。跑页面：星嗨争霸名单人数非 0（在有数据时）。

- [ ] **步骤 2：全量相关测试**

```bash
npm run test:pk-group
npm run test:db-config
```

- [ ] **步骤 3：对照规格成功标准勾选**

- 三阶段切换与各自名单/约束  
- 双顺序  
- 不同组 + 首尾  
- 拖改保存刷新仍在  
- 终极四轮  
- 导出  
- 监控分未写入分组存储  

- [ ] **步骤 4：Commit 收尾**

```bash
git add -A
git status
git commit -m "feat(pk): finish stage grouping verification notes"
```

（若无文档变更可 skip 空 commit。）

---

## 自检（对照规格）

| 规格项 | 任务 |
|--------|------|
| 三阶段 early/mid/final | 5、6 |
| 初/中直接分组 | 6 |
| 终极四轮 | 6 |
| high_to_low / balanced | 1、2、6 |
| 不同组硬约束 | 4、6 |
| 首尾间隔硬约束 | 3、6 |
| 正交：约束×顺序 | 3、4 测试 |
| 可拖改保存 | 7 |
| 仅导入音浪 | 不改 db/监控（全任务边界） |
| localStorage v1 + v2 迁移 | 5 |
| 导出 | 6 |
| 星嗨不破 | 5 映射 + 8 |
| 引擎单测 | 1–4 |

无 TODO/「适当处理」占位；类型名 `GroupOrderMode` / `StageKey` / `FinalRoundKey` / `SavedGroupState` 全任务一致。

---

## 执行方式

计划已保存到 `docs/superpowers/plans/2026-07-28-pk-stage-grouping.md`。两种执行方式：

**1. 子代理驱动（推荐）** — 每任务新代理 + 任务间审查（subagent-driven-development）

**2. 内联执行** — 本会话 executing-plans，批量步骤 + 检查点

选哪种？
