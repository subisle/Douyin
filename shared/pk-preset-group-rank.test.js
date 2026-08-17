"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePresetGroupRankCommand,
  buildPresetGroupRank,
  formatPresetGroupRankText,
  formatGapSuffix,
  groupStartTime,
  getPresetGroupNames,
  gapToPlace,
  pickDisplayGapPlaces,
} = require("./pk-preset-group-rank");

test("parsePresetGroupRankCommand accepts 5组 / 第5组总分 / 各组", () => {
  assert.deepEqual(parsePresetGroupRankCommand("5组"), {
    type: "preset-group-rank",
    groupNo: 5,
    all: false,
  });
  assert.deepEqual(parsePresetGroupRankCommand("第5组总分"), {
    type: "preset-group-rank",
    groupNo: 5,
    all: false,
  });
  assert.deepEqual(parsePresetGroupRankCommand("第五组排名"), {
    type: "preset-group-rank",
    groupNo: 5,
    all: false,
  });
  assert.deepEqual(parsePresetGroupRankCommand("各组总分"), {
    type: "preset-group-rank",
    groupNo: null,
    all: true,
  });
  assert.equal(parsePresetGroupRankCommand("分组"), null);
  assert.equal(parsePresetGroupRankCommand("小张"), null);
});

test("groupStartTime steps 15 minutes from 12:15; group 5+ shifted +5 by revive", () => {
  assert.equal(groupStartTime(1), "12:15");
  assert.equal(groupStartTime(2), "12:30");
  assert.equal(groupStartTime(4), "13:00");
  assert.equal(groupStartTime(5), "13:20");
  assert.equal(groupStartTime(7), "13:50");
});

test("gapToPlace is zero inside target and positive outside", () => {
  assert.equal(gapToPlace(100, 8, 10, 200), 0);
  assert.equal(gapToPlace(100, 28, 20, 150), 50);
  assert.equal(gapToPlace(150, 28, 20, 150), 0);
});

test("pickDisplayGapPlaces adapts by overall rank", () => {
  assert.deepEqual(pickDisplayGapPlaces(8), [10]);
  assert.deepEqual(pickDisplayGapPlaces(15), [10, 20]);
  assert.deepEqual(pickDisplayGapPlaces(28), [10, 20]);
  assert.deepEqual(pickDisplayGapPlaces(35), [10, 30]);
  assert.deepEqual(pickDisplayGapPlaces(55), [10, 50]);
  assert.deepEqual(pickDisplayGapPlaces(120), [10, 100]);
});

test("build + format uses adaptive milestones (55→前50, 28→前20)", () => {
  const names = getPresetGroupNames(1);
  assert.ok(names.includes("狼澈"));
  assert.ok(names.includes("啸墨"));

  // 造 120 人榜，覆盖前50/前100 档；音浪只填第1组实名
  const wave = {};
  for (let i = 1; i <= 120; i += 1) {
    wave[`占位${String(i).padStart(3, "0")}`] = 2_000_000 - i * 10_000;
  }
  Object.assign(wave, {
    狼澈: 2_100_000, // 很靠前
    狼轩: 1_490_000, // ~#51 → 前50
    狼兴: 1_200_000,
    啸宇: 900_000,
    啸泽: 700_000,
    浩杰: 500_000,
    浩沐: 60_000, // 很靠后 → 前100
  });

  const rank = buildPresetGroupRank(1, wave);
  assert.equal(rank.ok, true);
  assert.equal(rank.rows[0].name, "狼澈");
  assert.ok(rank.rows[0].overallRank <= 10);
  assert.equal(rank.rows[0].gapTop10, 0);

  const near50 = rank.rows.find((r) => r.name === "狼轩");
  assert.ok(near50);
  assert.ok(near50.overallRank > 50, `expected 狼轩 rank>50 got ${near50.overallRank}`);
  assert.ok((near50.gaps?.[50] ?? 0) > 0);

  const last = rank.rows.find((r) => r.name === "浩沐");
  assert.ok(last);
  assert.ok(last.overallRank > 100, `expected 浩沐 rank>100 got ${last.overallRank}`);
  assert.ok(last.gapTop10 > 0);
  assert.ok((last.gaps?.[100] ?? 0) > 0);

  const text = formatPresetGroupRankText(rank, { asOfDate: "2026-07-30" });
  assert.match(text, /第1组总分 · 12:15 · 截至 2026-07-30/);
  assert.match(text, /狼澈 .*已进前10/);
  assert.match(text, /狼轩 .*距前50差/);
  assert.doesNotMatch(text, /狼轩 .*距前20差/);
  assert.match(text, /浩沐 .*距前10差/);
  assert.match(text, /浩沐 .*距前100差/);
  assert.doesNotMatch(text, /浩沐 .*距前20差/);

  // 中段名次仍展示前20
  const midSuffix = formatGapSuffix({
    overallRank: 28,
    gaps: { 10: 123000, 20: 31000, 30: 0, 50: 0, 100: 0 },
  });
  assert.match(midSuffix, /#28/);
  assert.match(midSuffix, /距前10差/);
  assert.match(midSuffix, /距前20差/);
  assert.doesNotMatch(midSuffix, /距前50差/);

  const farSuffix = formatGapSuffix({
    overallRank: 55,
    gaps: { 10: 400000, 20: 300000, 30: 200000, 50: 80000, 100: 0 },
  });
  assert.match(farSuffix, /#55/);
  assert.match(farSuffix, /距前50差/);
  assert.doesNotMatch(farSuffix, /距前20差/);
});
