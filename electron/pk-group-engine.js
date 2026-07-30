"use strict";

/**
 * PK 分组引擎（机器人 / 桌面共用口径）
 *
 * 战力口径：默认月音浪总量 wave（可用 scoreField=latestWave；缺省再回落到去峰日均）
 *
 * 模式：
 * - high_to_low（默认）：其余人按战力从高到低切块，特殊人后置插入，再调出场顺序
 * - balanced：蛇形均衡 + 爬山修补
 * - score_capable（能出分）：每组保底高战力，剩余补给当前最弱组
 * - preset（内置）：使用锁定的 PRESET_BATTLE_GROUPS，不跑自动算法
 *
 * 硬约束（默认）：
 * - 浩阳 与 浩沐 不同组，组序号差 ≥ 4
 * - 啸泽 与 啸帆 不同组，组序号差 ≥ 3
 * - 次强组固定第 3 场、最强组固定第 4 场（组数不足时尽量靠后）
 */

const {
  DEFAULT_MIN_GAP,
  YANG_MU_MIN_GAP,
  DEFAULT_GAP_PAIRS,
  NAME_ALIASES,
  normalizeName,
  canonicalName,
  normalizeGapPairs,
  validateGroupsGap,
} = require("../shared/pk-group-constraints");
const {
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_META,
} = require("../shared/pk-preset-battle-groups");


const DEFAULT_GROUP_SIZE = 8;

const MODE_LABELS = {
  high_to_low: "顺序分组",
  balanced: "均衡分组",
  score_capable: "能出分",
  preset: "内置分组",
};

function normalizeMode(raw) {
  const s = String(raw || "high_to_low").trim().toLowerCase();
  if (
    s === "balanced" ||
    s === "balance" ||
    s === "蛇形" ||
    s === "均衡" ||
    s === "平均"
  ) {
    return "balanced";
  }
  if (
    s === "score_capable" ||
    s === "score-capable" ||
    s === "capable" ||
    s === "能出分" ||
    s === "出分"
  ) {
    return "score_capable";
  }
  if (
    s === "preset" ||
    s === "builtin" ||
    s === "built-in" ||
    s === "内置" ||
    s === "固定" ||
    s === "锁定" ||
    s === "内置分组"
  ) {
    return "preset";
  }
  return "high_to_low";
}

function strengthOf(member) {
  const wave = Number(member.wave ?? member.day28 ?? 0);
  if (wave > 0) return wave;
  return Number(member.trimmedAvg ?? member.trimmed ?? 0);
}

function compareStrength(a, b) {
  const d = strengthOf(b) - strengthOf(a);
  if (d !== 0) return d;
  const t = Number(b.trimmedAvg || 0) - Number(a.trimmedAvg || 0);
  if (t !== 0) return t;
  return String(a.name || "").localeCompare(String(b.name || ""), "zh");
}

/**
 * 目标组数：max(4, round(n/preferred)) when n>=16；更小池子不强行 4。
 * 若名单含 minGap 很大的 pair，抬到至少 minGap+1 组（且 n 足够）。
 */
function resolveTargetGroupCount(total, preferredSize = DEFAULT_GROUP_SIZE, options = {}) {
  if (total <= 0) return 0;
  if (total <= preferredSize) return 1;
  let count = Math.max(1, Math.round(total / preferredSize));
  if (total >= 16) count = Math.max(4, count);

  // 仅当调用方提供 memberNames 时，才按「名单里实际出现的 gap 对」抬组数
  const nameSet = new Set(
    (options.memberNames || []).map((n) => canonicalName(n)).filter(Boolean)
  );
  let requiredByGap = 0;
  if (nameSet.size) {
    const gapPairs = normalizeGapPairs(options.gapPairs, options.minGap || DEFAULT_MIN_GAP);
    for (const { a, b, minGap } of gapPairs) {
      if (!nameSet.has(canonicalName(a)) || !nameSet.has(canonicalName(b))) continue;
      // |i-j|>=minGap 需要至少 minGap+1 组
      requiredByGap = Math.max(requiredByGap, minGap + 1);
    }
    if (requiredByGap > 0 && total >= requiredByGap * 2) {
      // 每组至少约 2 人时才强制抬；否则引擎后续会报错
      count = Math.max(count, Math.min(requiredByGap, Math.floor(total / 2)));
    }
  }

  // 避免组过碎 / 过大
  while (count > 1 && Math.ceil(total / count) > preferredSize + 1) count += 1;
  while (count > 1 && Math.floor(total / count) < Math.max(2, preferredSize - 4)) {
    // 不把为 gap 抬上去的组数再压回去太多
    if (requiredByGap && count <= requiredByGap) break;
    count -= 1;
  }

  return Math.min(Math.max(1, count), total);
}

function distributeEvenly(total, count) {
  if (total <= 0 || count <= 0) return [];
  const c = Math.min(count, total);
  const base = Math.floor(total / c);
  const rem = total % c;
  return Array.from({ length: c }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * 均分人数：组间差 ≤ 1。
 * @param {number} total
 * @param {number} [preferredSize]
 * @param {{ gapPairs?: unknown, memberNames?: string[], minGap?: number }} [options]
 */
function buildGroupSizes(total, preferredSize = DEFAULT_GROUP_SIZE, options = {}) {
  if (total <= 0) return [];
  if (total <= preferredSize && !(options.gapPairs || options.memberNames)) {
    // 小数情况仍可能因 gap 需要多组：走 resolve
    if (!options.memberNames && !options.gapPairs) return [total];
  }
  const count = resolveTargetGroupCount(total, preferredSize, options);
  if (count <= 1) return [total];
  return distributeEvenly(total, count);
}

function findMemberIndex(members, name) {
  const key = canonicalName(name);
  return members.findIndex((m) => canonicalName(m.name) === key);
}

function groupTopK(group, k = 4) {
  return [...group]
    .sort(compareStrength)
    .slice(0, k)
    .reduce((sum, m) => sum + strengthOf(m), 0);
}

function groupTotal(group) {
  return group.reduce((sum, m) => sum + strengthOf(m), 0);
}

function groupScore(g) {
  // 主序 top4，其次组总、组均 —— 避免完全均势时误判「第1组最强」
  return (Number(g.top4) || 0) * 1e9 + (groupTotal(g.members || []) || 0) * 1e3 + (Number(g.average) || 0);
}

function indexOfStrongest(groups) {
  return groups.reduce((best, g, idx) => (groupScore(g) > groupScore(groups[best]) ? idx : best), 0);
}

function isUniquelyStrongestAt(groups, idx) {
  if (groups.length <= 1) return false;
  const score = groupScore(groups[idx]);
  return groups.every((g, i) => i === idx || groupScore(g) < score - 1);
}

/**
 * 最优出场强度序列（0=最强，1=次强）。
 * 默认节奏：中上开场 → 弱穿插 → 次强(第3场) → 最强冲高(第4场) → 中后段。
 * 硬规则：seed0 尽量落在第 4 场（index 3）；seed1 尽量落在第 3 场（index 2）。
 * 组数不足时：最强尽量靠后，次强紧挨其前。
 */
function optimalStageOrder(count) {
  if (count <= 1) return [0];
  if (count === 2) return [1, 0]; // 次强1 / 最强2
  if (count === 3) return [2, 1, 0]; // 次强2 / 最强3
  if (count === 4) return [2, 3, 1, 0]; // 次强3 / 最强4
  if (count === 5) return [2, 4, 1, 0, 3]; // 次强3 / 最强4
  if (count === 6) return [2, 5, 1, 0, 4, 3]; // 次强3 / 最强4
  if (count === 7) return [2, 6, 1, 0, 5, 4, 3]; // 次强3 / 最强4
  if (count === 8) return [2, 7, 1, 0, 6, 5, 4, 3]; // 次强3 / 最强4
  const used = new Set();
  const result = [];
  const take = (i) => {
    if (i < 0 || i >= count || used.has(i)) return false;
    used.add(i);
    result.push(i);
    return true;
  };
  // 先占前两场非顶尖，第3场次强，第4场最强
  take(Math.min(Math.max(2, Math.floor(count / 3)), count - 1));
  take(count - 1);
  take(1); // 第3场次强
  take(0); // 第4场最强
  for (let i = count - 2; i >= 1 && result.length < count; i -= 1) take(i);
  for (let i = 1; i < count; i += 1) take(i);
  return result;
}

/** 默认最强第4场（index 3）；组数不足时尽量靠后 */
function resolveStrongestSlot(count, preferred = 3) {
  if (count <= 1) return 0;
  if (count === 2) return 1;
  if (count === 3) return 2;
  return Math.min(Math.max(0, preferred), count - 1);
}

function relabelGroups(groups) {
  return groups.map((g, i) => ({
    ...g,
    label: `第${i + 1}组`,
    order: i + 1,
  }));
}

/**
 * 把当前最强组整组换到 targetSlot（0-based）。
 */
function moveStrongestToSlot(groups, targetSlot = 3) {
  if (!groups.length) return groups;
  const slot = resolveStrongestSlot(groups.length, targetSlot);
  const strongIdx = indexOfStrongest(groups);
  if (strongIdx === slot) return relabelGroups(groups);
  const next = groups.map((g) => ({
    ...g,
    members: [...(g.members || [])],
  }));
  const tmp = next[strongIdx];
  next[strongIdx] = next[slot];
  next[slot] = tmp;
  return relabelGroups(next);
}

function reorderForStage(groups, strongestSlot = 3) {
  if (groups.length <= 1) return groups.map((g, i) => ({ ...g, label: `第${i + 1}组`, order: i + 1 }));
  // 按战力（top4）从强到弱编号，再套出场模板
  const ranked = groups
    .map((g, index) => ({ g, index, score: groupTopK(g.members, 4) || groupTotal(g.members) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const order = optimalStageOrder(ranked.length);
  // 强制最强(seed0)在目标场次
  const want = resolveStrongestSlot(order.length, strongestSlot);
  const strongAt = order.indexOf(0);
  if (strongAt !== want && strongAt >= 0) {
    const t = order[want];
    order[want] = 0;
    order[strongAt] = t;
  }
  return order.map((strengthIndex, slot) => {
    const item = ranked[strengthIndex];
    return {
      ...item.g,
      label: `第${slot + 1}组`,
      order: slot + 1,
      strengthRank: strengthIndex + 1,
    };
  });
}

/**
 * 成员归属微调：保证「最强钉第 4 场 + gap≥minGap」在整组重排下可解。
 *
 * 定理（n 组、最强钉 slot=3 时）：
 * - 含特殊人的宿主组最多 2 个，且最终会被排到间距 ≥ minGap 的自由槽（常为首末）
 * - 最强组必须不含特殊人；否则钉在中后场后 pair 可能无处可去（n=4,minGap=3 时尤甚）
 * - 若最强个人是特殊人，把非特殊高战力集中到一个「纯战力组」压过宿主
 */
function repairMembershipForStageConstraints(groups, gapPairs, minGap, lockedNames) {
  const n = groups.length;
  if (n <= 2) return groups;
  const pairs = normalizeGapPairs(gapPairs, minGap);

  const specialKeys = new Set();
  for (const { a, b } of pairs) {
    specialKeys.add(canonicalName(a));
    specialKeys.add(canonicalName(b));
  }
  if (!specialKeys.size) return groups;

  function scoreOf(g) {
    return groupTopK(g, 4) * 1e9 + groupTotal(g) * 1e3 + (Number(g.length) || 0);
  }

  function strongIndex() {
    let best = 0;
    for (let i = 1; i < groups.length; i += 1) {
      if (scoreOf(groups[i]) > scoreOf(groups[best])) best = i;
    }
    return best;
  }

  function isSpecial(m) {
    return specialKeys.has(canonicalName(m.name));
  }

  function swapInto(name, targetGi, allowSpecialVictim = false) {
    const cur = locateName(groups, name);
    if (!cur) return false;
    if (cur.gi === targetGi) return true;
    let victims = groups[targetGi]
      .map((m, mi) => ({ m, mi }))
      .filter(({ m }) => !isSpecial(m))
      .sort((x, y) => strengthOf(x.m) - strengthOf(y.m));
    if (!victims.length && allowSpecialVictim) {
      victims = groups[targetGi]
        .map((m, mi) => ({ m, mi }))
        .filter(({ m }) => canonicalName(m.name) !== canonicalName(name))
        .sort((x, y) => strengthOf(x.m) - strengthOf(y.m));
    }
    if (!victims.length) return false;
    return swapMembers(groups, cur, { gi: targetGi, mi: victims[0].mi });
  }

  // 1) 选 2 个宿主：优先已有特殊人、战力偏弱的组
  let sIdx = strongIndex();
  const ranked = [];
  for (let gi = 0; gi < n; gi += 1) {
    ranked.push({
      gi,
      specialCount: groups[gi].filter(isSpecial).length,
      score: scoreOf(groups[gi]),
    });
  }
  ranked.sort(
    (a, b) => b.specialCount - a.specialCount || a.score - b.score || a.gi - b.gi
  );
  // 宿主先不排除最强（稍后会造纯战力最强组）
  const hosts = [ranked[0].gi, ranked[1] ? ranked[1].gi : ranked[0].gi];
  if (hosts[0] === hosts[1] && n > 2) {
    hosts[1] = ranked.find((x) => x.gi !== hosts[0])?.gi ?? (hosts[0] + 1) % n;
  }
  const hostSet = new Set(hosts);

  // 2) 全部特殊人迁入宿主
  for (let round = 0; round < specialKeys.size * 4; round += 1) {
    let pending = null;
    for (let gi = 0; gi < n; gi += 1) {
      if (hostSet.has(gi)) continue;
      const sp = groups[gi].find(isSpecial);
      if (sp) {
        pending = sp.name;
        break;
      }
    }
    if (!pending) break;
    const target = hosts.slice().sort((a, b) => {
      const sa = groups[a].filter(isSpecial).length;
      const sb = groups[b].filter(isSpecial).length;
      return sa - sb || groups[a].length - groups[b].length;
    })[0];
    if (!swapInto(pending, target)) break;
  }

  // 3) 每对分居两个宿主
  for (const { a, b } of pairs) {
    let locA = locateName(groups, a);
    let locB = locateName(groups, b);
    if (!locA || !locB) continue;
    if (!hostSet.has(locA.gi)) {
      swapInto(a, hosts[0]);
      locA = locateName(groups, a);
    }
    if (!hostSet.has(locB.gi)) {
      swapInto(b, hosts[1]);
      locB = locateName(groups, b);
    }
    if (locA && locB && locA.gi === locB.gi) {
      const weaker =
        strengthOf(locA.member) <= strengthOf(locB.member) ? a : b;
      const otherHost = hosts[0] === locA.gi ? hosts[1] : hosts[0];
      swapInto(weaker, otherHost);
    }
  }

  // 4) 造「纯战力最强组」：在非宿主组里堆非特殊高战力，确保最强不含特殊人
  const powerCandidates = [];
  for (let gi = 0; gi < n; gi += 1) {
    if (hostSet.has(gi)) continue;
    powerCandidates.push(gi);
  }
  if (!powerCandidates.length) {
    // 所有组都是宿主（n=2）——无法两全，交给排列层
    void lockedNames;
    void minGap;
    return groups;
  }
  // 选一个 power 组：当前非宿主中战力最高的
  powerCandidates.sort((a, b) => scoreOf(groups[b]) - scoreOf(groups[a]));
  const powerGi = powerCandidates[0];

  // 从全场（含宿主）抽最强非特殊人换入 power 组
  const powerSize = groups[powerGi].length;
  for (let boost = 0; boost < powerSize * 2; boost += 1) {
    // power 组里最弱（可被换出）
    const weakInPower = groups[powerGi]
      .map((m, mi) => ({ m, mi }))
      .filter(({ m }) => !isSpecial(m))
      .sort((x, y) => strengthOf(x.m) - strengthOf(y.m));
    if (!weakInPower.length) break;

    // 外场最强非特殊且强于 power 最弱
    let best = null;
    for (let gi = 0; gi < n; gi += 1) {
      if (gi === powerGi) continue;
      for (let mi = 0; mi < groups[gi].length; mi += 1) {
        const m = groups[gi][mi];
        if (isSpecial(m)) continue;
        const s = strengthOf(m);
        if (s <= strengthOf(weakInPower[0].m)) continue;
        if (!best || s > best.s) best = { gi, mi, s };
      }
    }
    if (!best) break;
    swapMembers(
      groups,
      { gi: powerGi, mi: weakInPower[0].mi },
      { gi: best.gi, mi: best.mi }
    );
  }

  // 若 power 仍不比两个宿主强：继续从宿主抽非特殊强人（保留特殊人）
  for (let guard = 0; guard < 16; guard += 1) {
    sIdx = strongIndex();
    if (!hostSet.has(sIdx) && !groups[sIdx].some(isSpecial)) break;
    // 最强仍是宿主或含特殊 → 再强化 power
    const weakInPower = groups[powerGi]
      .map((m, mi) => ({ m, mi }))
      .filter(({ m }) => !isSpecial(m))
      .sort((x, y) => strengthOf(x.m) - strengthOf(y.m));
    if (!weakInPower.length) break;
    let best = null;
    for (const h of hosts) {
      for (let mi = 0; mi < groups[h].length; mi += 1) {
        const m = groups[h][mi];
        if (isSpecial(m)) continue;
        const s = strengthOf(m);
        if (!best || s > best.s) best = { gi: h, mi, s };
      }
    }
    // 也看其它非 power 非宿主
    for (let gi = 0; gi < n; gi += 1) {
      if (gi === powerGi || hostSet.has(gi)) continue;
      for (let mi = 0; mi < groups[gi].length; mi += 1) {
        const m = groups[gi][mi];
        if (isSpecial(m)) continue;
        const s = strengthOf(m);
        if (!best || s > best.s) best = { gi, mi, s };
      }
    }
    if (!best) break;
    if (best.s <= strengthOf(weakInPower[0].m) && !hostSet.has(strongIndex())) break;
    swapMembers(
      groups,
      { gi: powerGi, mi: weakInPower[0].mi },
      { gi: best.gi, mi: best.mi }
    );
  }

  // 5) 特殊人若因交换掉出宿主，拉回；每对分居
  for (let round = 0; round < 8; round += 1) {
    let moved = false;
    for (let gi = 0; gi < n; gi += 1) {
      if (hostSet.has(gi)) continue;
      const sp = groups[gi].find(isSpecial);
      if (!sp) continue;
      const target = hosts.slice().sort(
        (a, b) =>
          groups[a].filter(isSpecial).length - groups[b].filter(isSpecial).length
      )[0];
      if (swapInto(sp.name, target)) moved = true;
    }
    for (const { a, b } of pairs) {
      const locA = locateName(groups, a);
      const locB = locateName(groups, b);
      if (!locA || !locB) continue;
      if (locA.gi === locB.gi) {
        const weaker =
          strengthOf(locA.member) <= strengthOf(locB.member) ? a : b;
        const other = hosts[0] === locA.gi ? hosts[1] : hosts[0];
        if (swapInto(weaker, other)) moved = true;
      }
    }
    if (!moved) break;
  }

  // 6) 最后：若最强仍含特殊人，把特殊人与 power 组非特殊换（牺牲一点战力差也要清场）
  for (let guard = 0; guard < 8; guard += 1) {
    sIdx = strongIndex();
    const sp = groups[sIdx].find(isSpecial);
    if (!sp) break;
    const target = hostSet.has(sIdx)
      ? hosts.slice().sort(
          (a, b) =>
            groups[a].filter(isSpecial).length - groups[b].filter(isSpecial).length
        )[0]
      : hosts[0];
    // 若 sIdx 本身是宿主，换到另一宿主；同时强化 power
    if (hostSet.has(sIdx)) {
      const other = hosts[0] === sIdx ? hosts[1] : hosts[0];
      swapInto(sp.name, other, true);
      // 从该宿主抽最强非特殊进 power
      const donor = groups[sIdx]
        .map((m, mi) => ({ m, mi }))
        .filter(({ m }) => !isSpecial(m))
        .sort((x, y) => strengthOf(y.m) - strengthOf(x.m));
      const weakPower = groups[powerGi]
        .map((m, mi) => ({ m, mi }))
        .filter(({ m }) => !isSpecial(m))
        .sort((x, y) => strengthOf(x.m) - strengthOf(y.m));
      if (donor.length && weakPower.length) {
        swapMembers(
          groups,
          { gi: powerGi, mi: weakPower[0].mi },
          { gi: sIdx, mi: donor[0].mi }
        );
      }
    } else {
      swapInto(sp.name, target, true);
    }
  }

  void lockedNames;
  void minGap;
  return groups;
}

/** 次强默认第 3 场（index 2）；组数不足时紧挨最强前一槽 */
function resolveSecondSlot(count, strongestSlot) {
  if (count <= 1) return 0;
  if (count === 2) return 0; // 次强第1 / 最强第2
  if (count === 3) return 1; // 次强第2 / 最强第3
  const second = 2; // 第 3 场
  if (second === strongestSlot) return Math.max(0, strongestSlot - 1);
  return second;
}

/**
 * 组内成员已固定后，只重排出场顺序（整组原子移动）：
 * - 最强组尽量钉在 strongestSlot（默认第 4 场）
 * - 次强组尽量钉在第 3 场
 * - gapPairs 的组序号差 ≥ minGap
 * 不拆组、不换人，避免「修间隔」把最强组拆散。
 */
function arrangeStagesAtomic(groups, gapPairs, minGap, strongestSlot = 3) {
  if (!groups.length) return groups;
  if (groups.length === 1) {
    return relabelGroups(groups.map((g) => ({ ...g, members: [...(g.members || [])] })));
  }

  const units = groups.map((g, index) => ({
    ...g,
    members: [...(g.members || [])],
    _src: index,
    _score: groupScore(g),
  }));
  const n = units.length;
  const want = resolveStrongestSlot(n, strongestSlot);
  const wantSecond = resolveSecondSlot(n, want);
  const rankedIdx = units
    .map((u, i) => ({ i, score: u._score }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.i);
  const strongIdx = rankedIdx[0];
  const secondIdx = rankedIdx[1] ?? rankedIdx[0];

  function nameGroupIndex(order, name) {
    const key = canonicalName(name);
    for (let i = 0; i < order.length; i += 1) {
      if (units[order[i]].members.some((m) => canonicalName(m.name) === key)) return i;
    }
    return -1;
  }

  const pairs = normalizeGapPairs(gapPairs, minGap);
  function gapsOk(order) {
    for (const { a, b, minGap: pairGap } of pairs) {
      const ia = nameGroupIndex(order, a);
      const ib = nameGroupIndex(order, b);
      if (ia < 0 || ib < 0) return false;
      if (Math.abs(ia - ib) < pairGap) return false;
    }
    return true;
  }

  function applyOrder(order) {
    return relabelGroups(order.map((ui) => ({
      ...units[ui],
      members: [...units[ui].members],
    })));
  }

  function* permute(arr) {
    if (arr.length <= 1) {
      yield arr.slice();
      return;
    }
    for (let i = 0; i < arr.length; i += 1) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permute(rest)) yield [arr[i], ...p];
    }
  }

  function pinPair(baseOrder, strongSlot, secondSlot) {
    const trial = baseOrder.slice();
    const sAt = trial.indexOf(strongIdx);
    if (sAt !== strongSlot && sAt >= 0) {
      const t = trial[strongSlot];
      trial[strongSlot] = strongIdx;
      trial[sAt] = t;
    }
    if (n >= 2 && secondIdx !== strongIdx) {
      const secAt = trial.indexOf(secondIdx);
      if (secAt !== secondSlot && secAt >= 0 && secondSlot !== strongSlot) {
        const t = trial[secondSlot];
        // 不要把最强从 strongSlot 换走
        if (t !== strongIdx) {
          trial[secondSlot] = secondIdx;
          trial[secAt] = t;
        } else {
          // secondSlot 已被最强占（不应发生）；找最近空位
          for (let s = 0; s < n; s += 1) {
            if (s === strongSlot) continue;
            if (trial[s] === secondIdx) break;
            const cur = trial.indexOf(secondIdx);
            const u = trial[s];
            trial[s] = secondIdx;
            trial[cur] = u;
            break;
          }
        }
      }
    }
    return trial;
  }

  // 1) 模板：按战力排序套 optimalStageOrder，并强制最强/次强钉位
  const strengthOrder = optimalStageOrder(n); // strengthOrder[slot] = strengthRank
  let order = strengthOrder.map((rank) => rankedIdx[rank]);
  order = pinPair(order, want, wantSecond);
  if (gapsOk(order) && order[want] === strongIdx && (n < 2 || order[wantSecond] === secondIdx)) {
    return applyOrder(order);
  }
  if (gapsOk(order) && order[want] === strongIdx) return applyOrder(order);

  // 2) 同时钉最强+次强，枚举其余（n≤8 可接受）
  const free = [];
  for (let i = 0; i < n; i += 1) {
    if (i === strongIdx) continue;
    if (n >= 2 && i === secondIdx) continue;
    free.push(i);
  }

  function fillFixed(strongSlot, secondSlot, restPerm) {
    const trial = new Array(n);
    trial[strongSlot] = strongIdx;
    let k = 0;
    for (let s = 0; s < n; s += 1) {
      if (s === strongSlot) continue;
      if (n >= 2 && s === secondSlot && secondIdx !== strongIdx) {
        trial[s] = secondIdx;
        continue;
      }
      trial[s] = restPerm[k++];
    }
    return trial;
  }

  // 2a) 理想钉位：最强 want + 次强 wantSecond
  if (n <= 8) {
    if (free.length === 0) {
      const trial = fillFixed(want, wantSecond, []);
      if (gapsOk(trial)) return applyOrder(trial);
    } else {
      for (const perm of permute(free)) {
        const trial = fillFixed(want, wantSecond, perm);
        if (gapsOk(trial)) return applyOrder(trial);
      }
    }
  } else {
    const trial = pinPair(order, want, wantSecond);
    if (gapsOk(trial)) return applyOrder(trial);
  }

  // 2b) 只钉最强在 want，次强尽量靠前中段
  const others = [];
  for (let i = 0; i < n; i += 1) if (i !== strongIdx) others.push(i);
  if (n <= 8) {
    // 优先次强在 wantSecond 的排列
    for (const preferSecond of [true, false]) {
      for (const perm of permute(others)) {
        const trial = new Array(n);
        trial[want] = strongIdx;
        let k = 0;
        for (let s = 0; s < n; s += 1) {
          if (s === want) continue;
          trial[s] = perm[k++];
        }
        if (preferSecond && n >= 2 && trial[wantSecond] !== secondIdx) continue;
        if (gapsOk(trial)) return applyOrder(trial);
      }
    }
  }

  // 3) 放宽：最强不强制 want，但绝不放第 1；仍优先次强第 3
  const slotPreference = [];
  if (want !== 0) slotPreference.push(want);
  for (let s = n - 1; s >= 1; s -= 1) {
    if (s !== want) slotPreference.push(s);
  }
  for (const slot of slotPreference) {
    const secondSlot = slot === wantSecond ? resolveSecondSlot(n, slot) : wantSecond;
    if (n <= 8) {
      const rest = [];
      for (let i = 0; i < n; i += 1) {
        if (i === strongIdx) continue;
        if (n >= 2 && i === secondIdx && secondSlot !== slot) continue;
        rest.push(i);
      }
      for (const perm of permute(rest.length ? rest : others.filter((i) => i !== strongIdx))) {
        const trial = fillFixed(slot, secondSlot === slot ? resolveSecondSlot(n, slot) : secondSlot, perm);
        // fillFixed 在 second==strong 时可能重复；兜底用只钉最强
        if (trial.filter((x) => x === strongIdx).length !== 1) continue;
        if (new Set(trial).size !== n) {
          // 退化：只钉最强
          const simple = new Array(n);
          simple[slot] = strongIdx;
          let k = 0;
          const pool = others.filter((i) => i !== strongIdx || true).filter((i) => i !== strongIdx);
          // others already excludes strongIdx
          for (let s = 0; s < n; s += 1) {
            if (s === slot) continue;
            simple[s] = others[k++];
          }
          // 再尝试把次强换到 secondSlot
          const pinned = pinPair(simple, slot, secondSlot === slot ? Math.max(0, slot - 1) : secondSlot);
          if (gapsOk(pinned)) return applyOrder(pinned);
          if (gapsOk(simple)) return applyOrder(simple);
          continue;
        }
        if (gapsOk(trial)) return applyOrder(trial);
      }
    } else {
      const trial = pinPair(order, slot, secondSlot === slot ? Math.max(0, slot - 1) : secondSlot);
      if (gapsOk(trial)) return applyOrder(trial);
    }
  }

  // 4) 再放宽：只要求 gap
  if (gapsOk(order)) return applyOrder(order);
  if (n <= 8) {
    const all = units.map((_, i) => i);
    for (const perm of permute(all)) {
      if (gapsOk(perm)) return applyOrder(perm);
    }
  }

  return applyOrder(order);
}

function assignHighToLow(sorted, sizes) {
  const groups = sizes.map(() => []);
  let cursor = 0;
  for (let gi = 0; gi < sizes.length; gi += 1) {
    groups[gi] = sorted.slice(cursor, cursor + sizes[gi]);
    cursor += sizes[gi];
  }
  return groups;
}

/**
 * 从高到低（排除硬约束四人）：
 * 1) 先抽出 gapPairs 里的人
 * 2) 其余严格按战力从高到低切块
 * 3) 再把四人插回，满足间隔 ≥ minGap，并尽量不破坏切块强弱层次
 */
function assignHighToLowExceptSpecials(sorted, sizes, gapPairs, minGap) {
  const pairs = normalizeGapPairs(gapPairs, minGap);
  const specialKeys = new Set();
  for (const { a, b } of pairs) {
    specialKeys.add(canonicalName(a));
    specialKeys.add(canonicalName(b));
  }
  const specials = [];
  const rest = [];
  for (const m of sorted) {
    if (specialKeys.has(canonicalName(m.name))) specials.push(m);
    else rest.push(m);
  }

  // 其余人按 sizes 切块；若因抽出特殊人导致某组少人，后面插入时补
  const groups = sizes.map(() => []);
  let cursor = 0;
  for (let gi = 0; gi < sizes.length; gi += 1) {
    // 先按目标人数尽量填，允许暂时不满（特殊人占位）
    const need = sizes[gi];
    while (groups[gi].length < need && cursor < rest.length) {
      groups[gi].push(rest[cursor]);
      cursor += 1;
    }
  }
  // 剩余 rest（极少）顺延塞进仍缺人的组
  while (cursor < rest.length) {
    let placed = false;
    for (let gi = 0; gi < groups.length; gi += 1) {
      if (groups[gi].length < sizes[gi]) {
        groups[gi].push(rest[cursor]);
        cursor += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // 全满则追加到末组
      groups[groups.length - 1].push(rest[cursor]);
      cursor += 1;
    }
  }

  // 特殊人按战力从强到弱插入：选「仍缺人 / 或可扩」且对另一半满足 gap 的组
  const byKey = new Map(specials.map((m) => [canonicalName(m.name), m]));
  const placedSpecial = new Map(); // key -> gi

  function roomLeft(gi) {
    return sizes[gi] - groups[gi].length;
  }

  function canPlace(nameKey, gi) {
    // 与已放置的配对检查 gap（每对用自己的 minGap）
    for (const { a, b, minGap: pairGap } of pairs) {
      const ka = canonicalName(a);
      const kb = canonicalName(b);
      if (nameKey !== ka && nameKey !== kb) continue;
      const otherKey = nameKey === ka ? kb : ka;
      if (!placedSpecial.has(otherKey)) continue;
      const otherGi = placedSpecial.get(otherKey);
      if (Math.abs(gi - otherGi) < pairGap) return false;
    }
    return true;
  }

  // 插入顺序：先放每对中较强的，再放较弱的（便于弱的去远处）
  const insertOrder = [];
  for (const { a, b } of pairs) {
    const ma = byKey.get(canonicalName(a));
    const mb = byKey.get(canonicalName(b));
    if (ma && mb) {
      if (strengthOf(ma) >= strengthOf(mb)) insertOrder.push(ma, mb);
      else insertOrder.push(mb, ma);
    } else if (ma) insertOrder.push(ma);
    else if (mb) insertOrder.push(mb);
  }
  // 去重（多对共享名时）
  const seenIns = new Set();
  const uniqueInsert = [];
  for (const m of insertOrder) {
    const k = canonicalName(m.name);
    if (seenIns.has(k)) continue;
    seenIns.add(k);
    uniqueInsert.push(m);
  }

  for (const member of uniqueInsert) {
    const key = canonicalName(member.name);
    const options = [];
    for (let gi = 0; gi < groups.length; gi += 1) {
      if (!canPlace(key, gi)) continue;
      const room = roomLeft(gi);
      // 优先：有空位的组；其次按「组当前 top4 与该人接近」减少破坏强弱层次
      const top = groupTopK(groups[gi], 3);
      const fit = Math.abs(top / Math.max(groups[gi].length, 1) - strengthOf(member));
      const score =
        (room > 0 ? 0 : 1e9) + // 无空位惩罚
        Math.max(0, -room) * 1e6 +
        fit +
        gi * 0.01;
      options.push({ gi, score, room });
    }
    if (!options.length) {
      // 放宽：只要求不同组（gap 稍后 enforce 再修）
      for (let gi = 0; gi < groups.length; gi += 1) {
        options.push({ gi, score: roomLeft(gi) > 0 ? gi : 1e6 + gi, room: roomLeft(gi) });
      }
    }
    options.sort((x, y) => x.score - y.score);
    const pick = options[0].gi;
    // 若该组已满，挤出最弱非特殊人到仍有空位的组
    if (roomLeft(pick) <= 0) {
      const victims = groups[pick]
        .map((m, mi) => ({ m, mi }))
        .filter(({ m }) => !specialKeys.has(canonicalName(m.name)))
        .sort((x, y) => strengthOf(x.m) - strengthOf(y.m));
      if (victims.length) {
        let dest = -1;
        for (let gi = 0; gi < groups.length; gi += 1) {
          if (gi !== pick && roomLeft(gi) > 0) {
            dest = gi;
            break;
          }
        }
        if (dest >= 0) {
          const v = victims[0];
          groups[pick].splice(v.mi, 1);
          groups[dest].push(v.m);
        }
      }
    }
    groups[pick].push(member);
    placedSpecial.set(key, pick);
  }

  return groups;
}

function assignSerpentine(sorted, sizes) {
  const groups = sizes.map(() => []);
  let gi = 0;
  let dir = 1;
  for (const member of sorted) {
    let guard = 0;
    while (groups[gi].length >= sizes[gi] && guard < sizes.length * 3) {
      if (dir === 1) {
        if (gi === sizes.length - 1) dir = -1;
        else gi += 1;
      } else if (gi === 0) dir = 1;
      else gi -= 1;
      guard += 1;
    }
    groups[gi].push(member);
    if (dir === 1) {
      if (gi === sizes.length - 1) dir = -1;
      else gi += 1;
    } else if (gi === 0) dir = 1;
    else gi -= 1;
  }
  return groups;
}

/**
 * 能出分：每组先放 1 高战力，剩余补给当前 top4 最弱未满组；特殊人后置插入。
 */
function assignScoreCapable(sorted, sizes, gapPairs, minGap) {
  const pairs = normalizeGapPairs(gapPairs, minGap);
  const specialKeys = new Set();
  for (const { a, b } of pairs) {
    specialKeys.add(canonicalName(a));
    specialKeys.add(canonicalName(b));
  }
  const specials = [];
  const normals = [];
  for (const m of sorted) {
    if (specialKeys.has(canonicalName(m.name))) specials.push(m);
    else normals.push(m);
  }

  const groups = sizes.map(() => []);
  const highCount = Math.max(sizes.length, Math.ceil(Math.max(normals.length, 1) * 0.25));
  const highs = normals.slice(0, highCount);
  const rest = normals.slice(highCount);

  for (let i = 0; i < sizes.length; i += 1) {
    if (highs[i]) groups[i].push(highs[i]);
  }
  const pool = [...highs.slice(sizes.length), ...rest];

  for (const m of pool) {
    let bestGi = -1;
    let bestKey = null;
    for (let gi = 0; gi < groups.length; gi += 1) {
      if (groups[gi].length >= sizes[gi]) continue;
      const curTop = groupTopK(groups[gi], 4);
      const rank = [curTop, groups[gi].length];
      if (
        bestGi < 0 ||
        rank[0] < bestKey[0] ||
        (rank[0] === bestKey[0] && rank[1] < bestKey[1])
      ) {
        bestGi = gi;
        bestKey = rank;
      }
    }
    if (bestGi < 0) {
      bestGi = groups.reduce(
        (best, g, i) => (g.length < groups[best].length ? i : best),
        0
      );
    }
    groups[bestGi].push(m);
  }

  // 特殊人：优先人数最少且对已放 pair 满足 gap 的组
  const placedSpecial = new Map();
  const byStrength = [...specials].sort(compareStrength);
  for (const member of byStrength) {
    const key = canonicalName(member.name);
    const options = [];
    for (let gi = 0; gi < groups.length; gi += 1) {
      let gapOk = true;
      for (const { a, b, minGap: pairGap } of pairs) {
        const ka = canonicalName(a);
        const kb = canonicalName(b);
        if (key !== ka && key !== kb) continue;
        const other = key === ka ? kb : ka;
        if (!placedSpecial.has(other)) continue;
        if (Math.abs(gi - placedSpecial.get(other)) < pairGap) {
          gapOk = false;
          break;
        }
      }
      if (!gapOk) continue;
      options.push({
        gi,
        score: groups[gi].length * 1e6 + groupTopK(groups[gi], 4),
      });
    }
    if (!options.length) {
      for (let gi = 0; gi < groups.length; gi += 1) {
        options.push({ gi, score: groups[gi].length });
      }
    }
    options.sort((x, y) => x.score - y.score);
    const pick = options[0].gi;
    groups[pick].push(member);
    placedSpecial.set(key, pick);
  }

  return groups;
}

function locateName(groups, name) {
  const key = canonicalName(name);
  for (let gi = 0; gi < groups.length; gi += 1) {
    const mi = groups[gi].findIndex((m) => canonicalName(m.name) === key);
    if (mi >= 0) return { gi, mi, member: groups[gi][mi] };
  }
  return null;
}

function swapMembers(groups, a, b) {
  if (!a || !b) return false;
  if (a.gi === b.gi && a.mi === b.mi) return false;
  const tmp = groups[a.gi][a.mi];
  groups[a.gi][a.mi] = groups[b.gi][b.mi];
  groups[b.gi][b.mi] = tmp;
  return true;
}

/**
 * 把 name 换到 targetGi（与该组最弱非 protect 交换）。
 */
function moveNameToGroup(groups, name, targetGi, protect = new Set()) {
  const cur = locateName(groups, name);
  if (!cur) return false;
  if (cur.gi === targetGi) return true;
  const swappables = groups[targetGi]
    .map((m, mi) => ({ m, mi, gi: targetGi }))
    .filter(({ m }) => {
      const key = canonicalName(m.name);
      if (protect.has(key)) return false;
      if (key === canonicalName(name)) return false;
      return true;
    })
    .sort((x, y) => strengthOf(x.m) - strengthOf(y.m));
  if (!swappables.length) return false;
  return swapMembers(groups, cur, { gi: swappables[0].gi, mi: swappables[0].mi });
}

/**
 * 让 pair 满足 |giA-giB| >= minGap。
 * 策略：先试挪较弱方 → 再试挪较强方 → 再把两人放到距离足够的槽位对。
 */
function enforceGapPair(groups, nameA, nameB, minGap, lockedNames = new Set()) {
  const a0 = locateName(groups, nameA);
  const b0 = locateName(groups, nameB);
  if (!a0 || !b0) {
    return {
      ok: false,
      reason: `名单中缺少 ${!a0 ? nameA : nameB}`,
    };
  }
  if (Math.abs(a0.gi - b0.gi) >= minGap) return { ok: true };

  const G = groups.length;
  if (G - 1 < minGap) {
    return { ok: false, reason: `总组数 ${G} 无法满足间隔 ≥${minGap}` };
  }

  const protect = new Set(lockedNames);
  // 允许 pair 自己被移动，但尽量不拿另一约束对的人当炮灰
  const tryMoveSide = (moveName, anchorName) => {
    const anchor = locateName(groups, anchorName);
    if (!anchor) return false;
    const options = [];
    for (let gi = 0; gi < G; gi += 1) {
      if (Math.abs(gi - anchor.gi) < minGap) continue;
      options.push(gi);
    }
    // 远端优先
    options.sort((x, y) => Math.abs(y - anchor.gi) - Math.abs(x - anchor.gi));
    for (const gi of options) {
      const ok = moveNameToGroup(groups, moveName, gi, protect);
      if (!ok) continue;
      const a = locateName(groups, nameA);
      const b = locateName(groups, nameB);
      if (a && b && Math.abs(a.gi - b.gi) >= minGap) return true;
    }
    return false;
  };

  // 1) 挪较弱
  const weakerFirst =
    strengthOf(a0.member) <= strengthOf(b0.member)
      ? [nameA, nameB]
      : [nameB, nameA];
  if (tryMoveSide(weakerFirst[0], weakerFirst[1])) return { ok: true };
  // 2) 挪较强
  if (tryMoveSide(weakerFirst[1], weakerFirst[0])) return { ok: true };

  // 3) 两端锚定：把 A 放 i、B 放 j，|i-j|>=minGap
  const slotPairs = [];
  for (let i = 0; i < G; i += 1) {
    for (let j = 0; j < G; j += 1) {
      if (i === j) continue;
      if (Math.abs(i - j) < minGap) continue;
      slotPairs.push([i, j]);
    }
  }
  // 偏好两端
  slotPairs.sort((p, q) => {
    const pe = (p[0] === 0 || p[0] === G - 1 ? 0 : 1) + (p[1] === 0 || p[1] === G - 1 ? 0 : 1);
    const qe = (q[0] === 0 || q[0] === G - 1 ? 0 : 1) + (q[1] === 0 || q[1] === G - 1 ? 0 : 1);
    return pe - qe || Math.abs(q[0] - q[1]) - Math.abs(p[0] - p[1]);
  });

  for (const [giA, giB] of slotPairs) {
    // 复制不可用；就地试，失败不回滚复杂状态——用 locate 后多次 move
    const beforeA = locateName(groups, nameA);
    const beforeB = locateName(groups, nameB);
    if (!beforeA || !beforeB) break;
    const okA = moveNameToGroup(groups, nameA, giA, new Set([canonicalName(nameB), ...protect]));
    const okB = moveNameToGroup(groups, nameB, giB, new Set([canonicalName(nameA), ...protect]));
    const a = locateName(groups, nameA);
    const b = locateName(groups, nameB);
    if (okA && okB && a && b && Math.abs(a.gi - b.gi) >= minGap) return { ok: true };
    // 粗回滚：若弄得更差就再试把他们换回原组
    if (beforeA) moveNameToGroup(groups, nameA, beforeA.gi, protect);
    if (beforeB) moveNameToGroup(groups, nameB, beforeB.gi, protect);
  }

  const a2 = locateName(groups, nameA);
  const b2 = locateName(groups, nameB);
  if (a2 && b2 && Math.abs(a2.gi - b2.gi) >= minGap) return { ok: true };
  return { ok: false, reason: `${nameA}/${nameB} 无法拉开 ≥${minGap} 组` };
}

function balancedCost(groups) {
  const top4s = groups.map((g) => groupTopK(g, 4));
  const avgs = groups.map((g) => (g.length ? groupTotal(g) / g.length : 0));
  const range = (arr) => Math.max(...arr) - Math.min(...arr);
  let mono = 0;
  for (const g of groups) {
    const sorted = [...g].sort(compareStrength);
    if (sorted.length >= 2) {
      const a = strengthOf(sorted[0]);
      const b = strengthOf(sorted[1]);
      if (b > 0 && a > 2.4 * b) mono += a - 2.4 * b;
    }
  }
  return range(top4s) * 4 + range(avgs) * 2 + mono * 0.05;
}

function hillClimbBalance(groups, lockedNames, rounds = 8000) {
  const G = groups.length;
  let best = balancedCost(groups);
  for (let r = 0; r < rounds; r += 1) {
    const g1 = Math.floor(Math.random() * G);
    let g2 = Math.floor(Math.random() * G);
    if (g1 === g2) continue;
    const c1 = groups[g1]
      .map((m, mi) => ({ m, mi }))
      .filter(({ m }) => !lockedNames.has(canonicalName(m.name)));
    const c2 = groups[g2]
      .map((m, mi) => ({ m, mi }))
      .filter(({ m }) => !lockedNames.has(canonicalName(m.name)));
    if (!c1.length || !c2.length) continue;
    const a = c1[Math.floor(Math.random() * c1.length)];
    const b = c2[Math.floor(Math.random() * c2.length)];
    swapMembers(groups, { gi: g1, mi: a.mi }, { gi: g2, mi: b.mi });
    // 约束复检由调用方在 climb 外层做；这里只优化均衡
    const cost = balancedCost(groups);
    if (cost <= best) best = cost;
    else swapMembers(groups, { gi: g1, mi: a.mi }, { gi: g2, mi: b.mi });
  }
}

function formatHm(totalMinutes) {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function attachSchedule(groups, { firstStart = "08:15", stepMinutes = 15 } = {}) {
  const match = String(firstStart).match(/^(\d{1,2}):(\d{2})$/);
  const start = match ? Number(match[1]) * 60 + Number(match[2]) : 8 * 60 + 15;
  return groups.map((g, i) => ({
    ...g,
    startTime: formatHm(start + i * stepMinutes),
    scheduleLabel: `${formatHm(start + i * stepMinutes)} 开始连麦`,
  }));
}

/**
 * @param {object} options
 * @param {Array<{name:string, trimmedAvg?:number, wave?:number, personId?:number}>} options.members
 * @param {'balanced'|'high_to_low'} [options.mode] 默认 high_to_low（wave 总分从高到低）
 * @param {number} [options.groupSize]
 * @param {number} [options.minGap]
 * @param {Array<[string,string]>} [options.gapPairs]
 * @param {string} [options.firstStart]
 * @param {number} [options.stepMinutes]
 */

function buildPkGroupsFromNameGroups(options = {}) {
  const nameGroups = Array.isArray(options.nameGroups) && options.nameGroups.length
    ? options.nameGroups
    : PRESET_BATTLE_GROUPS;
  const scoreField =
    options.scoreField === "latestWave" || options.scoreField === "latest"
      ? "latestWave"
      : "wave";
  const firstStart = options.firstStart || PRESET_BATTLE_META.firstStart || "08:15";
  const stepMinutes = Number(options.stepMinutes) || PRESET_BATTLE_META.stepMinutes || 15;
  const rawMembers = Array.isArray(options.members) ? options.members : [];

  const byKey = new Map();
  for (const item of rawMembers) {
    const name = String(item?.name || "").trim();
    if (!name) continue;
    const key = canonicalName(name);
    if (byKey.has(key)) continue;
    const originalWave = Number(item.wave || 0);
    const latestWave = Number(item.latestWave ?? item.latest_wave ?? 0);
    const strengthWave = scoreField === "latestWave" ? latestWave : originalWave;
    byKey.set(key, {
      personId: item.personId ?? item.person_id ?? null,
      name,
      gender: item.gender || "",
      wave: strengthWave,
      originalWave,
      latestWave,
      trimmedAvg: Number(item.trimmedAvg ?? item.trimmed ?? 0),
      anchorId: item.anchorId || item.anchor_id || "",
    });
  }

  const missingNames = [];
  const used = new Set();
  const rawGroups = nameGroups.map((names, gi) => {
    const members = [];
    for (const rawName of names || []) {
      const name = String(rawName || "").trim();
      if (!name) continue;
      const key = canonicalName(name);
      const hit = byKey.get(key);
      if (!hit || used.has(key)) {
        missingNames.push(name);
        members.push({
          personId: null,
          name,
          gender: "",
          wave: 0,
          originalWave: 0,
          latestWave: 0,
          trimmedAvg: 0,
          anchorId: "",
        });
        continue;
      }
      used.add(key);
      members.push(hit);
    }
    return members;
  });

  const withStats = rawGroups.map((membersInGroup, index) => {
    const top4 = groupTopK(membersInGroup, 4);
    const total = groupTotal(membersInGroup);
    return {
      label: `第${index + 1}组`,
      order: index + 1,
      members: membersInGroup,
      top4,
      average: membersInGroup.length ? total / membersInGroup.length : 0,
    };
  });

  const staged = attachSchedule(withStats, { firstStart, stepMinutes });
  const ranked = staged
    .map((g, i) => ({ i, top4: g.top4 }))
    .sort((a, b) => b.top4 - a.top4 || a.i - b.i);
  const notes = [
    ...(Array.isArray(PRESET_BATTLE_META.notes) ? PRESET_BATTLE_META.notes : []),
    missingNames.length ? `缺人占位：${missingNames.join("、")}` : null,
  ].filter(Boolean);

  return {
    ok: true,
    mode: "preset",
    modeLabel: MODE_LABELS.preset,
    total: staged.reduce((s, g) => s + g.members.length, 0),
    groupCount: staged.length,
    sizes: staged.map((g) => g.members.length),
    minGap: Number(options.minGap) || DEFAULT_MIN_GAP,
    scoreField,
    strongestSlot: 5,
    strongestGroup: (ranked[0]?.i ?? 4) + 1,
    constraints: notes,
    warning: missingNames.length ? `内置缺人：${missingNames.join("、")}` : null,
    groups: staged.map((g) => ({
      label: g.label,
      order: g.order,
      startTime: g.startTime,
      scheduleLabel: g.scheduleLabel,
      count: g.members.length,
      top4: Math.round(g.top4),
      average: Math.round(g.average),
      members: g.members.map((m, idx) => ({
        index: idx + 1,
        name: m.name,
        personId: m.personId,
        wave: Number(m.originalWave ?? m.wave ?? 0),
        latestWave: Number(m.latestWave ?? 0),
        trimmedAvg: Math.round(m.trimmedAvg || 0),
        strength: Math.round(strengthOf(m)),
      })),
    })),
  };
}

function buildPkGroups(options = {}) {
  const mode = normalizeMode(options.mode);
  if (mode === "preset") {
    return buildPkGroupsFromNameGroups({
      ...options,
      nameGroups: options.nameGroups || PRESET_BATTLE_GROUPS,
      firstStart: options.firstStart || PRESET_BATTLE_META.firstStart,
      stepMinutes: options.stepMinutes || PRESET_BATTLE_META.stepMinutes,
    });
  }
  const groupSize = Math.max(4, Number(options.groupSize) || DEFAULT_GROUP_SIZE);
  const minGap = Math.max(1, Number(options.minGap) || DEFAULT_MIN_GAP);
  const scoreField =
    options.scoreField === "latestWave" || options.scoreField === "latest"
      ? "latestWave"
      : "wave";
  const gapPairs = normalizeGapPairs(
    Array.isArray(options.gapPairs) && options.gapPairs.length
      ? options.gapPairs
      : DEFAULT_GAP_PAIRS,
    minGap
  );
  const rawMembers = Array.isArray(options.members) ? options.members : [];

  // 去重
  const seen = new Set();
  const members = [];
  for (const item of rawMembers) {
    const name = String(item?.name || "").trim();
    if (!name) continue;
    const key = canonicalName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const originalWave = Number(item.wave || 0);
    const latestWave = Number(item.latestWave ?? item.latest_wave ?? 0);
    const strengthWave = scoreField === "latestWave" ? latestWave : originalWave;
    members.push({
      personId: item.personId ?? item.person_id ?? null,
      name,
      gender: item.gender || "",
      wave: strengthWave,
      originalWave,
      latestWave,
      trimmedAvg: Number(item.trimmedAvg ?? item.trimmed ?? 0),
      anchorId: item.anchorId || item.anchor_id || "",
    });
  }

  if (members.length === 0) {
    return { ok: false, error: "没有可分组的成员", mode, groups: [] };
  }

  const sizes = buildGroupSizes(members.length, groupSize, {
    gapPairs,
    minGap,
    memberNames: members.map((m) => m.name),
  });
  let warning = null;
  if (members.length < 16 && sizes.length < 4) {
    warning = `人数不足 16，组数降为 ${sizes.length}`;
  }
  const sorted = [...members].sort(compareStrength);

  const locked = new Set();
  for (const { a, b } of gapPairs) {
    locked.add(canonicalName(a));
    locked.add(canonicalName(b));
  }

  // high_to_low：其余人严格高低切块，特殊人后置插入
  // balanced：全员蛇形后再 enforce / 爬山
  // score_capable：高保底 + 补最弱组
  let rawGroups;
  if (mode === "high_to_low") {
    rawGroups = assignHighToLowExceptSpecials(sorted, sizes, gapPairs, minGap);
  } else if (mode === "score_capable") {
    rawGroups = assignScoreCapable(sorted, sizes, gapPairs, minGap);
  } else {
    rawGroups = assignSerpentine(sorted, sizes);
  }

  const constraintNotes = [];
  for (const { a, b, minGap: pairGap } of gapPairs) {
    const result = enforceGapPair(rawGroups, a, b, pairGap, locked);
    if (!result.ok) {
      return {
        ok: false,
        error: result.reason || `约束失败: ${a}/${b}`,
        mode,
        groups: [],
      };
    }
    const locA = locateName(rawGroups, a);
    const locB = locateName(rawGroups, b);
    constraintNotes.push(
      `${a}↔${b} 间隔 ${Math.abs(locA.gi - locB.gi)} 组（要求≥${pairGap}）`
    );
  }

  // 人数对齐 sizes（插入/交换后可能略偏）
  for (let gi = 0; gi < rawGroups.length; gi += 1) {
    while (rawGroups[gi].length > sizes[gi]) {
      // 多出的最弱非锁丢到仍缺人的组
      const extras = rawGroups[gi]
        .map((m, mi) => ({ m, mi }))
        .filter(({ m }) => !locked.has(canonicalName(m.name)))
        .sort((x, y) => strengthOf(x.m) - strengthOf(y.m));
      if (!extras.length) break;
      let dest = -1;
      for (let dj = 0; dj < rawGroups.length; dj += 1) {
        if (dj !== gi && rawGroups[dj].length < sizes[dj]) {
          dest = dj;
          break;
        }
      }
      if (dest < 0) break;
      const victim = extras[0];
      rawGroups[gi].splice(victim.mi, 1);
      rawGroups[dest].push(victim.m);
    }
  }

  if (mode === "balanced") {
    // 爬山时暂时允许动非锁；每次后重新 enforce gap
    for (let pass = 0; pass < 3; pass += 1) {
      hillClimbBalance(rawGroups, locked, 5000);
      let broken = false;
      for (const { a, b, minGap: pairGap } of gapPairs) {
        const again = enforceGapPair(rawGroups, a, b, pairGap, locked);
        if (!again.ok) {
          broken = true;
          break;
        }
      }
      if (broken) break;
    }
  }

  // 组内从高到低
  rawGroups = rawGroups.map((membersInGroup) => [...membersInGroup].sort(compareStrength));

  // 成员阶段再确认 gap 对已分到不同组（间隔由出场排列保证）
  for (const { a, b, minGap: pairGap } of gapPairs) {
    const locA = locateName(rawGroups, a);
    const locB = locateName(rawGroups, b);
    if (!locA || !locB) {
      return {
        ok: false,
        error: `名单中缺少 ${!locA ? a : b}`,
        mode,
        groups: [],
      };
    }
    if (locA.gi === locB.gi) {
      // 同组无法靠出场拉开，再强制拆开
      const again = enforceGapPair(
        rawGroups,
        a,
        b,
        Math.min(pairGap, Math.max(1, rawGroups.length - 1)),
        locked
      );
      if (!again.ok || locateName(rawGroups, a)?.gi === locateName(rawGroups, b)?.gi) {
        return {
          ok: false,
          error: again.reason || `${a}/${b} 无法分到不同组`,
          mode,
          groups: [],
        };
      }
    }
  }

  // 微调归属：特殊人离开最强组，便于「最强第3 + 两端 gap」同时成立
  rawGroups = repairMembershipForStageConstraints(rawGroups, gapPairs, minGap, locked);
  rawGroups = rawGroups.map((membersInGroup) => [...membersInGroup].sort(compareStrength));

  const strongestSlotPreferred = 3; // 第 4 场（0-based）
  const units = rawGroups.map((membersInGroup, index) => ({
    key: `group-${index + 1}`,
    members: membersInGroup,
    average: membersInGroup.length ? groupTotal(membersInGroup) / membersInGroup.length : 0,
    top4: groupTopK(membersInGroup, 4),
  }));

  let staged = arrangeStagesAtomic(units, gapPairs, minGap, strongestSlotPreferred);
  // 重算指标（排列不改成员）
  staged = staged.map((g, index) => {
    const sortedMembers = [...g.members].sort(compareStrength);
    return {
      key: `group-${index + 1}`,
      label: `第${index + 1}组`,
      order: index + 1,
      members: sortedMembers,
      average: sortedMembers.length ? groupTotal(sortedMembers) / sortedMembers.length : 0,
      top4: groupTopK(sortedMembers, 4),
    };
  });

  const wantStrongSlot = resolveStrongestSlot(staged.length, strongestSlotPreferred);
  const finalNotes = [];
  for (const { a, b, minGap: pairGap } of gapPairs) {
    const locA = locateName(staged.map((g) => g.members), a);
    const locB = locateName(staged.map((g) => g.members), b);
    if (!locA || !locB || Math.abs(locA.gi - locB.gi) < pairGap) {
      return {
        ok: false,
        error: `最终校验 ${a}/${b} 间隔不足（第${(locA?.gi ?? -1) + 1}组 与 第${(locB?.gi ?? -1) + 1}组，要求≥${pairGap}）`,
        mode,
        groups: [],
      };
    }
    finalNotes.push(
      `${a}↔${b} 间隔 ${Math.abs(locA.gi - locB.gi)} 组（要求≥${pairGap}）`
    );
  }

  staged = attachSchedule(staged, {
    firstStart: options.firstStart || "08:15",
    stepMinutes: Number(options.stepMinutes) || 15,
  });

  const finalStrongestIdx = indexOfStrongest(staged);
  // 组数须留给 gap 对「避开最强槽」的空间：n ≥ maxPairGap+2 时才强校验最强钉位
  const maxPairGap = gapPairs.reduce((m, p) => Math.max(m, p.minGap || minGap), minGap);
  const canPinStrongestHard = staged.length >= maxPairGap + 2;
  if (
    canPinStrongestHard &&
    isUniquelyStrongestAt(staged, finalStrongestIdx) &&
    finalStrongestIdx !== wantStrongSlot
  ) {
    return {
      ok: false,
      error: `最强组应在第 ${wantStrongSlot + 1} 场，当前在第 ${finalStrongestIdx + 1} 场`,
      mode,
      groups: [],
    };
  }
  if (staged.length > 1 && finalStrongestIdx === 0 && isUniquelyStrongestAt(staged, 0)) {
    return {
      ok: false,
      error: "最强组仍落在第 1 场",
      mode,
      groups: [],
    };
  }

  return {
    ok: true,
    mode,
    modeLabel: MODE_LABELS[mode] || "顺序分组",
    total: members.length,
    groupCount: staged.length,
    sizes: staged.map((g) => g.members.length),
    minGap,
    scoreField,
    warning: warning || undefined,
    strongestSlot: wantStrongSlot + 1,
    constraints: finalNotes.length ? finalNotes : constraintNotes,
    strongestGroup: finalStrongestIdx + 1,
    groups: staged.map((g) => ({
      label: g.label,
      order: g.order,
      startTime: g.startTime,
      scheduleLabel: g.scheduleLabel,
      count: g.members.length,
      top4: Math.round(g.top4),
      average: Math.round(g.average),
      members: g.members.map((m, idx) => ({
        index: idx + 1,
        name: m.name,
        personId: m.personId,
        wave: Number(m.originalWave ?? m.wave ?? 0),
        latestWave: Number(m.latestWave ?? 0),
        trimmedAvg: Math.round(m.trimmedAvg || 0),
        strength: Math.round(strengthOf(m)),
      })),
    })),
  };
}

function formatGroupsText(result) {
  if (!result?.ok) return result?.error || "分组失败";
  const lines = [
    `【${result.modeLabel}】共 ${result.total} 人 · ${result.groupCount} 组 · ${result.sizes.join("+")}`,
    `约束：${(result.constraints || []).join("；") || "无"}`,
    `最强组：第 ${result.strongestGroup} 组（目标第 ${result.strongestSlot || 3} 场）`,
    "",
  ];
  for (const g of result.groups) {
    lines.push(
      `${g.label} · ${g.scheduleLabel} · ${g.count}人 · top4 ${g.top4} · 均 ${g.average}`
    );
    lines.push(g.members.map((m) => m.name).join("、"));
    lines.push("");
  }
  return lines.join("\n").trim();
}

function groupsToCsv(result) {
  if (!result?.ok) return "";
  const header = ["组序", "组名", "开场时间", "组内序号", "姓名", "去峰日均", "月音浪", "战力"];
  const rows = [header];
  for (const g of result.groups) {
    for (const m of g.members) {
      rows.push([
        g.order,
        g.label,
        g.startTime,
        m.index,
        m.name,
        m.trimmedAvg,
        m.wave,
        m.strength,
      ]);
    }
  }
  const escape = (value) => {
    const s = String(value ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return `﻿${rows.map((row) => row.map(escape).join(",")).join("\n")}`;
}

module.exports = {
  DEFAULT_GROUP_SIZE,
  DEFAULT_MIN_GAP,
  YANG_MU_MIN_GAP,
  DEFAULT_GAP_PAIRS,
  MODE_LABELS,
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_META,
  canonicalName,
  normalizeName,
  normalizeMode,
  normalizeGapPairs,
  validateGroupsGap,
  strengthOf,
  resolveTargetGroupCount,
  buildGroupSizes,
  optimalStageOrder,
  buildPkGroups,
  buildPkGroupsFromNameGroups,
  formatGroupsText,
  groupsToCsv,
};
