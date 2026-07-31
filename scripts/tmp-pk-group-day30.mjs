import "dotenv/config";
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const db = require("../electron/db.js");
const { buildGroupSizes, canonicalName } = require("../electron/pk-group-engine.js");
const { renderPkGroupsPng } = require("../electron/pk-group-image.js");

const day = "2026-07-30";
const text = fs.readFileSync(
  path.join("src/components/desktop/pk-roster-config.ts"),
  "utf8"
);
const m = text.match(/PRESET_ROSTER_TEXT = `([\s\S]*?)`;/);
const preset = m[1]
  .split(/\n/)
  .map((s) => s.trim())
  .filter(Boolean);

// 白名单 + 浩森（指令强制末组）
const rosterNames = [...preset];
if (!rosterNames.some((n) => canonicalName(n) === canonicalName("浩森"))) {
  rosterNames.push("浩森");
}
const want = new Set(rosterNames.map((n) => canonicalName(n)));

const male = await db.getDailyWaveReport(day, "male");
const female = await db.getDailyWaveReport(day, "female");
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
for (const name of rosterNames) {
  const key = canonicalName(name);
  if (!byName.has(key)) byName.set(key, { name, wave: 0, trimmedAvg: 0 });
}

const all = [...byName.values()].sort(
  (a, b) => b.wave - a.wave || a.name.localeCompare(b.name, "zh")
);

const sizes = buildGroupSizes(all.length, 8);
const n = sizes.length; // 56 → 7 组 × 8
const STRONG_SLOT = 4; // 第 5 组（0-based）
const SECOND_SLOT = 2; // 第 3 组

// 固定锚点：浩泽第1、浩森末；保留阳沐/泽帆间隔
const anchors = {
  浩泽: 0,
  浩森: n - 1,
};
// 阳沐 ≥4、泽帆 ≥3：尽量放两端侧
// 浩阳 尽量远离 浩沐；啸泽 尽量远离 啸帆
// 第1已有浩泽，末已有浩森 → 浩阳放第3附近但避开最强，浩沐放末侧异组
// 啸帆战力高倾向最强组，啸泽放靠前异组
const preferred = {
  啸帆: STRONG_SLOT, // 常在最强侧
  啸泽: 1, // 与帆间隔 3（1 vs 5 → gap 4）
  浩阳: 2, // 次强侧
  浩沐: n - 1, // 与阳 gap≥4（2 vs 6 → gap 4）；末组可与浩森同组
};

const specialKeys = new Set(
  ["浩泽", "浩森", "浩阳", "浩沐", "啸泽", "啸帆"].map(canonicalName)
);
const byKey = new Map(all.map((x) => [canonicalName(x.name), x]));
const slotSpecials = sizes.map(() => []);

function placeSpecial(name, gi) {
  const mem = byKey.get(canonicalName(name));
  if (!mem) return false;
  // 已放置则跳过
  if (slotSpecials.some((arr) => arr.some((m) => canonicalName(m.name) === canonicalName(name)))) {
    return true;
  }
  if (slotSpecials[gi].length >= sizes[gi]) return false;
  slotSpecials[gi].push(mem);
  return true;
}

// 先钉指令锚点
for (const [name, gi] of Object.entries(anchors)) placeSpecial(name, gi);
// 再钉偏好（冲突时找最近合法槽）
function gapOk(name, gi) {
  const pairs = [
    ["浩阳", "浩沐", 4],
    ["啸泽", "啸帆", 3],
  ];
  for (const [a, b, gap] of pairs) {
    if (canonicalName(name) !== canonicalName(a) && canonicalName(name) !== canonicalName(b)) {
      continue;
    }
    const other = canonicalName(name) === canonicalName(a) ? b : a;
    for (let i = 0; i < n; i += 1) {
      if (slotSpecials[i].some((m) => canonicalName(m.name) === canonicalName(other))) {
        if (Math.abs(i - gi) < gap) return false;
      }
    }
  }
  // 不与同名重复
  return true;
}

for (const [name, preferGi] of Object.entries(preferred)) {
  if (!byKey.has(canonicalName(name))) continue;
  if (slotSpecials.some((arr) => arr.some((m) => canonicalName(m.name) === canonicalName(name)))) {
    continue;
  }
  const tryOrder = [preferGi];
  for (let d = 1; d < n; d += 1) {
    if (preferGi - d >= 0) tryOrder.push(preferGi - d);
    if (preferGi + d < n) tryOrder.push(preferGi + d);
  }
  let placed = false;
  for (const gi of tryOrder) {
    if (slotSpecials[gi].length >= sizes[gi]) continue;
    if (!gapOk(name, gi)) continue;
    placeSpecial(name, gi);
    placed = true;
    break;
  }
  if (!placed) {
    for (let gi = 0; gi < n; gi += 1) {
      if (slotSpecials[gi].length >= sizes[gi]) continue;
      if (!gapOk(name, gi)) continue;
      placeSpecial(name, gi);
      break;
    }
  }
}

const rest = all
  .filter((x) => !specialKeys.has(canonicalName(x.name)))
  .sort((a, b) => b.wave - a.wave || a.name.localeCompare(b.name, "zh"));

const capacity = sizes.map((sz, gi) => sz - slotSpecials[gi].length);
const rebuilt = sizes.map(() => []);

/**
 * 顺序穿插（蛇形）：
 * 先把最强空位留给第5组、次强留给第3组（指令硬钉），
 * 其余按 高→低 蛇形填入剩余容量。
 */
// 1) 第5组（最强）先吃最强 free
let fi = 0;
while (rebuilt[STRONG_SLOT].length < capacity[STRONG_SLOT] && fi < rest.length) {
  rebuilt[STRONG_SLOT].push(rest[fi++]);
}
// 2) 第3组（次强）再吃下一批
while (rebuilt[SECOND_SLOT].length < capacity[SECOND_SLOT] && fi < rest.length) {
  rebuilt[SECOND_SLOT].push(rest[fi++]);
}

// 3) 剩余：按「非强/次强槽」蛇形穿插（0→1→3→5→6→6→5→3→1→0…）
const snakeSlots = [];
const otherSlots = [];
for (let gi = 0; gi < n; gi += 1) {
  if (gi === STRONG_SLOT || gi === SECOND_SLOT) continue;
  otherSlots.push(gi);
}
// 正向 + 反向 交替构造蛇形序列，直到容量耗尽
{
  let dir = 1;
  let idx = 0;
  const capsLeft = otherSlots.map((gi) => capacity[gi] - rebuilt[gi].length);
  const totalLeft = () => capsLeft.reduce((s, c) => s + c, 0);
  while (totalLeft() > 0 && snakeSlots.length < rest.length * 2) {
    // 找下一个仍有容量的 otherSlots[idx]
    let guard = 0;
    while (capsLeft[idx] <= 0 && guard < otherSlots.length * 2) {
      if (dir === 1) {
        if (idx >= otherSlots.length - 1) {
          dir = -1;
        } else idx += 1;
      } else if (idx <= 0) {
        dir = 1;
      } else idx -= 1;
      guard += 1;
    }
    if (capsLeft[idx] <= 0) break;
    snakeSlots.push(otherSlots[idx]);
    capsLeft[idx] -= 1;
    if (dir === 1) {
      if (idx >= otherSlots.length - 1) dir = -1;
      else idx += 1;
    } else if (idx <= 0) dir = 1;
    else idx -= 1;
  }
}

for (const gi of snakeSlots) {
  if (fi >= rest.length) break;
  if (rebuilt[gi].length >= capacity[gi]) continue;
  rebuilt[gi].push(rest[fi++]);
}
// 兜底：仍有人就塞任何有空位的组（优先非满）
while (fi < rest.length) {
  let placed = false;
  // 优先其它组，再强/次强
  const order = [
    ...otherSlots,
    SECOND_SLOT,
    STRONG_SLOT,
  ];
  for (const gi of order) {
    if (rebuilt[gi].length < capacity[gi]) {
      rebuilt[gi].push(rest[fi++]);
      placed = true;
      break;
    }
  }
  if (!placed) {
    rebuilt[n - 1].push(rest[fi++]);
  }
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

// 若第5并非唯一最强 / 第3并非次强，用非锚点 free 互换微调
function allMembersOf(gi) {
  return orderMembers(gi, rebuilt[gi]);
}
function scoreOf(gi) {
  return top4sum(allMembersOf(gi));
}

function isAnchorName(name) {
  return specialKeys.has(canonicalName(name));
}

function swapWeakestNonSpecial(fromGi, toGi) {
  // 从 fromGi 抽最强非特殊 ↔ toGi 最弱非特殊
  const fromFree = rebuilt[fromGi]
    .map((m, mi) => ({ m, mi }))
    .filter(({ m }) => !isAnchorName(m.name))
    .sort((a, b) => b.m.wave - a.m.wave);
  const toFree = rebuilt[toGi]
    .map((m, mi) => ({ m, mi }))
    .filter(({ m }) => !isAnchorName(m.name))
    .sort((a, b) => a.m.wave - b.m.wave);
  if (!fromFree.length || !toFree.length) return false;
  const a = fromFree[0];
  const b = toFree[0];
  if (a.m.wave <= b.m.wave) return false;
  rebuilt[fromGi][a.mi] = b.m;
  rebuilt[toGi][b.mi] = a.m;
  return true;
}

// 强化第5组直到 top4 唯一最高
for (let pass = 0; pass < 40; pass += 1) {
  const scores = Array.from({ length: n }, (_, i) => scoreOf(i));
  const ranked = scores
    .map((s, i) => ({ i, s }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  if (ranked[0].i === STRONG_SLOT && ranked[1].i === SECOND_SLOT) break;
  if (ranked[0].i !== STRONG_SLOT) {
    // 从当前最强组抽强人进第5
    if (!swapWeakestNonSpecial(ranked[0].i, STRONG_SLOT)) break;
    continue;
  }
  if (ranked[1].i !== SECOND_SLOT) {
    // 第5已最强，把次强堆到第3
    if (!swapWeakestNonSpecial(ranked[1].i, SECOND_SLOT)) break;
    continue;
  }
}

const groups = rebuilt.map((free, slot) => {
  const members = orderMembers(slot, free);
  const t4 = top4sum(members);
  const avg = members.length ? total(members) / members.length : 0;
  // 08:15 起，每组间隔 5 分钟（与近期小组赛一致）
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

// 校验
function indexOfName(name) {
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i].members.some((m) => canonicalName(m.name) === canonicalName(name))) {
      return i;
    }
  }
  return -1;
}
const zeGi = indexOfName("浩泽");
const senGi = indexOfName("浩森");
const yangGi = indexOfName("浩阳");
const muGi = indexOfName("浩沐");
const xiaoZeGi = indexOfName("啸泽");
const fanGi = indexOfName("啸帆");

const byTop4 = groups
  .map((g, i) => ({ i: i + 1, top4: g.top4, avg: g.average }))
  .sort((a, b) => b.top4 - a.top4 || b.avg - a.avg);

const constraints = [
  "浩泽第1组 · 浩森末组",
  "次强第3组 · 最强第5组",
  yangGi >= 0 && muGi >= 0
    ? `浩阳↔浩沐 间隔 ${Math.abs(yangGi - muGi)}（要求≥4）`
    : null,
  xiaoZeGi >= 0 && fanGi >= 0
    ? `啸泽↔啸帆 间隔 ${Math.abs(xiaoZeGi - fanGi)}（要求≥3）`
    : null,
  `口径：日音浪 ${day}`,
].filter(Boolean);

const result = {
  ok: true,
  mode: "high_to_low",
  modeLabel: "顺序穿插",
  total: all.length,
  groupCount: n,
  sizes: groups.map((g) => g.count),
  strongestSlot: 5,
  strongestGroup: byTop4[0].i,
  constraints,
  groups,
};

const outDir = path.join("data", "runtime", "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(
  outDir,
  `星嗨争霸赛_顺序穿插_日音浪_${day}.png`
);
const png = await renderPkGroupsPng(result, {
  period: "2026-07",
  title: "星嗨争霸赛 · 顺序穿插",
  rosterSource: `日音浪 ${day} · 浩泽首/浩森末 · 次强3/最强5`,
  constraints,
});
fs.writeFileSync(outFile, png);

console.log("WROTE", path.resolve(outFile), "bytes", png.length);
console.log("TOTAL", all.length, "SIZES", result.sizes.join("+"));
console.log(
  "ANCHORS 浩泽=G" + (zeGi + 1),
  "浩森=G" + (senGi + 1),
  "浩阳=G" + (yangGi + 1),
  "浩沐=G" + (muGi + 1),
  "啸泽=G" + (xiaoZeGi + 1),
  "啸帆=G" + (fanGi + 1)
);
console.log(
  "TOP4 RANK",
  byTop4.map((x) => `G${x.i}:${fmtWan(x.top4)}`).join(" > ")
);
for (const g of groups) {
  console.log(
    `${g.label} · ${g.startTime} · ${g.count}人 · top4 ${fmtWan(g.top4)} · 均 ${fmtWan(g.average)}`
  );
  console.log(
    "  " + g.members.map((mem) => `${mem.name}(${fmtWan(mem.wave)})`).join(" · ")
  );
}

// 输出可直接贴进 PRESET 的名单
console.log("\n--- PRESET_BATTLE_GROUPS ---");
for (const g of groups) {
  console.log(
    `  [${g.members.map((mem) => JSON.stringify(mem.name)).join(", ")}],`
  );
}
