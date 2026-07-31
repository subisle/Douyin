"use strict";

/**
 * 内置小组赛：按组输出成员「总分」排名文案。
 * 数据由调用方注入（name -> wave），本模块只做匹配/排序/格式化。
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
 *   groupNo 1-based；all=true 时 groupNo 为 null
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
  const first = String(meta.firstStart || "08:15");
  const step = Number(meta.stepMinutes) || 15;
  const parts = first.split(":").map((x) => Number(x));
  const h0 = Number.isFinite(parts[0]) ? parts[0] : 8;
  const m0 = Number.isFinite(parts[1]) ? parts[1] : 15;
  const total = h0 * 60 + m0 + (Math.max(1, groupNo) - 1) * step;
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
 * @param {number} groupNo 1-based
 * @param {Map<string, number> | Record<string, number> | Array<{name:string, wave?:number, totalWave?:number}>} waveSource
 */
function buildPresetGroupRank(groupNo, waveSource) {
  const names = getPresetGroupNames(groupNo);
  if (!names) {
    return {
      ok: false,
      error: `组号须为 1–${PRESET_BATTLE_GROUPS.length}`,
      groupNo,
    };
  }

  const waveMap = new Map();
  if (waveSource instanceof Map) {
    for (const [k, v] of waveSource) waveMap.set(String(k).trim(), Number(v) || 0);
  } else if (Array.isArray(waveSource)) {
    for (const row of waveSource) {
      const name = String(row?.name || row?.anchorName || "").trim();
      if (!name) continue;
      const wave = Number(row.wave ?? row.totalWave ?? row.monthlyWave) || 0;
      // 同名取较大值（防重复）
      waveMap.set(name, Math.max(waveMap.get(name) || 0, wave));
    }
  } else if (waveSource && typeof waveSource === "object") {
    for (const [k, v] of Object.entries(waveSource)) {
      waveMap.set(String(k).trim(), Number(v) || 0);
    }
  }

  const rows = [];
  const missing = [];
  for (const name of names) {
    if (waveMap.has(name)) {
      rows.push({ name, wave: Number(waveMap.get(name)) || 0 });
    } else {
      missing.push(name);
      rows.push({ name, wave: 0, missing: true });
    }
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
  };
}

/**
 * @param {object} rank buildPresetGroupRank 结果
 * @param {{ asOfDate?: string, namesOnly?: boolean }} [options]
 */
function formatPresetGroupRankText(rank, options = {}) {
  if (!rank?.ok) return rank?.error || "无法生成组内排名";
  const asOf = String(options.asOfDate || "").trim();
  const headerBits = [`第${rank.groupNo}组总分`, rank.startTime ? `· ${rank.startTime}` : null];
  if (asOf) headerBits.push(`· 截至 ${asOf}`);
  const lines = [headerBits.filter(Boolean).join(" ")];
  for (const row of rank.rows) {
    if (options.namesOnly) {
      lines.push(`${row.rank} ${row.name}`);
    } else {
      const waveText = row.missing && row.wave <= 0 ? "无数据" : formatWaveShort(row.wave);
      lines.push(`${row.rank} ${row.name} ${waveText}`);
    }
  }
  if (rank.missing?.length) {
    lines.push(`未匹配：${rank.missing.join("、")}`);
  }
  return lines.join("\n");
}

function formatAllPresetGroupRanksText(waveSource, options = {}) {
  const blocks = [];
  for (let groupNo = 1; groupNo <= PRESET_BATTLE_GROUPS.length; groupNo += 1) {
    const rank = buildPresetGroupRank(groupNo, waveSource);
    blocks.push(formatPresetGroupRankText(rank, options));
  }
  return blocks.join("\n\n");
}

module.exports = {
  CN_NUM,
  formatWaveShort,
  parseGroupNoToken,
  parsePresetGroupRankCommand,
  groupStartTime,
  getPresetGroupNames,
  buildPresetGroupRank,
  formatPresetGroupRankText,
  formatAllPresetGroupRanksText,
  PRESET_GROUP_COUNT: PRESET_BATTLE_GROUPS.length,
};
