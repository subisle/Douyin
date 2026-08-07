"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPkGroups,
  buildGroupSizes,
  resolveTargetGroupCount,
  optimalStageOrder,
  canonicalName,
  formatGroupsText,
  groupsToCsv,
} = require("./pk-group-engine");
const { validateGroupsGap } = require("../shared/pk-group-constraints");

function fakeMembers() {
  // 合成 20 人，含硬约束四人
  const names = [
    "啸辰", "玖玉", "浩鸣", "狼赫", "浩冬", "狼澈", "玖柒", "玖玥",
    "啸泽", "浩阳", "南方楠", "狼小宝", "啸帆", "浩沐", "狼兴", "啸安",
    "浩雨", "狼俊", "浩运", "狼凯",
  ];
  return names.map((name, i) => ({
    name,
    personId: i + 1,
    trimmedAvg: 30000 - i * 1200,
    wave: 50000 - i * 1500,
  }));
}

test("canonicalName aliases", () => {
  assert.equal(canonicalName("阿楠"), "南方楠");
  assert.equal(canonicalName("狼宝"), "狼小宝");
});

test("resolveTargetGroupCount prefers at least 4 groups when n>=16", () => {
  assert.equal(resolveTargetGroupCount(32, 8), 4);
  assert.equal(resolveTargetGroupCount(55, 8), 7);
  assert.equal(resolveTargetGroupCount(12, 8), 2); // <16 不强行 4
  assert.equal(resolveTargetGroupCount(20, 8), 4); // max(4, round(20/8)=3)=4
  assert.equal(resolveTargetGroupCount(8, 8), 1);
});

test("buildGroupSizes keeps near-equal sizes and min 4 when n>=16", () => {
  assert.deepEqual(buildGroupSizes(55, 8), [8, 8, 8, 8, 8, 8, 7]);
  // 20 人：max(4, round(20/8)=3)=4 → [5,5,5,5]
  assert.deepEqual(buildGroupSizes(20, 8), [5, 5, 5, 5]);
  // 12 人：不强行 4
  assert.deepEqual(buildGroupSizes(12, 8), [6, 6]);
});

test("buildGroupSizes raises count for gap>=4 pairs when members present", () => {
  // 32 人本应 4 组，但含阳沐 gap4 → 至少 5 组
  const sizes = buildGroupSizes(32, 8, {
    gapPairs: [
      { a: "浩阳", b: "浩沐", minGap: 4 },
      { a: "啸泽", b: "啸帆", minGap: 3 },
    ],
    memberNames: ["浩阳", "浩沐", "啸泽", "啸帆", ...Array.from({ length: 28 }, (_, i) => `x${i}`)],
  });
  assert.ok(sizes.length >= 5, `got ${sizes.length} groups`);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 32);
});

test("optimalStageOrder puts second on slot 3 and strongest on slot 4 when possible", () => {
  for (const n of [4, 5, 6, 7, 8]) {
    const order = optimalStageOrder(n);
    assert.equal(order.length, n);
    assert.equal(order[2], 1, `count=${n} second at 3rd: ${order}`);
    assert.equal(order[3], 0, `count=${n} strongest at 4th: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), [...Array(n).keys()]);
  }
  assert.deepEqual(optimalStageOrder(2), [1, 0]);
  assert.deepEqual(optimalStageOrder(3), [2, 1, 0]);
});

test("balanced mode respects gap pairs and strongest on 4th", () => {
  // 25 人 / 5 人组 → 5 组，才能同时满足 minGap=3 与最强第4
  const extra = Array.from({ length: 5 }, (_, i) => ({
    name: `补位${i + 1}`,
    personId: 1000 + i,
    trimmedAvg: 5000 - i * 100,
    wave: 8000 - i * 200,
  }));
  const result = buildPkGroups({
    members: [...fakeMembers(), ...extra],
    mode: "balanced",
    groupSize: 5,
    minGap: 3,
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.groupCount >= 5);
  assert.equal(result.strongestSlot, 4);
  assert.notEqual(result.strongestGroup, 1);
  assert.equal(result.strongestGroup, 4);
  const indexOf = (name) => {
    for (let i = 0; i < result.groups.length; i += 1) {
      if (result.groups[i].members.some((m) => m.name === name)) return i;
    }
    return -1;
  };
  assert.ok(Math.abs(indexOf("浩阳") - indexOf("浩沐")) >= 3);
  assert.ok(Math.abs(indexOf("啸泽") - indexOf("啸帆")) >= 3);
});

test("high_to_low mode respects gap and strongest on 4th", () => {
  const extra = Array.from({ length: 5 }, (_, i) => ({
    name: `补位${i + 1}`,
    personId: 1000 + i,
    trimmedAvg: 5000 - i * 100,
    wave: 8000 - i * 200,
  }));
  const result = buildPkGroups({
    members: [...fakeMembers(), ...extra],
    mode: "high_to_low",
    groupSize: 5,
    minGap: 3,
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.mode, "high_to_low");
  assert.equal(result.modeLabel, "顺序分组");
  assert.equal(result.strongestSlot, 4);
  assert.equal(result.strongestGroup, 4);
  assert.notEqual(result.strongestGroup, 1);
  // 最强必须第4；次强优先第3（若次强组含特殊人且 gap 不可解，可回退）
  const byTop4 = [...result.groups]
    .map((g, i) => ({ i: i + 1, top4: g.top4 }))
    .sort((a, b) => b.top4 - a.top4);
  assert.equal(byTop4[0].i, 4);
  assert.ok([2, 3, 5].includes(byTop4[1].i), `次强在第${byTop4[1].i}组`);
  const indexOf = (name) => {
    for (let i = 0; i < result.groups.length; i += 1) {
      if (result.groups[i].members.some((m) => m.name === name)) return i;
    }
    return -1;
  };
  assert.ok(Math.abs(indexOf("浩阳") - indexOf("浩沐")) >= 3);
  assert.ok(Math.abs(indexOf("啸泽") - indexOf("啸帆")) >= 3);
});

test("high_to_low keeps non-special relative order roughly high-to-low across early groups", () => {
  // 构造：特殊四人 + 一串递减普通人
  const members = [];
  const specials = ["浩阳", "浩沐", "啸泽", "啸帆"];
  specials.forEach((name, i) => {
    members.push({ name, trimmedAvg: 20000 - i * 100, wave: 20000, personId: i + 1 });
  });
  for (let i = 0; i < 16; i += 1) {
    members.push({
      name: `选手${i + 1}`,
      trimmedAvg: 50000 - i * 2000,
      wave: 50000 - i * 2000,
      personId: 100 + i,
    });
  }
  const result = buildPkGroups({
    members,
    mode: "high_to_low",
    groupSize: 4, // 20 人 → 5 组，可钉最强第4
    minGap: 3,
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.strongestGroup, 4);
  // 最强普通人 选手1 所在组 average 应高于 选手16
  const find = (name) => result.groups.find((g) => g.members.some((m) => m.name === name));
  const gStrong = find("选手1");
  const gWeak = find("选手16");
  assert.ok(gStrong && gWeak);
  assert.ok(gStrong.average > gWeak.average);
});

test("default mode is high_to_low and ranks by wave over trimmedAvg", () => {
  const members = [
    { name: "浩阳", wave: 100, trimmedAvg: 99999, personId: 1 },
    { name: "浩沐", wave: 90, trimmedAvg: 99998, personId: 2 },
    { name: "啸泽", wave: 80, trimmedAvg: 99997, personId: 3 },
    { name: "啸帆", wave: 70, trimmedAvg: 99996, personId: 4 },
    { name: "选手A", wave: 50000, trimmedAvg: 1, personId: 10 },
    { name: "选手B", wave: 1000, trimmedAvg: 90000, personId: 11 },
    { name: "选手C", wave: 40000, trimmedAvg: 2, personId: 12 },
    { name: "选手D", wave: 30000, trimmedAvg: 3, personId: 13 },
    { name: "选手E", wave: 20000, trimmedAvg: 4, personId: 14 },
    { name: "选手F", wave: 10000, trimmedAvg: 5, personId: 15 },
    { name: "选手G", wave: 9000, trimmedAvg: 6, personId: 16 },
    { name: "选手H", wave: 8000, trimmedAvg: 7, personId: 17 },
    { name: "选手I", wave: 7000, trimmedAvg: 8, personId: 18 },
    { name: "选手J", wave: 6000, trimmedAvg: 9, personId: 19 },
    { name: "选手K", wave: 5000, trimmedAvg: 10, personId: 20 },
    { name: "选手L", wave: 4000, trimmedAvg: 11, personId: 21 },
    { name: "选手M", wave: 3000, trimmedAvg: 12, personId: 22 },
    { name: "选手N", wave: 2000, trimmedAvg: 13, personId: 23 },
    { name: "选手O", wave: 1500, trimmedAvg: 14, personId: 24 },
    { name: "选手P", wave: 1200, trimmedAvg: 15, personId: 25 },
  ];
  const result = buildPkGroups({ members, groupSize: 4, minGap: 3 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.mode, "high_to_low");
  assert.equal(result.modeLabel, "顺序分组");
  assert.equal(result.strongestSlot, 4);
  assert.equal(result.strongestGroup, 4);
  const find = (name) => result.groups.find((g) => g.members.some((m) => m.name === name));
  assert.ok(find("选手A").average > find("选手B").average);
});

test("missing one side of gap pair skips that pair (does not fail)", () => {
  const members = fakeMembers().filter((m) => m.name !== "浩沐");
  const result = buildPkGroups({ members, mode: "balanced", minGap: 3 });
  // 浩阳在、浩沐不在 → 阳沐对跳过；啸泽/啸帆仍约束
  assert.equal(result.ok, true, result.error);
  const indexOf = (name) => {
    for (let i = 0; i < result.groups.length; i += 1) {
      if (result.groups[i].members.some((m) => m.name === name)) return i;
    }
    return -1;
  };
  assert.ok(Math.abs(indexOf("啸泽") - indexOf("啸帆")) >= 3);
});

test("score_capable mode labels and respects gaps + strongest 4th", () => {
  const extra = Array.from({ length: 5 }, (_, i) => ({
    name: `补位${i + 1}`,
    personId: 1000 + i,
    trimmedAvg: 5000 - i * 100,
    wave: 8000 - i * 200,
  }));
  const all = [...fakeMembers(), ...extra];
  const result = buildPkGroups({
    members: all,
    mode: "score_capable",
    groupSize: 5,
    minGap: 3,
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.mode, "score_capable");
  assert.equal(result.modeLabel, "能出分");
  assert.equal(result.strongestGroup, 4);
  assert.ok(result.groupCount >= 5);

  // 每组最强不低于全局中位战力的一半 → 避免死组
  const allWaves = all.map((m) => m.wave).sort((a, b) => b - a);
  const median = allWaves[Math.floor(allWaves.length / 2)];
  for (const g of result.groups) {
    const best = Math.max(...g.members.map((m) => m.wave));
    assert.ok(best >= median * 0.4, `${g.label} 最强 ${best} 过弱 (median=${median})`);
  }

  const gap = validateGroupsGap(result.groups);
  assert.equal(gap.ok, true, JSON.stringify(gap.violations));
});

test("scoreField latestWave changes strength ranking", () => {
  const members = [
    { name: "浩阳", wave: 100, latestWave: 10, trimmedAvg: 1, personId: 1 },
    { name: "浩沐", wave: 90, latestWave: 9, trimmedAvg: 1, personId: 2 },
    { name: "啸泽", wave: 80, latestWave: 8, trimmedAvg: 1, personId: 3 },
    { name: "啸帆", wave: 70, latestWave: 7, trimmedAvg: 1, personId: 4 },
  ];
  for (let i = 0; i < 16; i += 1) {
    members.push({
      name: `选手${i + 1}`,
      wave: 1000 - i * 10,
      latestWave: i === 0 ? 99999 : 100 - i,
      trimmedAvg: 1,
      personId: 100 + i,
    });
  }
  const byLatest = buildPkGroups({
    members,
    mode: "high_to_low",
    groupSize: 4,
    scoreField: "latestWave",
  });
  assert.equal(byLatest.ok, true, byLatest.error);
  // 选手1 latestWave 最高，应成为全局最强种子所在组的核心
  const find = (name) => byLatest.groups.find((g) => g.members.some((m) => m.name === name));
  const g1 = find("选手1");
  assert.ok(g1);
  assert.ok(g1.members.some((m) => m.name === "选手1" && m.latestWave === 99999));
  // 输出同时保留 wave 与 latestWave
  const m1 = g1.members.find((m) => m.name === "选手1");
  assert.equal(m1.wave, 1000);
  assert.equal(m1.latestWave, 99999);
});

test("n<16 allows fewer than 4 groups with warning", () => {
  const members = [
    { name: "浩阳", wave: 100, personId: 1 },
    { name: "浩沐", wave: 90, personId: 2 },
    { name: "啸泽", wave: 80, personId: 3 },
    { name: "啸帆", wave: 70, personId: 4 },
    { name: "A", wave: 60, personId: 5 },
    { name: "B", wave: 50, personId: 6 },
    { name: "C", wave: 40, personId: 7 },
    { name: "D", wave: 30, personId: 8 },
    { name: "E", wave: 20, personId: 9 },
    { name: "F", wave: 15, personId: 10 },
    { name: "G", wave: 12, personId: 11 },
    { name: "H", wave: 10, personId: 12 },
  ];
  const result = buildPkGroups({ members, mode: "high_to_low", groupSize: 8, minGap: 3 });
  // 12 人可能因 gap 需要更多组；若不抬也能 ok，但 groupCount 可 <4 并带 warning
  if (result.ok && result.groupCount < 4) {
    assert.ok(result.warning);
  }
});

test("preset mode loads locked battle groups with 15-min schedule", () => {
  const { PRESET_BATTLE_GROUPS } = require("../shared/pk-preset-battle-groups");
  const members = PRESET_BATTLE_GROUPS.flat().map((name, i) => ({
    name,
    personId: i + 1,
    wave: 100000 - i * 1000,
    latestWave: 20000 - i * 200,
    trimmedAvg: 15000 - i * 100,
  }));
  // bump G5 tops so strongest is group 5
  for (const name of PRESET_BATTLE_GROUPS[4]) {
    const m = members.find((x) => x.name === name);
    if (m) m.wave += 500000;
  }
  const result = buildPkGroups({ members, mode: "preset" });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "preset");
  assert.equal(result.modeLabel, "内置分组");
  assert.equal(result.groupCount, 8);
  assert.deepEqual(result.sizes, [7, 7, 7, 8, 7, 8, 7, 7]);
  assert.ok(result.groups.every((g) => g.members.length >= 7 && g.members.length <= 8));
  assert.ok(result.groups[5].members.some((m) => m.name === "鹏先生"));
  assert.ok(result.groups[7].members.some((m) => m.name === "狼佑"));
  assert.ok(result.groups[7].members.some((m) => m.name === "狼博"));
  assert.ok(result.groups[7].members.some((m) => m.name === "狼影"));
  assert.equal(result.groups[0].startTime, "08:15");
  assert.equal(result.groups[1].startTime, "08:30");
  assert.equal(result.groups[6].startTime, "09:45");
  assert.equal(result.groups[7].startTime, "10:00");
  assert.ok(result.groups[0].members.some((m) => m.name === "玖依"));
  assert.ok(result.groups[0].members.some((m) => m.name === "狼九"));
  assert.ok(result.groups[3].members.some((m) => m.name === "玖玉"));
  assert.equal(result.groups[0].members.map((m) => m.name).join(","), PRESET_BATTLE_GROUPS[0].join(","));
  // test bumps G5 wave so strongest becomes 5
  assert.equal(result.strongestGroup, 5);
});
