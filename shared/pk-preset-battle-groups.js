/**
 * 星嗨争霸赛 / 小组赛内置固定分组（锁定版）。
 * 56 人 · 7 组 × 8
 * 口径：日音浪 2026-07-30 微调后锁定
 * - 狼辉第4组 / 狼佑第1组
 * - 次强第3组 / 最强第5组
 * - 08:15 起，组间间隔 15 分钟
 */
const PRESET_BATTLE_GROUPS = [
  // 第1组 · 08:15 · top4 ~4万
  ["啸辰", "狼凯", "浩泽", "狼瑞", "狼哲", "浩龙", "狼腾", "狼佑"],
  // 第2组 · 08:30 · top4 ~9万
  ["啸宇", "啸泽", "浩月", "浩雨", "玖柒", "浩运", "浩阳", "浩启"],
  // 第3组 · 08:45 · 次强 · top4 ~23万
  ["玖玉", "狼兴", "狼影", "浩冬", "狼明", "啸森", "狼轩", "狼赫"],
  // 第4组 · 09:00 · top4 ~10万
  ["狼辉", "玖雪", "浩玟", "浩杰", "浩哲", "狼岳", "啸强", "狼霆"],
  // 第5组 · 09:15 · 最强 · top4 ~50万
  ["浩鸣", "狼澈", "玖玥", "啸帆", "狼仔", "浩辰", "啸安", "南方楠"],
  // 第6组 · 09:30 · top4 ~7万
  ["玖妹", "狼小宝", "浩艺", "狼九", "狼途", "狼俊", "狼征", "浩延"],
  // 第7组 · 09:45 · top4 ~7万
  ["狼博", "狼艺", "啸阳", "狼泽", "浩沐", "狼辰", "狼旭", "浩森"],
];

const PRESET_BATTLE_META = {
  label: "内置分组",
  source: "内置小组赛分组",
  firstStart: "08:15",
  stepMinutes: 15,
  periodHint: "2026-07",
  notes: [
    "狼辉第4组 · 狼佑第1组",
    "次强第3组 · 最强第5组",
    "08:15 起每组间隔 15 分钟",
    "口径：日音浪 2026-07-30 锁定",
  ],
};

function flattenPresetRosterNames() {
  return PRESET_BATTLE_GROUPS.flat().map((n) => String(n).trim()).filter(Boolean);
}

function flattenPresetRosterText() {
  return flattenPresetRosterNames().join("\n");
}

module.exports = {
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_META,
  flattenPresetRosterNames,
  flattenPresetRosterText,
};
