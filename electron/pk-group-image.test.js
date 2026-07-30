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
    title: "PK 分组 · 顺序分组",
    constraints: result.constraints,
  });
  assert.match(svg, /<svg/);
  assert.match(svg, /第1组/);

  const png = await renderPkGroupsPng(result, {
    period: "2026-07",
    title: "PK 分组 · 顺序分组",
    constraints: result.constraints,
  });
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const meta = await sharp(png).metadata();
  assert.ok(meta.width >= 900);
  assert.ok(meta.height >= 400);
});
