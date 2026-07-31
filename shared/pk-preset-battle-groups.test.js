const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_META,
  flattenPresetRosterNames,
} = require("./pk-preset-battle-groups");

test("preset battle groups: 7x8 unique names", () => {
  assert.equal(PRESET_BATTLE_GROUPS.length, 7);
  const flat = flattenPresetRosterNames();
  assert.equal(flat.length, 56);
  assert.equal(new Set(flat).size, 56);
  for (const g of PRESET_BATTLE_GROUPS) {
    assert.equal(g.length, 8);
  }
  assert.equal(PRESET_BATTLE_META.firstStart, "08:15");
  assert.equal(PRESET_BATTLE_META.stepMinutes, 15);
});

test("preset anchors: 狼佑 G1 / 狼辉 G4 / 最强侧 G5", () => {
  assert.ok(PRESET_BATTLE_GROUPS[0].includes("狼佑"));
  assert.ok(PRESET_BATTLE_GROUPS[0].includes("浩泽"));
  assert.ok(PRESET_BATTLE_GROUPS[0].includes("浩杰"));
  assert.ok(PRESET_BATTLE_GROUPS[3].includes("狼凯"));
  assert.ok(PRESET_BATTLE_GROUPS[3].includes("狼辉"));
  assert.ok(PRESET_BATTLE_GROUPS[4].includes("啸帆"));
  assert.ok(PRESET_BATTLE_GROUPS[4].includes("浩鸣"));
  assert.ok(PRESET_BATTLE_GROUPS[6].includes("浩森"));
  assert.ok(PRESET_BATTLE_GROUPS[6].includes("浩沐"));
});
