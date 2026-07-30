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
    { members: [{ name: "浩阳" }, { name: "A" }] },
    { members: [{ name: "B" }] },
    { members: [{ name: "C" }] },
    { members: [{ name: "D" }] },
    { members: [{ name: "浩沐" }, { name: "E" }] },
    { members: [{ name: "啸泽" }] },
    { members: [{ name: "F" }] },
    { members: [{ name: "G" }] },
    { members: [{ name: "啸帆" }] },
  ];
  // 浩阳@0 浩沐@4 → gap 4；啸泽@5 啸帆@8 → gap 3
  const r = validateGroupsGap(groups, DEFAULT_GAP_PAIRS);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test("validateGroupsGap fails when 阳沐 too close", () => {
  const groups = [
    { members: [{ name: "浩阳" }] },
    { members: [{ name: "浩沐" }] },
    { members: [{ name: "啸泽" }] },
    { members: [{ name: "啸帆" }] },
  ];
  const r = validateGroupsGap(groups);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.a === "浩阳" && v.reason === "gap"));
  assert.match(formatGapViolation(r.violations[0]), /浩阳|间隔/);
});
