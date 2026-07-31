"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { buildPkGroups } = require("./pk-group-engine");
const { renderPkGroupsPng, renderPkGroupsSvg } = require("./pk-group-image");

test("renderPkGroupsPng produces a real PNG", async () => {
  const members = [];
  for (let i = 0; i < 25; i += 1) {
    members.push({
      name: `选手${i}`,
      trimmedAvg: 30000 - i * 1000,
      wave: 40000 - i * 1200,
      personId: i + 1,
    });
  }
  members[0].name = "浩阳";
  members[1].name = "浩沐";
  members[2].name = "啸泽";
  members[3].name = "啸帆";

  const result = buildPkGroups({
    members,
    mode: "high_to_low",
    groupSize: 5,
    minGap: 3,
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.groupCount >= 5, `groupCount=${result.groupCount}`);

  const svg = renderPkGroupsSvg(result, {
    period: "2026-07",
    title: "星嗨艺创",
    constraints: result.constraints,
  });
  assert.match(svg, /<svg/);
  assert.match(svg, /第1组/);
  assert.match(svg, /星嗨艺创/);
  assert.match(svg, /XINGHAI YICHUANG/);
  // 默认不带音浪数字（成员行不渲染万/亿）
  assert.doesNotMatch(svg, /\d+(\.\d+)?万/);
  assert.doesNotMatch(svg, /T4 /);

  const png = await renderPkGroupsPng(result, {
    period: "2026-07",
    title: "星嗨艺创",
    constraints: result.constraints,
  });
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const meta = await sharp(png).metadata();
  assert.ok(meta.width >= 900);
  assert.ok(meta.height >= 400);
});

test("default export title is 星嗨艺创 and hides waves", () => {
  const result = {
    ok: true,
    modeLabel: "顺序分组",
    total: 8,
    groupCount: 2,
    strongestGroup: 2,
    groups: [
      {
        label: "第1组",
        order: 1,
        startTime: "08:15",
        top4: 42000,
        members: [
          { index: 1, name: "啸辰", strength: 12000, wave: 12000 },
          { index: 2, name: "狼凯", strength: 11000, wave: 11000 },
          { index: 3, name: "浩泽", strength: 10000, wave: 10000 },
          { index: 4, name: "狼瑞", strength: 9000, wave: 9000 },
        ],
      },
      {
        label: "第2组",
        order: 2,
        startTime: "08:30",
        top4: 500000,
        members: [
          { index: 1, name: "浩鸣", strength: 200000, wave: 200000 },
          { index: 2, name: "狼澈", strength: 150000, wave: 150000 },
          { index: 3, name: "玖玥", strength: 80000, wave: 80000 },
          { index: 4, name: "啸帆", strength: 70000, wave: 70000 },
        ],
      },
    ],
  };
  const svg = renderPkGroupsSvg(result, { period: "2026-07" });
  assert.match(svg, /星嗨艺创/);
  assert.doesNotMatch(svg, /最强/);
  assert.doesNotMatch(svg, /次强/);
  assert.doesNotMatch(svg, /星嗨争霸赛/);
  assert.doesNotMatch(svg, /T4 /);
  assert.doesNotMatch(svg, /\d+(\.\d+)?万/);
  // 显式打开音浪时才渲染
  const withWave = renderPkGroupsSvg(result, { period: "2026-07", showWave: true });
  assert.match(withWave, /T4 /);
  assert.match(withWave, /万/);
});
