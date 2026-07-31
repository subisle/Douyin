"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePresetGroupRankCommand,
  buildPresetGroupRank,
  formatPresetGroupRankText,
  groupStartTime,
  getPresetGroupNames,
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

test("build + format group rank sorts by wave", () => {
  const names = getPresetGroupNames(1);
  assert.ok(names.includes("啸辰"));
  const wave = {
    啸辰: 1_085_399,
    狼腾: 542_417,
    浩龙: 269_917,
    狼凯: 242_200,
    狼佑: 140_406,
    浩泽: 140_084,
    狼哲: 108_877,
    狼瑞: 32_942,
  };
  const rank = buildPresetGroupRank(1, wave);
  assert.equal(rank.ok, true);
  assert.deepEqual(rank.rows.map((r) => r.name), [
    "啸辰", "狼腾", "浩龙", "狼凯", "狼佑", "浩泽", "狼哲", "狼瑞",
  ]);
  const text = formatPresetGroupRankText(rank, { asOfDate: "2026-07-30" });
  assert.match(text, /第1组总分 · 08:15 · 截至 2026-07-30/);
  assert.match(text, /1 啸辰 108\.5万/);
  assert.match(text, /8 狼瑞 3\.3万/);
});
