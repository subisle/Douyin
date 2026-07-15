import type { PkMember } from "@/types/electron";

/** 与抖音监控分数账本共用，勿改 key */
export const MATCH_LEDGER_STORAGE_KEY = "douyin-monitor-match-ledger-v1";
/** 争霸赛进入监控时写入，用于隔离历史场次，避免跨轮次同步。 */
export const SCORE_SYNC_CONTEXT_STORAGE_KEY = "star-battle-monitor-sync-context-v1";

export interface MonitorLedgerScore {
  anchorId: string;
  name: string;
  uniqueId: string;
  score: number;
}

export interface MonitorLedgerRound {
  round: number;
  battleId: string;
  mode?: string;
  modeLabel?: string;
  phase?: string;
  status: "running" | "finished" | string;
  startedAt?: string;
  endedAt?: string;
  scores: MonitorLedgerScore[];
  winnerId?: string;
  winnerName?: string;
}

export interface MonitorScoreSyncContext {
  version: 1;
  period: string;
  roundKey: string;
  roundLabel: string;
  expectedGroupCount: number;
  groupKeys: string[];
  baselineBattleIds: string[];
  createdAt: string;
}

function safeText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function scoreFromUnknown(value: unknown): MonitorLedgerScore | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const anchorId =
    safeText(row.anchorId) ||
    safeText(row.userId) ||
    safeText(row.user_id) ||
    safeText(row.openId);
  if (!anchorId || anchorId === "0") return null;
  const score = safeNumber(row.score);
  if (score < 0) return null;
  return {
    anchorId,
    name: safeText(row.name) || safeText(row.realName) || safeText(row.nickname) || safeText(row.displayName),
    uniqueId: safeText(row.uniqueId) || safeText(row.douyinId),
    score,
  };
}

export function loadMonitorMatchLedger(): MonitorLedgerRound[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MATCH_LEDGER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row, index) => {
        if (!row || typeof row !== "object") return null;
        const item = row as Record<string, unknown>;
        const scores = Array.isArray(item.scores)
          ? (item.scores.map(scoreFromUnknown).filter(Boolean) as MonitorLedgerScore[])
          : [];
        return {
          round: safeNumber(item.round) || index + 1,
          battleId: safeText(item.battleId) || `round-${index + 1}`,
          mode: safeText(item.mode),
          modeLabel: safeText(item.modeLabel),
          phase: safeText(item.phase),
          status: safeText(item.status) || "running",
          startedAt: safeText(item.startedAt),
          endedAt: safeText(item.endedAt),
          scores,
          winnerId: safeText(item.winnerId),
          winnerName: safeText(item.winnerName),
        } satisfies MonitorLedgerRound;
      })
      .filter(Boolean) as MonitorLedgerRound[];
  } catch {
    return [];
  }
}

export function loadMonitorScoreSyncContext(): MonitorScoreSyncContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SCORE_SYNC_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MonitorScoreSyncContext>;
    if (
      parsed.version !== 1
      || !safeText(parsed.period)
      || !safeText(parsed.roundKey)
      || !Array.isArray(parsed.groupKeys)
      || !Array.isArray(parsed.baselineBattleIds)
    ) {
      return null;
    }
    return {
      version: 1,
      period: safeText(parsed.period),
      roundKey: safeText(parsed.roundKey),
      roundLabel: safeText(parsed.roundLabel) || safeText(parsed.roundKey),
      expectedGroupCount: Math.max(0, safeNumber(parsed.expectedGroupCount)),
      groupKeys: parsed.groupKeys.map(safeText).filter(Boolean),
      baselineBattleIds: parsed.baselineBattleIds.map(safeText).filter(Boolean),
      createdAt: safeText(parsed.createdAt),
    };
  } catch {
    return null;
  }
}

export function beginMonitorScoreSyncContext(options: {
  period: string;
  roundKey: string;
  roundLabel: string;
  groupKeys: string[];
  rounds?: MonitorLedgerRound[];
}): MonitorScoreSyncContext {
  const rounds = options.rounds || loadMonitorMatchLedger();
  const context: MonitorScoreSyncContext = {
    version: 1,
    period: safeText(options.period),
    roundKey: safeText(options.roundKey),
    roundLabel: safeText(options.roundLabel) || safeText(options.roundKey),
    expectedGroupCount: options.groupKeys.length,
    groupKeys: options.groupKeys.map(safeText).filter(Boolean),
    baselineBattleIds: Array.from(
      new Set(rounds.map((round) => safeText(round.battleId)).filter(Boolean))
    ),
    createdAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SCORE_SYNC_CONTEXT_STORAGE_KEY, JSON.stringify(context));
  }
  return context;
}

export function monitorRoundsForSyncContext(
  context: MonitorScoreSyncContext | null,
  rounds: MonitorLedgerRound[] = loadMonitorMatchLedger()
) {
  if (!context) return [] as MonitorLedgerRound[];
  const baseline = new Set(context.baselineBattleIds);
  return sortLedgerRoundsByPlayOrder(
    rounds.filter((round) => !baseline.has(safeText(round.battleId)))
  );
}

export function memberIdentityKeys(member: Pick<PkMember, "personId" | "name" | "anchorId" | "anchorIds" | "douyinNos">) {
  return Array.from(
    new Set(
      [
        member.anchorId,
        ...(member.anchorIds || []),
        ...(member.douyinNos || []),
        member.name,
        String(member.personId),
      ]
        .map((item) => safeText(item).toLowerCase())
        .filter(Boolean)
    )
  );
}

function scoreIdentityKeys(score: MonitorLedgerScore) {
  return Array.from(
    new Set(
      [score.anchorId, score.uniqueId, score.name]
        .map((item) => safeText(item).toLowerCase())
        .filter(Boolean)
    )
  );
}

function namesLooselyMatch(a: string, b: string) {
  const left = safeText(a).toLowerCase();
  const right = safeText(b).toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  // 避免过短误匹配
  if (left.length < 2 || right.length < 2) return false;
  return left.includes(right) || right.includes(left);
}

/** 将监控分数行匹配到名单成员；优先 ID，其次昵称 */
export function findScoreForMember(
  member: Pick<PkMember, "personId" | "name" | "anchorId" | "anchorIds" | "douyinNos">,
  scores: MonitorLedgerScore[]
): MonitorLedgerScore | null {
  const memberKeys = new Set(memberIdentityKeys(member));
  // 1) 精确 ID
  for (const score of scores) {
    const keys = scoreIdentityKeys(score);
    if (keys.some((key) => memberKeys.has(key) && key !== safeText(member.name).toLowerCase())) {
      return score;
    }
  }
  // 2) 昵称宽松匹配
  for (const score of scores) {
    if (namesLooselyMatch(member.name, score.name)) return score;
  }
  return null;
}

export interface ScoreSyncHit {
  personId: number;
  name: string;
  groupKey: string;
  groupLabel: string;
  score: number;
  battleId: string;
  matchRound: number;
  /** 对应分组出场序号（1-based，与连麦/PK 顺序一致） */
  groupSlot: number;
  source: string;
}

function parseClockSortKey(value?: string) {
  const text = safeText(value);
  if (!text) return Number.POSITIVE_INFINITY;
  const full = Date.parse(text);
  if (Number.isFinite(full)) return full;
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

/** 按真实开打顺序排序：startedAt → endedAt → round */
export function sortLedgerRoundsByPlayOrder(rounds: MonitorLedgerRound[]) {
  return [...rounds].sort((a, b) => {
    const startDiff = parseClockSortKey(a.startedAt) - parseClockSortKey(b.startedAt);
    if (Number.isFinite(startDiff) && startDiff !== 0) return startDiff;
    const endDiff = parseClockSortKey(a.endedAt) - parseClockSortKey(b.endedAt);
    if (Number.isFinite(endDiff) && endDiff !== 0) return endDiff;
    return (a.round || 0) - (b.round || 0);
  });
}

/**
 * 连麦/PK 按分组出场顺序进行：
 * 监控第 1 场最终分 → 当前轮次第 1 组
 * 监控第 2 场最终分 → 当前轮次第 2 组
 * ...
 *
 * 每场分数只写入对应组内能匹配到的成员（主播ID / 抖音号 / 昵称）。
 */
export function collectScoreSyncHits(options: {
  groups: Array<{ key: string; label: string; members: PkMember[] }>;
  rounds?: MonitorLedgerRound[];
  /** 只同步已结束场次（默认 true） */
  finishedOnly?: boolean;
  /**
   * 映射模式：
   * - slot（默认）：第 N 场 → 第 N 组（连麦出场顺序）
   * - global：跨所有组匹配，同人取最近一场
   */
  mode?: "slot" | "global";
}): ScoreSyncHit[] {
  const rounds = options.rounds || loadMonitorMatchLedger();
  const finishedOnly = options.finishedOnly !== false;
  const mode = options.mode || "slot";
  const targets = sortLedgerRoundsByPlayOrder(
    finishedOnly
      ? rounds.filter((round) => round.status === "finished" && round.scores.some((score) => score.score > 0))
      : rounds.filter((round) => round.scores.some((score) => score.score > 0))
  );

  if (mode === "global") {
    const byPerson = new Map<number, ScoreSyncHit>();
    for (const round of targets) {
      for (const group of options.groups) {
        for (const member of group.members) {
          const hit = findScoreForMember(member, round.scores);
          if (!hit || hit.score <= 0) continue;
          byPerson.set(member.personId, {
            personId: member.personId,
            name: member.name,
            groupKey: group.key,
            groupLabel: group.label,
            score: hit.score,
            battleId: round.battleId,
            matchRound: round.round,
            groupSlot: options.groups.findIndex((item) => item.key === group.key) + 1,
            source: `${round.modeLabel || round.mode || "PK"} 第${round.round}场`,
          });
        }
      }
    }
    return Array.from(byPerson.values());
  }

  // slot 模式：第 N 场 PK → 第 N 组（出场顺序）
  const hits: ScoreSyncHit[] = [];
  const count = Math.min(targets.length, options.groups.length);
  for (let index = 0; index < count; index += 1) {
    const round = targets[index];
    const group = options.groups[index];
    const slot = index + 1;
    for (const member of group.members) {
      const hit = findScoreForMember(member, round.scores);
      if (!hit || hit.score <= 0) continue;
      hits.push({
        personId: member.personId,
        name: member.name,
        groupKey: group.key,
        groupLabel: group.label,
        score: hit.score,
        battleId: round.battleId,
        matchRound: round.round,
        groupSlot: slot,
        source: `第${slot}场连麦/PK → ${group.label}`,
      });
    }
  }
  return hits;
}
