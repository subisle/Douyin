"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePresetGroupRankCommand,
  buildPresetGroupRank,
  formatPresetGroupRankText,
  groupStartTime,
  getPresetGroupNames,
  gapToPlace,
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

test("groupStartTime steps 15 minutes from 08:15", () => {
  assert.equal(groupStartTime(1), "08:15");
  assert.equal(groupStartTime(2), "08:30");
  assert.equal(groupStartTime(5), "09:15");
  assert.equal(groupStartTime(7), "09:45");
});

test("gapToPlace is zero inside target and positive outside", () => {
  assert.equal(gapToPlace(100, 8, 10, 200), 0);
  assert.equal(gapToPlace(100, 28, 20, 150), 50);
  assert.equal(gapToPlace(150, 28, 20, 150), 0);
});

test("build + format includes overall rank and gaps to top10/top20", () => {
  const names = getPresetGroupNames(1);
  assert.ok(names.includes("啸辰"));

  // 造 28 人榜：第10=500000，第20=300000；狼瑞故意设为第28附近
  const wave = {};
  for (let i = 1; i <= 30; i += 1) {
    wave[`占位${String(i).padStart(2, "0")}`] = 1_000_000 - i * 10_000;
  }
  // 覆盖组员
  Object.assign(wave, {
    啸辰: 1_085_399, // 应很靠前
    狼腾: 542_417,
    浩龙: 269_917,
    狼凯: 242_200,
    狼佑: 140_406,
    浩泽: 140_084,
    狼哲: 108_877,
    狼瑞: 32_942, // 很靠后
  });

  const rank = buildPresetGroupRank(1, wave);
  assert.equal(rank.ok, true);
  assert.equal(rank.rows[0].name, "啸辰");
  assert.ok(rank.rows[0].overallRank <= 10);
  assert.equal(rank.rows[0].gapTop10, 0);

  const last = rank.rows.find((r) => r.name === "狼瑞");
  assert.ok(last);
  assert.ok(last.overallRank > 20);
  assert.ok(last.gapTop10 > 0);
  assert.ok(last.gapTop20 > 0);

  const text = formatPresetGroupRankText(rank, { asOfDate: "2026-07-30" });
  assert.match(text, /第1组总分 · 08:15 · 截至 2026-07-30/);
  assert.match(text, /啸辰 .*已进前10/);
  assert.match(text, /狼瑞 .*距前10差/);
  assert.match(text, /狼瑞 .*距前20差/);
});
