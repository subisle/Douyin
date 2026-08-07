"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalName,
  validateGroupsGap,
  formatGapViolation,
  DEFAULT_GAP_PAIRS,
} = require("./pk-group-constraints");

test("canonicalName aliases", () => {
  assert.equal(canonicalName("阿楠"), "南方楠");
  assert.equal(canonicalName("狼宝"), "狼小宝");
});

test("validateGroupsGap ok when pairs far enough", () => {
  const groups = [
    { members: [{ name: "浩阳" }, { name: "玖依" }, { name: "狼九" }, { name: "A" }] },
    { members: [{ name: "B" }] },
    { members: [{ name: "C" }] },
    { members: [{ name: "D" }] },
    { members: [{ name: "浩沐" }, { name: "E" }] },
    { members: [{ name: "啸泽" }] },
    { members: [{ name: "F" }] },
    { members: [{ name: "G" }] },
    { members: [{ name: "啸帆" }, { name: "狼影" }, { name: "狼裕" }] },
  ];
  // 浩阳@0 浩沐@4 →4；啸泽@5 啸帆@8 →3；玖依@0 狼影@8 →8；狼九@0 狼裕@8 →8
  const r = validateGroupsGap(groups, DEFAULT_GAP_PAIRS);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test("validateGroupsGap fails when 阳沐 too close", () => {
  const groups = [
    { members: [{ name: "浩阳" }, { name: "玖依" }, { name: "狼九" }] },
    { members: [{ name: "浩沐" }] },
    { members: [{ name: "啸泽" }] },
    { members: [{ name: "啸帆" }, { name: "狼影" }, { name: "狼裕" }] },
  ];
  const r = validateGroupsGap(groups);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.a === "浩阳" && v.reason === "gap"));
  assert.match(formatGapViolation(r.violations[0]), /浩阳|间隔/);
});

test("validateGroupsGap fails when 玖依狼影 or 狼九狼裕 too close", () => {
  const groups = [
    { members: [{ name: "玖依" }, { name: "狼九" }] },
    { members: [{ name: "狼影" }, { name: "狼裕" }] }, // gap 1 < 3
    { members: [{ name: "啸泽" }] },
    { members: [{ name: "X" }] },
    { members: [{ name: "啸帆" }] },
  ];
  const r = validateGroupsGap(groups);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.a === "玖依" && v.b === "狼影"));
  assert.ok(r.violations.some((v) => v.a === "狼九" && v.b === "狼裕"));
});

test("DEFAULT_GAP_PAIRS includes 三对间隔 + 阳沐", () => {
  const keys = DEFAULT_GAP_PAIRS.map((p) => `${p.a}|${p.b}|${p.minGap}`).sort();
  assert.ok(keys.some((k) => k.startsWith("啸泽|啸帆|3")));
  assert.ok(keys.some((k) => k.startsWith("玖依|狼影|3")));
  assert.ok(keys.some((k) => k.startsWith("狼九|狼裕|3")));
  assert.ok(keys.some((k) => k.startsWith("浩阳|浩沐|4")));
});
