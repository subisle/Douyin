import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROMO_GROUP_COUNT,
  PROMO_GROUP_MAX,
  PROMO_GROUP_MIN,
  PROMO_POOL_MAX,
  PROMO_POOL_MIN,
  REVIVE_GROUP_TOP,
  chunkKeys,
  mergeBestScores,
  pickAdvanceFromRanked,
  pickPromoToFinals,
  resolveGroupTopRevive,
  resolvePromoPoolTarget,
  resolveReviveGroupCount,
  resolveReviveGroupTop,
  resolveReviveTarget,
  resolveSevenPersonSplit,
  sortByScoreDesc,
  splitGroupAdvanceRevive,
  splitIntoNGroups,
  splitReviveGroupAdvance,
} from "./pk-tournament-rules.ts";

test("sortByScoreDesc stable on tie by key", () => {
  const rows = [
    { key: "b", score: 10 },
    { key: "a", score: 10 },
    { key: "c", score: 20 },
  ];
  assert.deepEqual(
    sortByScoreDesc(rows).map((r) => r.key),
    ["c", "a", "b"]
  );
});

test("resolveGroupTopRevive：8 人前4后4 · 7 人前4后3 · 可调前3后4", () => {
  assert.deepEqual(resolveGroupTopRevive(8), { top: 4, reviveTail: 4 });
  assert.deepEqual(resolveGroupTopRevive(7), { top: 4, reviveTail: 3 });
  assert.deepEqual(resolveGroupTopRevive(7, { sevenPersonSplit: "3-4" }), {
    top: 3,
    reviveTail: 4,
  });
  assert.deepEqual(resolveGroupTopRevive(7, { sevenPersonSplit: "4-3" }), {
    top: 4,
    reviveTail: 3,
  });
  // 尾组：尽量前4，剩余进复活
  assert.deepEqual(resolveGroupTopRevive(5), { top: 4, reviveTail: 1 });
  assert.deepEqual(resolveGroupTopRevive(3), { top: 3, reviveTail: 0 });
  assert.deepEqual(resolveGroupTopRevive(0), { top: 0, reviveTail: 0 });
  // 超额组：前4直晋，其余全部进复活（小组赛零淘汰）
  assert.deepEqual(resolveGroupTopRevive(9), { top: 4, reviveTail: 5 });
  assert.deepEqual(resolveGroupTopRevive(10), { top: 4, reviveTail: 6 });
});

test("小组赛零淘汰：任意 n 人 = 直晋 ∪ 复活，无 eliminated", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
    const ranked = Array.from({ length: n }, (_, i) => ({
      key: `p${i + 1}`,
      score: (n - i) * 100,
    }));
    const { top, reviveTail } = resolveGroupTopRevive(n);
    const r = splitGroupAdvanceRevive(ranked, top, reviveTail);
    assert.equal(r.eliminated.length, 0, `n=${n} 不应有小组淘汰`);
    assert.equal(
      r.advance.length + r.revive.length,
      n,
      `n=${n} 直晋+复活应覆盖全员`
    );
  }
  // 7 人 3-4 切法同样零淘汰
  const seven = Array.from({ length: 7 }, (_, i) => ({
    key: `s${i + 1}`,
    score: 700 - i,
  }));
  const mode34 = resolveGroupTopRevive(7, { sevenPersonSplit: "3-4" });
  const r34 = splitGroupAdvanceRevive(seven, mode34.top, mode34.reviveTail);
  assert.deepEqual(r34.eliminated, []);
  assert.equal(r34.advance.length + r34.revive.length, 7);
});

test("8 人：前4直晋 · 后4复活 · 0淘汰", () => {
  const ranked = [8, 7, 6, 5, 4, 3, 2, 1].map((score, i) => ({
    key: `p${i + 1}`,
    score: score * 1000,
  }));
  const { top, reviveTail } = resolveGroupTopRevive(8);
  const r = splitGroupAdvanceRevive(ranked, top, reviveTail);
  assert.deepEqual(r.advance, ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(r.revive, ["p5", "p6", "p7", "p8"]);
  assert.deepEqual(r.eliminated, []);
});

test("7 人：前4直晋 · 后3复活 · 0淘汰", () => {
  const ranked = [7, 6, 5, 4, 3, 2, 1].map((score, i) => ({
    key: `p${i + 1}`,
    score: score * 1000,
  }));
  const { top, reviveTail } = resolveGroupTopRevive(7);
  const r = splitGroupAdvanceRevive(ranked, top, reviveTail);
  assert.deepEqual(r.advance, ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(r.revive, ["p5", "p6", "p7"]);
  assert.deepEqual(r.eliminated, []);
});

test("7 人可调：前3直晋 · 后4复活", () => {
  const ranked = [7, 6, 5, 4, 3, 2, 1].map((score, i) => ({
    key: `p${i + 1}`,
    score: score * 1000,
  }));
  const { top, reviveTail } = resolveGroupTopRevive(7, { sevenPersonSplit: "3-4" });
  const r = splitGroupAdvanceRevive(ranked, top, reviveTail);
  assert.deepEqual(r.advance, ["p1", "p2", "p3"]);
  assert.deepEqual(r.revive, ["p4", "p5", "p6", "p7"]);
  assert.deepEqual(r.eliminated, []);
});

test("5 人尾组：top min4 全晋前4，revive 1", () => {
  const ranked = [5, 4, 3, 2, 1].map((score, i) => ({ key: `x${i}`, score }));
  const { top, reviveTail } = resolveGroupTopRevive(5);
  const r = splitGroupAdvanceRevive(ranked, top, reviveTail);
  assert.deepEqual(r.advance, ["x0", "x1", "x2", "x3"]);
  assert.deepEqual(r.revive, ["x4"]);
  assert.deepEqual(r.eliminated, []);
});

test("3 人：top3 晋，revive0", () => {
  const ranked = [
    { key: "a", score: 3 },
    { key: "b", score: 2 },
    { key: "c", score: 1 },
  ];
  const { top, reviveTail } = resolveGroupTopRevive(3);
  const r = splitGroupAdvanceRevive(ranked, top, reviveTail);
  assert.deepEqual(r.advance, ["a", "b", "c"]);
  assert.deepEqual(r.revive, []);
  assert.deepEqual(r.eliminated, []);
});

test("resolveSevenPersonSplit：晋级池缺口过大时 7 人改前3后4", () => {
  // 4-3：直晋偏多时若 ideal 很大，需要的复活出线 > 4-3 池 → 改 3-4 扩大复活池
  assert.equal(
    resolveSevenPersonSplit({
      groupSizes: [7, 7, 7, 8, 7, 8, 7, 7],
      idealPromoPool: 58,
      sevenPersonSplit: "auto",
    }),
    "4-3"
  );
  // 强制
  assert.equal(
    resolveSevenPersonSplit({
      groupSizes: [7, 7, 7, 8],
      idealPromoPool: 40,
      sevenPersonSplit: "3-4",
    }),
    "3-4"
  );
  assert.equal(
    resolveSevenPersonSplit({
      groupSizes: [7, 7],
      idealPromoPool: 100,
      sevenPersonSplit: "4-3",
    }),
    "4-3"
  );
});

test("复活分组：26 人 → 4 组均分 · 每组前4晋 · 后淘", () => {
  assert.equal(REVIVE_GROUP_TOP, 4);
  assert.equal(resolveReviveGroupCount(26), 4);
  assert.equal(resolveReviveGroupCount(8), 1);
  assert.equal(resolveReviveGroupCount(0), 0);

  const keys = Array.from({ length: 26 }, (_, i) => `r${i + 1}`);
  const groups = splitIntoNGroups(keys, resolveReviveGroupCount(26));
  assert.deepEqual(
    groups.map((g) => g.length),
    [7, 7, 6, 6]
  );

  let advance = 0;
  let eliminated = 0;
  for (const chunk of groups) {
    const ranked = chunk.map((key, i) => ({
      key,
      score: (chunk.length - i) * 100,
    }));
    const top = resolveReviveGroupTop(chunk.length);
    assert.equal(top, 4);
    const split = splitReviveGroupAdvance(ranked, top);
    advance += split.advance.length;
    eliminated += split.eliminated.length;
    assert.equal(split.advance.length + split.eliminated.length, chunk.length);
  }
  // 4 组 × 前 4 = 16 晋 · 10 淘
  assert.equal(advance, 16);
  assert.equal(eliminated, 10);
});

test("复活组内：前 N 晋 · 其余淘（尾组全晋若 n≤N）", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({
    key: `a${i + 1}`,
    score: 800 - i,
  }));
  const s8 = splitReviveGroupAdvance(eight, resolveReviveGroupTop(8));
  assert.deepEqual(s8.advance, ["a1", "a2", "a3", "a4"]);
  assert.deepEqual(s8.eliminated, ["a5", "a6", "a7", "a8"]);

  const two = [
    { key: "x", score: 2 },
    { key: "y", score: 1 },
  ];
  const s2 = splitReviveGroupAdvance(two, resolveReviveGroupTop(2));
  assert.deepEqual(s2.advance, ["x", "y"]);
  assert.deepEqual(s2.eliminated, []);
});

test("复活总目标人数仍可反推（兼容）", () => {
  // 直晋 32、ideal 48 → 目标 48，池 26 → 出 16
  assert.equal(
    resolveReviveTarget({
      directAdvanceCount: 32,
      idealPromoPool: 48,
      reviveTarget: null,
      revivePoolSize: 26,
    }),
    16
  );
});

test("chunkKeys 顺序切 8", () => {
  const keys = Array.from({ length: 17 }, (_, i) => `n${i}`);
  const g = chunkKeys(keys, 8);
  assert.equal(g.length, 3);
  assert.equal(g[0].length, 8);
  assert.equal(g[1].length, 8);
  assert.equal(g[2].length, 1);
  assert.equal(g[0][0], "n0");
});

test("splitIntoNGroups：固定 8 组均分，人数差 ≤1", () => {
  const keys56 = Array.from({ length: 56 }, (_, i) => `k${i}`);
  const g56 = splitIntoNGroups(keys56, 8);
  assert.equal(g56.length, 8);
  assert.ok(g56.every((g) => g.length === 7));
  assert.equal(g56.flat().length, 56);

  const keys58 = Array.from({ length: 58 }, (_, i) => `p${i}`);
  const g58 = splitIntoNGroups(keys58, 8);
  assert.equal(g58.length, 8);
  assert.deepEqual(
    g58.map((g) => g.length),
    [8, 8, 7, 7, 7, 7, 7, 7]
  );
  assert.equal(g58[0][0], "p0");
  assert.equal(g58.flat().length, 58);

  const keys64 = Array.from({ length: 64 }, (_, i) => `x${i}`);
  const g64 = splitIntoNGroups(keys64, 8);
  assert.ok(g64.every((g) => g.length === 8));

  const keys40 = Array.from({ length: 40 }, (_, i) => `y${i}`);
  const g40 = splitIntoNGroups(keys40, 8);
  assert.equal(g40.length, 8);
  assert.ok(g40.every((g) => g.length === 5));
});

test("晋级池目标：8 组 × 每组 6–8 → 总人数 48–64", () => {
  assert.equal(PROMO_GROUP_COUNT, 8);
  assert.equal(PROMO_GROUP_MIN, 6);
  assert.equal(PROMO_GROUP_MAX, 8);
  assert.equal(PROMO_POOL_MIN, 48);
  assert.equal(PROMO_POOL_MAX, 64);

  // 直晋 32 · 复活池 26 · ideal 48 → 目标 48（8×6）
  assert.equal(
    resolvePromoPoolTarget({
      directAdvanceCount: 32,
      revivePoolSize: 26,
      idealPromoPool: 48,
    }),
    48
  );
  // ideal 偏小 40 → 抬到下限 48（需复活出 16）
  assert.equal(
    resolvePromoPoolTarget({
      directAdvanceCount: 32,
      revivePoolSize: 26,
      idealPromoPool: 40,
    }),
    48
  );
  // ideal 偏大 80 → 压到上限 64；池不够则 direct+pool
  assert.equal(
    resolvePromoPoolTarget({
      directAdvanceCount: 32,
      revivePoolSize: 26,
      idealPromoPool: 80,
    }),
    58 // 32+26
  );
  assert.equal(
    resolvePromoPoolTarget({
      directAdvanceCount: 32,
      revivePoolSize: 40,
      idealPromoPool: 80,
    }),
    64
  );
});

test("reviveTarget 自动 = 晋级池目标 - direct，且不超过池", () => {
  // ideal 32 → 抬到 48；直晋 24 · 池无限 → 出 24
  assert.equal(
    resolveReviveTarget({ directAdvanceCount: 24, idealPromoPool: 32, reviveTarget: null }),
    24
  );
  // 池只有 5 → 最多出 5
  assert.equal(
    resolveReviveTarget({
      directAdvanceCount: 24,
      idealPromoPool: 32,
      reviveTarget: null,
      revivePoolSize: 5,
    }),
    5
  );
  assert.equal(
    resolveReviveTarget({ directAdvanceCount: 24, idealPromoPool: 32, reviveTarget: 3 }),
    3
  );
  // 直晋 32 · ideal 48 · 池 26 → 出 16（淘 10）
  assert.equal(
    resolveReviveTarget({
      directAdvanceCount: 32,
      idealPromoPool: 48,
      reviveTarget: null,
      revivePoolSize: 26,
    }),
    16
  );
});

test("晋级全局取 8", () => {
  const ranked = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, score: 100 - i }));
  const keys = pickPromoToFinals(ranked, 8);
  assert.equal(keys.length, 8);
  assert.equal(keys[0], "k0");
  assert.equal(keys[7], "k7");
});

test("mergeBestScores 同 key 取高", () => {
  const m = mergeBestScores([
    { key: "浩辰", score: 100 },
    { key: "浩辰", score: 200 },
    { key: "狼辉", score: null },
    { key: "狼辉", score: 50 },
  ]);
  assert.deepEqual(
    m.map((r) => [r.key, r.score]),
    [
      ["浩辰", 200],
      ["狼辉", 50],
    ]
  );
});
