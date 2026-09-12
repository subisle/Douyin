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
  PROMO_GROUP_MIN,
  PROMO_GROUP_MAX,
  PROMO_POOL_MIN,
  PROMO_POOL_MAX,
  REVIVE_GROUP_TOP,
} = require("./pk-tournament-rules.ts");

const root = path.join(__dirname);

// 815 分组规模以 shared 预设为准（勿硬编码具体人数，名单调整时本用例仍成立）
test("815 唯一分组：8 组，无重复，每组 7–9，与赛程 meta 对齐", () => {
  assert.equal(PRESET_BATTLE_GROUPS.length, 8);
  const flat = PRESET_BATTLE_GROUPS.flat();
  assert.equal(new Set(flat).size, flat.length, "名单无重复");
  assert.ok(PRESET_BATTLE_GROUPS.every((g) => g.length >= 7 && g.length <= 9));
  assert.equal(PRESET_BATTLE_META.label, "815");
  assert.equal(PRESET_BATTLE_META.firstStart, "20:15");
  assert.equal(PRESET_BATTLE_META.stepMinutes, 15);
  assert.equal(PRESET_BATTLE_META.periodHint, "2026-08");
  // meta.notes 里的规模描述应与实际分组一致
  assert.ok(
    PRESET_BATTLE_META.notes.some((n) => n.includes(`${flat.length} 人`)),
    `notes 应写明 ${flat.length} 人，实际 ${PRESET_BATTLE_META.notes.join(" / ")}`
  );
});

test("815 规则：前四组→复活①→后四组→复活② → 晋级池落在 8 组 × 6–8", () => {
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

  // 期望值按规则从共享预设动态推导（名单规模调整时自动跟随，勿硬编码人数）
  const expectPhase = (groups) => {
    let direct = 0;
    let revivePool = 0;
    for (const names of groups) {
      const { top, reviveTail } = resolveGroupTopRevive(names.length, {
        sevenPersonSplit: sevenMode,
      });
      direct += top;
      revivePool += reviveTail;
    }
    return { direct, revivePool };
  };

  // 前四组 → 复活①
  const head = PRESET_BATTLE_GROUPS.slice(0, 4);
  const e1 = expectPhase(head);
  const p1 = settlePhase(head);
  assert.deepEqual(
    { direct: p1.direct, revivePool: p1.revivePool },
    { direct: e1.direct, revivePool: e1.revivePool }
  );
  assert.equal(p1.direct + p1.revivePool, head.flat().length, "前半程小组赛零淘汰");
  assert.equal(p1.reviveAdvance + p1.reviveElim, p1.revivePool, "复活①出线+淘汰=复活池");

  // 后四组 → 复活②
  const tail = PRESET_BATTLE_GROUPS.slice(4);
  const e2 = expectPhase(tail);
  const p2 = settlePhase(tail);
  assert.deepEqual(
    { direct: p2.direct, revivePool: p2.revivePool },
    { direct: e2.direct, revivePool: e2.revivePool }
  );
  assert.equal(p2.direct + p2.revivePool, tail.flat().length, "后半程小组赛零淘汰");
  assert.equal(p2.reviveAdvance + p2.reviveElim, p2.revivePool, "复活②出线+淘汰=复活池");

  // 晋级池 = 两半程直晋 + 两轮复活出线，须能均分成 8 组（每组 6–8）
  const promoPool = p1.direct + p2.direct + p1.reviveAdvance + p2.reviveAdvance;
  assert.ok(
    promoPool >= PROMO_POOL_MIN && promoPool <= PROMO_POOL_MAX,
    `晋级池 ${promoPool} 应落在 ${PROMO_POOL_MIN}–${PROMO_POOL_MAX}`
  );
  const promoGroups = splitIntoNGroups(
    Array.from({ length: promoPool }, (_, i) => `p${i + 1}`),
    PROMO_GROUP_COUNT
  );
  assert.equal(promoGroups.length, PROMO_GROUP_COUNT);
  const promoSizes = promoGroups.map((g) => g.length);
  assert.ok(
    Math.max(...promoSizes) - Math.min(...promoSizes) <= 1,
    `晋级组规模应均分，实际 ${promoSizes.join("+")}`
  );
  assert.ok(
    promoSizes.every((n) => n >= PROMO_GROUP_MIN && n <= PROMO_GROUP_MAX),
    `每组应 ${PROMO_GROUP_MIN}–${PROMO_GROUP_MAX} 人，实际 ${promoSizes.join("+")}`
  );
});

test("815 规则 3-4 可调：扩大复活池", () => {
  const total = PRESET_BATTLE_GROUPS.flat().length;
  const settle = (mode) => {
    let direct = 0;
    let revivePool = 0;
    for (const names of PRESET_BATTLE_GROUPS) {
      const ranked = names.map((name, i) => ({
        key: name,
        score: (names.length - i) * 1000,
      }));
      const { top, reviveTail } = resolveGroupTopRevive(names.length, {
        sevenPersonSplit: mode,
      });
      const split = splitGroupAdvanceRevive(ranked, top, reviveTail);
      direct += split.advance.length;
      revivePool += split.revive.length;
      assert.equal(split.eliminated.length, 0, "小组赛零淘汰");
    }
    return { direct, revivePool };
  };

  const wide = settle("3-4");
  const tight = settle("4-3");
  assert.equal(wide.direct + wide.revivePool, total, "3-4 仍覆盖全员");
  assert.equal(tight.direct + tight.revivePool, total, "4-3 仍覆盖全员");
  // 业务意义：3-4 把 7 人组的复活尾由 3 扩到 4，复活池变大、直晋变少
  assert.ok(
    wide.revivePool > tight.revivePool,
    `3-4 复活池 ${wide.revivePool} 应大于 4-3 的 ${tight.revivePool}`
  );
  assert.ok(
    wide.direct < tight.direct,
    `3-4 直晋 ${wide.direct} 应少于 4-3 的 ${tight.direct}`
  );
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
