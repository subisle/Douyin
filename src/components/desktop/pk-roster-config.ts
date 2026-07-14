import type { PkMember } from "@/types/electron";

export type RosterSlot = "midmonth" | "monthend";
export type RosterMode = "include" | "exclude";

export interface RosterConfig {
  mode: RosterMode;
  includeText: string;
  excludeText: string;
}

export const DEFAULT_PK_GROUP_SIZE = 8;
export const ROSTER_CONFIG_STORAGE_KEY = "pk-roster-list-config-v1";
/** 星嗨争霸赛 / PK 名单默认白名单（去重后写入） */
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
浩哲
啸强
浩启`;

const ROSTER_NAME_ALIASES: Record<string, string> = {
  辰辰: "浩辰",
  阿楠: "南方楠",
  狼宝: "狼小宝",
  玖月: "玖玥",
};

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
