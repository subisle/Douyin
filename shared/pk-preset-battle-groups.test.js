const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_META,
  PRESET_PROMO_GROUPS,
  PRESET_PROMO_META,
  flattenPresetRosterNames,
  flattenPresetPromoNames,
} = require("./pk-preset-battle-groups");

// 给定 55 人 + 新增 鹏先生 / 啸泽 / 啸墨，按 shared 表展平序
const GIVEN_58 = [
  "狼澈", "狼轩", "狼兴", "啸宇", "啸泽", "浩杰", "浩沐", "浩龙", "啸墨",
  "狼明", "狼仔", "狼赫", "浩楠", "狼腾", "狼凯", "啸强",
  "玖玉", "玖豆", "浩月", "啸森", "狼岳", "狼佑", "浩延",
  "浩冬", "浩玟", "狼辉", "玖妹", "狼雨", "浩辰", "浩阳",
  "啸辰", "狼小宝", "浩鸣", "狼九", "啸安", "啸阳", "狼哲",
  "鹏先生", "南方楠", "狼艺", "玖雪", "浩艺", "玖依", "狼霆",
  "玖玥", "浩雨", "狼辰", "浩哲", "浩森", "浩启", "浩坤",
  "啸帆", "狼影", "狼泽", "浩运", "啸恒", "狼征", "狼途",
];

test("815 唯一分组：8 组、每组 7–9、唯一 58 人且与给定名单一致", () => {
  assert.equal(PRESET_BATTLE_GROUPS.length, 8);
  const flat = flattenPresetRosterNames();
  assert.equal(flat.length, 58);
  assert.equal(new Set(flat).size, 58);
  assert.deepEqual(
    PRESET_BATTLE_GROUPS.map((g) => g.length),
    [9, 7, 7, 7, 7, 7, 7, 7]
  );
  for (let i = 0; i < PRESET_BATTLE_GROUPS.length; i += 1) {
    assert.ok(
      PRESET_BATTLE_GROUPS[i].length >= 7 && PRESET_BATTLE_GROUPS[i].length <= 9,
      `group ${i + 1} size ${PRESET_BATTLE_GROUPS[i].length}`
    );
  }
  // 与给定名单完全一致（含顺序）
  assert.deepEqual(flat, GIVEN_58);
  assert.equal(PRESET_BATTLE_META.label, "815");
  assert.equal(PRESET_BATTLE_META.firstStart, "12:15");
  assert.equal(PRESET_BATTLE_META.stepMinutes, 15);
});

test("815 名单关键锚点：啸泽/啸墨@第1组 · 鹏先生@第6组 · 狼小宝@第5组 · 啸帆@第8组", () => {
  const idx = (n) => {
    for (let i = 0; i < PRESET_BATTLE_GROUPS.length; i += 1) {
      if (PRESET_BATTLE_GROUPS[i].includes(n)) return i;
    }
    return -1;
  };
  assert.equal(idx("啸泽"), 0);
  assert.equal(idx("啸墨"), 0);
  assert.equal(idx("鹏先生"), 5);
  assert.equal(idx("狼小宝"), 4);
  assert.equal(idx("啸帆"), 7);
  assert.equal(idx("玖依"), 5);
  assert.equal(idx("啸恒"), 7);
  assert.equal(idx("狼九"), 4);
  assert.equal(idx("浩月"), 2);
  assert.equal(idx("狼影"), 7);
  assert.equal(idx("玖玥"), 6);
});

// 晋级赛名单（用户给定 44 人 · 鹏鹏 = 鹏先生 · 浩雨@第7组 · 玖依@第6组 · 均衡 [5,5,5,5,6,6,6,6] 无四人组）
const PROMO_44 = [
  "狼腾", "啸泽", "浩坤", "狼雨", "啸阳",
  "狼赫", "狼辰", "狼影", "浩阳", "狼明",
  "狼仔", "浩哲", "啸安", "狼兴", "玖雪",
  "狼澈", "玖玉", "浩月", "玖豆", "啸恒",
  "啸辰", "南方楠", "啸森", "狼轩", "狼艺", "狼凯",
  "鹏先生", "狼九", "浩辰", "玖依", "浩杰", "狼霆",
  "浩冬", "浩雨", "浩玟", "狼征", "浩艺", "狼佑",
  "玖玥", "啸帆", "浩森", "狼岳", "狼辉", "狼泽",
];

test("晋级赛分组：8 组、规模 [5,5,5,5,6,6,6,6]、无四人组、唯一 44 人且与给定名单一致", () => {
  assert.equal(PRESET_PROMO_GROUPS.length, 8);
  const flat = flattenPresetPromoNames();
  assert.equal(flat.length, 44);
  assert.equal(new Set(flat).size, 44);
  assert.deepEqual(
    PRESET_PROMO_GROUPS.map((g) => g.length),
    [5, 5, 5, 5, 6, 6, 6, 6]
  );
  // 每组 5–6 人，不允许四人组/七人组
  assert.ok(PRESET_PROMO_GROUPS.every((g) => g.length >= 5 && g.length <= 6));
  assert.deepEqual(flat, PROMO_44);
  assert.equal(PRESET_PROMO_META.label, "晋级815");
  assert.equal(PRESET_PROMO_META.source, "815 晋级赛分组");
  assert.equal(PRESET_PROMO_META.periodHint, "2026-08");
});

test("晋级赛名单是小组赛 58 人的子集，且每组第 1 名 = 本组最强（钉位）", () => {
  const stageSet = new Set(flattenPresetRosterNames());
  const promoFlat = flattenPresetPromoNames();
  assert.ok(
    promoFlat.every((n) => stageSet.has(n)),
    "晋级名单必须全部来自小组赛 58 人"
  );

  const strongest = ["狼腾", "狼赫", "狼仔", "狼澈", "啸辰", "鹏先生", "浩冬", "玖玥"];
  assert.deepEqual(
    PRESET_PROMO_GROUPS.map((g) => g[0]),
    strongest
  );
  // 组内其余成员无重复、各组成员无交叉
  assert.equal(new Set(promoFlat).size, 44);
  for (const g of PRESET_PROMO_GROUPS) {
    assert.equal(new Set(g).size, g.length, `组内重复：${g.join("、")}`);
  }
});

test("晋级赛间隔约束：玖依↔狼影 ≥3 组（分开放置）", () => {
  const idx = (n) => PRESET_PROMO_GROUPS.findIndex((g) => g.includes(n));
  const gap = Math.abs(idx("玖依") - idx("狼影"));
  assert.ok(gap >= 3, `玖依@第${idx("玖依") + 1}组 · 狼影@第${idx("狼影") + 1}组 · 间隔 ${gap} 组`);
});
