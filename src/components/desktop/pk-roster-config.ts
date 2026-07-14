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
 * 星嗨争霸赛小组赛内置固定分组（2026-07，54人 / 8+8+8+8+8+7+7）。
 * 最合理出场：前半强弱交错热场，弱组不垫底，最强第6场冲高，次强收尾。
 * 连麦时间仍按场次 1→7 固定（12:15 起，每场 +15 分钟）。
 */
export const PRESET_BATTLE_GROUPS: string[][] = [
  // 第1场 12:15 中上开场拉热
  ["狼赫", "狼凯", "浩玟", "啸安", "浩运", "玖妹", "狼泽", "啸森"],
  // 第2场 12:30 最弱（不压轴、不连冷三场）
  ["啸阳", "狼九", "狼安", "狼旭", "狼征", "啸恒", "狼瑞"],
  // 第3场 12:45 中下托底回温
  ["狼佑", "狼艺", "狼仔", "浩辰", "浩启", "狼轩", "浩哲", "浩泽"],
  // 第4场 13:00 次弱
  ["狼哲", "浩艺", "狼辰", "浩杰", "狼途", "狼霆", "啸强"],
  // 第5场 13:15 中游过渡
  ["玖雪", "狼辉", "啸帆", "浩延", "啸宇", "狼岳", "浩坤", "浩阳"],
  // 第6场 13:30 最强冲高（不压轴）
  ["浩鸣", "啸辰", "狼澈", "南方楠", "浩雨", "浩冬", "浩龙", "狼俊"],
  // 第7场 13:45 次强稳收
  ["狼小宝", "狼腾", "玖玥", "玖玉", "狼兴", "狼博", "狼明", "玖柒"],
];

export function resolvePresetBattleGroups(allMembers: PkMember[]) {
  const byName = new Map<string, PkMember[]>();
  allMembers.forEach((member) => {
    const key = canonicalRosterName(member.name);
    const list = byName.get(key) || [];
    list.push(member);
    byName.set(key, list);
  });

  const usedIds = new Set<number>();
  const groups = PRESET_BATTLE_GROUPS.map((names, index) => {
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
      label: `第${index + 1}组`,
      members,
      averageWave,
      missingNames,
      source: "内置固定分组",
    };
  });

  const leftover = allMembers.filter((member) => !usedIds.has(member.personId));
  const missingNames = groups.flatMap((group) => group.missingNames);
  const expected = PRESET_BATTLE_GROUPS.reduce((sum, row) => sum + row.length, 0);
  const assigned = groups.reduce((sum, group) => sum + group.members.length, 0);

  return {
    groups,
    leftover,
    missingNames,
    expected,
    assigned,
    detail:
      missingNames.length > 0 || leftover.length > 0
        ? `内置固定分组 ${assigned}/${expected} 人` +
          (missingNames.length ? `，缺 ${missingNames.join("、")}` : "") +
          (leftover.length
            ? `，未入组 ${leftover.map((item) => item.name).join("、")}`
            : "")
        : `内置固定分组 ${groups.map((group) => `${group.members.length}人`).join(" + ")}`,
  };
}

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
