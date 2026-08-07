"use strict";

const DEFAULT_MIN_GAP = 3;
/** 浩阳↔浩沐 单独更严：间隔 ≥4 组 */
const YANG_MU_MIN_GAP = 4;

/**
 * 默认间隔硬约束（组序号差 |giA-giB| ≥ minGap）
 * - 啸泽↔啸帆 ≥3
 * - 玖依↔狼影 ≥3
 * - 狼九↔狼裕 ≥3
 * - 浩阳↔浩沐 ≥4（名单同时含二者时生效）
 */
const DEFAULT_GAP_PAIRS = [
  { a: "浩阳", b: "浩沐", minGap: YANG_MU_MIN_GAP },
  { a: "啸泽", b: "啸帆", minGap: DEFAULT_MIN_GAP },
  { a: "玖依", b: "狼影", minGap: DEFAULT_MIN_GAP },
  { a: "狼九", b: "狼裕", minGap: DEFAULT_MIN_GAP },
];

const NAME_ALIASES = {
  辰辰: "浩辰",
  阿楠: "南方楠",
  狼宝: "狼小宝",
  玖月: "玖玥",
  农村小胖孩: "狼轩",
};

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function canonicalName(value) {
  const key = normalizeName(value);
  return NAME_ALIASES[key] || key;
}

/** 归一化 gap 对：统一成 {a,b,minGap}[] */
function normalizeGapPairs(rawPairs, fallbackMinGap = DEFAULT_MIN_GAP) {
  const list = Array.isArray(rawPairs) && rawPairs.length ? rawPairs : DEFAULT_GAP_PAIRS;
  return list
    .map((item) => {
      if (Array.isArray(item)) {
        const [a, b, g] = item;
        return {
          a: String(a || "").trim(),
          b: String(b || "").trim(),
          minGap: Math.max(1, Number(g) || fallbackMinGap),
        };
      }
      if (item && typeof item === "object") {
        return {
          a: String(item.a || item[0] || "").trim(),
          b: String(item.b || item[1] || "").trim(),
          minGap: Math.max(1, Number(item.minGap ?? item.gap) || fallbackMinGap),
        };
      }
      return null;
    })
    .filter((p) => p && p.a && p.b);
}

/**
 * 校验分组结果是否满足 gap 对。
 * 任一方不在名单/分组中 → 跳过该对（不视为违规；约束仅在双方都在时生效）。
 * @param {Array<{ members: Array<{ name: string }> }>} groups 按出场序排列
 * @param {unknown} [gapPairs]
 * @returns {{ ok: boolean, violations: Array<object> }}
 */
function validateGroupsGap(groups, gapPairs) {
  const list = Array.isArray(groups) ? groups : [];
  const pairs = normalizeGapPairs(gapPairs);
  const violations = [];
  const findIndex = (name) => {
    const key = canonicalName(name);
    return list.findIndex((g) => {
      const members = g.members || g;
      if (!Array.isArray(members)) return false;
      return members.some((m) => {
        if (typeof m === "string") return canonicalName(m) === key;
        return canonicalName(m?.name) === key;
      });
    });
  };
  for (const { a, b, minGap } of pairs) {
    const giA = findIndex(a);
    const giB = findIndex(b);
    // 缺一方：本对不适用
    if (giA < 0 || giB < 0) continue;
    const actual = Math.abs(giA - giB);
    if (actual < minGap) {
      violations.push({
        a,
        b,
        minGap,
        reason: "gap",
        actual,
        giA,
        giB,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

function formatGapViolation(v) {
  if (!v) return "间隔约束不满足";
  if (v.reason === "missing") return `名单中缺少 ${v.a} 或 ${v.b}`;
  return `${v.a}↔${v.b} 间隔 ${v.actual} 组（要求≥${v.minGap}）`;
}

/**
 * 只保留双方都在 nameSet 中的 gap 对。
 * @param {unknown} rawPairs
 * @param {Iterable<string>} memberNames
 * @param {number} [fallbackMinGap]
 */
function filterGapPairsForMembers(rawPairs, memberNames, fallbackMinGap = DEFAULT_MIN_GAP) {
  const nameSet = new Set(
    [...(memberNames || [])].map((n) => canonicalName(n)).filter(Boolean)
  );
  return normalizeGapPairs(rawPairs, fallbackMinGap).filter(
    (p) => nameSet.has(canonicalName(p.a)) && nameSet.has(canonicalName(p.b))
  );
}

module.exports = {
  DEFAULT_MIN_GAP,
  YANG_MU_MIN_GAP,
  DEFAULT_GAP_PAIRS,
  NAME_ALIASES,
  normalizeName,
  canonicalName,
  normalizeGapPairs,
  filterGapPairsForMembers,
  validateGroupsGap,
  formatGapViolation,
};
