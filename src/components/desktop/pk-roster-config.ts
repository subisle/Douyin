import type { PkMember } from "@/types/electron";

export type RosterSlot = "midmonth" | "monthend";
export type RosterMode = "include" | "exclude";

export interface RosterConfig {
  mode: RosterMode;
  includeText: string;
  excludeText: string;
}

export const DEFAULT_PK_GROUP_SIZE = 8;
/** v2：刷新 15 号内置名单默认值，避免沿用旧 localStorage */
export const ROSTER_CONFIG_STORAGE_KEY = "pk-roster-list-config-v2";
/**
 * 15号 PK / 星嗨争霸赛默认白名单。
 * 来源名单含重复（浩泽/浩辰/狼途/啸恒），入库前按出现顺序去重，共 54 人。
 */
export const PRESET_ROSTER_TEXT = `浩雨
南方楠
狼赫
浩泽
狼途
啸恒
浩杰
狼九
啸安
狼澈
浩鸣
浩延
狼小宝
狼瑞
浩艺
狼俊
浩阳
狼辰
浩冬
浩玟
狼佑
浩运
浩龙
玖玥
狼博
狼泽
啸阳
玖柒
狼征
狼艺
狼轩
啸宇
啸森
狼凯
浩坤
狼仔
玖妹
狼腾
狼明
狼旭
狼兴
浩辰
狼霆
狼安
狼岳
玖玉
啸辰
狼辉
啸帆
狼哲
玖雪
浩哲
啸强
浩启`;

const ROSTER_NAME_ALIASES: Record<string, string> = {
  辰辰: "浩辰",
  阿楠: "南方楠",
  狼宝: "狼小宝",
  玖月: "玖玥",
  // 狼轩换号后平台昵称
  农村小胖孩: "狼轩",
  "农村小胖孩🎹（才艺）": "狼轩",
};

/**
 * 星嗨争霸赛 / 15号 PK 小组赛内置固定分组（锁定版）。
 * 54人：8+7+8+7+8+8+8
 * 出场：中上开场 → 最弱 → 中下 → 次弱 → 中游 → 最强冲高 → 次强收尾
 * 出线：8人组前4晋级后4复活；7人组前4晋级后3复活
 */
export const PRESET_BATTLE_GROUPS: string[][] = [
  // 第1场 12:15 开始连麦 · 中上开场
  ["狼赫", "狼凯", "浩玟", "啸安", "浩运", "玖妹", "狼泽", "啸森"],
  // 第2场 12:30 开始连麦 · 最弱
  ["啸阳", "狼九", "狼安", "狼旭", "狼征", "啸恒", "狼瑞"],
  // 第3场 12:45 开始连麦 · 中下回温
  ["狼佑", "狼艺", "狼仔", "浩辰", "浩启", "狼轩", "浩哲", "浩泽"],
  // 第4场 13:00 开始连麦 · 次弱
  ["狼哲", "浩艺", "狼辰", "浩杰", "狼途", "狼霆", "啸强"],
  // 第5场 13:15 开始连麦 · 中游
  ["玖雪", "狼辉", "啸帆", "浩延", "啸宇", "狼岳", "浩坤", "浩阳"],
  // 第6场 13:30 开始连麦 · 最强冲高
  ["浩鸣", "啸辰", "狼澈", "南方楠", "浩雨", "浩冬", "浩龙", "狼俊"],
  // 第7场 13:45 开始连麦 · 次强收尾
  ["狼小宝", "狼腾", "玖玥", "玖玉", "狼兴", "狼博", "狼明", "玖柒"],
];

/**
 * 星嗨争霸赛晋级赛内置固定分组（锁定版）。
 * 37人 / 8 组（5+5+5+5+5+4+4+4），蛇形均衡后按最优直播出场重排。
 * 出场：中上开场 → 最弱 → 中游 → 次弱 → 中 → 中下 → 最强冲高 → 次强收尾
 * 时间：20:15 起，每场间隔 15 分钟
 * 出线：每组第 1 名进决赛（共 8 人）
 */
export const PRESET_PROMOTION_GROUPS: string[][] = [
  // 第1场 20:15 · 中上开场（种子3）
  ["狼澈", "啸安", "啸宇", "啸阳", "狼旭"],
  // 第2场 20:30 · 最弱（种子8）
  ["狼仔", "玖玉", "浩玟", "狼泽"],
  // 第3场 20:45 · 中游（种子5）—— 狼腾 / 玖妹 不同组
  ["狼腾", "浩哲", "浩辰", "浩运", "狼征"],
  // 第4场 21:00 · 次弱（种子7）
  ["狼明", "啸帆", "狼小宝", "啸强"],
  // 第5场 21:15 · 中（种子4）
  ["南方楠", "玖妹", "浩雨", "狼九", "狼兴"],
  // 第6场 21:30 · 中下回温（种子6）
  ["玖玥", "狼轩", "玖柒", "浩杰"],
  // 第7场 21:45 · 最强冲高（种子1）
  ["浩鸣", "狼凯", "狼赫", "浩艺", "浩启"],
  // 第8场 22:00 · 次强收尾（种子2）
  ["浩冬", "狼辉", "浩阳", "啸森", "狼哲"],
];

/** 晋级赛内置组数（与 PRESET_PROMOTION_GROUPS 同步） */
export const PRESET_PROMOTION_GROUP_COUNT = PRESET_PROMOTION_GROUPS.length;

export type NamedBattleGroupResult = {
  key: string;
  label: string;
  members: PkMember[];
  averageWave: number;
  missingNames: string[];
  source: string;
};

function resolveNamedBattleGroups(
  nameGroups: string[][],
  allMembers: PkMember[],
  source: string,
  labelPrefix = "第"
) {
  const byName = new Map<string, PkMember[]>();
  allMembers.forEach((member) => {
    const key = canonicalRosterName(member.name);
    const list = byName.get(key) || [];
    list.push(member);
    byName.set(key, list);
  });

  const usedIds = new Set<number>();
  const groups: NamedBattleGroupResult[] = nameGroups.map((names, index) => {
    const members: PkMember[] = [];
    const missingNames: string[] = [];
    names.forEach((name) => {
      const matches = (byName.get(canonicalRosterName(name)) || []).filter(
        (member) => !usedIds.has(member.personId)
      );
      if (matches.length === 0) {
        missingNames.push(name);
        return;
      }
      const picked = matches[0];
      usedIds.add(picked.personId);
      members.push(picked);
    });
    const averageWave =
      members.length > 0
        ? members.reduce((sum, item) => sum + item.wave, 0) / members.length
        : 0;
    return {
      key: `group-${index + 1}`,
      label: `${labelPrefix}${index + 1}组`,
      members,
      averageWave,
      missingNames,
      source,
    };
  });

  const leftover = allMembers.filter((member) => !usedIds.has(member.personId));
  const missingNames = groups.flatMap((group) => group.missingNames);
  const expected = nameGroups.reduce((sum, row) => sum + row.length, 0);
  const assigned = groups.reduce((sum, group) => sum + group.members.length, 0);

  return {
    groups,
    leftover,
    missingNames,
    expected,
    assigned,
    detail:
      missingNames.length > 0 || leftover.length > 0
        ? `${source} ${assigned}/${expected} 人` +
          (missingNames.length ? `，缺 ${missingNames.join("、")}` : "") +
          (leftover.length
            ? `，未入组 ${leftover.map((item) => item.name).join("、")}`
            : "")
        : `${source} ${groups.map((group) => `${group.members.length}人`).join(" + ")}`,
  };
}

export function resolvePresetBattleGroups(allMembers: PkMember[]) {
  return resolveNamedBattleGroups(PRESET_BATTLE_GROUPS, allMembers, "内置小组赛分组", "第");
}

export function resolvePresetPromotionGroups(allMembers: PkMember[]) {
  return resolveNamedBattleGroups(
    PRESET_PROMOTION_GROUPS,
    allMembers,
    "内置晋级赛分组",
    "晋级"
  );
}

/** 15号争霸赛分组页签 */
export type BattleStageTab = "group" | "promotion";

export const BATTLE_STAGE_TAB_OPTIONS: {
  key: BattleStageTab;
  label: string;
  description: string;
}[] = [
  {
    key: "group",
    label: "小组赛分组",
    description: "内置 7 组固定名单",
  },
  {
    key: "promotion",
    label: "晋级赛分组",
    description: "内置 8 组；每组晋级 1 人，晋级赛全部结束后进入决赛；无复活赛",
  },
];

export const ROSTER_SLOT_OPTIONS: { key: RosterSlot; label: string; shortLabel: string }[] = [
  { key: "midmonth", label: "15号分组名单", shortLabel: "15号" },
  { key: "monthend", label: "月底分组名单", shortLabel: "月底" },
];

export function defaultRosterConfig(): RosterConfig {
  return {
    mode: "include",
    includeText: PRESET_ROSTER_TEXT,
    excludeText: "",
  };
}

export function defaultRosterConfigs(): Record<RosterSlot, RosterConfig> {
  return {
    midmonth: defaultRosterConfig(),
    monthend: defaultRosterConfig(),
  };
}

export function normalizeRosterName(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function canonicalRosterName(value: string) {
  const key = normalizeRosterName(value);
  return ROSTER_NAME_ALIASES[key] || key;
}

export function parseRosterText(value: string) {
  const names: string[] = [];
  const seen = new Set<string>();
  String(value || "")
    .split(/\n|,|，|、|;|；/)
    .map((line) => line.replace(/^\s*\d+\s*[.)、．]\s*/, "").trim())
    .filter(Boolean)
    .forEach((name) => {
      const key = canonicalRosterName(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      names.push(name.trim());
    });
  return names;
}

export function resolveRosterNames(allMembers: PkMember[], text: string) {
  const names = parseRosterText(text);
  const byName = new Map<string, PkMember[]>();
  allMembers.forEach((member) => {
    const key = canonicalRosterName(member.name);
    const members = byName.get(key) || [];
    members.push(member);
    byName.set(key, members);
  });

  const ids = new Set<number>();
  const matchedNames: string[] = [];
  const unmatchedNames: string[] = [];
  names.forEach((name) => {
    const matches = byName.get(canonicalRosterName(name)) || [];
    if (matches.length === 0) {
      unmatchedNames.push(name);
      return;
    }
    matchedNames.push(name);
    matches.forEach((member) => ids.add(member.personId));
  });

  return { ids, matchedNames, names, unmatchedNames };
}

export function loadRosterConfigs() {
  if (typeof window === "undefined") return defaultRosterConfigs();
  try {
    const raw = window.localStorage.getItem(ROSTER_CONFIG_STORAGE_KEY);
    if (!raw) return defaultRosterConfigs();
    const parsed = JSON.parse(raw) as Partial<Record<RosterSlot, Partial<RosterConfig>>>;
    const defaults = defaultRosterConfigs();
    return {
      midmonth: { ...defaults.midmonth, ...parsed.midmonth },
      monthend: { ...defaults.monthend, ...parsed.monthend },
    };
  } catch {
    return defaultRosterConfigs();
  }
}
