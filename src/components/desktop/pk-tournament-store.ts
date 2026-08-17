/** PK 监控四阶段状态：localStorage + 结算回写分组 preset */

import type { PkMember } from "@/types/electron";
import {
  BUILTIN_PROMO_PRESET_NAME,
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_FIRST_START,
  PRESET_BATTLE_META,
  PRESET_BATTLE_STEP_MINUTES,
  PRESET_PROMO_GROUPS,
  PRESET_PROMO_META,
  canonicalRosterName,
  getActiveGroupPreset,
  listSavedGroupPresets,
  loadSavedGroupsLayout,
  saveNamedGroupPreset,
  type SavedGroupPreset,
} from "./pk-roster-config";
import {
  DEFAULT_TOURNAMENT_RULES,
  PROMO_GROUP_COUNT,
  chunkKeys,
  mergeBestScores,
  pickPromoToFinals,
  resolveGroupTopRevive,
  resolveReviveGroupCount,
  resolveReviveGroupTop,
  resolveSevenPersonSplit,
  sortByScoreDesc,
  splitGroupAdvanceRevive,
  splitIntoNGroups,
  splitReviveGroupAdvance,
  type TournamentRules,
} from "./pk-tournament-rules";

/** 815 唯一分组元信息兜底（避免 CJS/HMR re-export 瞬时 undefined 崩导入） */
const BUILTIN_BATTLE_META = {
  label: "815",
  source: "815 唯一分组",
  firstStart: PRESET_BATTLE_FIRST_START || "12:15",
  stepMinutes: PRESET_BATTLE_STEP_MINUTES || 15,
  reviveExtraMinutes: 0,
  periodHint: "2026-08",
};

export const TOURNAMENT_STORAGE_KEY = "pk-monitor-tournament-v1";

export const STAGE_TABS = [
  { key: "group", label: "小组赛" },
  { key: "revive", label: "复活赛" },
  { key: "promo", label: "晋级赛" },
  { key: "finals", label: "决赛" },
] as const;

export type StageKey = (typeof STAGE_TABS)[number]["key"];

export type StageGroupStatus = "pending" | "live" | "scored" | "settled";

export type StageMemberScore = {
  memberKey: string;
  name: string;
  personId?: number;
  anchorId?: string;
  douyinNos?: string[];
  score: number | null;
  manual?: boolean;
};

export type StageGroup = {
  key: string;
  label: string;
  members: StageMemberScore[];
  status: StageGroupStatus;
  battleId?: string;
  updatedAt?: string;
};

export type StageState = {
  groups: StageGroup[];
  settled: boolean;
  advanceKeys: string[];
  reviveKeys?: string[];
  presetId?: string;
  presetName?: string;
};

/**
 * 前后半程流程状态：
 * 小组赛①(前四组) → 复活赛① → 小组赛②(后四组) → 复活赛② → 晋级赛 → 决赛
 */
export type TournamentFlow = {
  /** 小组赛当前结算半程：1=前四组 · 2=后四组 */
  groupPhase: 1 | 2;
  /** 当前复活赛对应的小组赛半程 */
  revivePhase: 1 | 2;
  /** 已累计晋级池（直晋 + 复活出线，保序去重） */
  promoPool: string[];
};

export type TournamentState = {
  version: 1;
  period?: string;
  sourcePresetId?: string;
  sourcePresetName?: string;
  rules: TournamentRules;
  flow: TournamentFlow;
  stages: Record<StageKey, StageState>;
  activeStage: StageKey;
  updatedAt: string;
};

export type MemberMeta = {
  personId?: number;
  name?: string;
  anchorId?: string;
  douyinNos?: string[];
};

export type SettleResult = {
  state: TournamentState;
  preset: SavedGroupPreset | null;
  message: string;
};

const DEFAULT_FLOW: TournamentFlow = { groupPhase: 1, revivePhase: 1, promoPool: [] };

function emptyStage(): StageState {
  return { groups: [], settled: false, advanceKeys: [] };
}

export function createEmptyTournamentState(
  partial?: Partial<TournamentState>
): TournamentState {
  return {
    version: 1,
    period: partial?.period,
    sourcePresetId: partial?.sourcePresetId,
    sourcePresetName: partial?.sourcePresetName,
    rules: { ...DEFAULT_TOURNAMENT_RULES, ...(partial?.rules || {}) },
    flow: { ...DEFAULT_FLOW, ...(partial?.flow || {}) },
    stages: {
      group: emptyStage(),
      revive: emptyStage(),
      promo: emptyStage(),
      finals: emptyStage(),
      ...(partial?.stages || {}),
    },
    activeStage: partial?.activeStage || "group",
    updatedAt: partial?.updatedAt || new Date().toISOString(),
  };
}

function cloneState(state: TournamentState): TournamentState {
  return JSON.parse(JSON.stringify(state)) as TournamentState;
}

function nowIso() {
  return new Date().toISOString();
}

function groupLabel(index: number) {
  return `第${index + 1}组`;
}

function groupKey(stage: StageKey, index: number) {
  return `${stage}-g${index + 1}`;
}

function memberFromName(
  rawName: string,
  metaByKey?: Map<string, MemberMeta>
): StageMemberScore {
  const name = String(rawName || "").trim();
  const memberKey = canonicalRosterName(name) || name;
  const meta = metaByKey?.get(memberKey);
  return {
    memberKey,
    name: meta?.name || name,
    personId: meta?.personId,
    anchorId: meta?.anchorId ? String(meta.anchorId) : undefined,
    douyinNos: meta?.douyinNos?.length ? [...meta.douyinNos] : undefined,
    score: null,
  };
}

function buildMetaMap(
  membersMeta?: MemberMeta[] | PkMember[] | null
): Map<string, MemberMeta> {
  const map = new Map<string, MemberMeta>();
  for (const raw of membersMeta || []) {
    if (!raw) continue;
    const name = String((raw as MemberMeta).name || "").trim();
    const key = canonicalRosterName(name) || name;
    if (!key) continue;
    const existing = map.get(key) || {};
    const anchorId =
      String((raw as MemberMeta).anchorId || "").trim() || existing.anchorId;
    const douyinNos = Array.from(
      new Set([
        ...((raw as MemberMeta).douyinNos || existing.douyinNos || []).map((n) =>
          String(n || "").trim()
        ),
        ...((raw as PkMember).anchorIds || []).map((n) => String(n || "").trim()),
      ].filter(Boolean))
    );
    map.set(key, {
      personId:
        typeof (raw as MemberMeta).personId === "number"
          ? (raw as MemberMeta).personId
          : existing.personId,
      name: name || existing.name,
      anchorId: anchorId || undefined,
      douyinNos: douyinNos.length ? douyinNos : existing.douyinNos,
    });
  }
  return map;
}

function groupsFromNameGroups(
  stage: StageKey,
  nameGroups: string[][],
  metaByKey?: Map<string, MemberMeta>
): StageGroup[] {
  return (nameGroups || [])
    .map((names, index) => {
      const members = (names || [])
        .map((n) => memberFromName(n, metaByKey))
        .filter((m) => m.memberKey);
      if (!members.length) return null;
      return {
        key: groupKey(stage, index),
        label: groupLabel(index),
        members,
        status: "pending" as StageGroupStatus,
      };
    })
    .filter((g): g is StageGroup => Boolean(g));
}

function nameGroupsFromKeys(
  keys: string[],
  lookup: Map<string, StageMemberScore>,
  groupSize: number
): string[][] {
  const chunks = chunkKeys(keys, groupSize);
  return chunks.map((chunk) =>
    chunk.map((key) => lookup.get(key)?.name || key).filter(Boolean)
  );
}

/** 晋级赛：固定 groupCount 组均分（默认 8 组，每组约 7–8） */
function nameGroupsSplitN(
  keys: string[],
  lookup: Map<string, StageMemberScore>,
  groupCount: number = PROMO_GROUP_COUNT
): string[][] {
  const chunks = splitIntoNGroups(keys, groupCount);
  return chunks.map((chunk) =>
    chunk.map((key) => lookup.get(key)?.name || key).filter(Boolean)
  );
}

function collectMemberLookup(state: TournamentState): Map<string, StageMemberScore> {
  const map = new Map<string, StageMemberScore>();
  for (const stage of STAGE_TABS) {
    for (const group of state.stages[stage.key].groups) {
      for (const member of group.members) {
        if (!member.memberKey) continue;
        const prev = map.get(member.memberKey);
        if (!prev) {
          map.set(member.memberKey, { ...member });
          continue;
        }
        map.set(member.memberKey, {
          ...prev,
          ...member,
          name: member.name || prev.name,
          anchorId: member.anchorId || prev.anchorId,
          douyinNos: member.douyinNos?.length ? member.douyinNos : prev.douyinNos,
          personId: member.personId ?? prev.personId,
          score: member.score != null ? member.score : prev.score,
        });
      }
    }
  }
  return map;
}

function findPresetIdByName(name: string): string | undefined {
  const hit = listSavedGroupPresets().find(
    (p) => String(p.name || "").trim() === name
  );
  return hit?.id;
}

function writePreset(opts: {
  name: string;
  nameGroups: string[][];
  period?: string;
  groupSize: number;
  note: string;
  existingId?: string;
}): SavedGroupPreset | null {
  const id = opts.existingId || findPresetIdByName(opts.name);
  return saveNamedGroupPreset({
    id,
    name: opts.name,
    nameGroups: opts.nameGroups,
    period: opts.period,
    mode: "high_to_low",
    groupSize: opts.groupSize,
    note: opts.note,
    makeActive: false,
  });
}

function rankedMembersOfGroup(group: StageGroup) {
  return sortByScoreDesc(
    group.members
      .filter((m) => m.score != null && Number.isFinite(Number(m.score)))
      .map((m) => ({ key: m.memberKey, score: Number(m.score) }))
  );
}

function allRankedInStage(stage: StageState) {
  return mergeBestScores(
    stage.groups.flatMap((g) =>
      g.members.map((m) => ({ key: m.memberKey, score: m.score }))
    )
  );
}

function markStageSettled(stage: StageState): StageState {
  return {
    ...stage,
    settled: true,
    groups: stage.groups.map((g) => ({
      ...g,
      status: "settled" as StageGroupStatus,
      updatedAt: nowIso(),
    })),
  };
}

export function loadTournamentState(): TournamentState {
  if (typeof window === "undefined") return createEmptyTournamentState();
  try {
    const raw = window.localStorage.getItem(TOURNAMENT_STORAGE_KEY);
    if (!raw) return createEmptyTournamentState();
    const parsed = JSON.parse(raw) as TournamentState;
    if (!parsed || parsed.version !== 1 || !parsed.stages) {
      return createEmptyTournamentState();
    }
    return createEmptyTournamentState({
      ...parsed,
      rules: { ...DEFAULT_TOURNAMENT_RULES, ...(parsed.rules || {}) },
      flow: {
        groupPhase: parsed.flow?.groupPhase === 2 ? 2 : 1,
        revivePhase: parsed.flow?.revivePhase === 2 ? 2 : 1,
        promoPool: Array.isArray(parsed.flow?.promoPool)
          ? (parsed.flow.promoPool as string[])
          : [],
      },
      stages: {
        group: { ...emptyStage(), ...(parsed.stages.group || {}) },
        revive: { ...emptyStage(), ...(parsed.stages.revive || {}) },
        promo: { ...emptyStage(), ...(parsed.stages.promo || {}) },
        finals: { ...emptyStage(), ...(parsed.stages.finals || {}) },
      },
    });
  } catch {
    return createEmptyTournamentState();
  }
}

export function saveTournamentState(state: TournamentState): TournamentState {
  const next = { ...state, updatedAt: nowIso(), version: 1 as const };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(TOURNAMENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  }
  return next;
}

export function importGroupStageFromPreset(
  nameGroups: string[][],
  options?: {
    membersMeta?: MemberMeta[] | PkMember[] | null;
    period?: string;
    sourcePresetId?: string;
    sourcePresetName?: string;
    rules?: Partial<TournamentRules>;
    state?: TournamentState;
  }
): TournamentState {
  const base = options?.state
    ? cloneState(options.state)
    : createEmptyTournamentState();
  const metaByKey = buildMetaMap(options?.membersMeta);
  const groups = groupsFromNameGroups("group", nameGroups, metaByKey);
  base.period = options?.period || base.period;
  base.sourcePresetId = options?.sourcePresetId || base.sourcePresetId;
  base.sourcePresetName = options?.sourcePresetName || base.sourcePresetName;
  if (options?.rules) base.rules = { ...base.rules, ...options.rules };
  base.stages.group = {
    groups,
    settled: false,
    advanceKeys: [],
    reviveKeys: [],
  };
  // 导入小组赛时清空后续阶段
  base.stages.revive = emptyStage();
  base.stages.promo = emptyStage();
  base.stages.finals = emptyStage();
  base.activeStage = "group";
  base.flow = { groupPhase: 1, revivePhase: 1, promoPool: [] };
  return saveTournamentState(base);
}

/** 从指定 / 激活 / 布局导入小组赛（多存档先选再监控） */
export function importGroupStageFromActiveLayout(options?: {
  membersMeta?: MemberMeta[] | PkMember[] | null;
  state?: TournamentState;
  /** 指定 PK 分组存档 id；不传则用激活存档 / 布局 */
  presetId?: string | null;
}): { state: TournamentState; message: string } | { state: null; message: string } {
  const presetId = String(options?.presetId || "").trim();
  const listed = presetId
    ? listSavedGroupPresets().find((p) => p.id === presetId) || null
    : null;
  const active = listed || getActiveGroupPreset();
  const layout = active
    ? {
        nameGroups: active.nameGroups,
        period: active.period,
        id: active.id,
        name: active.name,
      }
    : loadSavedGroupsLayout();
  if (!layout?.nameGroups?.length) {
    return {
      state: null,
      message: presetId
        ? "所选 PK 分组不存在或为空"
        : "没有可导入的 PK 分组（请先在分组页保存/激活，或在此选择存档）",
    };
  }
  const state = importGroupStageFromPreset(layout.nameGroups, {
    membersMeta: options?.membersMeta,
    period: layout.period,
    sourcePresetId: "id" in layout ? layout.id : undefined,
    sourcePresetName: layout.name,
    state: options?.state,
  });
  const count = state.stages.group.groups.length;
  const members = state.stages.group.groups.reduce(
    (sum, g) => sum + g.members.length,
    0
  );
  return {
    state,
    message: `已导入小组赛 ${count} 组 / ${members} 人${
      layout.name ? ` · 来源 ${layout.name}` : ""
    }`,
  };
}

/** 列出可选 PK 分组存档（监控页下拉） */
export function listPkGroupPresetsForMonitor(): Array<{
  id: string;
  name: string;
  groupCount: number;
  memberCount: number;
  savedAt: string;
  active: boolean;
}> {
  const activeId = getActiveGroupPreset()?.id || "";
  return listSavedGroupPresets().map((p) => {
    const groups = (p.nameGroups || []).filter((g) => (g || []).length > 0);
    return {
      id: p.id,
      name: p.name,
      groupCount: groups.length,
      memberCount: groups.reduce((s, g) => s + g.length, 0),
      savedAt: p.savedAt,
      active: p.id === activeId,
    };
  });
}

const BUILTIN_GROUP_STAGE_PRESET_NAME = "815";

/**
 * 从 815 唯一分组（PRESET_BATTLE_GROUPS · 58 人 8 组）导入小组赛。
 * 默认同步写入 PK 分组命名存档「815」并设为激活（makeActive 默认 true）。
 * 赛程：小组赛 → 复活赛 → 晋级赛 → 决赛 均基于此表。
 */
export function importGroupStageFromBuiltIn(options?: {
  membersMeta?: MemberMeta[] | PkMember[] | null;
  state?: TournamentState;
  /** 是否写入命名存档「815」，默认 true */
  savePreset?: boolean;
  /** 写入存档时是否设为激活，默认 true（PK 分组页可见） */
  makeActive?: boolean;
  period?: string;
}):
  | { state: TournamentState; preset: SavedGroupPreset | null; message: string }
  | { state: null; preset: null; message: string } {
  const nameGroups = (PRESET_BATTLE_GROUPS || [])
    .map((row) => (row || []).map((n) => String(n || "").trim()).filter(Boolean))
    .filter((row) => row.length > 0);
  if (!nameGroups.length) {
    return { state: null, preset: null, message: "815 分组表为空" };
  }

  const meta = {
    ...BUILTIN_BATTLE_META,
    ...(PRESET_BATTLE_META && typeof PRESET_BATTLE_META === "object" ? PRESET_BATTLE_META : null),
  };
  const period =
    String(options?.period || meta.periodHint || "").trim() || undefined;
  const sourceName = String(meta.source || BUILTIN_BATTLE_META.source);
  const firstStart = String(meta.firstStart || BUILTIN_BATTLE_META.firstStart);
  const stepMinutes = Number(meta.stepMinutes) || BUILTIN_BATTLE_META.stepMinutes;

  let preset: SavedGroupPreset | null = null;
  const shouldSave = options?.savePreset !== false;
  if (shouldSave) {
    const existingId = findPresetIdByName(BUILTIN_GROUP_STAGE_PRESET_NAME);
    preset = saveNamedGroupPreset({
      id: existingId,
      name: BUILTIN_GROUP_STAGE_PRESET_NAME,
      nameGroups,
      period,
      mode: "preset",
      firstStart,
      stepMinutes,
      groupSize: DEFAULT_TOURNAMENT_RULES.groupSize,
      note: [
        sourceName,
        `${nameGroups.length} 组 · ${nameGroups.reduce((s, g) => s + g.length, 0)} 人`,
        `规模 ${nameGroups.map((g) => g.length).join("+")}`,
        `${firstStart}×${stepMinutes}min${Number(meta.reviveExtraMinutes) > 0 ? `·第4组后+${Number(meta.reviveExtraMinutes)}min` : ""}`,
        `导入 ${nowIso()}`,
      ].join(" · "),
      makeActive: options?.makeActive !== false,
    });
  }

  const state = importGroupStageFromPreset(nameGroups, {
    membersMeta: options?.membersMeta,
    period,
    sourcePresetId: preset?.id || "builtin-preset-battle",
    sourcePresetName: preset?.name || sourceName,
    state: options?.state,
    rules: {
      groupSize: DEFAULT_TOURNAMENT_RULES.groupSize,
      groupTop: DEFAULT_TOURNAMENT_RULES.groupTop,
      groupReviveTail: DEFAULT_TOURNAMENT_RULES.groupReviveTail,
      // 7 人组前4后3 · 6 人组前4后2 → 直晋32 + 复活23；ideal=48 → 复活出16淘7 · 晋级 8×6
      idealPromoPool: DEFAULT_TOURNAMENT_RULES.idealPromoPool,
      reviveTarget: null,
      sevenPersonSplit: DEFAULT_TOURNAMENT_RULES.sevenPersonSplit || "4-3",
    },
  });

  const count = state.stages.group.groups.length;
  const members = state.stages.group.groups.reduce(
    (sum, g) => sum + g.members.length,
    0
  );
  return {
    state,
    preset,
    message: [
      `已导入 815 唯一分组 ${count} 组 / ${members} 人`,
      sourceName,
      preset ? `已写入 PK 分组 · ${preset.name}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * 从内置晋级赛分组（PRESET_PROMO_GROUPS · 44 人 8 组）导入晋级赛阶段。
 * 只覆盖 promo + finals，保留小组赛 / 复活赛阶段与 flow；默认写入命名存档「晋级赛-815」。
 */
export function importPromoFromBuiltIn(options?: {
  membersMeta?: MemberMeta[] | PkMember[] | null;
  state?: TournamentState;
  /** 是否写入命名存档「晋级赛-815」，默认 true */
  savePreset?: boolean;
  /** 写入存档时是否设为激活，默认 false（不顶掉小组赛激活布局） */
  makeActive?: boolean;
  period?: string;
}):
  | { state: TournamentState; preset: SavedGroupPreset | null; message: string }
  | { state: null; preset: null; message: string } {
  const nameGroups = (PRESET_PROMO_GROUPS || [])
    .map((row) => (row || []).map((n) => String(n || "").trim()).filter(Boolean))
    .filter((row) => row.length > 0);
  if (!nameGroups.length) {
    return { state: null, preset: null, message: "晋级赛分组表为空" };
  }

  const base = options?.state ? cloneState(options.state) : createEmptyTournamentState();
  const metaByKey = buildMetaMap(options?.membersMeta);
  const total = nameGroups.reduce((s, g) => s + g.length, 0);
  base.period =
    String(options?.period || base.period || PRESET_PROMO_META.periodHint || "").trim() ||
    undefined;
  base.sourcePresetName = BUILTIN_PROMO_PRESET_NAME;
  base.stages.promo = {
    groups: groupsFromNameGroups("promo", nameGroups, metaByKey),
    settled: false,
    advanceKeys: [],
  };
  base.stages.finals = emptyStage();
  base.activeStage = "promo";

  let preset: SavedGroupPreset | null = null;
  if (options?.savePreset !== false) {
    const existingId = findPresetIdByName(BUILTIN_PROMO_PRESET_NAME);
    preset = saveNamedGroupPreset({
      id: existingId,
      name: BUILTIN_PROMO_PRESET_NAME,
      nameGroups,
      period: base.period,
      mode: "preset",
      groupSize: Math.max(...nameGroups.map((g) => g.length), DEFAULT_TOURNAMENT_RULES.groupSize),
      note: [
        PRESET_PROMO_META.source || "815 晋级赛分组",
        `${nameGroups.length} 组 · ${total} 人`,
        `规模 ${nameGroups.map((g) => g.length).join("+")}`,
        `导入 ${nowIso()}`,
      ].join(" · "),
      makeActive: options?.makeActive === true,
    });
    if (preset) {
      base.stages.promo.presetId = preset.id;
      base.stages.promo.presetName = preset.name;
    }
  }

  const saved = saveTournamentState(base);
  return {
    state: saved,
    preset,
    message: [
      `已导入 晋级赛分组 ${nameGroups.length} 组 / ${total} 人`,
      PRESET_PROMO_META.source,
      preset ? `已写入 PK 分组 · ${preset.name}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export function setMemberScore(
  state: TournamentState,
  stage: StageKey,
  groupKeyValue: string,
  memberKey: string,
  score: number | null,
  manual = true
): TournamentState {
  const next = cloneState(state);
  const group = next.stages[stage].groups.find((g) => g.key === groupKeyValue);
  if (!group) return state;
  const member = group.members.find(
    (m) => m.memberKey === memberKey || m.name === memberKey
  );
  if (!member) return state;
  member.score =
    score == null || !Number.isFinite(Number(score)) ? null : Number(score);
  member.manual = manual;
  group.updatedAt = nowIso();
  if (group.status === "pending" || group.status === "live") {
    const scored = group.members.some((m) => m.score != null);
    group.status = scored ? "scored" : group.status;
  }
  next.activeStage = stage;
  return saveTournamentState(next);
}

export type ScoreRowInput = {
  key?: string;
  name?: string;
  anchorId?: string;
  douyinNo?: string;
  uniqueId?: string;
  score: number;
};

function applyScoreRowsToOneGroup(
  group: StageGroup,
  scores: ScoreRowInput[],
  options?: { manual?: boolean; onlyEmpty?: boolean }
): number {
  const manual = Boolean(options?.manual);
  let hit = 0;
  for (const row of scores || []) {
    const score = Number(row.score);
    if (!Number.isFinite(score)) continue;
    const anchorId = String(row.anchorId || "").trim();
    const douyinNo =
      String(row.douyinNo || "").trim() || String(row.uniqueId || "").trim();
    const keys = [
      canonicalRosterName(String(row.key || "")),
      canonicalRosterName(String(row.name || "")),
      anchorId,
      douyinNo,
    ].filter(Boolean);

    const member = group.members.find((m) => {
      if (keys.includes(m.memberKey)) return true;
      if (keys.includes(canonicalRosterName(m.name))) return true;
      if (m.anchorId && keys.includes(String(m.anchorId))) return true;
      if (m.douyinNos?.some((d) => keys.includes(String(d)))) return true;
      return false;
    });
    if (!member) continue;
    if (options?.onlyEmpty && member.score != null && !member.manual) continue;
    if (member.manual && !manual) continue; // 手改优先，采分不覆盖
    member.score = score;
    // 匹配成功后回写 ID，避免后续只能靠脱敏/变体昵称
    if (anchorId && !member.anchorId) member.anchorId = anchorId;
    if (douyinNo) {
      const nos = new Set((member.douyinNos || []).map((d) => String(d)));
      if (!nos.has(douyinNo)) {
        nos.add(douyinNo);
        member.douyinNos = Array.from(nos);
      }
    }
    if (manual) member.manual = true;
    else delete member.manual;
    hit += 1;
  }

  if (hit > 0) {
    group.updatedAt = nowIso();
    if (group.status !== "settled") group.status = "scored";
  }
  return hit;
}

export function applyScoresToGroup(
  state: TournamentState,
  stage: StageKey,
  groupKeyValue: string,
  scores: ScoreRowInput[],
  options?: { manual?: boolean; onlyEmpty?: boolean }
): TournamentState {
  const next = cloneState(state);
  const group = next.stages[stage].groups.find((g) => g.key === groupKeyValue);
  if (!group) return state;
  applyScoreRowsToOneGroup(group, scores, options);
  next.activeStage = stage;
  return saveTournamentState(next);
}

/**
 * 单房连麦采分：按名/ID 写入**本阶段全部组**。
 * 连麦顺序=分组名单顺序，不按组开多房监控。
 */
export function applyScoresToStage(
  state: TournamentState,
  stage: StageKey,
  scores: ScoreRowInput[],
  options?: { manual?: boolean; onlyEmpty?: boolean }
): TournamentState {
  const next = cloneState(state);
  const groups = next.stages[stage]?.groups || [];
  if (!groups.length) return state;
  let totalHit = 0;
  for (const group of groups) {
    if (group.status === "settled") continue;
    totalHit += applyScoreRowsToOneGroup(group, scores, options);
  }
  if (totalHit === 0 && !(scores || []).length) return state;
  next.activeStage = stage;
  return saveTournamentState(next);
}

export function setGroupStatus(
  state: TournamentState,
  stage: StageKey,
  groupKeyValue: string,
  status: StageGroupStatus
): TournamentState {
  const next = cloneState(state);
  const group = next.stages[stage].groups.find((g) => g.key === groupKeyValue);
  if (!group) return state;
  group.status = status;
  group.updatedAt = nowIso();
  return saveTournamentState(next);
}

/** 保序去重合并名单 */
function mergeOrderedUnique(list: string[]): string[] {
  const seen = new Set<string>();
  return (list || []).filter((k) => {
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 小组赛前后半程切界：前 boundary 组为第①程，其余为第②程。
 */
export function groupPhaseBoundary(groupCount: number): number {
  const n = Math.max(0, Math.floor(Number(groupCount) || 0));
  return Math.ceil(n / 2);
}

export function groupPhaseList(stage: StageState, phase: 1 | 2): StageGroup[] {
  const groups = stage?.groups || [];
  if (!groups.length) return [];
  const boundary = groupPhaseBoundary(groups.length);
  return phase === 1 ? groups.slice(0, boundary) : groups.slice(boundary);
}

export function isGroupPhaseSettled(stage: StageState, phase: 1 | 2): boolean {
  const list = groupPhaseList(stage, phase);
  return list.length > 0 && list.every((g) => g.status === "settled");
}

/** 当前半程组是否已全部记分（自动结算前置；已结算的组不算） */
export function isGroupPhaseFullyScored(stage: StageState, phase: 1 | 2): boolean {
  const list = groupPhaseList(stage, phase);
  if (!list.length) return false;
  if (list.some((g) => g.status === "settled")) return false;
  return list.every(
    (g) =>
      g.members.length > 0 &&
      g.members.every((m) => m.score != null && Number.isFinite(Number(m.score)))
  );
}

/** 当前小组赛结算半程（由 flow 决定） */
export function currentGroupPhase(state: TournamentState): 1 | 2 {
  return state?.flow?.groupPhase === 2 ? 2 : 1;
}

/** 阶段是否已全部记分（group 按当前半程判定，其余阶段全量） */
export function isStageFullyScoredForTournament(
  state: TournamentState,
  stageKey: StageKey
): boolean {
  if (stageKey === "group") {
    return isGroupPhaseFullyScored(state.stages.group, currentGroupPhase(state));
  }
  return isStageFullyScored(state.stages[stageKey]);
}

/** 阶段页签名：小组赛/复活赛随前后半程显示 ①/② */
export function stageTabLabel(state: TournamentState, tabKey: StageKey): string {
  if (tabKey === "group") {
    return currentGroupPhase(state) === 1 ? "小组赛①" : "小组赛②";
  }
  if (tabKey === "revive") {
    return state.flow?.revivePhase === 2 ? "复活赛②" : "复活赛①";
  }
  if (tabKey === "promo") return "晋级赛";
  return "决赛";
}

/** 累计晋级池 → 晋级赛 8 组均分（只有后半程复活结束后调用） */
function buildPromoFromPoolSettle(
  next: TournamentState,
  opts?: { extraNote?: string }
): SettleResult {
  const promoPool = next.flow?.promoPool || [];
  const lookup = collectMemberLookup(next);
  const promoNameGroups = nameGroupsSplitN(promoPool, lookup, PROMO_GROUP_COUNT);
  const meta = buildMetaMap(
    Array.from(lookup.values()).map((m) => ({
      personId: m.personId,
      name: m.name,
      anchorId: m.anchorId,
      douyinNos: m.douyinNos,
    }))
  );
  next.stages.promo = {
    groups: groupsFromNameGroups("promo", promoNameGroups, meta),
    settled: false,
    advanceKeys: [],
  };
  next.stages.finals = emptyStage();
  next.activeStage = "promo";

  const sizes = promoNameGroups.map((g) => g.length);
  const sizeHint = sizes.length
    ? sizes.every((n) => n === sizes[0])
      ? `${sizes[0]} 人/组`
      : `${Math.min(...sizes)}–${Math.max(...sizes)} 人/组`
    : "";
  const note = [
    opts?.extraNote || "",
    `晋级池 ${promoPool.length} · 晋级 ${promoNameGroups.length} 组${sizeHint ? `（${sizeHint}）` : ""}`,
    next.period ? `period ${next.period}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const preset = promoNameGroups.length
    ? writePreset({
        name: "晋级赛",
        nameGroups: promoNameGroups,
        period: next.period,
        groupSize: Math.max(...sizes, next.rules.groupSize),
        note,
        existingId: next.stages.promo.presetId,
      })
    : null;

  if (preset) {
    next.stages.promo.presetId = preset.id;
    next.stages.promo.presetName = preset.name;
  }

  const saved = saveTournamentState(next);
  const head = opts?.extraNote || "小组赛已结算";
  return {
    state: saved,
    preset,
    message: preset
      ? `${head} · 累计晋级池 ${promoPool.length} 人 · 已写入 PK 分组 · 晋级赛`
      : `${head} · 累计晋级池 ${promoPool.length} 人`,
  };
}

/**
 * 结算小组赛**当前半程**（前四组或后四组）：
 * 半程内 7 人前4后3 / 6 人前4后2 → 直晋 + 复活池；只结算本半程的组。
 * 前四组结算后进入复活赛①；后四组结算后进入复活赛②。
 */
export function settleGroupStage(state: TournamentState): SettleResult {
  const next = cloneState(state);
  const stage = next.stages.group;
  if (!stage.groups.length) {
    return { state, preset: null, message: "小组赛无分组，无法结算" };
  }
  if (stage.settled) {
    return { state, preset: null, message: "小组赛已全部结算" };
  }

  const phase = currentGroupPhase(next);
  const phaseGroups = groupPhaseList(stage, phase);
  if (phaseGroups.length === 0) {
    return { state, preset: null, message: "小组赛分组为空，无法结算" };
  }
  const phaseLabel = phase === 1 ? "前四组" : "后四组";
  if (phaseGroups.every((g) => g.status === "settled")) {
    return { state, preset: null, message: `小组赛${phaseLabel}已结算` };
  }

  const rules = next.rules;
  const sevenMode = resolveSevenPersonSplit({
    groupSizes: stage.groups.map((g) => g.members.length),
    idealPromoPool: rules.idealPromoPool,
    sevenPersonSplit: rules.sevenPersonSplit,
  });

  const advanceAll: string[] = [];
  const reviveAll: string[] = [];
  for (const group of phaseGroups) {
    if (group.status === "settled") continue;
    const ranked = rankedMembersOfGroup(group);
    if (!ranked.length) {
      return {
        state,
        preset: null,
        message: `${group.label} 尚无记分，无法结算`,
      };
    }
    const n = ranked.length;
    const { top, reviveTail } = resolveGroupTopRevive(n, {
      sevenPersonSplit: sevenMode,
    });
    const split = splitGroupAdvanceRevive(ranked, top, reviveTail);
    advanceAll.push(...split.advance);
    reviveAll.push(...split.revive);
  }

  // 直晋累计到本阶段（保序去重）；复活池 = 本半程复活尾
  const advanceKeys = mergeOrderedUnique([...(stage.advanceKeys || []), ...advanceAll]);
  const advanceSet = new Set(advanceKeys);
  const seenR = new Set<string>();
  const reviveKeys = reviveAll.filter((k) => {
    if (!k || seenR.has(k) || advanceSet.has(k)) return false;
    seenR.add(k);
    return true;
  });

  stage.advanceKeys = advanceKeys;
  stage.reviveKeys = reviveKeys;
  // 只标记本半程的组为已结算
  const phaseKeySet = new Set(phaseGroups.map((g) => g.key));
  stage.groups = stage.groups.map((g) =>
    phaseKeySet.has(g.key)
      ? { ...g, status: "settled" as StageGroupStatus, updatedAt: nowIso() }
      : g
  );
  if (isGroupPhaseSettled(stage, 1) && isGroupPhaseSettled(stage, 2)) {
    stage.settled = true;
  }

  // 直晋计入晋级池；复活池进本半程复活赛
  next.flow = {
    ...next.flow,
    promoPool: mergeOrderedUnique([...(next.flow?.promoPool || []), ...advanceAll]),
    revivePhase: phase,
  };

  const lookup = collectMemberLookup(next);
  const meta = buildMetaMap(
    Array.from(lookup.values()).map((m) => ({
      personId: m.personId,
      name: m.name,
      anchorId: m.anchorId,
      douyinNos: m.douyinNos,
    }))
  );

  let reviveNameGroups: string[][] = [];
  let reviveGroups: StageGroup[] = [];
  if (reviveKeys.length) {
    const reviveGroupCount = resolveReviveGroupCount(reviveKeys.length);
    reviveNameGroups = nameGroupsSplitN(reviveKeys, lookup, reviveGroupCount || 1);
    reviveGroups = groupsFromNameGroups("revive", reviveNameGroups, meta);
  }
  next.stages.revive = {
    groups: reviveGroups,
    settled: false,
    advanceKeys: [],
  };

  // 本轮没有复活池 → 直接推进流程
  if (!reviveGroups.length) {
    if (phase === 1) {
      next.flow = { ...next.flow, groupPhase: 2 };
      next.stages.promo = emptyStage();
      next.stages.finals = emptyStage();
      next.activeStage = "group";
      const saved = saveTournamentState(next);
      return {
        state: saved,
        preset: null,
        message: `小组赛前四组已结算：直晋 ${advanceAll.length} · 无复活池，进入后四组小组赛`,
      };
    }
    return buildPromoFromPoolSettle(next, {
      extraNote: `小组赛后四组已结算：直晋 ${advanceAll.length} · 无复活池`,
    });
  }

  next.stages.promo = emptyStage();
  next.stages.finals = emptyStage();
  next.activeStage = "revive";

  const note = [
    `小组赛${phaseLabel}结算 ${nowIso()}`,
    `直晋 ${advanceAll.length} · 复活池 ${reviveKeys.length}`,
    `复活 ${reviveGroups.length} 组（组内前4出线）`,
    `规则 8人组前4后4 · 7人组${sevenMode === "3-4" ? "前3后4" : "前4后3"}`,
    next.period ? `period ${next.period}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const preset = reviveGroups.length
    ? writePreset({
        name: phase === 1 ? "复活赛①" : "复活赛②",
        nameGroups: reviveNameGroups,
        period: next.period,
        groupSize: rules.groupSize,
        note,
        existingId: next.stages.revive.presetId,
      })
    : null;

  if (preset) {
    next.stages.revive.presetId = preset.id;
    next.stages.revive.presetName = preset.name;
  }

  const saved = saveTournamentState(next);
  return {
    state: saved,
    preset,
    message: preset
      ? `小组赛${phaseLabel}已结算：直晋 ${advanceAll.length}（累计 ${advanceKeys.length}）· 本程进复活 ${reviveKeys.length} · 已写入 PK 分组 · ${preset.name}`
      : `小组赛${phaseLabel}已结算：直晋 ${advanceAll.length} · 无复活池`,
  };
}

export function settleReviveStage(state: TournamentState): SettleResult {
  const next = cloneState(state);
  const stage = next.stages.revive;
  if (!stage.groups.length) {
    return { state, preset: null, message: "复活赛无分组，无法结算" };
  }
  if (stage.settled) {
    return { state, preset: null, message: "复活赛已结算" };
  }

  const rules = next.rules;
  // 复活：各组内前 N 晋级、其余淘汰（不再全局 top K）
  const advanceAll: string[] = [];
  let poolScored = 0;
  let eliminatedCount = 0;
  for (const group of stage.groups) {
    const ranked = rankedMembersOfGroup(group);
    if (!ranked.length) {
      return {
        state,
        preset: null,
        message: `${group.label} 尚无记分，无法结算`,
      };
    }
    poolScored += ranked.length;
    const top = resolveReviveGroupTop(ranked.length);
    const split = splitReviveGroupAdvance(ranked, top);
    advanceAll.push(...split.advance);
    eliminatedCount += split.eliminated.length;
  }
  const seenAdv = new Set<string>();
  const reviveAdvance = advanceAll.filter((k) => {
    if (!k || seenAdv.has(k)) return false;
    seenAdv.add(k);
    return true;
  });
  // 仅当显式设置 reviveTarget 时再截断；主路径以组内前 N 为准
  let capped = reviveAdvance;
  if (rules.reviveTarget != null && Number.isFinite(Number(rules.reviveTarget))) {
    const cap = Math.max(0, Math.floor(Number(rules.reviveTarget)));
    capped = reviveAdvance.slice(0, cap);
    eliminatedCount = Math.max(0, poolScored - capped.length);
  }
  stage.advanceKeys = capped;
  next.stages.revive = markStageSettled(stage);

  const revivePhase = next.flow?.revivePhase === 2 ? 2 : 1;
  // 复活出线累计进晋级池
  next.flow = {
    ...next.flow,
    promoPool: mergeOrderedUnique([...(next.flow?.promoPool || []), ...capped]),
  };
  const phaseLabel = revivePhase === 1 ? "前四组" : "后四组";
  const head = `复活赛${phaseLabel}已结算：组内前4 · 出线 ${capped.length} · 淘汰 ${eliminatedCount}`;
  const note = [
    `复活赛${phaseLabel}结算 ${nowIso()}`,
    `组内前4出线 · 出线 ${capped.length} · 淘汰 ${eliminatedCount}`,
    next.period ? `period ${next.period}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  if (revivePhase === 1) {
    // 前半程复活完成 → 进入后四组小组赛
    next.flow = { ...next.flow, groupPhase: 2 };
    next.stages.promo = emptyStage();
    next.stages.finals = emptyStage();
    next.activeStage = "group";
    const saved = saveTournamentState(next);
    return {
      state: saved,
      preset: null,
      message: `${head} · 接下来 小组赛·后四组`,
    };
  }

  // 后半程复活完成 → 全量晋级池 → 晋级赛 8 组均分
  return buildPromoFromPoolSettle(next, { extraNote: head });
}

export function settlePromoStage(state: TournamentState): SettleResult {
  const next = cloneState(state);
  const stage = next.stages.promo;
  if (!stage.groups.length) {
    return { state, preset: null, message: "晋级赛无分组，无法结算" };
  }
  if (stage.settled) {
    return { state, preset: null, message: "晋级赛已结算" };
  }

  const ranked = allRankedInStage(stage);
  if (!ranked.length) {
    return { state, preset: null, message: "晋级赛尚无记分，无法结算" };
  }

  const rules = next.rules;
  const advanceKeys = pickPromoToFinals(ranked, rules.promoTarget);
  stage.advanceKeys = advanceKeys;
  next.stages.promo = markStageSettled(stage);

  const lookup = collectMemberLookup(next);
  const finalsNameGroups = nameGroupsFromKeys(
    advanceKeys,
    lookup,
    Math.max(rules.promoTarget, rules.groupSize)
  );
  // 决赛固定一桌
  const finalsSingle = [
    advanceKeys.map((key) => lookup.get(key)?.name || key).filter(Boolean),
  ].filter((row) => row.length);

  const meta = buildMetaMap(
    Array.from(lookup.values()).map((m) => ({
      personId: m.personId,
      name: m.name,
      anchorId: m.anchorId,
      douyinNos: m.douyinNos,
    }))
  );
  next.stages.finals = {
    groups: groupsFromNameGroups("finals", finalsSingle, meta).map((g, i) => ({
      ...g,
      label: i === 0 ? "决赛桌" : g.label,
    })),
    settled: false,
    advanceKeys: [],
  };
  next.activeStage = "finals";

  const note = [
    `晋级赛结算 ${nowIso()}`,
    `出线 ${advanceKeys.length} 进决赛`,
    `promoTarget ${rules.promoTarget}`,
    next.period ? `period ${next.period}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const preset = finalsSingle.length
    ? writePreset({
        name: "决赛",
        nameGroups: finalsSingle,
        period: next.period,
        groupSize: advanceKeys.length || rules.promoTarget,
        note,
        existingId: next.stages.finals.presetId,
      })
    : null;

  if (preset) {
    next.stages.finals.presetId = preset.id;
    next.stages.finals.presetName = preset.name;
  }

  void finalsNameGroups;
  const saved = saveTournamentState(next);
  return {
    state: saved,
    preset,
    message: preset
      ? `晋级赛已结算：${advanceKeys.length} 人进决赛 · 已写入 PK 分组 · 决赛`
      : `晋级赛已结算：${advanceKeys.length} 人进决赛`,
  };
}

export function settleActiveStage(state: TournamentState): SettleResult {
  switch (state.activeStage) {
    case "group":
      return settleGroupStage(state);
    case "revive":
      return settleReviveStage(state);
    case "promo":
      return settlePromoStage(state);
    case "finals":
      return {
        state,
        preset: null,
        message: "决赛仅记分排名，无需再结算出线",
      };
    default:
      return { state, preset: null, message: "未知阶段" };
  }
}

export function roomUrlForMember(member: StageMemberScore): string {
  const candidates = [
    ...(member.douyinNos || []),
    member.anchorId || "",
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  for (const raw of candidates) {
    if (/^https?:\/\/live\.douyin\.com\//i.test(raw)) return raw;
    const rid = raw.replace(/^@/, "");
    if (/^\d{6,}$/.test(rid)) return `https://live.douyin.com/${rid}`;
  }
  return "";
}

export function stageSummary(stage: StageState) {
  const groups = stage.groups.length;
  const members = stage.groups.reduce((s, g) => s + g.members.length, 0);
  const scored = stage.groups.reduce(
    (s, g) => s + g.members.filter((m) => m.score != null).length,
    0
  );
  return { groups, members, scored, settled: stage.settled };
}

/** 本阶段是否人人都有分（自动结算前置；决赛仅记分） */
export function isStageFullyScored(stage: StageState): boolean {
  if (!stage?.groups?.length) return false;
  if (stage.settled) return false;
  for (const group of stage.groups) {
    if (!group.members.length) return false;
    for (const m of group.members) {
      if (m.score == null || !Number.isFinite(Number(m.score))) return false;
    }
  }
  return true;
}

/** 单组是否全员有分（顺序 PK 锁定当前组前置） */
export function isGroupFullyScored(group: StageGroup | null | undefined): boolean {
  if (!group?.members?.length) return false;
  if (group.status === "settled") return true;
  for (const m of group.members) {
    if (m.score == null || !Number.isFinite(Number(m.score))) return false;
  }
  return true;
}

/**
 * 顺序 PK 当前组：严格按 groups 数组顺序取第一组未满分、未结算的组。
 * preferredKey 若仍未记满则保留（中途不跳组）。
 */
export function resolveSequentialPkGroupKey(
  stage: StageState,
  preferredKey?: string | null
): string {
  const groups = stage?.groups || [];
  if (!groups.length) return "";
  if (preferredKey) {
    const preferred = groups.find((g) => g.key === preferredKey);
    if (preferred && preferred.status !== "settled" && !isGroupFullyScored(preferred)) {
      return preferred.key;
    }
  }
  for (const group of groups) {
    if (group.status === "settled") continue;
    if (!isGroupFullyScored(group)) return group.key;
  }
  return groups[groups.length - 1]?.key || "";
}

/** 当前组之后的下一组 key；无则 "" */
export function nextPkGroupKey(stage: StageState, currentKey: string): string {
  const groups = stage?.groups || [];
  if (!groups.length || !currentKey) return "";
  const idx = groups.findIndex((g) => g.key === currentKey);
  if (idx < 0) return "";
  for (let i = idx + 1; i < groups.length; i += 1) {
    const g = groups[i];
    if (g.status === "settled") continue;
    return g.key;
  }
  return "";
}

/**
 * 按连麦方识别当前小组：命中人数最多且 ≥2 的组（组序靠前优先）。
 * 用于 UI 自动选中与写分；顺序仅作兜底（见 resolvePkWriteGroupKey）。
 */
export function resolveLiveGroupKey(
  stage: StageState,
  liveRows: Array<{
    name?: string;
    anchorId?: string;
    douyinNo?: string;
    uniqueId?: string;
  }>
): string {
  if (!stage?.groups?.length || !liveRows?.length) return "";
  let bestKey = "";
  let bestHits = 0;
  for (const group of stage.groups) {
    if (group.status === "settled") continue;
    let hits = 0;
    for (const row of liveRows) {
      const keys = [
        canonicalRosterName(String(row.name || "")),
        String(row.anchorId || "").trim(),
        String(row.douyinNo || "").trim(),
        String(row.uniqueId || "").trim(),
      ].filter(Boolean);
      if (!keys.length) continue;
      const matched = group.members.some((m) => {
        if (keys.includes(m.memberKey)) return true;
        if (keys.includes(canonicalRosterName(m.name))) return true;
        if (m.anchorId && keys.includes(String(m.anchorId))) return true;
        if (m.douyinNos?.some((d) => keys.includes(String(d)))) return true;
        return false;
      });
      if (matched) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestKey = group.key;
    }
  }
  return bestHits >= 2 ? bestKey : "";
}

/**
 * 写分目标组（小组赛主路径 = 组序）：
 * 1) 顺序当前组未记满 → 按组序（主持连麦按组顺序）
 * 2) 在线 ≥2 人命中且与顺序组不同 → 视为「打错 PK / 组间对调」，改写到识别组
 * 3) 顺序已满或无 preferred → 在线识别，再顺序兜底
 *
 * 注意：连麦分不进赛程；仅 PK 事件调用本函数。
 */
export function resolvePkWriteGroupKey(
  stage: StageState,
  liveRows: Array<{
    name?: string;
    anchorId?: string;
    douyinNo?: string;
    uniqueId?: string;
  }>,
  preferredKey?: string | null
): string {
  const sequential = resolveSequentialPkGroupKey(stage, preferredKey);
  const liveKey = resolveLiveGroupKey(stage, liveRows || []);
  if (sequential && liveKey && liveKey !== sequential) {
    // 打错 PK / 临时换组：在线身份能认出另一组时，写到识别组
    return liveKey;
  }
  if (sequential) return sequential;
  if (liveKey) return liveKey;
  return resolveSequentialPkGroupKey(stage, preferredKey);
}

/** 自动写入赛程的最低 PK 分（低于此视为噪声 / 未真正开打） */
export const MIN_AUTO_PK_SCORE = 200;
