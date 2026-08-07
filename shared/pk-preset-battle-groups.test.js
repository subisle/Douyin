const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_META,
  PRESET_PROMO_GROUPS,
  PRESET_PROMO_META,
  flattenPresetRosterNames,
  flattenPromoRosterNames,
} = require("./pk-preset-battle-groups");

test("preset battle groups: 8 groups, each 7–8, unique 58", () => {
  assert.equal(PRESET_BATTLE_GROUPS.length, 8);
  const flat = flattenPresetRosterNames();
  assert.equal(flat.length, 58);
  assert.equal(new Set(flat).size, 58);
  assert.deepEqual(
    PRESET_BATTLE_GROUPS.map((g) => g.length),
    [7, 7, 7, 8, 7, 8, 7, 7]
  );
  for (let i = 0; i < PRESET_BATTLE_GROUPS.length; i += 1) {
    assert.ok(
      PRESET_BATTLE_GROUPS[i].length >= 7 && PRESET_BATTLE_GROUPS[i].length <= 8,
      `group ${i + 1} size ${PRESET_BATTLE_GROUPS[i].length}`
    );
  }
  assert.equal(PRESET_BATTLE_META.firstStart, "08:15");
  assert.equal(PRESET_BATTLE_META.stepMinutes, 15);
});

test("preset anchors: 人工位次 + 泽帆间隔 + 末组四人", () => {
  assert.ok(PRESET_BATTLE_GROUPS[0].includes("玖依"));
  assert.ok(PRESET_BATTLE_GROUPS[0].includes("狼九"));
  assert.ok(PRESET_BATTLE_GROUPS[3].includes("玖玉"));
  assert.ok(PRESET_BATTLE_GROUPS[3].includes("啸辰"));
  assert.ok(PRESET_BATTLE_GROUPS[3].includes("浩鸣"));
  assert.ok(PRESET_BATTLE_GROUPS[3].includes("浩冬"));
  assert.ok(PRESET_BATTLE_GROUPS[3].includes("浩森"));
  assert.ok(PRESET_BATTLE_GROUPS[0].includes("浩泽"));
  assert.ok(PRESET_BATTLE_GROUPS[7].includes("浩坤"));
  assert.equal(PRESET_BATTLE_GROUPS.findIndex((g) => g.includes("浩泽")), 0);
  assert.equal(PRESET_BATTLE_GROUPS.findIndex((g) => g.includes("浩森")), 3);
  assert.equal(PRESET_BATTLE_GROUPS.findIndex((g) => g.includes("浩坤")), 7);
  const last = PRESET_BATTLE_GROUPS[PRESET_BATTLE_GROUPS.length - 1];
  assert.ok(last.includes("狼影"));
  assert.ok(last.includes("狼裕"));
  assert.ok(last.includes("狼博"));
  assert.ok(last.includes("狼佑"));
  assert.ok(PRESET_BATTLE_GROUPS.flat().includes("鹏先生"));
  const idx = (n) => {
    for (let i = 0; i < PRESET_BATTLE_GROUPS.length; i += 1) {
      if (PRESET_BATTLE_GROUPS[i].includes(n)) return i;
    }
    return -1;
  };
  assert.equal(idx("啸泽"), 2);
  assert.equal(idx("啸帆"), 5);
  assert.ok(Math.abs(idx("啸泽") - idx("啸帆")) >= 3, "啸泽↔啸帆 间隔≥3");
  assert.ok(Math.abs(idx("玖依") - idx("狼影")) >= 3, "玖依↔狼影 间隔≥3");
  assert.ok(Math.abs(idx("狼九") - idx("狼裕")) >= 3, "狼九↔狼裕 间隔≥3");
  // 位次：玖依/狼九 第1 · 狼影/狼裕 第8 → 间隔 7
  assert.equal(idx("玖依"), 0);
  assert.equal(idx("狼九"), 0);
  assert.equal(idx("狼影"), 7);
  assert.equal(idx("狼裕"), 7);
});

test("上月前十：各组按名单序伪分时均落组内前 4（直晋，不进淘汰）", () => {
  // 名单内按「综合战力」从高到低排；伪分用 index 反序，等价于名单序即战力序
  const TOP10 = [
    "浩鸣",
    "南方楠",
    "狼澈",
    "鹏先生",
    "啸辰",
    "浩冬",
    "玖玉",
    "玖玥",
    "啸帆",
    "狼赫",
  ];
  for (const name of TOP10) {
    const gi = PRESET_BATTLE_GROUPS.findIndex((g) => g.includes(name));
    assert.ok(gi >= 0, `${name} 缺失`);
    const rank = PRESET_BATTLE_GROUPS[gi].indexOf(name) + 1;
    assert.ok(rank <= 4, `${name} 在 G${gi + 1} 第 ${rank} 名，应 ≤4 直晋`);
  }
});

test("preset promo groups: 8 groups, 48 unique, sizes 8×6", () => {
  assert.equal(PRESET_PROMO_GROUPS.length, 8);
  const flat = flattenPromoRosterNames();
  assert.equal(flat.length, 48);
  assert.equal(new Set(flat).size, 48);
  assert.deepEqual(
    PRESET_PROMO_GROUPS.map((g) => g.length),
    [6, 6, 6, 6, 6, 6, 6, 6]
  );
  assert.equal(PRESET_PROMO_META.label, "晋级赛");
  assert.equal(PRESET_PROMO_META.firstStart, "08:15");
  assert.equal(PRESET_PROMO_META.stepMinutes, 15);
});

test("preset promo anchors: 浩杰G1 · 浩森G8 · 间隔≥4 · top8 各占一组", () => {
  const idx = (n) => {
    for (let i = 0; i < PRESET_PROMO_GROUPS.length; i += 1) {
      if (PRESET_PROMO_GROUPS[i].includes(n)) return i;
    }
    return -1;
  };
  assert.equal(idx("浩杰"), 0);
  assert.equal(idx("浩沐"), 1);
  assert.equal(idx("浩森"), 7);
  assert.equal(idx("狼旭"), 7, "狼旭在末组");
  assert.ok(idx("狼俊") >= 0, "狼俊在晋级赛");
  assert.ok(idx("浩沐") < idx("鹏先生"), "浩沐先于鹏先生");
  assert.ok(Math.abs(idx("浩泽") - idx("浩森")) >= 4);
  assert.ok(Math.abs(idx("玖依") - idx("狼影")) >= 4);
  assert.ok(Math.abs(idx("啸帆") - idx("啸泽")) >= 4);
  assert.ok(Math.abs(idx("浩沐") - idx("鹏先生")) >= 4);

  // 上月 top8 各占一组（组内第一）
  const TOP8 = ["鹏先生", "狼澈", "狼仔", "啸帆", "浩月", "浩玫", "狼辉", "啸辰"];
  const cores = PRESET_PROMO_GROUPS.map((g) => g[0]);
  for (const name of TOP8) {
    assert.ok(cores.includes(name), `${name} 应为组内核`);
  }
  assert.equal(new Set(cores).size, 8);
});
