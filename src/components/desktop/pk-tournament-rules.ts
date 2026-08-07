/** 四阶段出线 / 切组纯函数 — 无 DOM、无 storage */

export type RankedPerson = {
  key: string;
  score: number;
};

/** 7 人组切法：默认前4后3；晋级池不足时可改前3后4 */
export type SevenPersonSplit = "4-3" | "3-4" | "auto";

export type TournamentRules = {
  groupSize: number;
  /** 兼容旧字段：满编组默认直晋人数（现由 resolveGroupTopRevive 按 n 决定） */
  groupTop: number;
  /** 兼容旧字段：满编组默认复活尾人数 */
  groupReviveTail: number;
  promoTarget: number;
  idealPromoPool: number;
  /** null = 按 idealPromoPool - 直晋人数自动算 */
  reviveTarget: number | null;
  /**
   * 7 人组切法。
   * - "4-3"：前4直晋 · 后3复活（默认）
   * - "3-4"：前3直晋 · 后4复活（晋级池人数不足时手动/自动上调）
   * - "auto"：按 idealPromoPool 与各组规模估算，必要时升为 3-4
   */
  sevenPersonSplit?: SevenPersonSplit;
};

export const DEFAULT_TOURNAMENT_RULES: TournamentRules = {
  groupSize: 8,
  groupTop: 4,
  groupReviveTail: 4,
  promoTarget: 8,
  // 晋级 8 组 × 每组 6 → 理想池 48；直晋 32 + 复活出 16（淘 10）
  idealPromoPool: 48,
  reviveTarget: null,
  sevenPersonSplit: "4-3",
};

/** 晋级赛：固定 8 组，每组默认 6 人（可到 8） */
export const PROMO_GROUP_COUNT = 8;
export const PROMO_GROUP_MIN = 6;
export const PROMO_GROUP_MAX = 8;
export const PROMO_POOL_MIN = PROMO_GROUP_COUNT * PROMO_GROUP_MIN; // 48
export const PROMO_POOL_MAX = PROMO_GROUP_COUNT * PROMO_GROUP_MAX; // 64

/**
 * 复活赛：先分组，组内前 N 晋级、其余淘汰。
 * 默认每组前 4 出线；组数按池大小均分（约 6–8 人/组）。
 * 内置 26 人 → 4 组（7,7,6,6）× 前 4 = 出 16 · 淘 10。
 */
export const REVIVE_GROUP_TOP = 4;
export const REVIVE_GROUP_SIZE_HINT = 7;

/** 复活池应切成几组（均分，目标每组约 6–8） */
export function resolveReviveGroupCount(poolSize: number): number {
  const n = Math.max(0, Math.floor(Number(poolSize) || 0));
  if (n <= 0) return 0;
  if (n <= 8) return 1;
  // 目标每组约 REVIVE_GROUP_SIZE_HINT，至少 1 组
  return Math.max(1, Math.round(n / REVIVE_GROUP_SIZE_HINT));
}

/** 复活组内出线人数：前 min(REVIVE_GROUP_TOP, n)；尾组人少则全出 */
export function resolveReviveGroupTop(groupSize: number): number {
  const n = Math.max(0, Math.floor(Number(groupSize) || 0));
  if (n <= 0) return 0;
  return Math.min(REVIVE_GROUP_TOP, n);
}

/**
 * 复活组内：已按分降序 → 前 top 晋级，其余淘汰。
 */
export function splitReviveGroupAdvance(
  ranked: RankedPerson[],
  top: number
): { advance: string[]; eliminated: string[] } {
  const list = ranked.map((r) => String(r.key || "").trim()).filter(Boolean);
  const n = list.length;
  if (n === 0) return { advance: [], eliminated: [] };
  const topN = Math.max(0, Math.min(Math.floor(top), n));
  return {
    advance: list.slice(0, topN),
    eliminated: list.slice(topN),
  };
}

export function sortByScoreDesc(rows: RankedPerson[]): RankedPerson[] {
  return [...rows].sort((a, b) => {
    const ds = (b.score || 0) - (a.score || 0);
    if (ds !== 0) return ds;
    return String(a.key).localeCompare(String(b.key), "zh");
  });
}

/**
 * 按组人数决定直晋 / 复活尾。
 * **小组赛零淘汰**：top + reviveTail 必须覆盖全组。
 * - n≥8：前 4 直晋 · 其余全部进复活（满编 8 = 后 4）
 * - n=7：默认前 4 后 3；可调前 3 后 4
 * - n<7：尽量前 4，剩余进复活
 * 淘汰只发生在复活赛（前 K 出线，后 池−K 淘）。
 */
export function resolveGroupTopRevive(
  groupSize: number,
  options?: { sevenPersonSplit?: Exclude<SevenPersonSplit, "auto"> | "4-3" | "3-4" }
): { top: number; reviveTail: number } {
  const n = Math.max(0, Math.floor(Number(groupSize) || 0));
  if (n <= 0) return { top: 0, reviveTail: 0 };

  if (n === 7) {
    const mode = options?.sevenPersonSplit === "3-4" ? "3-4" : "4-3";
    if (mode === "3-4") return { top: 3, reviveTail: 4 };
    return { top: 4, reviveTail: 3 };
  }

  // n≠7：前 min(4,n) 直晋，其余全进复活 → 小组零淘汰
  const top = Math.min(4, n);
  return { top, reviveTail: Math.max(0, n - top) };
}

/**
 * 估算 7 人组切法。
 * auto：先按 4-3 估直晋/复活池；若 idealPromoPool - 直晋 > 4-3 复活池，改 3-4 扩大复活。
 * 显式 "4-3" / "3-4" 原样返回。
 */
export function resolveSevenPersonSplit(opts: {
  groupSizes: number[];
  idealPromoPool: number;
  sevenPersonSplit?: SevenPersonSplit | null;
}): Exclude<SevenPersonSplit, "auto"> {
  const mode = opts.sevenPersonSplit || "4-3";
  if (mode === "4-3" || mode === "3-4") return mode;

  // auto
  let direct43 = 0;
  let revive43 = 0;
  for (const raw of opts.groupSizes || []) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    const { top, reviveTail } = resolveGroupTopRevive(n, { sevenPersonSplit: "4-3" });
    const adv = Math.min(top, n);
    direct43 += adv;
    revive43 += Math.min(reviveTail, Math.max(0, n - adv));
  }
  const ideal = Math.max(0, Math.floor(opts.idealPromoPool) || 0);
  const need = Math.max(0, ideal - direct43);
  if (need > revive43) return "3-4";
  return "4-3";
}

/**
 * 组内已按分降序：前 top 直晋；从末位向前取 reviveTail 进复活（与 top 不重叠）。
 */
export function splitGroupAdvanceRevive(
  ranked: RankedPerson[],
  top: number,
  reviveTail: number
): { advance: string[]; revive: string[]; eliminated: string[] } {
  const list = ranked.map((r) => String(r.key || "").trim()).filter(Boolean);
  const n = list.length;
  if (n === 0) return { advance: [], revive: [], eliminated: [] };

  const topN = Math.max(0, Math.min(Math.floor(top), n));
  const advance = list.slice(0, topN);
  const rest = list.slice(topN);
  const reviveN = Math.max(0, Math.min(Math.floor(reviveTail), rest.length));
  // 后 N：rest 末尾（当 reviveTail >= rest.length 时整段 rest 进复活，无中间淘汰）
  const revive = reviveN > 0 ? rest.slice(rest.length - reviveN) : [];
  const reviveSet = new Set(revive);
  const eliminated = rest.filter((k) => !reviveSet.has(k));
  return { advance, revive, eliminated };
}

/** 顺序切块（高分在前的名单 → 第1组先装满） */
export function chunkKeys(keys: string[], groupSize: number): string[][] {
  const size = Math.max(1, Math.floor(groupSize) || 8);
  const list = (keys || []).map((k) => String(k || "").trim()).filter(Boolean);
  const groups: string[][] = [];
  for (let i = 0; i < list.length; i += size) {
    groups.push(list.slice(i, i + size));
  }
  return groups;
}

/**
 * 固定组数均分（晋级赛：固定 8 组）。
 * 第 i 组人数 = floor(n/g) + (i < n%g ? 1 : 0)，余数从前组顺延。
 * 空名单 → []；groupCount≤0 时按 1 组处理。
 */
export function splitIntoNGroups(keys: string[], groupCount: number): string[][] {
  const list = (keys || []).map((k) => String(k || "").trim()).filter(Boolean);
  if (!list.length) return [];
  const g = Math.max(1, Math.floor(Number(groupCount) || 1));
  const n = list.length;
  const base = Math.floor(n / g);
  const rem = n % g;
  const groups: string[][] = [];
  let offset = 0;
  for (let i = 0; i < g; i++) {
    const size = base + (i < rem ? 1 : 0);
    if (size <= 0) continue;
    groups.push(list.slice(offset, offset + size));
    offset += size;
  }
  return groups;
}

/**
 * 晋级池目标总人数：夹在 [48, 64]（8 组 × 6–8 人），
 * 且不超过 direct + revivePool，不低于 direct（复活可 0 出）。
 * idealPromoPool 作为偏好目标，被上下限与可用人数裁剪。
 */
export function resolvePromoPoolTarget(opts: {
  directAdvanceCount: number;
  revivePoolSize: number;
  idealPromoPool?: number | null;
}): number {
  const direct = Math.max(0, Math.floor(Number(opts.directAdvanceCount) || 0));
  const pool = Math.max(0, Math.floor(Number(opts.revivePoolSize) || 0));
  const available = direct + pool;
  if (available <= 0) return 0;

  let ideal =
    opts.idealPromoPool != null && Number.isFinite(Number(opts.idealPromoPool))
      ? Math.max(0, Math.floor(Number(opts.idealPromoPool)))
      : PROMO_POOL_MIN;

  // 偏好落在 56–64；再与可用人数取交
  ideal = Math.min(PROMO_POOL_MAX, Math.max(PROMO_POOL_MIN, ideal));
  ideal = Math.min(available, Math.max(direct, ideal));
  return ideal;
}

/**
 * 复活出线人数 K：前 K 晋级，后 (池-K) 淘汰。
 * - reviveTarget 显式 → 用该值
 * - 否则按晋级池目标（8 组 × 7–8）反推：K = promoPoolTarget - direct
 * - 且 0 ≤ K ≤ 复活池
 */
export function resolveReviveTarget(opts: {
  directAdvanceCount: number;
  idealPromoPool: number;
  reviveTarget: number | null | undefined;
  revivePoolSize?: number;
}): number {
  const poolRaw = opts.revivePoolSize;
  const poolKnown = poolRaw != null && Number.isFinite(Number(poolRaw));
  const pool = poolKnown ? Math.max(0, Math.floor(Number(poolRaw))) : NaN;
  let target: number;
  if (opts.reviveTarget != null && Number.isFinite(Number(opts.reviveTarget))) {
    target = Math.max(0, Math.floor(Number(opts.reviveTarget)));
  } else {
    const direct = Math.max(0, Math.floor(opts.directAdvanceCount) || 0);
    // 池未知时按满编上限估（可到 64），有池则用真实池
    const poolSize = poolKnown ? pool : Math.max(0, PROMO_POOL_MAX - direct);
    const promoTarget = resolvePromoPoolTarget({
      directAdvanceCount: direct,
      revivePoolSize: poolSize,
      idealPromoPool: opts.idealPromoPool,
    });
    target = Math.max(0, promoTarget - direct);
  }
  if (poolKnown) target = Math.min(target, pool);
  return Math.max(0, target);
}

/** 复活/任意池：按分降序取前 count 晋级（其余即淘汰） */
export function pickAdvanceFromRanked(ranked: RankedPerson[], count: number): string[] {
  const n = Math.max(0, Math.floor(count) || 0);
  return sortByScoreDesc(ranked)
    .slice(0, n)
    .map((r) => r.key);
}

export function pickPromoToFinals(ranked: RankedPerson[], promoTarget: number): string[] {
  return pickAdvanceFromRanked(ranked, promoTarget);
}

/** 合并多组成绩为全局排名（同 key 取最高分） */
export function mergeBestScores(
  rows: Array<{ key: string; score: number | null | undefined }>
): RankedPerson[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = String(row.key || "").trim();
    if (!key) continue;
    if (row.score == null || !Number.isFinite(Number(row.score))) continue;
    const score = Number(row.score);
    const prev = map.get(key);
    if (prev == null || score > prev) map.set(key, score);
  }
  return sortByScoreDesc(Array.from(map.entries()).map(([key, score]) => ({ key, score })));
}
