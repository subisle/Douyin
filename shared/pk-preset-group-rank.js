"use strict";

/**
 * 815 唯一分组：按组输出成员「总分」排名文案。
 * 数据由调用方注入（花名册/日报），本模块做匹配、全库名次、动态档位分差与格式化。
 * 档位：前10 / 前20 / 前30 / 前50 / 前100（按名次就近展示，避免全员都写前20）。
 */

const {
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_META,
} = require("./pk-preset-battle-groups");

const CN_NUM = Object.freeze({
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
});

const MILESTONE_TIERS = Object.freeze([10, 20, 30, 50, 100]);
/** @deprecated 兼容旧调用；实际展示用 pickDisplayGapPlaces 按名次挑选 */
const DEFAULT_GAP_TARGETS = MILESTONE_TIERS;

function formatWaveShort(value) {
  const number = Number(value) || 0;
  if (number <= 0) return "0";
  if (number >= 100_000_000) {
    const yi = number / 100_000_000;
    const r = Math.round(yi * 10) / 10;
    return Number.isInteger(r) ? `${r}亿` : `${r.toFixed(1)}亿`;
  }
  const wan = number / 10_000;
  const r = Math.round(wan * 10) / 10;
  if (r <= 0) return "0";
  return Number.isInteger(r) ? `${r}万` : `${r.toFixed(1)}万`;
}

function parseGroupNoToken(raw) {
  const key = String(raw || "").trim();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(CN_NUM, key)) return CN_NUM[key];
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= PRESET_BATTLE_GROUPS.length) return n;
  return null;
}

/**
 * 解析「5组 / 第5组总分 / 各组排名」等。
 * @returns {{ type: "preset-group-rank", groupNo: number|null, all: boolean } | null}
 */
function parsePresetGroupRankCommand(input) {
  const text = String(input || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .replace(/[。！!，,；;]+$/g, "")
    .trim();
  if (!text) return null;

  if (/^(?:各组|全部组|全部小组|七组全部|所有组)(?:\s*(?:的)?\s*(?:总分|排名|总分排名|音浪排名|总分榜))?$/.test(text)) {
    return { type: "preset-group-rank", groupNo: null, all: true };
  }

  const m =
    text.match(/^(?:第)?([1-7一二三四五六七])\s*组(?:\s*(?:的)?\s*(?:总分|排名|总分排名|音浪排名|总分榜))?$/) ||
    text.match(/^组\s*([1-7一二三四五六七])(?:\s*(?:的)?\s*(?:总分|排名|总分排名|音浪排名|总分榜))?$/);
  if (!m) return null;
  const groupNo = parseGroupNoToken(m[1]);
  if (!groupNo) return null;
  return { type: "preset-group-rank", groupNo, all: false };
}

function groupStartTime(groupNo) {
  const meta = PRESET_BATTLE_META || {};
  const first = String(meta.firstStart || "12:15");
  const step = Number(meta.stepMinutes) || 15;
  const extra = Number(meta.reviveExtraMinutes) || 0;
  const parts = first.split(":").map((x) => Number(x));
  const h0 = Number.isFinite(parts[0]) ? parts[0] : 8;
  const m0 = Number.isFinite(parts[1]) ? parts[1] : 15;
  // 第4组后插入复活赛：第5组及后续组顺延 extra 分钟
  const total =
    h0 * 60 +
    m0 +
    (Math.max(1, groupNo) - 1) * step +
    (groupNo >= 5 ? extra : 0);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function getPresetGroupNames(groupNo) {
  const idx = Number(groupNo) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= PRESET_BATTLE_GROUPS.length) return null;
  return PRESET_BATTLE_GROUPS[idx].map((n) => String(n).trim()).filter(Boolean);
}

/**
 * 将花名册/Map/对象规范为 name->wave（同名取较大值）。
 * @returns {Map<string, number>}
 */
function toWaveMap(waveSource) {
  const waveMap = new Map();
  if (waveSource instanceof Map) {
    for (const [k, v] of waveSource) {
      const name = String(k).trim();
      if (!name) continue;
      waveMap.set(name, Math.max(waveMap.get(name) || 0, Number(v) || 0));
    }
    return waveMap;
  }
  if (Array.isArray(waveSource)) {
    for (const row of waveSource) {
      const name = String(row?.name || row?.anchorName || "").trim();
      if (!name) continue;
      const wave = Number(row.wave ?? row.totalWave ?? row.monthlyWave) || 0;
      waveMap.set(name, Math.max(waveMap.get(name) || 0, wave));
    }
    return waveMap;
  }
  if (waveSource && typeof waveSource === "object") {
    for (const [k, v] of Object.entries(waveSource)) {
      const name = String(k).trim();
      if (!name) continue;
      waveMap.set(name, Math.max(waveMap.get(name) || 0, Number(v) || 0));
    }
  }
  return waveMap;
}

/**
 * 全库（或当前数据源）按总分降序排行榜。
 * @returns {{ board: Array<{name:string,wave:number,overallRank:number}>, byName: Map<string, any>, thresholds: Record<number, number> }}
 */
function buildOverallLeaderboard(waveSource, gapTargets = DEFAULT_GAP_TARGETS) {
  const waveMap = toWaveMap(waveSource);
  const board = [...waveMap.entries()]
    .map(([name, wave]) => ({ name, wave: Number(wave) || 0 }))
    .sort((a, b) => b.wave - a.wave || a.name.localeCompare(b.name, "zh"));
  board.forEach((row, index) => {
    row.overallRank = index + 1;
  });
  const byName = new Map(board.map((row) => [row.name, row]));
  const thresholds = {};
  for (const place of gapTargets) {
    const n = Number(place);
    if (!Number.isInteger(n) || n <= 0) continue;
    thresholds[n] = board[n - 1] ? Number(board[n - 1].wave) || 0 : 0;
  }
  return { board, byName, thresholds, total: board.length };
}

/**
 * 进入前 N 还差多少分：已在榜内为 0；否则 = 第N名分数 - 本人分数（至少 0）。
 */
function gapToPlace(wave, overallRank, place, thresholdWave) {
  const rank = Number(overallRank) || 0;
  const target = Number(place) || 0;
  if (!target || (rank > 0 && rank <= target)) return 0;
  return Math.max(0, (Number(thresholdWave) || 0) - (Number(wave) || 0));
}

/**
 * @param {number} groupNo 1-based
 * @param {Map|Record|Array} waveSource 全量花名册更佳（用于全库名次/阈值）
 * @param {{ gapTargets?: number[] }} [options]
 */
function buildPresetGroupRank(groupNo, waveSource, options = {}) {
  const names = getPresetGroupNames(groupNo);
  if (!names) {
    return {
      ok: false,
      error: `组号须为 1–${PRESET_BATTLE_GROUPS.length}`,
      groupNo,
    };
  }

  const gapTargets = Array.isArray(options.gapTargets) && options.gapTargets.length
    ? options.gapTargets.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    : [...DEFAULT_GAP_TARGETS];

  const { byName, thresholds, total } = buildOverallLeaderboard(waveSource, gapTargets);
  const waveMap = toWaveMap(waveSource);

  const rows = [];
  const missing = [];
  for (const name of names) {
    if (!waveMap.has(name) && !byName.has(name)) {
      missing.push(name);
      rows.push({
        name,
        wave: 0,
        missing: true,
        overallRank: null,
        gapTop10: null,
        gapTop20: null,
        gaps: {},
      });
      continue;
    }
    const wave = Number(waveMap.get(name) ?? byName.get(name)?.wave) || 0;
    const overall = byName.get(name);
    const overallRank = overall?.overallRank || null;
    const gaps = {};
    for (const place of gapTargets) {
      gaps[place] = gapToPlace(wave, overallRank, place, thresholds[place]);
    }
    rows.push({
      name,
      wave,
      missing: false,
      overallRank,
      gapTop10: gaps[10] ?? null,
      gapTop20: gaps[20] ?? null,
      gaps,
    });
  }

  rows.sort(
    (a, b) =>
      b.wave - a.wave ||
      Number(Boolean(a.missing)) - Number(Boolean(b.missing)) ||
      a.name.localeCompare(b.name, "zh")
  );
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return {
    ok: true,
    groupNo: Number(groupNo),
    startTime: groupStartTime(groupNo),
    names,
    rows,
    missing,
    overallTotal: total,
    thresholds: {
      top10: thresholds[10] ?? 0,
      top20: thresholds[20] ?? 0,
      ...thresholds,
    },
    gapTargets,
  };
}

/**
 * 按总榜名次挑选要展示的档位（就近，不全员死写前20）。
 * - #8  → 前10
 * - #15 → 前10 + 前20（已进前20）
 * - #28 → 前10 + 前20
 * - #35 → 前10 + 前30
 * - #55 → 前10 + 前50
 * - #120 → 前10 + 前100
 * @param {number|null} overallRank
 * @param {number[]} [tiers]
 * @returns {number[]}
 */
function pickDisplayGapPlaces(overallRank, tiers = MILESTONE_TIERS) {
  const rank = Number(overallRank) || 0;
  const list = (Array.isArray(tiers) && tiers.length ? tiers : MILESTONE_TIERS)
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  if (!rank) return list.slice(0, 2);
  if (rank <= 10) return [10];

  // 最近未进入的档：最大的 t < rank（且 rank > t）
  let nearest = list[0] || 10;
  for (const t of list) {
    if (rank > t) nearest = t;
  }

  const places = [10];
  if (nearest !== 10) places.push(nearest);
  // 仅掉出前10、仍在前20内：补「已进前20」
  if (nearest === 10) {
    const nextInside = list.find((t) => t > 10 && rank <= t);
    if (nextInside) places.push(nextInside);
  }
  return places;
}

/**
 * 单行附加信息：全库名次 + 动态档位分差
 * 例：#28 距前10差12.3万 距前20差3.1万
 *     #8 已进前10
 *     #15 距前10差2.0万 已进前20
 *     #55 距前10差x 距前50差y
 */
function formatGapSuffix(row, gapTargets = MILESTONE_TIERS) {
  if (row?.missing) return "无数据";
  const rank = Number(row.overallRank) || 0;
  if (rank > 0 && rank <= 10) {
    return `#${rank} 已进前10`;
  }

  const allTargets = (Array.isArray(gapTargets) && gapTargets.length ? gapTargets : MILESTONE_TIERS)
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  const targets = pickDisplayGapPlaces(rank || null, allTargets);

  const out = [];
  if (rank) out.push(`#${rank}`);
  for (const place of targets) {
    const gap = row.gaps?.[place];
    if (gap == null && !(rank && rank <= place)) continue;
    if (rank && rank <= place) {
      if (place !== 10) out.push(`已进前${place}`);
    } else {
      out.push(`距前${place}差${formatWaveShort(gap)}`);
    }
  }
  return out.join(" ");
}

/**
 * @param {object} rank buildPresetGroupRank 结果
 * @param {{ asOfDate?: string, namesOnly?: boolean, showGaps?: boolean }} [options]
 */
function formatPresetGroupRankText(rank, options = {}) {
  if (!rank?.ok) return rank?.error || "无法生成组内排名";
  const asOf = String(options.asOfDate || "").trim();
  const showGaps = options.showGaps !== false;
  const headerBits = [`第${rank.groupNo}组总分`, rank.startTime ? `· ${rank.startTime}` : null];
  if (asOf) headerBits.push(`· 截至 ${asOf}`);
  const lines = [headerBits.filter(Boolean).join(" ")];
  for (const row of rank.rows) {
    if (options.namesOnly) {
      lines.push(`${row.rank} ${row.name}`);
      continue;
    }
    const waveText = row.missing && row.wave <= 0 ? "无数据" : formatWaveShort(row.wave);
    if (!showGaps || row.missing) {
      lines.push(`${row.rank} ${row.name} ${waveText}`);
      continue;
    }
    const suffix = formatGapSuffix(row, rank.gapTargets || DEFAULT_GAP_TARGETS);
    lines.push(`${row.rank} ${row.name} ${waveText}（${suffix}）`);
  }
  if (rank.missing?.length) {
    lines.push(`未匹配：${rank.missing.join("、")}`);
  }
  return lines.join("\n");
}

function formatAllPresetGroupRanksText(waveSource, options = {}) {
  const blocks = [];
  for (let groupNo = 1; groupNo <= PRESET_BATTLE_GROUPS.length; groupNo += 1) {
    const rank = buildPresetGroupRank(groupNo, waveSource, options);
    blocks.push(formatPresetGroupRankText(rank, options));
  }
  return blocks.join("\n\n");
}

module.exports = {
  CN_NUM,
  MILESTONE_TIERS,
  DEFAULT_GAP_TARGETS,
  formatWaveShort,
  parseGroupNoToken,
  parsePresetGroupRankCommand,
  groupStartTime,
  getPresetGroupNames,
  toWaveMap,
  buildOverallLeaderboard,
  gapToPlace,
  pickDisplayGapPlaces,
  buildPresetGroupRank,
  formatGapSuffix,
  formatPresetGroupRankText,
  formatAllPresetGroupRanksText,
  PRESET_GROUP_COUNT: PRESET_BATTLE_GROUPS.length,
};
