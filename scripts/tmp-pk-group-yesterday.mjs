import "dotenv/config";
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const db = require("../electron/db.js");
const { buildGroupSizes, canonicalName } = require("../electron/pk-group-engine.js");
const { renderPkGroupsPng } = require("../electron/pk-group-image.js");

const yesterday = "2026-07-29";
const text = fs.readFileSync(
  path.join("src/components/desktop/pk-roster-config.ts"),
  "utf8"
);
const m = text.match(/PRESET_ROSTER_TEXT = `([\s\S]*?)`;/);
const preset = m[1]
  .split(/\n/)
  .map((s) => s.trim())
  .filter(Boolean);
const want = new Set(preset.map((n) => canonicalName(n)));

const male = await db.getDailyWaveReport(yesterday, "male");
const female = await db.getDailyWaveReport(yesterday, "female");
const rows = [...(male.rows || []), ...(female.rows || [])];
const byName = new Map();
for (const r of rows) {
  const n = String(r.name || "").trim();
  if (!n) continue;
  const key = canonicalName(n);
  if (!want.has(key)) continue;
  const w = Number(r.dailyWave || 0);
  const prev = byName.get(key);
  if (!prev || w > prev.wave) byName.set(key, { name: n, wave: w, trimmedAvg: w });
}
for (const name of preset) {
  const key = canonicalName(name);
  if (!byName.has(key)) byName.set(key, { name, wave: 0, trimmedAvg: 0 });
}

const all = [...byName.values()].sort(
  (a, b) => b.wave - a.wave || a.name.localeCompare(b.name, "zh")
);
const specials = new Set(["浩阳", "浩沐", "啸泽", "啸帆"].map(canonicalName));
const sizes = buildGroupSizes(all.length, 8);
const n = sizes.length;

const fan = all.find((x) => canonicalName(x.name) === canonicalName("啸帆"));
const ze = all.find((x) => canonicalName(x.name) === canonicalName("啸泽"));
const yang = all.find((x) => canonicalName(x.name) === canonicalName("浩阳"));
const mu = all.find((x) => canonicalName(x.name) === canonicalName("浩沐"));
const rest = all.filter((x) => !specials.has(canonicalName(x.name)));

// 强制：啸帆第3、啸泽末、浩阳第1、浩沐末（阳沐间隔6≥4）
const slotSpecials = sizes.map(() => []);
slotSpecials[2].push(fan);
slotSpecials[n - 1].push(ze);
slotSpecials[0].push(yang);
slotSpecials[n - 1].push(mu);

const freeMembers = [...rest].sort((a, b) => b.wave - a.wave);
const capacity = sizes.map((sz, gi) => sz - slotSpecials[gi].length);
const rebuilt = sizes.map(() => []);
let fi = 0;
// 第4组先吃最强 free
while (rebuilt[3].length < capacity[3] && fi < freeMembers.length) {
  rebuilt[3].push(freeMembers[fi++]);
}
for (const gi of [0, 1, 2, 4, 5, 6]) {
  while (rebuilt[gi].length < capacity[gi] && fi < freeMembers.length) {
    rebuilt[gi].push(freeMembers[fi++]);
  }
}
while (fi < freeMembers.length) {
  let placed = false;
  for (let gi = 0; gi < n; gi++) {
    if (rebuilt[gi].length < capacity[gi]) {
      rebuilt[gi].push(freeMembers[fi++]);
      placed = true;
      break;
    }
  }
  if (!placed) rebuilt[n - 1].push(freeMembers[fi++]);
}

function top4sum(members) {
  return [...members]
    .sort((a, b) => b.wave - a.wave)
    .slice(0, 4)
    .reduce((s, m) => s + m.wave, 0);
}
function total(members) {
  return members.reduce((s, m) => s + m.wave, 0);
}
function orderMembers(gi, free) {
  // 组内：特殊四人前置，其余按昨天 wave 高→低
  const sp = slotSpecials[gi].slice().sort((a, b) => b.wave - a.wave);
  const fr = free.slice().sort((a, b) => b.wave - a.wave);
  return [...sp, ...fr];
}
function fmtWan(v) {
  const num = Number(v) || 0;
  if (num <= 0) return "0";
  const wan = num / 10_000;
  if (wan >= 10) return `${Math.round(wan)}万`;
  if (wan >= 1) {
    const r = Math.round(wan * 10) / 10;
    return Number.isInteger(r) ? `${r}万` : `${r.toFixed(1)}万`;
  }
  const r = Math.round(wan * 10) / 10;
  return `${r.toFixed(1)}万`;
}

const groups = rebuilt.map((free, slot) => {
  const members = orderMembers(slot, free);
  const t4 = top4sum(members);
  const avg = members.length ? total(members) / members.length : 0;
  const startMin = 8 * 60 + 15 + slot * 5;
  const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
  const mm = String(startMin % 60).padStart(2, "0");
  return {
    label: `第${slot + 1}组`,
    order: slot + 1,
    startTime: `${hh}:${mm}`,
    scheduleLabel: `${hh}:${mm} 开始连麦`,
    count: members.length,
    top4: Math.round(t4),
    average: Math.round(avg),
    members: members.map((mem, idx) => ({
      index: idx + 1,
      name: mem.name,
      wave: mem.wave,
      trimmedAvg: mem.wave,
      strength: mem.wave,
    })),
  };
});

const constraints = [
  "浩阳↔浩沐 间隔≥4 · 啸泽↔啸帆 间隔≥3",
  "啸帆第3组 / 啸泽末组 · 最强第4组",
  `口径：昨天日音浪 ${yesterday}`,
];

const result = {
  ok: true,
  mode: "high_to_low",
  modeLabel: "顺序分组",
  total: all.length,
  groupCount: n,
  sizes: groups.map((g) => g.count),
  strongestSlot: 4,
  strongestGroup: 4,
  constraints,
  groups,
};

const outDir = path.join("data", "runtime", "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(
  outDir,
  `星嗨争霸赛_顺序分组_昨天日音浪_${yesterday}.png`
);
const png = await renderPkGroupsPng(result, {
  period: "2026-07",
  title: "星嗨争霸赛 · 顺序分组",
  rosterSource: `昨天日音浪 ${yesterday} · 15号白名单`,
  constraints,
});
fs.writeFileSync(outFile, png);

console.log("WROTE", path.resolve(outFile), "bytes", png.length);
for (const g of groups) {
  console.log(
    `${g.label} · ${g.startTime} · ${g.count}人 · top4 ${fmtWan(g.top4)} · 均 ${fmtWan(g.average)}`
  );
  console.log(
    "  " + g.members.map((mem) => `${mem.name}(${fmtWan(mem.wave)})`).join(" · ")
  );
}
