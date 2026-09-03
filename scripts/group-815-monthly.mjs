import "dotenv/config";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const db = require("../electron/db.js");

const ROSTER = [
  "浩月", "狼哲", "狼九", "浩龙", "狼赫", "浩辰", "玖玥",
  "浩雨", "狼澈", "啸帆", "南方楠", "狼岳", "浩玟", "狼凯",
  "狼泽", "狼辉", "啸强", "浩鸣", "浩艺", "浩阳", "浩冬",
  "啸阳", "狼征", "狼佑", "浩森", "浩坤", "浩杰", "狼兴",
  "啸森", "浩哲", "浩延", "狼明", "玖雪", "啸安", "浩沐",
  "狼影", "狼霆", "狼仔", "浩运", "浩启", "浩楠", "啸宇",
  "玖豆", "狼腾", "狼轩", "玖玉", "玖妹", "啸辰", "狼小宝",
  "狼辰", "狼途", "狼艺", "狼雨", "玖依", "啸恒",
];
// 新增：鹏先生（当月 91.6 万音浪）+ 啸泽（库中原有 5.8 万，仅此一位，钉第 1 组）+ 啸墨（库中原有 9.6 万，钉第 1 组）。
const EXTRA = ["鹏先生", "啸泽", "啸墨"];
const ALL = [...ROSTER, ...EXTRA];

const GROUP_COUNT = 8;
// 钉位：啸泽@第1组 · 啸墨@第1组 · 鹏先生@第6组 · 啸帆@第8组（鹏先生与狼小宝换位）
const PINS = [
  { key: "啸泽", group: 0, tag: "啸泽" },
  { key: "啸墨", group: 0, tag: "啸墨" },
  { key: "鹏先生", group: 5, tag: "鹏先生" },
  { key: "啸帆", group: GROUP_COUNT - 1, tag: "啸帆" },
];
const PIN_KEYS = new Set(PINS.map((p) => p.key));

function fmtWave(n) {
  if (n >= 100000) return `${(n / 10000).toFixed(0)}万`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(Math.round(n));
}

function total(g) {
  return g.reduce((s, p) => s + p.wave, 0);
}

// 蛇形：按人序逐轮左右往返填入各组，满组跳过
function snakeDraft(people, needs) {
  const groups = needs.map(() => []);
  const left = needs.slice();
  let ptr = 0;
  let dir = 1;
  const order = needs.map((_, i) => i);
  while (ptr < people.length) {
    let placed = 0;
    const seq = dir === 1 ? order : [...order].reverse();
    for (const gi of seq) {
      if (left[gi] > 0 && ptr < people.length) {
        groups[gi].push(people[ptr]);
        left[gi]--;
        ptr++;
        placed++;
      }
    }
    if (placed === 0) break;
    dir *= -1;
  }
  return groups;
}

// 贪心：按音浪降序逐个放入当前最弱（或人数最少）的组
function greedy(rest, keyPrimary) {
  const groups = Array.from({ length: GROUP_COUNT }, () => []);
  const cap = Math.ceil(ALL.length / GROUP_COUNT);
  for (const p of rest) {
    let best = -1;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].length >= cap) continue;
      if (best === -1) { best = i; continue; }
      const a = groups[best];
      const b = groups[i];
      const better =
        keyPrimary === "total"
          ? total(b) < total(a) ? true : total(b) > total(a) ? false : b.length < a.length ? true : b.length > a.length ? false : i < best
          : b.length < a.length ? true : b.length > a.length ? false : total(b) < total(a) ? true : total(b) > total(a) ? false : i < best;
      if (better) best = i;
    }
    groups[best].push(p);
  }
  return groups;
}

// 贪心-最弱组优先，但 7 人封顶（钉住的组从 6 人开始），全部满 7 后才允许某一组到 8
function greedyTotalCap(rest) {
  const groups = Array.from({ length: GROUP_COUNT }, () => []);
  for (const p of rest) {
    let eligible = groups.map((_, i) => i).filter((i) => groups[i].length < 7);
    if (eligible.length === 0) eligible = groups.map((_, i) => i).filter((i) => groups[i].length < 8);
    let best = eligible[0];
    for (const i of eligible.slice(1)) {
      const a = groups[best];
      const b = groups[i];
      const better =
        total(b) < total(a) ? true : total(b) > total(a) ? false : b.length < a.length ? true : b.length > a.length ? false : i < best;
      if (better) best = i;
    }
    groups[best].push(p);
  }
  return groups;
}

// 8 组均分容量：总容量恰好 = total（先均分，余数按升序 +1），避免蛇形丢人
function exactCaps(total) {
  const base = Math.floor(total / GROUP_COUNT);
  const caps = Array(GROUP_COUNT).fill(base);
  let extra = total - base * GROUP_COUNT;
  for (let i = 0; i < GROUP_COUNT && extra > 0; i++) {
    caps[i]++;
    extra--;
  }
  return caps;
}

// 把某一组的容量移到另一组（用于蛇形变体）
// 蛇形容量：总容量恰好 = total；余量（超过均分的部分）优先给非钉位或钉位组
function snakeCaps(total, pinnedGroups, pinnedFirst) {
  const base = Math.floor(total / GROUP_COUNT);
  const caps = Array(GROUP_COUNT).fill(base);
  let extra = total - base * GROUP_COUNT;
  const nonPinned = [];
  const pinned = [];
  for (let i = 0; i < GROUP_COUNT; i++) (pinnedGroups.has(i) ? pinned : nonPinned).push(i);
  const order = pinnedFirst ? [...pinned, ...nonPinned] : [...nonPinned, ...pinned];
  for (const i of order) {
    if (extra <= 0) break;
    caps[i]++;
    extra--;
  }
  return caps;
}

// 蛇形 + 钉位交换：先对全体蛇形，再把钉位人换到指定组（与目标组内音浪最近的人交换，扰动最小）
function swapInto(groups, key, targetIndex) {
  const g = groups.map((arr) => arr.slice());
  let cur = -1;
  for (let i = 0; i < g.length; i++) {
    if (g[i].some((p) => p.key === key)) cur = i;
  }
  if (cur === targetIndex) return g;
  const pin = g[cur].find((p) => p.key === key);
  let bestJ = -1;
  let bestDiff = Infinity;
  for (let j = 0; j < g[targetIndex].length; j++) {
    const other = g[targetIndex][j];
    if (PIN_KEYS.has(other.key)) continue;
    const diff = Math.abs(other.wave - pin.wave);
    if (diff < bestDiff) { bestDiff = diff; bestJ = j; }
  }
  if (bestJ === -1) return g;
  const other = g[targetIndex][bestJ];
  g[cur][g[cur].indexOf(pin)] = other;
  g[targetIndex][bestJ] = pin;
  return g;
}

function snakeWithSwap(sortedAll) {
  let groups = snakeDraft(sortedAll, exactCaps(sortedAll.length));
  for (const pin of PINS) groups = swapInto(groups, pin.key, pin.group);
  return groups;
}

async function main() {
  const pool = db.getPool();
  const [dateRows] = await pool.query(
    "SELECT DISTINCT import_date FROM wave_snapshots ORDER BY import_date DESC"
  );
  const periods = [...new Set(dateRows.map((r) => String(r.import_date).slice(0, 7)))];
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const period = process.argv[2] || (periods.includes(current) ? current : periods[0]);

  const roster = await db.getPkRoster(period, 8);
  const namesInRoster = new Set([...roster.males, ...roster.females].map((m) => m.name));
  const waveByName = new Map(
    [...roster.males, ...roster.females].map((m) => [m.name, Number(m.wave) || 0])
  );
  const people = ALL.map((rawName) => ({
    key: rawName,
    name: rawName,
    wave: waveByName.get(rawName) ?? 0,
    hasData: namesInRoster.has(rawName),
  }));
  for (const p of people) {
    if (!p.hasData) console.error(`⚠️ ${p.name} 当月无音浪数据（按 0 计入）`);
  }

  const pins = PINS.map((p) => ({
    ...p,
    person: people.find((x) => x.key === p.key),
  }));
  const pinnedGroups = new Set(pins.map((p) => p.group));
  const rest = people
    .filter((p) => !pins.some((pin) => pin.person === p))
    .sort((a, b) => b.wave - a.wave);

  // 多种候选分组，选最优
  const candidates = [];
  const withPins = (base) => {
    const g = base.map((arr) => arr.slice());
    for (const pin of pins) g[pin.group].unshift(pin.person);
    return g;
  };
  candidates.push({ name: "蛇形-余量先非钉位", groups: withPins(snakeDraft(rest, snakeCaps(rest.length, pinnedGroups, false))) });
  candidates.push({ name: "蛇形-余量先钉位", groups: withPins(snakeDraft(rest, snakeCaps(rest.length, pinnedGroups, true))) });
  candidates.push({ name: "贪心-最弱组优先(7人封顶)", groups: withPins(greedyTotalCap(rest)) });
  candidates.push({ name: "贪心-最弱组优先", groups: withPins(greedy(rest, "total")) });
  candidates.push({ name: "贪心-人数优先", groups: withPins(greedy(rest, "size")) });
  candidates.push({ name: "蛇形+钉位交换", groups: snakeWithSwap([...people].sort((a, b) => b.wave - a.wave)) });

  let best = null;
  for (const c of candidates) {
    const sizes = c.groups.map((g) => g.length);
    const totalsArr = c.groups.map(total);
    const maxT = Math.max(...totalsArr);
    const spread = maxT - Math.min(...totalsArr);
    const sizeOk = sizes.every((s) => s >= 6 && s <= 8);
    c.sizes = sizes;
    c.max = maxT;
    c.spread = spread;
    c.sizeOk = sizeOk;
    if (
      !best ||
      (c.sizeOk && !best.sizeOk) ||
      (c.sizeOk === best.sizeOk && (c.max < best.max || (c.max === best.max && c.spread < best.spread)))
    ) {
      best = c;
    }
  }

  console.error(`期次：${period}（可用 ${periods.join(" / ")}）`);
  console.error(`候选打分：`);
  for (const c of candidates) {
    console.error(`  ${c.name}: 组规模[${c.sizes.join(",")}] 最重组${fmtWave(c.max)} 极差${fmtWave(c.spread)}${c.sizeOk ? "" : " ✗超范围"}${c === best ? " ★选中" : ""}`);
  }

  const groups = best.groups;
  const totalsArr = groups.map(total);
  const totalAll = totalsArr.reduce((s, v) => s + v, 0);
  const avg = totalAll / groups.length;
  console.log("");
  console.log(`== ${period} 当月总音浪 · ${ALL.length} 人 · ${GROUP_COUNT} 组 ==`);
  console.log(`规则：${PINS.map((p) => `${p.tag}@第${p.group + 1}组`).join(" · ")} · 其余按总音浪${best.name.startsWith("蛇形") ? "蛇形均分" : "均衡分配"}（方案：${best.name}）`);
  console.log("");
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const pin = pins.find((p) => p.group === i);
    const tag = pin ? `◀${pin.tag}` : "";
    const members = g.map((p) => `${p.name}(${fmtWave(p.wave)})`).join("  ");
    console.log(`第${i + 1}组 ${tag} · ${g.length}人 · 总${fmtWave(total(g))} | ${members}`);
  }
  console.log("");
  console.log(`均衡：组总音浪 ${fmtWave(Math.min(...totalsArr))} ~ ${fmtWave(Math.max(...totalsArr))}（均 ${fmtWave(avg)}）`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
