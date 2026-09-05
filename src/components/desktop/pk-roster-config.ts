import type { BuildPkGroupsGroup, BuildPkGroupsResult, PkGroupMode, PkMember } from "@/types/electron";
import * as SharedPresetBattle from "../../../shared/pk-preset-battle-groups.js";

const SHARED_PRESET_BATTLE_GROUPS: string[][] =
  (SharedPresetBattle as { PRESET_BATTLE_GROUPS?: string[][] }).PRESET_BATTLE_GROUPS ||
  (SharedPresetBattle as { default?: { PRESET_BATTLE_GROUPS?: string[][] } }).default
    ?.PRESET_BATTLE_GROUPS ||
  [];

const AUGUST_END_BATTLE_GROUPS: string[][] =
  (SharedPresetBattle as { AUGUST_END_BATTLE_GROUPS?: string[][] }).AUGUST_END_BATTLE_GROUPS ||
  (SharedPresetBattle as { default?: { AUGUST_END_BATTLE_GROUPS?: string[][] } }).default
    ?.AUGUST_END_BATTLE_GROUPS ||
  [];

const AUGUST_END_BATTLE_META = {
  label: "8月月底",
  source: "8月月底分组",
  firstStart: "12:15",
  stepMinutes: 15,
  reviveExtraMinutes: 0,
  periodHint: "2026-08",
  notes: [] as string[],
  ...((SharedPresetBattle as { AUGUST_END_BATTLE_META?: Record<string, unknown> }).AUGUST_END_BATTLE_META ||
    (SharedPresetBattle as { default?: { AUGUST_END_BATTLE_META?: Record<string, unknown> } }).default
      ?.AUGUST_END_BATTLE_META ||
    {}),
};

const SHARED_PRESET_BATTLE_META = {
  label: "815",
  source: "815 唯一分组",
  firstStart: "12:15",
  stepMinutes: 15,
  reviveExtraMinutes: 0,
  periodHint: "2026-08",
  notes: [] as string[],
  ...((SharedPresetBattle as { PRESET_BATTLE_META?: Record<string, unknown> }).PRESET_BATTLE_META ||
    (SharedPresetBattle as { default?: { PRESET_BATTLE_META?: Record<string, unknown> } }).default
      ?.PRESET_BATTLE_META ||
    {}),
};

const SHARED_PRESET_PROMO_GROUPS: string[][] =
  (SharedPresetBattle as { PRESET_PROMO_GROUPS?: string[][] }).PRESET_PROMO_GROUPS ||
  (SharedPresetBattle as { default?: { PRESET_PROMO_GROUPS?: string[][] } }).default
    ?.PRESET_PROMO_GROUPS ||
  [];

const SHARED_PRESET_PROMO_META = {
  label: "晋级815",
  source: "815 晋级赛分组",
  periodHint: "2026-08",
  notes: [] as string[],
  ...((SharedPresetBattle as { PRESET_PROMO_META?: Record<string, unknown> }).PRESET_PROMO_META ||
    (SharedPresetBattle as { default?: { PRESET_PROMO_META?: Record<string, unknown> } }).default
      ?.PRESET_PROMO_META ||
    {}),
};

export const DEFAULT_PK_GROUP_SIZE = 8;

/** 与 shared 同步的 815 唯一分组元信息（时间表 / 来源 / periodHint） */
export const PRESET_BATTLE_META = {
  label: String(SHARED_PRESET_BATTLE_META.label || "815"),
  source: String(SHARED_PRESET_BATTLE_META.source || "815 唯一分组"),
  firstStart: String(SHARED_PRESET_BATTLE_META.firstStart || "12:15"),
  stepMinutes: Number(SHARED_PRESET_BATTLE_META.stepMinutes) || 15,
  reviveExtraMinutes: Number(SHARED_PRESET_BATTLE_META.reviveExtraMinutes) || 0,
  periodHint: String(SHARED_PRESET_BATTLE_META.periodHint || "2026-08"),
  notes: Array.isArray(SHARED_PRESET_BATTLE_META.notes)
    ? (SHARED_PRESET_BATTLE_META.notes as string[]).map(String)
    : [],
};

/** 单一名单 storage（分组页） */
export const ROSTER_STORAGE_KEY = "pk-group-roster-v1";
/** 拖拽微调后的分组布局（按人名二维数组持久化，兼容旧单槽） */
export const GROUPS_LAYOUT_STORAGE_KEY = "pk-group-layout-v1";
/** 多套命名分组存档（分组1 / 分组2 … 可备注） */
export const GROUPS_PRESETS_STORAGE_KEY = "pk-group-presets-v1";
/** 旧版双槽配置，仅用于迁移 */
export const LEGACY_ROSTER_CONFIG_STORAGE_KEY = "pk-roster-list-config-v17";
/** 兼容更旧 key */
export const LEGACY_ROSTER_CONFIG_STORAGE_KEY_V16 = "pk-roster-list-config-v16";

/**
 * 默认白名单（与 815 唯一分组顺序一致，按组展开）。
 * bot skill 用正则从本文件抽取 PRESET_ROSTER_TEXT，**勿改符号名 / 反引号形态**。
 */
export const PRESET_ROSTER_TEXT = `狼澈
狼轩
狼兴
啸宇
啸泽
浩杰
浩沐
浩龙
啸墨
狼明
狼仔
狼赫
浩楠
狼腾
狼凯
啸强
玖玉
玖豆
浩月
啸森
狼岳
狼佑
浩延
浩冬
浩玟
狼辉
玖妹
狼雨
浩辰
浩阳
啸辰
狼小宝
浩鸣
狼九
啸安
啸阳
狼哲
鹏先生
南方楠
狼艺
玖雪
浩艺
玖依
狼霆
玖玥
浩雨
狼辰
浩哲
浩森
浩启
浩坤
啸帆
狼影
狼泽
浩运
啸恒
狼征
狼途
`;

/**
 * 815 唯一固定分组（锁定版）。
 * 与 shared PRESET_BATTLE_GROUPS 同步 · 58 人 8 组（第1组 9 人 · 其余 7 人）· 12:15×15min
 */
export const PRESET_BATTLE_GROUPS: string[][] = SHARED_PRESET_BATTLE_GROUPS.map((row) => [...row]);

export const PRESET_BATTLE_FIRST_START = PRESET_BATTLE_META.firstStart;
export const PRESET_BATTLE_STEP_MINUTES = PRESET_BATTLE_META.stepMinutes;
/** 第4组后插复活赛造成的额外顺延（第5组起每组 +N 分钟）；815 = 5 */
export const PRESET_BATTLE_REVIVE_EXTRA_MINUTES = PRESET_BATTLE_META.reviveExtraMinutes;
export const PRESET_BATTLE_NOTES = [...PRESET_BATTLE_META.notes];

// ===== 8月月底内置分组 =====
export const AUGUST_END_BATTLE_GROUPS_EXPORT: string[][] = AUGUST_END_BATTLE_GROUPS.map((row) => [...row]);
export const AUGUST_END_BATTLE_META_EXPORT = {
  label: String(AUGUST_END_BATTLE_META.label || "8月月底"),
  source: String(AUGUST_END_BATTLE_META.source || "8月月底分组"),
  firstStart: String(AUGUST_END_BATTLE_META.firstStart || "12:15"),
  stepMinutes: Number(AUGUST_END_BATTLE_META.stepMinutes) || 15,
  reviveExtraMinutes: Number(AUGUST_END_BATTLE_META.reviveExtraMinutes) || 0,
  periodHint: String(AUGUST_END_BATTLE_META.periodHint || "2026-08"),
  notes: Array.isArray(AUGUST_END_BATTLE_META.notes)
    ? (AUGUST_END_BATTLE_META.notes as string[]).map(String)
    : [],
};
/** 8月月底分组存档名 */
export const BUILTIN_AUGUST_END_PRESET_NAME = "8月月底";

/** 当前代码锁定的 8月月底名组（拷贝，避免外部 mutate） */
export function getAugustEndNameGroups(): string[][] {
  return (AUGUST_END_BATTLE_GROUPS_EXPORT || []).map((row) =>
    (row || []).map((n) => String(n || "").trim()).filter(Boolean)
  );
}

/**
 * 把代码内置 8月月底表写入 PK 分组命名存档「8月月底」。
 * 默认 makeActive=false（不抢占当前激活的 815 分组）。
 */
export function syncAugustEndGroupsToPkStorage(options?: {
  makeActive?: boolean;
  period?: string;
  note?: string;
}): SavedGroupPreset | null {
  if (typeof window === "undefined") return null;
  const nameGroups = getAugustEndNameGroups();
  if (!nameGroups.length) return null;

  const existing = listSavedGroupPresets().find(
    (p) => String(p.name || "").trim() === BUILTIN_AUGUST_END_PRESET_NAME
  );
  const total = nameGroups.reduce((s, g) => s + g.length, 0);
  const period =
    String(options?.period || AUGUST_END_BATTLE_META_EXPORT.periodHint || "").trim() || undefined;
  const note =
    String(options?.note || "").trim() ||
    [
      AUGUST_END_BATTLE_META_EXPORT.source || "8月月底分组",
      `${nameGroups.length} 组 · ${total} 人`,
      `规模 ${nameGroups.map((g) => g.length).join("+")}`,
      `${AUGUST_END_BATTLE_META_EXPORT.firstStart}×${AUGUST_END_BATTLE_META_EXPORT.stepMinutes}min`,
      `同步 ${new Date().toISOString()}`,
    ].join(" · ");

  return saveNamedGroupPreset({
    id: existing?.id,
    name: BUILTIN_AUGUST_END_PRESET_NAME,
    nameGroups,
    period,
    mode: "preset",
    firstStart: AUGUST_END_BATTLE_META_EXPORT.firstStart,
    stepMinutes: AUGUST_END_BATTLE_META_EXPORT.stepMinutes,
    reviveExtraMinutes: AUGUST_END_BATTLE_META_EXPORT.reviveExtraMinutes,
    groupSize: DEFAULT_PK_GROUP_SIZE,
    note,
    makeActive: options?.makeActive === true,
  });
}

/**
 * 主进程快照 → 本地命名存档：仅在本地没有任何存档时恢复（换机/清数据后自动找回）。
 * 快照由保存分组时同步（writePresetsStore → IPC），bot 出图也读同一份。
 */
export async function syncSnapshotGroupsToPkStorage(): Promise<SavedGroupPreset | null> {
  if (typeof window === "undefined") return null;
  if (readPresetsStoreRaw().presets.length > 0) return null; // 已有存档不覆盖
  try {
    const api = (
      window as unknown as {
        electronAPI?: {
          readPkLayoutSnapshot?: () => Promise<{
            success: boolean;
            data?: {
              name?: string;
              note?: string;
              period?: string;
              mode?: string;
              scoreDisplay?: string;
              groupSize?: number;
              firstStart?: string;
              stepMinutes?: number;
              reviveExtraMinutes?: number;
              nameGroups?: string[][];
              groupLabels?: string[];
            } | null;
          }>;
        };
      }
    ).electronAPI;
    const res = await api?.readPkLayoutSnapshot?.();
    const snap = res?.data;
    if (!snap?.nameGroups?.length) return null;
    return (
      saveNamedGroupPreset({
        name: String(snap.name || "").trim() || "快照恢复分组",
        note: String(snap.note || "").trim() || "从主进程快照恢复",
        period: snap.period,
        mode: snap.mode,
        scoreDisplay: snap.scoreDisplay,
        groupSize: snap.groupSize || undefined,
        firstStart: snap.firstStart || undefined,
        stepMinutes: snap.stepMinutes || undefined,
        reviveExtraMinutes: snap.reviveExtraMinutes || undefined,
        nameGroups: snap.nameGroups,
        groupLabels: snap.groupLabels,
        makeActive: true,
      }) || null
    );
  } catch {
    return null;
  }
}

/** 815 晋级赛分组元信息（44 人 · 8 组 · 规模 [5,5,5,5,6,6,6,6] · 无四人组） */export const PRESET_PROMO_META = {
  label: String(SHARED_PRESET_PROMO_META.label || "晋级815"),
  source: String(SHARED_PRESET_PROMO_META.source || "815 晋级赛分组"),
  periodHint: String(SHARED_PRESET_PROMO_META.periodHint || "2026-08"),
  notes: Array.isArray(SHARED_PRESET_PROMO_META.notes)
    ? (SHARED_PRESET_PROMO_META.notes as string[]).map(String)
    : [],
};

/** 815 晋级赛固定分组（与 shared PRESET_PROMO_GROUPS 同步 · 44 人 8 组） */
export const PRESET_PROMO_GROUPS: string[][] = SHARED_PRESET_PROMO_GROUPS.map((row) => [...row]);

/** 晋级赛存档名（PK 分组命名存档） */
export const BUILTIN_PROMO_PRESET_NAME = "晋级赛-815";

/** 当前代码锁定的 815 晋级赛名组（拷贝，避免外部 mutate） */
export function getBuiltInPromoNameGroups(): string[][] {
  return (PRESET_PROMO_GROUPS || []).map((row) =>
    (row || []).map((n) => String(n || "").trim()).filter(Boolean)
  );
}

function flattenPresetRosterText() {
  const fn =
    (SharedPresetBattle as { flattenPresetRosterText?: () => string }).flattenPresetRosterText ||
    (SharedPresetBattle as { default?: { flattenPresetRosterText?: () => string } }).default
      ?.flattenPresetRosterText;
  if (typeof fn === "function") return String(fn() || "");
  return PRESET_BATTLE_GROUPS.flat().join("\n");
}

const ROSTER_NAME_ALIASES: Record<string, string> = {
  辰辰: "浩辰",
  阿楠: "南方楠",
  狼宝: "狼小宝",
  玖月: "玖玥",
  农村小胖孩: "狼轩",
  "农村小胖孩🎹（才艺）": "狼轩",
  中鹏先生: "鹏先生",
  鹏鹏: "鹏先生",
};

export function normalizeRosterName(value: string) {
  return value.replace(/\s+/g, "").trim();
}

export function canonicalRosterName(value: string) {
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

export type NamedBattleGroupResult = {
  key: string;
  label: string;
  members: PkMember[];
  averageWave: number;
  top4: number;
  missingNames: string[];
  source: string;
  startTime: string;
  scheduleLabel: string;
};

function formatHm(totalMinutes: number) {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function memberStrength(member: PkMember, scoreField: "wave" | "latestWave" = "wave") {
  if (scoreField === "latestWave") return Number(member.latestWave || 0);
  return Number(member.wave || 0);
}

function resolveNamedBattleGroups(
  nameGroups: string[][],
  allMembers: PkMember[],
  source: string,
  options?: {
    labelPrefix?: string;
    firstStart?: string;
    stepMinutes?: number;
    reviveExtraMinutes?: number;
    scoreField?: "wave" | "latestWave";
  }
) {
  const labelPrefix = options?.labelPrefix || "第";
  const firstStart = options?.firstStart || PRESET_BATTLE_FIRST_START;
  const stepMinutes = options?.stepMinutes ?? PRESET_BATTLE_STEP_MINUTES;
  const reviveExtraMinutes = options?.reviveExtraMinutes ?? PRESET_BATTLE_REVIVE_EXTRA_MINUTES;
  const scoreField = options?.scoreField || "wave";
  const match = String(firstStart).match(/^(\d{1,2}):(\d{2})$/);
  const startMin = match ? Number(match[1]) * 60 + Number(match[2]) : 8 * 60 + 15;

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
        // 占位：保证内置结构完整，便于导出/展示
        members.push({
          personId: -1000 - index * 100 - members.length,
          name,
          gender: "male",
          wave: 0,
          latestWave: 0,
          trimmedAvg: 0,
          days: 0,
        } as unknown as PkMember);
        return;
      }
      const picked = matches[0];
      usedIds.add(picked.personId);
      members.push(picked);
    });
    const strengths = members.map((m) => memberStrength(m, scoreField)).sort((a, b) => b - a);
    const top4 = strengths.slice(0, 4).reduce((s, n) => s + n, 0);
    const averageWave =
      members.length > 0
        ? members.reduce((sum, item) => sum + memberStrength(item, scoreField), 0) / members.length
        : 0;
    // 第4组后插复活赛：第5组起（index>=4）顺延 reviveExtraMinutes
    const startTime = formatHm(startMin + index * stepMinutes + (index >= 4 ? reviveExtraMinutes : 0));
    return {
      key: `group-${index + 1}`,
      label: `${labelPrefix}${index + 1}组`,
      members,
      averageWave,
      top4,
      missingNames,
      source,
      startTime,
      scheduleLabel: `${startTime} 开始连麦`,
    };
  });

  const leftover = allMembers.filter((member) => !usedIds.has(member.personId));
  const missingNames = groups.flatMap((group) => group.missingNames);
  const expected = nameGroups.reduce((sum, row) => sum + row.length, 0);
  const assigned = groups.reduce(
    (sum, group) => sum + group.members.filter((m) => (m.personId ?? 0) > 0).length,
    0
  );

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
            ? `，未入组 ${leftover
                .slice(0, 8)
                .map((item) => item.name)
                .join("、")}${leftover.length > 8 ? "…" : ""}`
            : "")
        : `${source} ${groups.map((group) => `${group.members.length}人`).join(" + ")}`,
  };
}

export function resolvePresetBattleGroups(
  allMembers: PkMember[],
  options?: { scoreField?: "wave" | "latestWave" }
) {
  return resolveNamedBattleGroups(PRESET_BATTLE_GROUPS, allMembers, PRESET_BATTLE_META.source, {
    labelPrefix: "第",
    firstStart: PRESET_BATTLE_FIRST_START,
    stepMinutes: PRESET_BATTLE_STEP_MINUTES,
    reviveExtraMinutes: PRESET_BATTLE_REVIVE_EXTRA_MINUTES,
    scoreField: options?.scoreField,
  });
}

/** 任意名组 → BuildPkGroupsResult（内置 / 已保存布局共用） */
export function buildBattleGroupsResultFromNameGroups(
  nameGroups: string[][],
  allMembers: PkMember[],
  options?: {
    scoreField?: "wave" | "latestWave";
    mode?: PkGroupMode | string;
    modeLabel?: string;
    source?: string;
    notes?: string[];
    firstStart?: string;
    stepMinutes?: number;
    reviveExtraMinutes?: number;
  }
): BuildPkGroupsResult {
  const scoreField = options?.scoreField || "wave";
  const source = options?.source || "自定义分组";
  const firstStart = options?.firstStart || PRESET_BATTLE_FIRST_START;
  const stepMinutes = options?.stepMinutes ?? PRESET_BATTLE_STEP_MINUTES;
  const resolved = resolveNamedBattleGroups(nameGroups, allMembers, source, {
    labelPrefix: "第",
    firstStart,
    stepMinutes,
    reviveExtraMinutes: options?.reviveExtraMinutes,
    scoreField,
  });
  const groups: BuildPkGroupsGroup[] = resolved.groups.map((g, gi) => ({
    label: g.label,
    order: gi + 1,
    startTime: g.startTime,
    scheduleLabel: g.scheduleLabel,
    count: g.members.length,
    top4: Math.round(g.top4),
    average: Math.round(g.averageWave),
    members: g.members.map((m, idx) => ({
      index: idx + 1,
      name: m.name,
      personId: m.personId ?? null,
      wave: Number(m.wave || 0),
      latestWave: Number(m.latestWave || 0),
      trimmedAvg: Math.round(Number(m.trimmedAvg || 0)),
      strength: Math.round(memberStrength(m, scoreField)),
    })),
  }));

  const byTop4 = groups
    .map((g, i) => ({ i: i + 1, top4: g.top4 }))
    .sort((a, b) => b.top4 - a.top4);

  const mode = (options?.mode || "preset") as BuildPkGroupsResult["mode"];
  const modeLabel = options?.modeLabel || (mode === "preset" ? PRESET_BATTLE_META.label : "自定义分组");
  const notes = options?.notes || (mode === "preset" ? [...PRESET_BATTLE_NOTES] : ["已保存的拖拽分组"]);

  return {
    ok: true,
    mode,
    modeLabel,
    total: groups.reduce((s, g) => s + g.count, 0),
    groupCount: groups.length,
    sizes: groups.map((g) => g.count),
    scoreField,
    strongestSlot: 5,
    strongestGroup: byTop4[0]?.i || 5,
    constraints: [...notes, resolved.detail],
    warning: resolved.missingNames.length
      ? `缺人：${resolved.missingNames.join("、")}`
      : undefined,
    groups,
  };
}

/** 把内置名组解析成 BuildPkGroupsResult，供分组页 / 导出直接用 */
export function buildPresetBattleGroupsResult(
  allMembers: PkMember[],
  options?: {
    scoreField?: "wave" | "latestWave";
    firstStart?: string;
    stepMinutes?: number;
    reviveExtraMinutes?: number;
  }
): BuildPkGroupsResult {
  return buildBattleGroupsResultFromNameGroups(PRESET_BATTLE_GROUPS, allMembers, {
    scoreField: options?.scoreField,
    firstStart: options?.firstStart,
    stepMinutes: options?.stepMinutes,
    reviveExtraMinutes: options?.reviveExtraMinutes,
    mode: "preset",
    modeLabel: PRESET_BATTLE_META.label,
    source: PRESET_BATTLE_META.source,
    notes: [...PRESET_BATTLE_NOTES],
  });
}

export type SavedGroupsLayout = {
  version: 1;
  id?: string;
  name?: string;
  note?: string;
  period?: string;
  mode?: string;
  scoreDisplay?: string;
  firstStart?: string;
  stepMinutes?: number;
  /** 第4组后插复活赛：第5组起每组顺延分钟数 */
  reviveExtraMinutes?: number;
  groupSize?: number;
  nameGroups: string[][];
  /** 自定义组名（与 nameGroups 下标对齐；空串/缺省 = 默认「第N组」） */
  groupLabels?: string[];
  savedAt: string;
};

export type SavedGroupPreset = {
  id: string;
  name: string;
  note?: string;
  period?: string;
  mode?: string;
  scoreDisplay?: string;
  firstStart?: string;
  stepMinutes?: number;
  reviveExtraMinutes?: number;
  groupSize?: number;
  nameGroups: string[][];
  /** 自定义组名（与 nameGroups 下标对齐；空串/缺省 = 默认「第N组」） */
  groupLabels?: string[];
  savedAt: string;
};

export type SavedGroupPresetsStore = {
  version: 1;
  activeId: string | null;
  presets: SavedGroupPreset[];
};

function newPresetId() {
  return `gp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeNameGroups(input: string[][] | undefined | null): string[][] {
  return (input || [])
    .map((row) => (Array.isArray(row) ? row.map((n) => String(n || "").trim()).filter(Boolean) : []))
    .filter((row) => row.length > 0);
}

/** 组名列表：去空白；全部为空时返回 undefined（即全部用默认名） */
function sanitizeGroupLabels(input: string[] | undefined | null): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const labels = input.map((n) => String(n || "").trim());
  return labels.some(Boolean) ? labels : undefined;
}

function normalizePreset(raw: Partial<SavedGroupPreset> | null | undefined): SavedGroupPreset | null {
  if (!raw) return null;
  const nameGroups = sanitizeNameGroups(raw.nameGroups);
  if (!nameGroups.length) return null;
  const name = String(raw.name || "").trim() || "未命名分组";
  const note = String(raw.note || "").trim();
  return {
    id: String(raw.id || "").trim() || newPresetId(),
    name,
    note: note || undefined,
    period: raw.period,
    mode: raw.mode,
    scoreDisplay: raw.scoreDisplay,
    firstStart: raw.firstStart ? normalizeFirstStart(raw.firstStart) : undefined,
    stepMinutes: raw.stepMinutes != null ? normalizeStepMinutes(raw.stepMinutes) : undefined,
    reviveExtraMinutes:
      raw.reviveExtraMinutes != null
        ? normalizeReviveExtraMinutes(raw.reviveExtraMinutes)
        : undefined,
    groupSize: raw.groupSize != null ? normalizeGroupSize(raw.groupSize) : undefined,
    nameGroups,
    groupLabels: sanitizeGroupLabels(raw.groupLabels),
    savedAt: raw.savedAt || new Date().toISOString(),
  };
}

function presetToLayout(preset: SavedGroupPreset): SavedGroupsLayout {
  return {
    version: 1,
    id: preset.id,
    name: preset.name,
    note: preset.note,
    period: preset.period,
    mode: preset.mode,
    scoreDisplay: preset.scoreDisplay,
    firstStart: preset.firstStart,
    stepMinutes: preset.stepMinutes,
    reviveExtraMinutes: preset.reviveExtraMinutes,
    groupSize: preset.groupSize,
    nameGroups: preset.nameGroups,
    groupLabels: preset.groupLabels,
    savedAt: preset.savedAt,
  };
}

function layoutToPreset(layout: SavedGroupsLayout, fallbackName = "分组1"): SavedGroupPreset | null {
  return normalizePreset({
    id: layout.id,
    name: layout.name || fallbackName,
    note: layout.note,
    period: layout.period,
    mode: layout.mode,
    scoreDisplay: layout.scoreDisplay,
    firstStart: layout.firstStart,
    stepMinutes: layout.stepMinutes,
    reviveExtraMinutes: layout.reviveExtraMinutes,
    groupSize: layout.groupSize,
    nameGroups: layout.nameGroups,
    groupLabels: layout.groupLabels,
    savedAt: layout.savedAt,
  });
}

function readPresetsStoreRaw(): SavedGroupPresetsStore {
  const empty: SavedGroupPresetsStore = { version: 1, activeId: null, presets: [] };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(GROUPS_PRESETS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedGroupPresetsStore;
      const presets = (parsed?.presets || [])
        .map((item) => normalizePreset(item))
        .filter((item): item is SavedGroupPreset => Boolean(item));
      const activeId =
        parsed?.activeId && presets.some((p) => p.id === parsed.activeId) ? parsed.activeId : null;
      return { version: 1, activeId, presets };
    }
  } catch {
    /* fall through to migrate */
  }

  // 兼容旧单槽 layout
  try {
    const legacyRaw = window.localStorage.getItem(GROUPS_LAYOUT_STORAGE_KEY);
    if (!legacyRaw) return empty;
    const legacy = JSON.parse(legacyRaw) as SavedGroupsLayout;
    const preset = layoutToPreset(
      {
        version: 1,
        period: legacy.period,
        mode: legacy.mode,
        scoreDisplay: legacy.scoreDisplay,
        firstStart: legacy.firstStart,
        stepMinutes: legacy.stepMinutes,
        reviveExtraMinutes: legacy.reviveExtraMinutes,
        groupSize: legacy.groupSize,
        nameGroups: legacy.nameGroups,
        savedAt: legacy.savedAt || new Date().toISOString(),
        name: legacy.name || "分组1",
        note: legacy.note,
      },
      "分组1"
    );
    if (!preset) return empty;
    const store: SavedGroupPresetsStore = {
      version: 1,
      activeId: preset.id,
      presets: [preset],
    };
    window.localStorage.setItem(GROUPS_PRESETS_STORAGE_KEY, JSON.stringify(store));
    return store;
  } catch {
    return empty;
  }
}

function writePresetsStore(store: SavedGroupPresetsStore) {
  if (typeof window === "undefined") return store;
  const presets = (store.presets || [])
    .map((item) => normalizePreset(item))
    .filter((item): item is SavedGroupPreset => Boolean(item));
  const activeId = store.activeId && presets.some((p) => p.id === store.activeId) ? store.activeId : null;
  const next: SavedGroupPresetsStore = { version: 1, activeId, presets };
  window.localStorage.setItem(GROUPS_PRESETS_STORAGE_KEY, JSON.stringify(next));
  // 同步旧单槽，兼容仍读 layout key 的路径
  const active = activeId ? presets.find((p) => p.id === activeId) : null;
  if (active) {
    window.localStorage.setItem(GROUPS_LAYOUT_STORAGE_KEY, JSON.stringify(presetToLayout(active)));
  } else {
    // 无激活存档时清掉旧单槽，避免模式重分后 preferSaved 又把旧布局拉回来
    window.localStorage.removeItem(GROUPS_LAYOUT_STORAGE_KEY);
  }
  // 同步激活分组快照给主进程（微信/QQ bot 发组名出图用）
  syncLayoutSnapshotToMain(active);
  return next;
}

/** 把激活分组快照同步给主进程（失败静默：bot 侧只会提示未保存分组） */
function syncLayoutSnapshotToMain(active: SavedGroupPreset | null | undefined) {
  try {
    const api = (
      window as unknown as {
        electronAPI?: {
          savePkLayoutSnapshot?: (snapshot: {
            id: string;
            name: string;
            note?: string;
            period?: string;
            mode?: string;
            scoreDisplay?: string;
            groupSize?: number;
            firstStart?: string;
            stepMinutes?: number;
            reviveExtraMinutes?: number;
            nameGroups: string[][];
            groupLabels?: string[];
          }) => Promise<unknown>;
          clearPkLayoutSnapshot?: () => Promise<unknown>;
        };
      }
    ).electronAPI;
    if (!api) return;
    if (active) {
      void api.savePkLayoutSnapshot?.({
        id: active.id,
        name: active.name,
        note: active.note,
        period: active.period,
        mode: active.mode,
        scoreDisplay: active.scoreDisplay,
        groupSize: active.groupSize,
        firstStart: active.firstStart,
        stepMinutes: active.stepMinutes,
        reviveExtraMinutes: active.reviveExtraMinutes,
        nameGroups: active.nameGroups,
        groupLabels: active.groupLabels,
      });
    } else {
      void api.clearPkLayoutSnapshot?.();
    }
  } catch {
    // 忽略同步失败
  }
}

export function loadSavedGroupPresets(): SavedGroupPresetsStore {
  return readPresetsStoreRaw();
}

export function listSavedGroupPresets(): SavedGroupPreset[] {
  return readPresetsStoreRaw().presets.slice().sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function getActiveGroupPreset(): SavedGroupPreset | null {
  const store = readPresetsStoreRaw();
  if (!store.activeId) return null;
  return store.presets.find((p) => p.id === store.activeId) || null;
}

export function suggestNextGroupPresetName(presets?: SavedGroupPreset[]): string {
  const list = presets || listSavedGroupPresets();
  let max = 0;
  for (const item of list) {
    const m = String(item.name || "").trim().match(/^分组\s*(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `分组${max + 1 || list.length + 1}`;
}

/** PK 分组页 / 赛程共用的 815 唯一分组存档名 */
export const BUILTIN_GROUP_PRESET_NAME = "815";

/** 当前代码锁定的 815 名组（拷贝，避免外部 mutate） */
export function getBuiltInNameGroups(): string[][] {
  return (PRESET_BATTLE_GROUPS || []).map((row) =>
    (row || []).map((n) => String(n || "").trim()).filter(Boolean)
  );
}

/**
 * 把代码内置 815 表写入 PK 分组命名存档「815」，并同步白名单文本。
 * 默认 makeActive=true，打开 PK 分组即见最新锁定表。
 * 注意：若「815」存档已存在，不覆盖用户已保存的修改（持久化保护）。
 */
export function syncBuiltInGroupsToPkStorage(options?: {
  makeActive?: boolean;
  period?: string;
  note?: string;
  force?: boolean;
}): SavedGroupPreset | null {
  if (typeof window === "undefined") return null;
  const nameGroups = getBuiltInNameGroups();
  if (!nameGroups.length) return null;

  // 白名单与内置表同序，避免 bot / 导入名单漂旧
  try {
    saveRosterText(flattenPresetRosterTextLocal());
  } catch {
    /* ignore */
  }

  const existing = listSavedGroupPresets().find(
    (p) => String(p.name || "").trim() === BUILTIN_GROUP_PRESET_NAME
  );

  // 持久化保护：已存在且非强制同步时，不覆盖用户修改
  if (existing && options?.force !== true) {
    if (options?.makeActive !== false) {
      setActiveGroupPreset(existing.id);
    }
    return existing;
  }

  const total = nameGroups.reduce((s, g) => s + g.length, 0);
  const period =
    String(options?.period || PRESET_BATTLE_META.periodHint || "").trim() || undefined;
  const note =
    String(options?.note || "").trim() ||
    [
      PRESET_BATTLE_META.source || "815 唯一分组",
      `${nameGroups.length} 组 · ${total} 人`,
      `规模 ${nameGroups.map((g) => g.length).join("+")}`,
      `${PRESET_BATTLE_FIRST_START}×${PRESET_BATTLE_STEP_MINUTES}min`,
      `同步 ${new Date().toISOString()}`,
    ].join(" · ");

  return saveNamedGroupPreset({
    id: existing?.id,
    name: BUILTIN_GROUP_PRESET_NAME,
    nameGroups,
    period,
    mode: "preset",
    firstStart: PRESET_BATTLE_FIRST_START,
    stepMinutes: PRESET_BATTLE_STEP_MINUTES,
    reviveExtraMinutes: PRESET_BATTLE_REVIVE_EXTRA_MINUTES,
    groupSize: DEFAULT_PK_GROUP_SIZE,
    note,
    makeActive: options?.makeActive !== false,
  });
}

function flattenPresetRosterTextLocal(): string {
  const fromGroups = getBuiltInNameGroups()
    .flat()
    .map((n) => String(n).trim())
    .filter(Boolean);
  if (fromGroups.length) return fromGroups.join("\n");
  return String(PRESET_ROSTER_TEXT || "").trim();
}

export function saveNamedGroupPreset(input: {
  id?: string;
  name: string;
  note?: string;
  nameGroups: string[][];
  groupLabels?: string[];
  period?: string;
  mode?: string;
  scoreDisplay?: string;
  firstStart?: string;
  stepMinutes?: number;
  reviveExtraMinutes?: number;
  groupSize?: number;
  makeActive?: boolean;
}): SavedGroupPreset | null {
  if (typeof window === "undefined") return null;
  const nameGroups = sanitizeNameGroups(input.nameGroups);
  if (!nameGroups.length) return null;
  const store = readPresetsStoreRaw();
  const name = String(input.name || "").trim() || suggestNextGroupPresetName(store.presets);
  const note = String(input.note || "").trim();
  const incoming = normalizePreset({
    id: input.id,
    name,
    note,
    period: input.period,
    mode: input.mode,
    scoreDisplay: input.scoreDisplay,
    firstStart: input.firstStart,
    stepMinutes: input.stepMinutes,
    reviveExtraMinutes: input.reviveExtraMinutes,
    groupSize: input.groupSize,
    nameGroups,
    groupLabels: sanitizeGroupLabels(input.groupLabels),
    savedAt: new Date().toISOString(),
  });
  if (!incoming) return null;

  const idx = store.presets.findIndex((p) => p.id === incoming.id);
  const presets = store.presets.slice();
  if (idx >= 0) presets[idx] = incoming;
  else presets.unshift(incoming);

  const makeActive = input.makeActive !== false;
  writePresetsStore({
    version: 1,
    activeId: makeActive ? incoming.id : store.activeId,
    presets,
  });
  return incoming;
}

export function setActiveGroupPreset(id: string | null): SavedGroupPreset | null {
  const store = readPresetsStoreRaw();
  if (!id) {
    writePresetsStore({ ...store, activeId: null });
    return null;
  }
  const hit = store.presets.find((p) => p.id === id) || null;
  if (!hit) return null;
  writePresetsStore({ ...store, activeId: hit.id });
  return hit;
}

export function deleteSavedGroupPreset(id: string): SavedGroupPresetsStore {
  const store = readPresetsStoreRaw();
  const presets = store.presets.filter((p) => p.id !== id);
  const activeId = store.activeId === id ? null : store.activeId;
  return writePresetsStore({ version: 1, activeId, presets });
}

export type ScheduleSettings = {
  firstStart: string;
  stepMinutes: number;
  /** 第4组后插复活赛：第5组起每组顺延分钟数 */
  reviveExtraMinutes: number;
  groupSize: number;
};

export function normalizeFirstStart(value: string | undefined | null, fallback = PRESET_BATTLE_FIRST_START) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function normalizeStepMinutes(value: number | string | undefined | null, fallback = PRESET_BATTLE_STEP_MINUTES) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback || 15;
  return Math.min(180, Math.max(1, n));
}

export function normalizeReviveExtraMinutes(
  value: number | string | undefined | null,
  fallback = PRESET_BATTLE_REVIVE_EXTRA_MINUTES
) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback || 0;
  return Math.min(60, Math.max(0, n));
}

export function normalizeGroupSize(value: number | string | undefined | null, fallback = DEFAULT_PK_GROUP_SIZE) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback || 8;
  return Math.min(20, Math.max(2, n));
}

/** 按开始时间 + 间隔给各组贴连麦时间（导出图 / 卡片共用） */
export function attachScheduleToGroups<T extends { startTime?: string; scheduleLabel?: string }>(
  groups: T[],
  options?: { firstStart?: string; stepMinutes?: number; reviveExtraMinutes?: number }
): T[] {
  const firstStart = normalizeFirstStart(options?.firstStart);
  const stepMinutes = normalizeStepMinutes(options?.stepMinutes);
  const reviveExtraMinutes = normalizeReviveExtraMinutes(options?.reviveExtraMinutes);
  const match = firstStart.match(/^(\d{1,2}):(\d{2})$/);
  const startMin = match ? Number(match[1]) * 60 + Number(match[2]) : 8 * 60 + 15;
  return groups.map((g, i) => {
    // 第4组后插复活赛：第5组起（index>=4）顺延 reviveExtraMinutes
    const startTime = formatHm(startMin + i * stepMinutes + (i >= 4 ? reviveExtraMinutes : 0));
    return {
      ...g,
      startTime,
      scheduleLabel: `${startTime} 开始连麦`,
    };
  });
}

export function groupsToNameGroups(groups: Array<{ members?: Array<{ name?: string }> }>): string[][] {
  return (groups || []).map((g) =>
    (g.members || []).map((m) => String(m?.name || "").trim()).filter(Boolean)
  );
}

export function loadSavedGroupsLayout(): SavedGroupsLayout | null {
  if (typeof window === "undefined") return null;
  const active = getActiveGroupPreset();
  if (active) return presetToLayout(active);
  try {
    const raw = window.localStorage.getItem(GROUPS_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGroupsLayout;
    const nameGroups = sanitizeNameGroups(parsed?.nameGroups);
    if (!nameGroups.length) return null;
    return {
      version: 1,
      id: parsed.id,
      name: parsed.name,
      note: parsed.note,
      period: parsed.period,
      mode: parsed.mode,
      scoreDisplay: parsed.scoreDisplay,
      firstStart: parsed.firstStart ? normalizeFirstStart(parsed.firstStart) : undefined,
      stepMinutes:
        parsed.stepMinutes != null ? normalizeStepMinutes(parsed.stepMinutes) : undefined,
      reviveExtraMinutes:
        parsed.reviveExtraMinutes != null
          ? normalizeReviveExtraMinutes(parsed.reviveExtraMinutes)
          : undefined,
      groupSize: parsed.groupSize != null ? normalizeGroupSize(parsed.groupSize) : undefined,
      nameGroups,
      groupLabels: sanitizeGroupLabels(parsed?.groupLabels),
      savedAt: parsed.savedAt || "",
    };
  } catch {
    return null;
  }
}

export function saveGroupsLayout(input: {
  nameGroups: string[][];
  groupLabels?: string[];
  period?: string;
  mode?: string;
  scoreDisplay?: string;
  firstStart?: string;
  stepMinutes?: number;
  reviveExtraMinutes?: number;
  groupSize?: number;
  id?: string;
  name?: string;
  note?: string;
  makeActive?: boolean;
}): SavedGroupsLayout | null {
  if (typeof window === "undefined") return null;
  const store = readPresetsStoreRaw();
  const active = store.activeId ? store.presets.find((p) => p.id === store.activeId) : null;
  const id = input.id || active?.id;
  const name =
    String(input.name || "").trim() ||
    active?.name ||
    suggestNextGroupPresetName(store.presets);
  const note =
    input.note !== undefined ? String(input.note || "").trim() : active?.note || "";
  const saved = saveNamedGroupPreset({
    id,
    name,
    note,
    nameGroups: input.nameGroups,
    groupLabels: input.groupLabels,
    period: input.period,
    mode: input.mode,
    scoreDisplay: input.scoreDisplay,
    firstStart: input.firstStart,
    stepMinutes: input.stepMinutes,
    reviveExtraMinutes: input.reviveExtraMinutes,
    groupSize: input.groupSize,
    makeActive: input.makeActive !== false,
  });
  return saved ? presetToLayout(saved) : null;
}

export function clearSavedGroupsLayout() {
  if (typeof window === "undefined") return;
  const store = readPresetsStoreRaw();
  writePresetsStore({ ...store, activeId: null });
  window.localStorage.removeItem(GROUPS_LAYOUT_STORAGE_KEY);
}


/** 当前分组导出为 CSV 文本（带 BOM，Excel 可直接打开中文） */
export function exportPkGroupsToCsv(
  groups: Array<{
    order?: number;
    label?: string;
    startTime?: string;
    scheduleLabel?: string;
    members?: Array<{
      index?: number;
      name?: string;
      trimmedAvg?: number;
      wave?: number;
      latestWave?: number;
      strength?: number;
    }>;
  }>,
  options?: { scoreField?: "wave" | "latestWave" }
): string {
  const scoreField = options?.scoreField || "wave";
  const waveHeader = scoreField === "latestWave" ? "最新音浪" : "月音浪";
  const header = ["组序", "组名", "开场时间", "组内序号", "姓名", "去峰日均", waveHeader, "战力"];
  const rows: Array<Array<string | number>> = [header];
  (groups || []).forEach((g, gi) => {
    const order = g.order ?? gi + 1;
    const label = g.label || `第${order}组`;
    const startTime = g.startTime || g.scheduleLabel || "";
    (g.members || []).forEach((m, mi) => {
      const wave = scoreField === "latestWave" ? Number(m.latestWave || 0) : Number(m.wave || 0);
      rows.push([
        order,
        label,
        startTime,
        m.index ?? mi + 1,
        m.name || "",
        Math.round(Number(m.trimmedAvg || 0)),
        Math.round(wave),
        Math.round(Number(m.strength || wave || 0)),
      ]);
    });
  });
  const escape = (value: string | number) => {
    const s = String(value ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return `\ufeff${rows.map((row) => row.map(escape).join(",")).join("\n")}`;
}

export function downloadPkGroupsCsv(filename: string, csvText: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 200);
}

/** 从 scheduleLabel 抽开场时间，如 "12:15 开始连麦" → "12:15" */
export function extractPkGroupStartTime(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const m = raw.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : raw;
}

type PkCopyGroup = {
  key?: string;
  order?: number;
  label?: string;
  startTime?: string;
  scheduleLabel?: string;
  members?: Array<{ name?: string | null } | null> | null;
};

/**
 * 复制用纯文本：仅组名 + 时间 + 人名。
 * 例：
 * 第1组 · 12:15
 * 啸辰 · 狼凯 · 浩泽 · …
 */
export function formatPkGroupsCopyText(
  groups: PkCopyGroup[] | null | undefined,
  options?: { groupKey?: string }
): string {
  const list = Array.isArray(groups) ? groups : [];
  const filtered = options?.groupKey
    ? list.filter((g, i) => (g.key || `g-${g.order ?? i + 1}`) === options.groupKey)
    : list;
  const blocks: string[] = [];
  filtered.forEach((g, i) => {
    const order = g.order ?? i + 1;
    const label = String(g.label || `第${order}组`).trim() || `第${order}组`;
    const time =
      extractPkGroupStartTime(g.startTime) ||
      extractPkGroupStartTime(g.scheduleLabel);
    const names = (g.members || [])
      .map((m) => String(m?.name || "").trim())
      .filter(Boolean)
      .join(" · ");
    const head = time ? `${label} · ${time}` : label;
    blocks.push(names ? `${head}\n${names}` : head);
  });
  return blocks.join("\n\n").trim();
}

/** 写入剪贴板；失败时走 textarea 兜底 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text || "");
  if (!value) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 开发期校验：TS 白名单与 shared 内置组扁平顺序一致 */
export function assertPresetRosterSynced() {
  const fromText = parseRosterText(PRESET_ROSTER_TEXT);
  const fromShared = parseRosterText(flattenPresetRosterText());
  if (fromText.length !== fromShared.length) {
    return {
      ok: false as const,
      reason: `人数不一致 text=${fromText.length} shared=${fromShared.length}`,
    };
  }
  for (let i = 0; i < fromText.length; i += 1) {
    if (canonicalRosterName(fromText[i]) !== canonicalRosterName(fromShared[i])) {
      return {
        ok: false as const,
        reason: `顺序不一致 @${i + 1}: ${fromText[i]} vs ${fromShared[i]}`,
      };
    }
  }
  return { ok: true as const };
}

function readLegacyIncludeText(): string | null {
  if (typeof window === "undefined") return null;
  for (const key of [LEGACY_ROSTER_CONFIG_STORAGE_KEY, LEGACY_ROSTER_CONFIG_STORAGE_KEY_V16]) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        midmonth?: { includeText?: string };
        includeText?: string;
      };
      const text =
        parsed?.midmonth?.includeText ||
        (typeof parsed?.includeText === "string" ? parsed.includeText : "");
      if (text && String(text).trim()) return String(text);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function loadRosterText(): string {
  if (typeof window === "undefined") return PRESET_ROSTER_TEXT;
  try {
    const raw = window.localStorage.getItem(ROSTER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { includeText?: string };
      if (typeof parsed?.includeText === "string" && parsed.includeText.trim()) {
        return parsed.includeText;
      }
    }
    const legacy = readLegacyIncludeText();
    if (legacy) return legacy;
  } catch {
    /* ignore */
  }
  return PRESET_ROSTER_TEXT;
}

export function saveRosterText(includeText: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    ROSTER_STORAGE_KEY,
    JSON.stringify({ includeText: String(includeText || "") })
  );
}
