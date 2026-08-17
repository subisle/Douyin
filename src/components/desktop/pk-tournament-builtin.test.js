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

test("815 唯一分组：8 组 58 人，每组 7–9，与赛程 meta 对齐", () => {
  assert.equal(PRESET_BATTLE_GROUPS.length, 8);
  const flat = PRESET_BATTLE_GROUPS.flat();
  assert.equal(flat.length, 58);
  assert.equal(new Set(flat).size, 58);
  assert.ok(PRESET_BATTLE_GROUPS.every((g) => g.length >= 7 && g.length <= 9));
  assert.deepEqual(
    PRESET_BATTLE_GROUPS.map((g) => g.length),
    [9, 7, 7, 7, 7, 7, 7, 7]
  );
  assert.equal(PRESET_BATTLE_META.label, "815");
  assert.equal(PRESET_BATTLE_META.firstStart, "12:15");
  assert.equal(PRESET_BATTLE_META.stepMinutes, 15);
  assert.equal(PRESET_BATTLE_META.periodHint, "2026-08");
});

test("815 规则：前四组→复活①→后四组→复活② → 直晋32 · 复活出16 · 晋级48（8×6）", () => {
  const rules = DEFAULT_TOURNAMENT_RULES;
  const sevenMode = resolveSevenPersonSplit({
    groupSizes: PRESET_BATTLE_GROUPS.map((g) => g.length),
    idealPromoPool: rules.idealPromoPool,
    sevenPersonSplit: rules.sevenPersonSplit,
  });
  assert.equal(sevenMode, "4-3");

  const settlePhase = (groups) => {
    let direct = 0;
    let revivePool = 0;
    for (const names of groups) {
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
      assert.equal(split.eliminated.length, 0);
    }
    const reviveGroupCount = resolveReviveGroupCount(revivePool);
    const reviveKeyGroups = splitIntoNGroups(
      Array.from({ length: revivePool }, (_, i) => `r${i + 1}`),
      reviveGroupCount
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
    return {
      direct,
      revivePool,
      reviveGroupCount,
      reviveKeySizes: reviveKeyGroups.map((g) => g.length),
      reviveAdvance,
      reviveElim,
    };
  };

  // 前四组（9,7,7,7）：直晋 16 · 复活池 14 → 2 组(7,7) 组内前4 → 出8 淘6
  const p1 = settlePhase(PRESET_BATTLE_GROUPS.slice(0, 4));
  assert.equal(p1.direct, 16);
  assert.equal(p1.revivePool, 14);
  assert.equal(p1.reviveGroupCount, 2);
  assert.deepEqual(p1.reviveKeySizes, [7, 7]);
  assert.equal(p1.reviveAdvance, 8);
  assert.equal(p1.reviveElim, 6);

  // 后四组（7,7,7,7）：直晋 16 · 复活池 12 → 2 组(6,6) 组内前4 → 出8 淘4
  const p2 = settlePhase(PRESET_BATTLE_GROUPS.slice(4));
  assert.equal(p2.direct, 16);
  assert.equal(p2.revivePool, 12);
  assert.equal(p2.reviveGroupCount, 2);
  assert.deepEqual(p2.reviveKeySizes, [6, 6]);
  assert.equal(p2.reviveAdvance, 8);
  assert.equal(p2.reviveElim, 4);

  // 晋级池 = 两半程直晋 32 + 两轮复活出线 16 = 48 = ideal，恰好 8 组各 6
  const promoPool = p1.direct + p2.direct + p1.reviveAdvance + p2.reviveAdvance;
  assert.equal(promoPool, 48);
  assert.equal(promoPool, rules.idealPromoPool);
  const promoGroups = splitIntoNGroups(
    Array.from({ length: promoPool }, (_, i) => `p${i + 1}`),
    PROMO_GROUP_COUNT
  );
  assert.equal(promoGroups.length, 8);
  assert.deepEqual(
    promoGroups.map((g) => g.length),
    [6, 6, 6, 6, 6, 6, 6, 6]
  );
});

test("815 规则 3-4 可调：扩大复活池", () => {
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
  // 1×9：前4复活5；7×7：3+4 → 直晋 25 · 复活 33
  assert.equal(direct, 7 * 3 + 4);
  assert.equal(direct, 25);
  assert.equal(revivePool, 7 * 4 + 5);
  assert.equal(revivePool, 33);
});

test("源码接线：store 导出 815 导入 · 前后半程复活 · 监控页按钮 · 按组人数切分", () => {
  const store = fs.readFileSync(path.join(root, "pk-tournament-store.ts"), "utf8");
  const page = fs.readFileSync(path.join(root, "pk-monitor-page.tsx"), "utf8");
  const stagePage = fs.readFileSync(path.join(root, "pk-group-stage-page.tsx"), "utf8");
  const roster = fs.readFileSync(path.join(root, "pk-roster-config.ts"), "utf8");
  const rulesSrc = fs.readFileSync(path.join(root, "pk-tournament-rules.ts"), "utf8");

  assert.match(store, /export function importGroupStageFromBuiltIn/);
  assert.match(store, /PRESET_BATTLE_GROUPS/);
  assert.match(store, /BUILTIN_GROUP_STAGE_PRESET_NAME = "815"/);
  assert.match(store, /resolveGroupTopRevive/);
  assert.match(store, /resolveSevenPersonSplit/);
  assert.match(store, /BUILTIN_BATTLE_META/);
  assert.match(store, /splitIntoNGroups|nameGroupsSplitN|PROMO_GROUP_COUNT/);
  assert.match(store, /splitReviveGroupAdvance|resolveReviveGroupTop|resolveReviveGroupCount/);
  assert.doesNotMatch(store, /PRESET_BATTLE_META\.periodHint/);

  // 前后半程流程：小组赛①→复活①→小组赛②→复活②→晋级赛
  assert.match(store, /export function settleGroupStage/);
  assert.match(store, /export function settleReviveStage/);
  assert.match(store, /flow: TournamentFlow/);
  assert.match(store, /groupPhase: 1 \| 2/);
  assert.match(store, /revivePhase: 1 \| 2/);
  assert.match(store, /promoPool: string\[\]/);
  assert.match(store, /export function currentGroupPhase/);
  assert.match(store, /export function groupPhaseBoundary/);
  assert.match(store, /export function isGroupPhaseFullyScored/);
  assert.match(store, /export function isStageFullyScoredForTournament/);
  assert.match(store, /export function stageTabLabel/);
  assert.match(store, /小组赛①|小组赛②|前四组|后四组/);

  assert.match(page, /importGroupStageFromBuiltIn/);
  assert.match(page, /导入 815 分组/);
  assert.match(page, /handleImportBuiltIn/);
  assert.match(page, /isStageFullyScoredForTournament/);
  assert.match(page, /stageTabLabel/);

  assert.match(stagePage, /stageTabLabel/);
  assert.match(stagePage, /currentGroupPhase/);
  assert.match(stagePage, /groupPhaseBoundary/);
  assert.match(stagePage, /前四组/);
  assert.match(stagePage, /后四组/);

  assert.match(roster, /export const PRESET_BATTLE_META/);
  assert.match(roster, /BUILTIN_GROUP_PRESET_NAME = "815"/);
  // 晋级赛内置分组：store 导入 + roster 导出
  assert.match(store, /export function importPromoFromBuiltIn/);
  assert.match(store, /PRESET_PROMO_GROUPS/);
  assert.match(store, /BUILTIN_PROMO_PRESET_NAME/);
  assert.match(roster, /export const PRESET_PROMO_GROUPS/);
  assert.match(roster, /BUILTIN_PROMO_PRESET_NAME = "晋级赛-815"/);
  assert.match(roster, /export function getBuiltInPromoNameGroups/);
  assert.doesNotMatch(roster, /syncBuiltInPromoGroupsToPkStorage/);
  assert.match(stagePage, /importPromoFromBuiltIn/);
  assert.match(stagePage, /加载晋级赛分组/);
  assert.match(rulesSrc, /export function resolveGroupTopRevive/);
  assert.match(rulesSrc, /export function splitIntoNGroups/);
  assert.match(rulesSrc, /export function splitReviveGroupAdvance/);
  assert.match(rulesSrc, /PROMO_GROUP_COUNT = 8/);
  assert.match(rulesSrc, /REVIVE_GROUP_TOP = 4/);
  assert.match(rulesSrc, /idealPromoPool: 48/);
  assert.match(rulesSrc, /PROMO_GROUP_MIN = 6/);
});
