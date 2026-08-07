"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_META,
} = require("../../../shared/pk-preset-battle-groups.js");
const {
  splitGroupAdvanceRevive,
  resolveGroupTopRevive,
  resolveReviveTarget,
  resolveSevenPersonSplit,
  resolveReviveGroupCount,
  resolveReviveGroupTop,
  splitReviveGroupAdvance,
  chunkKeys,
  splitIntoNGroups,
  resolvePromoPoolTarget,
  DEFAULT_TOURNAMENT_RULES,
  PROMO_GROUP_COUNT,
  PROMO_POOL_MIN,
  PROMO_POOL_MAX,
  REVIVE_GROUP_TOP,
} = require("./pk-tournament-rules.ts");

const root = path.join(__dirname);

test("内置表：8 组 58 人，每组 7–8，与赛程 meta 对齐", () => {
  assert.equal(PRESET_BATTLE_GROUPS.length, 8);
  const flat = PRESET_BATTLE_GROUPS.flat();
  assert.equal(flat.length, 58);
  assert.equal(new Set(flat).size, 58);
  assert.ok(PRESET_BATTLE_GROUPS.every((g) => g.length >= 7 && g.length <= 8));
  assert.deepEqual(
    PRESET_BATTLE_GROUPS.map((g) => g.length),
    [7, 7, 7, 8, 7, 8, 7, 7]
  );
  assert.equal(PRESET_BATTLE_META.firstStart, "08:15");
  assert.equal(PRESET_BATTLE_META.stepMinutes, 15);
  assert.equal(PRESET_BATTLE_META.periodHint, "2026-08");
});

test("新规则：8人前4后4 · 7人前4后3 → 直晋32 · 复活出16淘10 · 晋级48", () => {
  const rules = DEFAULT_TOURNAMENT_RULES;
  const sevenMode = resolveSevenPersonSplit({
    groupSizes: PRESET_BATTLE_GROUPS.map((g) => g.length),
    idealPromoPool: rules.idealPromoPool,
    sevenPersonSplit: rules.sevenPersonSplit,
  });
  assert.equal(sevenMode, "4-3");

  let direct = 0;
  let revivePool = 0;
  let eliminated = 0;
  for (const names of PRESET_BATTLE_GROUPS) {
    const ranked = names.map((name, i) => ({
      key: name,
      score: (names.length - i) * 1000,
    }));
    const { top, reviveTail } = resolveGroupTopRevive(names.length, {
      sevenPersonSplit: sevenMode,
    });
    const split = splitGroupAdvanceRevive(ranked, top, reviveTail);
    direct += split.advance.length;
    revivePool += split.revive.length;
    eliminated += split.eliminated.length;
  }

  // 6×7：各 4 直晋 + 3 复活；2×8：各 4 直晋 + 4 复活 → 直晋 32 · 复活 26 · 小组淘 0
  assert.equal(direct, 32);
  assert.equal(revivePool, 6 * 3 + 2 * 4); // 26
  assert.equal(eliminated, 0);

  // ideal=48 与组内前4 一致：复活 26 → 4 组均分，每组前4 → 出16淘10
  const reviveOut = resolveReviveTarget({
    directAdvanceCount: direct,
    idealPromoPool: rules.idealPromoPool,
    reviveTarget: rules.reviveTarget,
    revivePoolSize: revivePool,
  });
  assert.equal(reviveOut, 16);
  assert.equal(revivePool - reviveOut, 10);

  // 复活分组：26 人 → 4 组 · 组内前 4 晋
  assert.equal(REVIVE_GROUP_TOP, 4);
  const reviveGroupCount = resolveReviveGroupCount(revivePool);
  assert.equal(reviveGroupCount, 4);
  const reviveKeyGroups = splitIntoNGroups(
    Array.from({ length: revivePool }, (_, i) => `r${i + 1}`),
    reviveGroupCount
  );
  assert.deepEqual(
    reviveKeyGroups.map((g) => g.length),
    [7, 7, 6, 6]
  );
  let reviveAdvance = 0;
  let reviveElim = 0;
  for (const chunk of reviveKeyGroups) {
    const ranked = chunk.map((key, i) => ({
      key,
      score: (chunk.length - i) * 100,
    }));
    const top = resolveReviveGroupTop(chunk.length);
    const split = splitReviveGroupAdvance(ranked, top);
    reviveAdvance += split.advance.length;
    reviveElim += split.eliminated.length;
  }
  assert.equal(reviveAdvance, 16);
  assert.equal(reviveElim, 10);

  const promoTotal = direct + reviveAdvance;
  assert.equal(promoTotal, 48);
  assert.ok(promoTotal >= PROMO_POOL_MIN && promoTotal <= PROMO_POOL_MAX);

  // 晋级：固定 8 组均分，每组 6
  const promoGroups = splitIntoNGroups(
    Array.from({ length: promoTotal }, (_, i) => `p${i + 1}`),
    PROMO_GROUP_COUNT
  );
  assert.equal(promoGroups.length, 8);
  assert.ok(promoGroups.every((g) => g.length === 6));
  assert.deepEqual(
    promoGroups.map((g) => g.length),
    [6, 6, 6, 6, 6, 6, 6, 6]
  );

  assert.equal(
    resolvePromoPoolTarget({
      directAdvanceCount: direct,
      revivePoolSize: revivePool,
      idealPromoPool: rules.idealPromoPool,
    }),
    48
  );
});

test("7 人可调前3后4：扩大复活池", () => {
  let direct = 0;
  let revivePool = 0;
  for (const names of PRESET_BATTLE_GROUPS) {
    const ranked = names.map((name, i) => ({
      key: name,
      score: (names.length - i) * 1000,
    }));
    const { top, reviveTail } = resolveGroupTopRevive(names.length, {
      sevenPersonSplit: "3-4",
    });
    const split = splitGroupAdvanceRevive(ranked, top, reviveTail);
    direct += split.advance.length;
    revivePool += split.revive.length;
  }
  // 6×7：3+4；2×8：4+4 → 直晋 26 · 复活 32
  assert.equal(direct, 6 * 3 + 2 * 4);
  assert.equal(direct, 26);
  assert.equal(revivePool, 6 * 4 + 2 * 4);
  assert.equal(revivePool, 32);
});

test("源码接线：store 导出内置导入 · 监控页按钮 · 按组人数切分", () => {
  const store = fs.readFileSync(path.join(root, "pk-tournament-store.ts"), "utf8");
  const page = fs.readFileSync(path.join(root, "pk-monitor-page.tsx"), "utf8");
  const roster = fs.readFileSync(path.join(root, "pk-roster-config.ts"), "utf8");
  const rulesSrc = fs.readFileSync(path.join(root, "pk-tournament-rules.ts"), "utf8");

  assert.match(store, /export function importGroupStageFromBuiltIn/);
  assert.match(store, /PRESET_BATTLE_GROUPS/);
  assert.match(store, /BUILTIN_GROUP_STAGE_PRESET_NAME = "小组赛"/);
  assert.match(store, /resolveGroupTopRevive/);
  assert.match(store, /resolveSevenPersonSplit/);
  assert.match(store, /BUILTIN_BATTLE_META/);
  assert.match(store, /splitIntoNGroups|nameGroupsSplitN|PROMO_GROUP_COUNT/);
  assert.match(store, /splitReviveGroupAdvance|resolveReviveGroupTop|resolveReviveGroupCount/);
  assert.doesNotMatch(store, /PRESET_BATTLE_META\.periodHint/);

  assert.match(page, /importGroupStageFromBuiltIn/);
  assert.match(page, /导入内置小组赛/);
  assert.match(page, /handleImportBuiltIn/);

  assert.match(roster, /export const PRESET_BATTLE_META/);
  assert.match(roster, /export const PRESET_PROMO_GROUPS/);
  assert.match(roster, /export const BUILTIN_PROMO_PRESET_NAME = "晋级赛"/);
  assert.match(roster, /syncBuiltInPromoGroupsToPkStorage/);
  assert.match(rulesSrc, /export function resolveGroupTopRevive/);
  assert.match(rulesSrc, /export function splitIntoNGroups/);
  assert.match(rulesSrc, /export function splitReviveGroupAdvance/);
  assert.match(rulesSrc, /PROMO_GROUP_COUNT = 8/);
  assert.match(rulesSrc, /REVIVE_GROUP_TOP = 4/);
  assert.match(rulesSrc, /idealPromoPool: 48/);
  assert.match(rulesSrc, /PROMO_GROUP_MIN = 6/);
});
