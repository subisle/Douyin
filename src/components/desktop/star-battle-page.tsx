"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheckBig,
  ClipboardPaste,
  Download,
  GripVertical,
  ListChecks,
  LockKeyhole,
  MonitorUp,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  IpcResult,
  PkMember,
  PkRosterData,
  StarBattleScore,
} from "@/types/electron";
import {
  BrowserModeState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./states";
import { exportElementAsImage } from "./export-image";
import {
  loadRosterConfigs,
  PRESET_PROMOTION_GROUP_COUNT,
  resolvePresetBattleGroups,
  resolvePresetPromotionGroups,
  resolveRosterNames,
  type RosterConfig,
  type RosterSlot,
} from "./pk-roster-config";
import {
  beginMonitorScoreSyncContext,
  collectScoreSyncHits,
  loadMonitorMatchLedger,
  loadMonitorScoreSyncContext,
  MATCH_LEDGER_UPDATED_EVENT,
  monitorRoundsForSyncContext,
  type MonitorScoreSyncContext,
  type ScoreSyncHit,
} from "./monitor-score-sync";

interface BattleGroup {
  key: string;
  label: string;
  members: PkMember[];
  averageWave: number;
  source?: string;
  incomplete?: boolean;
}

const MIN_GROUP_SIZE = 5;
const MAX_GROUP_SIZE = 8;
const PREFERRED_TOP_GROUP_SIZE = 8;
const PREFERRED_TOP_GROUP_COUNT = 2;
// 一页展示全部小组（当前最多 7 组），紧凑布局不再分页
const GROUPS_PER_PAGE = 12;

/**
 * 星嗨争霸赛 · 项目内置规则（开箱默认）
 * ------------------------------------------------------------
 * 流程：PK15号名单 / 内置分组 → 监控记分
 *   小组赛 → 晋级赛 → 决赛
 *   （无复活赛）
 *
 * 小组赛：
 *   - 默认 sizeMode=preset：与 PK名单页共用 PRESET_BATTLE_GROUPS 内置 7 组
 *   - 可选 auto：先录名单，再按音浪从高到低切组
 *   - 组间最优出场（auto/manual）
 *
 * 晋级赛：
 *   - 优先使用 PRESET_PROMOTION_GROUPS 内置名单（8 组）
 *   - 每组晋级 1 人；等待晋级赛全部结束后进入决赛
 *
 * 决赛：晋级各组第 1 名单组
 *
 * 时间：小组 12:15 / 晋级 20:15（间隔 15 分钟）/ 决赛 22:15
 */
// v5：内置流水线默认（自动名单切组 + 最优出场 + 总分晋级）
// v6：默认改用内置固定分组（与 PK名单页同源），避免两边分组不一致
// v7：同步 pk-roster-config v6 均衡 53 人组（8×4+7×3）+ 啸泽/帆/安约束
const GROUP_PLAN_STORAGE_KEY = "star-battle-group-plan-v7";
// v19：导出头部写明每组晋级1人、无复活赛；晋级 20:15 起
const EXPORT_NOTES_STORAGE_KEY = "star-battle-export-notes-v19";
// 小组赛分组拖动顺序；v8：新内置 7 组节奏，避免沿用旧拖拽序
const GROUP_ORDER_STORAGE_KEY = "star-battle-group-order-v8";
const ACTIVE_ROUND_STORAGE_KEY = "star-battle-active-round-v1";

/** 晋级赛默认组数 / 决赛席位（与内置晋级名单同步，每组出 1 人） */
const PROMOTION_GROUP_COUNT = PRESET_PROMOTION_GROUP_COUNT;
const PROMOTION_FINAL_SLOTS = PROMOTION_GROUP_COUNT;

type GroupSizeMode = "preset" | "auto" | "manual";
type GroupSortMode = "wave_desc" | "top_wave_rest_volatility";

interface ManualGroupCount {
  size: number;
  count: number;
}

interface GroupPlanConfig {
  sizeMode: GroupSizeMode;
  sortMode: GroupSortMode;
  /** 手动：按组人数配置数量，例如 8人组2个、7人组5个 */
  manualCounts: ManualGroupCount[];
  /** 兼容自由文本，如 8x2,7x5 */
  manualText: string;
}

function defaultGroupPlan(): GroupPlanConfig {
  return {
    // 默认与 PK名单页同一套内置固定分组，避免两处分组各算各的
    sizeMode: "preset",
    sortMode: "wave_desc",
    // 与 PRESET_BATTLE_GROUPS 53 人结构一致：8+8+8+8+7+7+7
    manualCounts: [
      { size: 8, count: 4 },
      { size: 7, count: 3 },
      { size: 6, count: 0 },
      { size: 5, count: 0 },
    ],
    manualText: "8x4,7x3",
  };
}

function loadGroupPlan(): GroupPlanConfig {
  if (typeof window === "undefined") return defaultGroupPlan();
  try {
    const raw = window.localStorage.getItem(GROUP_PLAN_STORAGE_KEY);
    if (!raw) return defaultGroupPlan();
    const parsed = JSON.parse(raw) as Partial<GroupPlanConfig>;
    const defaults = defaultGroupPlan();
    const manualCounts = Array.isArray(parsed.manualCounts)
      ? defaults.manualCounts.map((item) => {
          const hit = parsed.manualCounts?.find((row) => Number(row?.size) === item.size);
          return {
            size: item.size,
            count: Math.max(0, Math.floor(Number(hit?.count) || 0)),
          };
        })
      : defaults.manualCounts;
    const sizeMode: GroupSizeMode =
      parsed.sizeMode === "manual"
        ? "manual"
        : parsed.sizeMode === "auto"
          ? "auto"
          : "preset";
    return {
      sizeMode,
      sortMode:
        parsed.sortMode === "top_wave_rest_volatility"
          ? "top_wave_rest_volatility"
          : "wave_desc",
      manualCounts,
      manualText: String(parsed.manualText ?? countsToText(manualCounts)),
    };
  } catch {
    return defaultGroupPlan();
  }
}

/** 连麦时间表：按出场场次顺序固定，与具体人员无关。 */
const SCHEDULE_MATCH_MINUTES = 10;
const SCHEDULE_GAP_MINUTES = 5; // 组间间隔
const SCHEDULE_SLOT_STEP = SCHEDULE_MATCH_MINUTES + SCHEDULE_GAP_MINUTES; // 15

/** 各轮次首场开始时间（项目内置；组数随名单变，时间按场次顺延） */
const ROUND_FIRST_START: Record<string, string> = {
  group: "12:15",
  // 小组末场约 13:45 开打 → 结束后进复活
  revival: "14:00",
  // 晋级赛晚场：20:15 起，8 场 × 间隔 15 分钟
  promotion: "20:15",
  // 晋级第8场 22:00 开打 → 约 22:10 结束，隔 5 分钟进决赛
  final: "22:15",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseHm(value: string) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatHm(totalMinutes: number) {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function formatLinkmicLabel(hm: string) {
  return `${hm} 开始连麦`;
}

function roundFirstStart(roundKey: string) {
  return ROUND_FIRST_START[roundKey] || ROUND_FIRST_START.group;
}

/** 按场次 1..count 生成固定时间（拖组不改时间轴）。 */
function buildSequentialSchedule(
  count: number,
  firstStart = ROUND_FIRST_START.group,
  stepMinutes = SCHEDULE_SLOT_STEP
) {
  const map = new Map<number, string>();
  const start = parseHm(firstStart);
  if (start == null || count <= 0) return map;
  for (let i = 0; i < count; i++) {
    const hm = formatHm(start + i * stepMinutes);
    map.set(i + 1, formatLinkmicLabel(hm));
  }
  return map;
}

function defaultExportNotes() {
  const promotionSchedule = buildSequentialSchedule(
    PROMOTION_GROUP_COUNT,
    ROUND_FIRST_START.promotion
  );
  const lines = [
    "【规则】每组晋级 1 人",
    "【规则】等待晋级赛全部结束后进入决赛即可",
    "【规则】无复活赛",
    `【晋级赛】内置 ${PROMOTION_GROUP_COUNT} 组 · 20:15 起 · 间隔 15 分钟`,
    "【出场】中上开场→最弱→中游→次弱→中→中下→最强冲高→次强收尾",
  ];
  for (let i = 1; i <= PROMOTION_GROUP_COUNT; i++) {
    lines.push(`晋级第${i}场 ${promotionSchedule.get(i)}`);
  }
  lines.push(
    `【决赛】晋级 ${PROMOTION_GROUP_COUNT} 组各 1 人 · ${formatLinkmicLabel(ROUND_FIRST_START.final)}`
  );
  return lines.join("\n");
}

function loadExportNotes(): string {
  if (typeof window === "undefined") return defaultExportNotes();
  try {
    const raw = window.localStorage.getItem(EXPORT_NOTES_STORAGE_KEY);
    if (raw == null) return defaultExportNotes();
    return String(raw);
  } catch {
    return defaultExportNotes();
  }
}

function loadGroupOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GROUP_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** 按保存的 key 顺序重排；缺的追加末尾。标签按当前顺序重编为第N组。 */
function applyGroupOrder(groups: BattleGroup[], orderKeys: string[]): BattleGroup[] {
  if (groups.length === 0) return [];
  if (!orderKeys.length) {
    return groups.map((group, index) => ({
      ...group,
      label: `第${index + 1}组`,
    }));
  }
  const map = new Map(groups.map((group) => [group.key, group]));
  const ordered: BattleGroup[] = [];
  const used = new Set<string>();
  for (const key of orderKeys) {
    const hit = map.get(key);
    if (!hit || used.has(key)) continue;
    ordered.push(hit);
    used.add(key);
  }
  for (const group of groups) {
    if (used.has(group.key)) continue;
    ordered.push(group);
  }
  return ordered.map((group, index) => ({
    ...group,
    label: `第${index + 1}组`,
  }));
}

function moveGroupByKey(groups: BattleGroup[], fromKey: string, toKey: string): BattleGroup[] {
  if (fromKey === toKey) return groups;
  const fromIndex = groups.findIndex((group) => group.key === fromKey);
  const toIndex = groups.findIndex((group) => group.key === toKey);
  if (fromIndex < 0 || toIndex < 0) return groups;
  const next = [...groups];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next.map((group, index) => ({
    ...group,
    label: `第${index + 1}组`,
  }));
}

function countsToText(counts: ManualGroupCount[]) {
  return counts
    .filter((row) => row.count > 0)
    .map((row) => `${row.size}x${row.count}`)
    .join(",");
}

function parseManualGroupText(text: string): ManualGroupCount[] | null {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/[,，\s]+/).map((part) => part.trim()).filter(Boolean);
  const map = new Map<number, number>();
  for (const part of parts) {
    // 支持 8x2 / 8*2 / 8人组x2 / 8:2
    const match = part.match(/^(\d+)\s*(?:人组)?\s*[xX*×:：]\s*(\d+)$/);
    if (!match) return null;
    const size = Number(match[1]);
    const count = Number(match[2]);
    if (!Number.isInteger(size) || !Number.isInteger(count)) return null;
    if (size < MIN_GROUP_SIZE || size > MAX_GROUP_SIZE || count < 0) return null;
    map.set(size, (map.get(size) || 0) + count);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, count]) => ({ size, count }));
}

function expandManualSizes(counts: ManualGroupCount[]): number[] {
  const sizes: number[] = [];
  for (const row of [...counts].sort((a, b) => b.size - a.size)) {
    for (let i = 0; i < row.count; i++) sizes.push(row.size);
  }
  return sizes;
}

const BATTLE_ROUNDS = [
  { key: "group", label: "小组赛", time: "中午" },
  { key: "promotion", label: "晋级赛", time: "晚上" },
  { key: "final", label: "决赛", time: "晚上" },
] as const;

type BattleRoundKey = (typeof BATTLE_ROUNDS)[number]["key"];

function loadActiveRound(): BattleRoundKey {
  if (typeof window === "undefined") return "group";
  const saved = window.localStorage.getItem(ACTIVE_ROUND_STORAGE_KEY);
  return BATTLE_ROUNDS.some((round) => round.key === saved)
    ? saved as BattleRoundKey
    : "group";
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatWave(value: number) {
  if (value >= 1_0000_0000) return `${Math.round(value / 1_0000_0000)}亿`;
  if (value >= 1_0000) return `${Math.round(value / 1_0000)}万`;
  return Math.round(value).toLocaleString("zh-CN");
}

function shiftPeriod(period: string, delta: number) {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function scoreKey(roundKey: string, groupKey: string, personId: number) {
  return `${roundKey}:${groupKey}:${personId}`;
}

function normalizeScoreText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return "";
  return String(Math.round(num * 100) / 100);
}

function buildAutoGroupSizes(total: number): number[] | null {
  if (total === 0) return [];
  if (total < MIN_GROUP_SIZE) return null;

  // 前两组优先 8 人；剩余组每组不低于 5 人，且仍限制在 5-8。
  // 若硬塞两个 8 会让尾组不足 5，则逐步减少“前排 8 人组”数量后再分配。
  const maxTopGroups = Math.min(
    PREFERRED_TOP_GROUP_COUNT,
    Math.floor(total / PREFERRED_TOP_GROUP_SIZE)
  );
  for (let topCount = maxTopGroups; topCount >= 0; topCount--) {
    const remaining = total - topCount * PREFERRED_TOP_GROUP_SIZE;
    if (remaining === 0) {
      return Array.from({ length: topCount }, () => PREFERRED_TOP_GROUP_SIZE);
    }
    const tail = packEvenGroupSizes(remaining);
    if (!tail) continue;
    return [
      ...Array.from({ length: topCount }, () => PREFERRED_TOP_GROUP_SIZE),
      ...tail,
    ];
  }
  return null;
}

/** 将人数均匀拆成每组 [MIN_GROUP_SIZE, MAX_GROUP_SIZE] 的组合；无法拆分返回 null。 */
function packEvenGroupSizes(total: number): number[] | null {
  if (total === 0) return [];
  if (total < MIN_GROUP_SIZE) return null;

  const minGroups = Math.ceil(total / MAX_GROUP_SIZE);
  const maxGroups = Math.floor(total / MIN_GROUP_SIZE);
  for (let count = minGroups; count <= maxGroups; count++) {
    const base = Math.floor(total / count);
    const rest = total % count;
    if (base < MIN_GROUP_SIZE || base > MAX_GROUP_SIZE) continue;
    if (rest > 0 && base + 1 > MAX_GROUP_SIZE) continue;
    return Array.from({ length: count }, (_, index) => base + (index < rest ? 1 : 0));
  }
  return null;
}

function compareByWave(a: PkMember, b: PkMember) {
  return b.wave - a.wave || b.trimmedAvg - a.trimmedAvg || a.personId - b.personId;
}

/** 音浪波动：日振幅 / 去峰日均，波动大的优先同组。 */
function waveVolatility(member: PkMember) {
  if (!member.waveDays || member.waveDays <= 1) return 0;
  const range = Math.max(0, (member.maxWave || 0) - (member.minWave || 0));
  const base = Math.max(member.trimmedAvg || 0, 1);
  return range / base;
}

function compareByVolatility(a: PkMember, b: PkMember) {
  const volDiff = waveVolatility(b) - waveVolatility(a);
  if (volDiff !== 0) return volDiff;
  return compareByWave(a, b);
}

function resolveGroupSizes(
  total: number,
  plan: GroupPlanConfig
): { sizes: number[] | null; detail: string } {
  if (total === 0) return { sizes: [], detail: "无人参赛" };
  if (plan.sizeMode === "manual") {
    const parsed = parseManualGroupText(plan.manualText);
    const counts = parsed ?? plan.manualCounts;
    if (parsed === null) {
      return { sizes: null, detail: "手动分组格式无效，请用 8x2,7x5" };
    }
    const sizes = expandManualSizes(counts);
    const sum = sizes.reduce((acc, n) => acc + n, 0);
    if (sizes.length === 0) {
      return { sizes: null, detail: "请至少配置一组" };
    }
    if (sum !== total) {
      return {
        sizes: null,
        detail: `手动分组合计 ${sum} 人，当前名单 ${total} 人`,
      };
    }
    if (sizes.some((size) => size < MIN_GROUP_SIZE || size > MAX_GROUP_SIZE)) {
      return {
        sizes: null,
        detail: `每组人数需在 ${MIN_GROUP_SIZE}-${MAX_GROUP_SIZE} 之间`,
      };
    }
    return {
      sizes,
      detail: `手动 ${sizes.map((size) => `${size}人`).join(" + ")}`,
    };
  }

  const sizes = buildAutoGroupSizes(total);
  if (!sizes) {
    return {
      sizes: null,
      detail: `无法满足前两组优先8人、其余每组不少于${MIN_GROUP_SIZE}人`,
    };
  }
  return {
    sizes,
    detail: `自动 ${sizes.map((size) => `${size}人`).join(" + ")}`,
  };
}

/**
 * 直播最优出场顺序（输入：实力从高到低的下标 0=最强）。
 * 中上开场 → 穿插弱组 → 中游回温 → 最强冲高 → 次强收尾。
 * 7 组固定：2,6,4,5,3,0,1（与内置小组赛节奏一致）。
 */
function optimalStageOrderIndices(count: number): number[] {
  if (count <= 1) return Array.from({ length: count }, (_, i) => i);
  if (count === 2) return [1, 0]; // 次强开场，最强收尾
  if (count === 3) return [1, 2, 0]; // 中 → 弱 → 最强
  if (count === 4) return [1, 3, 0, 2]; // 中上 → 最弱 → 最强 → 次强
  if (count === 5) return [1, 4, 2, 0, 3]; // 中上 → 最弱 → 中 → 最强 → 次强
  if (count === 6) return [2, 5, 3, 4, 0, 1]; // 中上 → 最弱 → 中下 → 中 → 最强 → 次强
  if (count === 7) return [2, 6, 4, 5, 3, 0, 1]; // 内置锁定节奏
  if (count === 8) return [2, 7, 4, 6, 3, 5, 0, 1];

  // 通用：开场取约 1/3 强位，弱组穿插，最后两场留给最强/次强
  const used = new Set<number>();
  const result: number[] = [];
  const take = (i: number) => {
    if (i < 0 || i >= count || used.has(i)) return false;
    used.add(i);
    result.push(i);
    return true;
  };
  take(Math.min(Math.max(1, Math.floor(count / 3)), count - 1));
  // 从最弱往上穿插，预留 0/1 给收尾
  for (let i = count - 1; i >= 2 && result.length < count - 2; i--) take(i);
  for (let i = 2; i < count && result.length < count - 2; i++) take(i);
  take(0);
  take(1);
  for (let i = 0; i < count; i++) take(i);
  return result;
}

/** 组间按实力排序后套最优出场；组内人员保持原序（应为从高到低）。 */
function reorderGroupsForLivePacing(groups: BattleGroup[], labelPrefix?: string): BattleGroup[] {
  if (groups.length <= 1) {
    return groups.map((group, index) => ({
      ...group,
      label: labelPrefix ? `${labelPrefix}${index + 1}组` : group.label,
    }));
  }
  const strengthDesc = [...groups].sort(
    (a, b) =>
      b.averageWave - a.averageWave ||
      b.members.length - a.members.length ||
      a.key.localeCompare(b.key)
  );
  const order = optimalStageOrderIndices(strengthDesc.length);
  return order.map((strengthIndex, slot) => {
    const group = strengthDesc[strengthIndex];
    return {
      ...group,
      label: labelPrefix ? `${labelPrefix}${slot + 1}组` : `第${slot + 1}组`,
    };
  });
}

/** 组内按音浪从高到低排好，方便卡片展示与录分。 */
function sortMembersHighToLow(members: PkMember[]) {
  return [...members].sort(compareByWave);
}

function orderMembersForGroups(
  members: PkMember[],
  sizes: number[],
  sortMode: GroupSortMode
): PkMember[] {
  if (members.length === 0) return [];
  if (sortMode === "wave_desc") {
    // 从高到低连续切组：第1刀最强组，最后一刀最弱组
    return [...members].sort(compareByWave);
  }

  // 前两组按音浪从高到低；剩余按波动从高到低，波动大的跟波动大的一组。
  const ranked = [...members].sort(compareByWave);
  const topSlots = sizes
    .slice(0, Math.min(PREFERRED_TOP_GROUP_COUNT, sizes.length))
    .reduce((sum, size) => sum + size, 0);
  const topMembers = ranked.slice(0, topSlots);
  const restMembers = ranked.slice(topSlots).sort(compareByVolatility);
  return [...topMembers, ...restMembers];
}

function buildBattleGroups(
  members: PkMember[],
  plan: GroupPlanConfig = defaultGroupPlan()
): { groups: BattleGroup[]; detail: string; invalid: boolean } {
  if (plan.sizeMode === "preset") {
    const preset = resolvePresetBattleGroups(members);
    const groups: BattleGroup[] = preset.groups.map((group) => ({
      key: group.key,
      label: group.label,
      // 组内也统一从高到低
      members: sortMembersHighToLow(group.members),
      averageWave: group.averageWave,
      source: group.source,
    }));
    // 有缺人或多余人时仍展示已匹配组，但标记 invalid 方便页面提示
    const invalid =
      members.length > 0 &&
      (preset.missingNames.length > 0 ||
        preset.leftover.length > 0 ||
        groups.every((group) => group.members.length === 0));
    // 内置名单本身已是最优出场，不再二次交错
    return { groups, detail: preset.detail, invalid };
  }

  const { sizes, detail } = resolveGroupSizes(members.length, plan);
  if (!sizes) {
    return { groups: [], detail, invalid: members.length > 0 };
  }

  const ordered = orderMembersForGroups(members, sizes, plan.sortMode);
  let cursor = 0;
  const rawGroups = sizes.map((size, index) => {
    const groupMembers = sortMembersHighToLow(ordered.slice(cursor, cursor + size));
    cursor += size;
    const averageWave =
      groupMembers.length > 0
        ? groupMembers.reduce((sum, item) => sum + item.wave, 0) / groupMembers.length
        : 0;
    return {
      key: `group-${index + 1}`,
      label: `第${index + 1}组`,
      members: groupMembers,
      averageWave,
      source:
        plan.sortMode === "top_wave_rest_volatility" && index >= PREFERRED_TOP_GROUP_COUNT
          ? "按音浪波动聚类"
          : "按音浪从高到低",
    };
  });
  // 自动/手动：组间改成最优直播出场顺序
  const groups = reorderGroupsForLivePacing(rawGroups);
  return {
    groups,
    detail: `${detail}；出场最优交错`,
    invalid: false,
  };
}

function buildStageGroups(
  members: PkMember[],
  labelPrefix = "第",
  plan: GroupPlanConfig = defaultGroupPlan()
): BattleGroup[] {
  const { groups } = buildBattleGroups(members, {
    ...plan,
    // 后继轮次强制自动切组 + 从高到低
    sizeMode: plan.sizeMode === "preset" ? "auto" : plan.sizeMode,
    sortMode: "wave_desc",
  });
  if (groups.length > 0) {
    // buildBattleGroups 已做最优交错；这里只重贴标签
    return groups.map((group, index) => ({
      ...group,
      key: group.key || `group-${index + 1}`,
      label: `${labelPrefix}${index + 1}组`,
    }));
  }
  if (members.length === 0) return [];
  const sorted = sortMembersHighToLow(members);
  const averageWave = sorted.reduce((sum, item) => sum + item.wave, 0) / sorted.length;
  return [
    {
      key: "group-1",
      label: `${labelPrefix}1组`,
      members: sorted,
      averageWave,
      source: "人数不足5人，先按单组显示",
    },
  ];
}

/** 汇总某人在指定轮次的有效总分（draft 优先于已存分，同 key 不重复计）。 */
function personRoundTotal(
  personId: number,
  scoreMap: Map<string, number>,
  scoreDrafts: Record<string, string>,
  roundKeys: string[]
) {
  const roundSet = new Set(roundKeys);
  const suffix = `:${personId}`;
  let total = 0;
  const counted = new Set<string>();

  const take = (key: string, value: number) => {
    if (counted.has(key) || !key.endsWith(suffix)) return;
    const roundKey = key.slice(0, key.indexOf(":"));
    if (!roundSet.has(roundKey)) return;
    if (!Number.isFinite(value)) return;
    counted.add(key);
    total += value;
  };

  for (const [key, draft] of Object.entries(scoreDrafts)) {
    if (draft === undefined || draft === "") continue;
    const n = Number(draft);
    if (!Number.isFinite(n)) continue;
    take(key, n);
  }
  for (const [key, score] of scoreMap) {
    if (scoreDrafts[key] !== undefined && scoreDrafts[key] !== "") continue;
    take(key, score);
  }
  return total;
}

/**
 * 晋级赛优先用内置固定名单；匹配不足时回落到「总分高→低 + 均分 N 组」。
 */
function buildPromotionBattleGroups(
  allMembers: PkMember[],
  fallbackPool: PkMember[] = []
): BattleGroup[] {
  const preset = resolvePresetPromotionGroups(allMembers);
  const matched = preset.groups.filter((group) => group.members.length > 0);
  if (matched.length > 0 && preset.missingNames.length === 0) {
    return matched.map((group, index) => ({
      key: group.key,
      label: group.label || `晋级${index + 1}组`,
      members: group.members,
      averageWave: group.averageWave,
      source: group.source,
    }));
  }
  // 部分匹配也展示已匹配组，缺人在 source 里提示
  if (matched.length > 0) {
    return matched.map((group, index) => ({
      key: group.key,
      label: group.label || `晋级${index + 1}组`,
      members: group.members,
      averageWave: group.averageWave,
      source:
        group.missingNames.length > 0
          ? `${group.source}（缺 ${group.missingNames.join("、")}）`
          : group.source,
      incomplete: group.missingNames.length > 0,
    }));
  }

  // 完全匹配不上时，用出线池按总分均分
  const pool = fallbackPool.length > 0 ? fallbackPool : allMembers;
  if (pool.length === 0) return [];
  const count = Math.min(PROMOTION_GROUP_COUNT, pool.length);
  const base = Math.floor(pool.length / count);
  const rest = pool.length % count;
  const sizes = Array.from({ length: count }, (_, index) => base + (index < rest ? 1 : 0));
  let cursor = 0;
  const rawGroups = sizes.map((size, index) => {
    const groupMembers = pool.slice(cursor, cursor + size);
    cursor += size;
    const averageWave =
      groupMembers.length > 0
        ? groupMembers.reduce((sum, item) => sum + item.wave, 0) / groupMembers.length
        : 0;
    return {
      key: `group-${index + 1}`,
      label: `晋级${index + 1}组`,
      members: groupMembers,
      averageWave,
      source: `回落均分 · ${count}组`,
    };
  });
  return reorderGroupsForLivePacing(rawGroups, "晋级");
}

function getScoreValue(
  scoreMap: Map<string, number>,
  scoreDrafts: Record<string, string>,
  roundKey: string,
  groupKey: string,
  personId: number
) {
  const key = scoreKey(roundKey, groupKey, personId);
  const draft = scoreDrafts[key];
  if (draft !== undefined && draft !== "") {
    const draftScore = Number(draft);
    if (Number.isFinite(draftScore)) return draftScore;
  }
  return scoreMap.get(key) || 0;
}

function hasScoreEntry(
  scoreMap: Map<string, number>,
  scoreDrafts: Record<string, string>,
  roundKey: string,
  groupKey: string,
  personId: number
) {
  const key = scoreKey(roundKey, groupKey, personId);
  return (scoreDrafts[key] !== undefined && scoreDrafts[key] !== "") || scoreMap.has(key);
}

function groupHasScore(
  group: BattleGroup,
  scoreMap: Map<string, number>,
  scoreDrafts: Record<string, string>,
  roundKey: string
) {
  return group.members.some((member) =>
    hasScoreEntry(scoreMap, scoreDrafts, roundKey, group.key, member.personId)
  );
}

function groupIsSettled(
  group: BattleGroup,
  scoreMap: Map<string, number>,
  scoreDrafts: Record<string, string>,
  roundKey: string
) {
  return group.members.length > 0 && group.members.every((member) =>
    hasScoreEntry(scoreMap, scoreDrafts, roundKey, group.key, member.personId)
  );
}

function rankGroupMembers(
  group: BattleGroup,
  scoreMap: Map<string, number>,
  scoreDrafts: Record<string, string>,
  roundKey: string
) {
  return [...group.members].sort((a, b) => {
    const scoreDiff =
      getScoreValue(scoreMap, scoreDrafts, roundKey, group.key, b.personId) -
      getScoreValue(scoreMap, scoreDrafts, roundKey, group.key, a.personId);
    return scoreDiff || b.wave - a.wave || a.personId - b.personId;
  });
}

/** 从已结算分组中按名次切片（from 起取 count 人）。未录完返回空。 */
function pickRankedMembers(
  group: BattleGroup,
  scoreMap: Map<string, number>,
  scoreDrafts: Record<string, string>,
  roundKey: string,
  fromIndex: number,
  count: number
) {
  if (count <= 0) return [] as PkMember[];
  if (!groupIsSettled(group, scoreMap, scoreDrafts, roundKey)) return [] as PkMember[];
  return rankGroupMembers(group, scoreMap, scoreDrafts, roundKey).slice(
    Math.max(0, fromIndex),
    Math.max(0, fromIndex) + count
  );
}

/**
 * 小组赛/复活赛晋级名额：
 * - 8人及以上：前4晋级
 * - 7人：前4晋级
 * - 更小：前半（至少1，且至少留1人可进复活池时优先）
 */
function promoteCountForGroupSize(size: number) {
  if (size <= 0) return 0;
  if (size >= 7) return Math.min(4, size);
  if (size <= 1) return size;
  return Math.max(1, Math.floor(size / 2));
}

function revivalCountForGroupSize(size: number) {
  return Math.max(0, size - promoteCountForGroupSize(size));
}

/**
 * 晋级赛进决赛名额：固定每组第 1 名（有人则 1 席）。
 * 晋级固定 8 组 → 共 8 人进决赛。
 */
function promotionFinalCountsForGroups(sizes: number[]): number[] {
  return sizes.map((size) => (size > 0 ? 1 : 0));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function memberIdentityValues(member: PkMember) {
  return Array.from(new Set([
    member.anchorId,
    ...(member.anchorIds || []),
    ...(member.douyinNos || []),
  ].map((item) => String(item || "").trim()).filter(Boolean)));
}

function findScoreInText(text: string, member: PkMember) {
  const candidates = [member.name, ...memberIdentityValues(member)].filter(Boolean);
  for (const candidate of candidates) {
    const pattern = new RegExp(`${escapeRegExp(candidate)}[^\\d]{0,20}(\\d+(?:\\.\\d+)?)`, "i");
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!candidates.some((candidate) => line.includes(candidate))) continue;
    const numbers = line.match(/\d+(?:\.\d+)?/g);
    if (numbers?.length) return numbers[numbers.length - 1];
  }
  return "";
}

export function StarBattlePage({ active = true }: { active?: boolean }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const monitorSyncInFlightRef = useRef(false);
  const autoSyncedHitSignaturesRef = useRef<Set<string>>(new Set());
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<PkRosterData | null>(null);
  const [rosterConfigs, setRosterConfigs] = useState<Record<RosterSlot, RosterConfig>>(loadRosterConfigs);
  const [scores, setScores] = useState<StarBattleScore[]>([]);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [roundKey, setRoundKey] = useState<BattleRoundKey>(loadActiveRound);
  const [groupPlan, setGroupPlan] = useState<GroupPlanConfig>(loadGroupPlan);
  const [groupOrderKeys, setGroupOrderKeys] = useState<string[]>(loadGroupOrder);
  const [dragOverGroupKey, setDragOverGroupKey] = useState<string | null>(null);
  const [draggingGroupKey, setDraggingGroupKey] = useState<string | null>(null);
  const [groupPage, setGroupPage] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [monitorLedger, setMonitorLedger] = useState(loadMonitorMatchLedger);
  const [syncContext, setSyncContext] = useState<MonitorScoreSyncContext | null>(loadMonitorScoreSyncContext);
  const [monitorRunning, setMonitorRunning] = useState(false);
  const [syncingLedger, setSyncingLedger] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNotes, setExportNotes] = useState(loadExportNotes);
  const [notesOpen, setNotesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const fetchData = useCallback(async () => {
    const api = getDataApi();
    if (!api) {
      setUnavailable(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res: IpcResult<PkRosterData> = await api.getPkRoster(period, MAX_GROUP_SIZE);
      if (res.success) {
        setData(res.data);
      } else {
        setError(res.error || "加载失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [period]);

  const fetchScores = useCallback(async () => {
    const api = getDataApi();
    if (!api?.getStarBattleScores) return;
    const res: IpcResult<StarBattleScore[]> = await api.getStarBattleScores(period);
    if (!res.success) {
      setSaveMessage(res.error || "分数加载失败");
      return;
    }
    setScores(res.data);
    const drafts: Record<string, string> = {};
    for (const row of res.data) {
      drafts[scoreKey(row.roundKey, row.groupKey, row.personId)] = String(row.score);
    }
    setScoreDrafts(drafts);
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchScores();
  }, [fetchScores]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_ROUND_STORAGE_KEY, roundKey);
  }, [roundKey]);

  useEffect(() => {
    const reloadMonitorState = () => {
      setMonitorLedger(loadMonitorMatchLedger());
      setSyncContext(loadMonitorScoreSyncContext());
    };
    window.addEventListener("focus", reloadMonitorState);
    window.addEventListener("storage", reloadMonitorState);
    window.addEventListener(MATCH_LEDGER_UPDATED_EVENT, reloadMonitorState);
    return () => {
      window.removeEventListener("focus", reloadMonitorState);
      window.removeEventListener("storage", reloadMonitorState);
      window.removeEventListener(MATCH_LEDGER_UPDATED_EVENT, reloadMonitorState);
    };
  }, []);

  useEffect(() => {
    const api = getDataApi();
    if (!api?.onLivePkStatus) return;
    const applyStatus = (status: { status: string }) => {
      setMonitorRunning(status.status === "running" || status.status === "connecting");
    };
    const offStatus = api.onLivePkStatus(applyStatus);
    void api.getLivePkMonitorStatus?.().then((result) => {
      if (result.success) applyStatus(result.data);
    });
    return offStatus;
  }, []);

  useEffect(() => {
    const syncRosterConfig = () => setRosterConfigs(loadRosterConfigs());
    window.addEventListener("storage", syncRosterConfig);
    window.addEventListener("focus", syncRosterConfig);
    return () => {
      window.removeEventListener("storage", syncRosterConfig);
      window.removeEventListener("focus", syncRosterConfig);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(GROUP_PLAN_STORAGE_KEY, JSON.stringify(groupPlan));
  }, [groupPlan]);

  useEffect(() => {
    window.localStorage.setItem(EXPORT_NOTES_STORAGE_KEY, exportNotes);
  }, [exportNotes]);

  useEffect(() => {
    window.localStorage.setItem(GROUP_ORDER_STORAGE_KEY, JSON.stringify(groupOrderKeys));
  }, [groupOrderKeys]);

  const rawBattleMembers = useMemo(() => {
    const rows = data?.males ?? [];
    const seen = new Set<number>();
    return rows
      .filter((member) => {
        if (seen.has(member.personId)) return false;
        seen.add(member.personId);
        return true;
      })
      .sort((a, b) => b.wave - a.wave || b.trimmedAvg - a.trimmedAvg || a.personId - b.personId);
  }, [data]);
  const midmonthRosterConfig = rosterConfigs.midmonth;
  const includeResolution = useMemo(
    () => resolveRosterNames(rawBattleMembers, midmonthRosterConfig.includeText),
    [midmonthRosterConfig.includeText, rawBattleMembers]
  );
  const excludeResolution = useMemo(
    () => resolveRosterNames(rawBattleMembers, midmonthRosterConfig.excludeText),
    [midmonthRosterConfig.excludeText, rawBattleMembers]
  );
  const allMembers = useMemo(
    () => rawBattleMembers.filter((member) => {
      if (
        midmonthRosterConfig.mode === "include" &&
        includeResolution.names.length > 0 &&
        !includeResolution.ids.has(member.personId)
      ) {
        return false;
      }
      if (excludeResolution.ids.has(member.personId)) return false;
      return true;
    }),
    [
      excludeResolution.ids,
      includeResolution.ids,
      includeResolution.names.length,
      midmonthRosterConfig.mode,
      rawBattleMembers,
    ]
  );

  const groupStageResult = useMemo(
    () => buildBattleGroups(allMembers, groupPlan),
    [allMembers, groupPlan]
  );
  // 稳定 key：按成员 personId 集合生成，拖动顺序不改 key，分数不丢
  const baseGroupStageGroups = useMemo(
    () =>
      groupStageResult.groups.map((group, index) => {
        const memberSig = group.members
          .map((member) => member.personId)
          .slice()
          .sort((a, b) => a - b)
          .join("-");
        return {
          ...group,
          key: memberSig ? `g-${memberSig}` : `g-empty-${index}`,
          label: `第${index + 1}组`,
        };
      }),
    [groupStageResult.groups]
  );

  // 名单变化时，清理已不存在的顺序 key，并补上新增组
  useEffect(() => {
    const available = new Set(baseGroupStageGroups.map((group) => group.key));
    setGroupOrderKeys((current) => {
      const kept = current.filter((key) => available.has(key));
      const missing = baseGroupStageGroups
        .map((group) => group.key)
        .filter((key) => !kept.includes(key));
      const next = [...kept, ...missing];
      if (
        next.length === current.length &&
        next.every((key, index) => key === current[index])
      ) {
        return current;
      }
      return next;
    });
  }, [baseGroupStageGroups]);

  const orderedGroupStageGroups = useMemo(
    () => applyGroupOrder(baseGroupStageGroups, groupOrderKeys),
    [baseGroupStageGroups, groupOrderKeys]
  );
  const initialGroups = orderedGroupStageGroups;
  const activeMembers = allMembers;
  const invalidGrouping = groupStageResult.invalid;
  const groupPlanDetail = groupStageResult.detail;
  const laterStagePlan = useMemo<GroupPlanConfig>(
    () => ({
      ...defaultGroupPlan(),
      // 复活/晋级不沿用固定小组名单，按当前出线人数自动切
      sizeMode: "auto",
      sortMode: "wave_desc",
    }),
    []
  );
  const scoreMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of scores) {
      map.set(scoreKey(row.roundKey, row.groupKey, row.personId), row.score);
    }
    return map;
  }, [scores]);
  const groupWinners = useMemo(
    () =>
      initialGroups.flatMap((group) =>
        pickRankedMembers(
          group,
          scoreMap,
          scoreDrafts,
          "group",
          0,
          promoteCountForGroupSize(group.members.length)
        )
      ),
    [initialGroups, scoreDrafts, scoreMap]
  );
  const groupSeconds = useMemo(
    () =>
      initialGroups.flatMap((group) => {
        const promote = promoteCountForGroupSize(group.members.length);
        const revival = revivalCountForGroupSize(group.members.length);
        return pickRankedMembers(group, scoreMap, scoreDrafts, "group", promote, revival);
      }),
    [initialGroups, scoreDrafts, scoreMap]
  );
  const revivalGroups = useMemo(
    () => buildStageGroups(groupSeconds, "复活", laterStagePlan),
    [groupSeconds, laterStagePlan]
  );
  const revivalWinners = useMemo(
    () =>
      revivalGroups.flatMap((group) =>
        pickRankedMembers(
          group,
          scoreMap,
          scoreDrafts,
          "revival",
          0,
          promoteCountForGroupSize(group.members.length)
        )
      ),
    [revivalGroups, scoreDrafts, scoreMap]
  );
  // 晋级赛：优先内置名单；回落时用小组晋级+复活出线按总分排序
  const promotionPool = useMemo(() => {
    const advanced = [...groupWinners, ...revivalWinners];
    const seen = new Set<number>();
    const unique = advanced.filter((member) => {
      if (seen.has(member.personId)) return false;
      seen.add(member.personId);
      return true;
    });
    return [...unique].sort((a, b) => {
      const totalDiff =
        personRoundTotal(b.personId, scoreMap, scoreDrafts, ["group", "revival"]) -
        personRoundTotal(a.personId, scoreMap, scoreDrafts, ["group", "revival"]);
      return totalDiff || b.wave - a.wave || a.personId - b.personId;
    });
  }, [groupWinners, revivalWinners, scoreDrafts, scoreMap]);
  const promotionGroups = useMemo(
    () => buildPromotionBattleGroups(allMembers, promotionPool),
    [allMembers, promotionPool]
  );
  const promotionFinalCounts = useMemo(
    () =>
      promotionFinalCountsForGroups(
        promotionGroups.map((group) => group.members.length)
      ),
    [promotionGroups]
  );
  const promotionSettledCount = useMemo(
    () => promotionGroups.filter((group) =>
      groupIsSettled(group, scoreMap, scoreDrafts, "promotion")
    ).length,
    [promotionGroups, scoreDrafts, scoreMap]
  );
  const promotionBlockedGroupCount =
    Math.max(0, PROMOTION_GROUP_COUNT - promotionGroups.length)
    + promotionGroups.filter((group) =>
      group.incomplete || !groupIsSettled(group, scoreMap, scoreDrafts, "promotion")
    ).length;
  const promotionReadyForFinal =
    promotionGroups.length === PROMOTION_GROUP_COUNT && promotionBlockedGroupCount === 0;
  const promotionWinners = useMemo(
    () =>
      promotionGroups.flatMap((group, index) => {
        if (!groupIsSettled(group, scoreMap, scoreDrafts, "promotion")) return [];
        return pickRankedMembers(
          group,
          scoreMap,
          scoreDrafts,
          "promotion",
          0,
          promotionFinalCounts[index] || 0
        );
      }),
    [promotionFinalCounts, promotionGroups, scoreDrafts, scoreMap]
  );
  const finalGroups = useMemo(() => {
    if (!promotionReadyForFinal || promotionWinners.length === 0) return [] as BattleGroup[];
    // 决赛：晋级出线共 8 人，单组
    const averageWave =
      promotionWinners.reduce((sum, item) => sum + item.wave, 0) /
      Math.max(1, promotionWinners.length);
    return [
      {
        key: "final-1",
        label: "决赛组",
        members: promotionWinners,
        averageWave,
        source: `晋级赛出线 ${promotionWinners.length} 人`,
      },
    ];
  }, [promotionReadyForFinal, promotionWinners]);
  const currentGroups = useMemo(() => {
    if (roundKey === "promotion") return promotionGroups;
    if (roundKey === "final") return finalGroups;
    return initialGroups;
  }, [finalGroups, initialGroups, promotionGroups, roundKey]);
  const roundMeta = BATTLE_ROUNDS.find((round) => round.key === roundKey) || BATTLE_ROUNDS[0];
  const promotionFinalSlots = useMemo(
    () => promotionFinalCounts.reduce((sum, n) => sum + n, 0),
    [promotionFinalCounts]
  );
  const roundHint =
    roundKey === "promotion"
      ? `内置晋级 ${promotionGroups.length || PROMOTION_GROUP_COUNT} 组；每组晋级 1 人，共 ${promotionFinalSlots || PROMOTION_FINAL_SLOTS} 人；全部结束后进决赛；${ROUND_FIRST_START.promotion} 起 / 间隔 15 分钟；无复活赛`
      : roundKey === "final"
        ? `等待晋级赛结束；每组第 1 名共 ${promotionWinners.length || PROMOTION_FINAL_SLOTS} 人进入决赛；默认 ${ROUND_FIRST_START.final} 开始连麦`
        : groupPlan.sizeMode === "preset"
          ? "小组赛：使用内置固定分组；可改「自动」——先在 PK 15号名单录入参赛人，再按音浪自动切组"
          : groupPlan.sizeMode === "auto"
            ? "小组赛：先录参赛名单，按音浪从高到低切组，组间最优出场（中上开场→穿插弱组→最强冲高→次强收尾）"
            : groupPlan.sortMode === "top_wave_rest_volatility"
              ? "前两组按音浪从高到低，剩余按波动聚类；沿用 PK 15号名单"
              : "按音浪从高到低分组；沿用 PK 15号名单";

  const currentGroupKeys = useMemo(
    () => currentGroups.map((group) => group.key),
    [currentGroups]
  );
  const syncContextMatchesRound = Boolean(
    syncContext
    && syncContext.period === period
    && syncContext.roundKey === roundKey
  );
  const syncContextMatchesGroups = Boolean(
    syncContextMatchesRound
    && syncContext
    && syncContext.expectedGroupCount === currentGroupKeys.length
    && syncContext.groupKeys.length === currentGroupKeys.length
    && syncContext.groupKeys.every((key, index) => key === currentGroupKeys[index])
  );
  const scopedMonitorRounds = useMemo(
    () => syncContextMatchesGroups
      ? monitorRoundsForSyncContext(syncContext, monitorLedger)
      : [],
    [monitorLedger, syncContext, syncContextMatchesGroups]
  );
  const finishedMonitorRounds = useMemo(
    () => scopedMonitorRounds.filter((row) =>
      row.status === "finished" && row.scores.some((score) => score.score > 0)
    ),
    [scopedMonitorRounds]
  );
  const monitorSyncHits = useMemo(
    () => collectScoreSyncHits({
      groups: currentGroups,
      rounds: finishedMonitorRounds,
      finishedOnly: true,
      mode: "slot",
    }),
    [currentGroups, finishedMonitorRounds]
  );
  const monitorMatchedGroupCount = useMemo(
    () => new Set(monitorSyncHits.map((hit) => hit.groupSlot)).size,
    [monitorSyncHits]
  );
  const monitorFullyMatchedGroupCount = useMemo(
    () => currentGroups.filter((group, index) =>
      monitorSyncHits.filter((hit) => hit.groupSlot === index + 1).length === group.members.length
    ).length,
    [currentGroups, monitorSyncHits]
  );
  const monitorRoundOverflow = finishedMonitorRounds.length > currentGroups.length;
  const monitorHasUnmatchedRounds =
    finishedMonitorRounds.length > 0
    && monitorFullyMatchedGroupCount < Math.min(finishedMonitorRounds.length, currentGroups.length);
  const canSyncMonitorScores =
    syncContextMatchesGroups
    && !monitorRoundOverflow
    && monitorSyncHits.length > 0
    && !syncingLedger;
  const currentStartedGroupCount = useMemo(
    () => currentGroups.filter((group) =>
      groupHasScore(group, scoreMap, scoreDrafts, roundKey)
    ).length,
    [currentGroups, roundKey, scoreDrafts, scoreMap]
  );
  const currentSettledGroupCount = useMemo(
    () => currentGroups.filter((group) =>
      groupIsSettled(group, scoreMap, scoreDrafts, roundKey)
    ).length,
    [currentGroups, roundKey, scoreDrafts, scoreMap]
  );

  useEffect(() => {
    if (data && roundKey === "final" && !promotionReadyForFinal) {
      setRoundKey("promotion");
    }
  }, [data, promotionReadyForFinal, roundKey]);

  const reorderGroupStage = useCallback((fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    setGroupOrderKeys((current) => {
      const ordered = applyGroupOrder(baseGroupStageGroups, current);
      const next = moveGroupByKey(ordered, fromKey, toKey);
      return next.map((group) => group.key);
    });
  }, [baseGroupStageGroups]);

  const resetGroupOrder = useCallback(() => {
    setGroupOrderKeys(baseGroupStageGroups.map((group) => group.key));
    setSaveMessage("已恢复默认分组顺序");
  }, [baseGroupStageGroups]);

  const updateManualCount = useCallback((size: number, count: number) => {
    setGroupPlan((current) => {
      const manualCounts = current.manualCounts.map((row) =>
        row.size === size
          ? { ...row, count: Math.max(0, Math.floor(count) || 0) }
          : row
      );
      return {
        ...current,
        sizeMode: "manual",
        manualCounts,
        manualText: countsToText(manualCounts),
      };
    });
  }, []);

  const applyManualText = useCallback((manualText: string) => {
    const parsed = parseManualGroupText(manualText);
    setGroupPlan((current) => {
      if (parsed === null) {
        return { ...current, sizeMode: "manual", manualText };
      }
      const manualCounts = defaultGroupPlan().manualCounts.map((row) => ({
        size: row.size,
        count: parsed.find((item) => item.size === row.size)?.count || 0,
      }));
      return {
        ...current,
        sizeMode: "manual",
        manualText,
        manualCounts,
      };
    });
  }, []);

  const fillManualToTotal = useCallback(() => {
    const total = allMembers.length;
    if (total <= 0) return;
    const auto = buildAutoGroupSizes(total);
    if (!auto) return;
    const countMap = new Map<number, number>();
    for (const size of auto) countMap.set(size, (countMap.get(size) || 0) + 1);
    const manualCounts = defaultGroupPlan().manualCounts.map((row) => ({
      size: row.size,
      count: countMap.get(row.size) || 0,
    }));
    setGroupPlan((current) => ({
      ...current,
      sizeMode: "manual",
      manualCounts,
      manualText: countsToText(manualCounts),
    }));
  }, [allMembers.length]);
  const totalPages = Math.max(1, Math.ceil(currentGroups.length / GROUPS_PER_PAGE));
  const visibleGroups = currentGroups.slice(
    groupPage * GROUPS_PER_PAGE,
    groupPage * GROUPS_PER_PAGE + GROUPS_PER_PAGE
  );
  const scheduleByGroupNo = useMemo(
    // 时间只看“当前轮次第几场”，拖组换人后场次时间轴不变
    () => parseExportSchedule(exportNotes, currentGroups.length, roundKey).scheduleByGroup,
    [currentGroups.length, exportNotes, roundKey]
  );

  useEffect(() => {
    setGroupPage(0);
  }, [period, roundKey, groupPlan]);

  useEffect(() => {
    setGroupPage((page) => Math.min(page, totalPages - 1));
  }, [totalPages]);

  const saveScore = useCallback(
    async (groupKey: string, personId: number, rawValue: string) => {
      const api = getDataApi();
      if (!api?.saveStarBattleScore) return false;
      const key = scoreKey(roundKey, groupKey, personId);
      const normalized = normalizeScoreText(rawValue);
      setSavingKey(key);
      setSaveMessage("");
      const payloadScore = normalized === "" ? null : normalized;
      const res = await api.saveStarBattleScore({
        period,
        roundKey,
        groupKey,
        personId,
        score: payloadScore,
      });
      setSavingKey(null);
      if (!res.success) {
        setSaveMessage(res.error || "保存失败");
        return false;
      }
      setScoreDrafts((prev) => {
        const next = { ...prev };
        if (normalized === "") delete next[key];
        else next[key] = normalized;
        return next;
      });
      setScores((prev) => {
        const rest = prev.filter(
          (row) =>
            !(row.period === period && row.roundKey === roundKey && row.groupKey === groupKey && row.personId === personId)
        );
        if (normalized === "") return rest;
        return [
          ...rest,
          { period, roundKey, groupKey, personId, score: Number(normalized), updatedAt: null },
        ];
      });
      setSaveMessage(normalized === "" ? "已清空" : "已保存");
      return true;
    },
    [period, roundKey]
  );

  const updateDraft = useCallback((groupKey: string, personId: number, value: string) => {
    const key = scoreKey(roundKey, groupKey, personId);
    setScoreDrafts((prev) => ({ ...prev, [key]: value }));
  }, [roundKey]);

  const quickAddScore = (groupKey: string, personId: number, delta: number) => {
    const key = scoreKey(roundKey, groupKey, personId);
    const current = Number(scoreDrafts[key] || scoreMap.get(key) || 0);
    const next = String(Math.max(0, current + delta));
    updateDraft(groupKey, personId, next);
    void saveScore(groupKey, personId, next);
  };

  const applyBulkScores = async () => {
    const text = bulkText.trim();
    if (!text) {
      setSaveMessage("请先粘贴分数文本");
      return;
    }
    let matched = 0;
    for (const group of currentGroups) {
      for (const member of group.members) {
        const score = findScoreInText(text, member);
        if (!score) continue;
        matched += 1;
        updateDraft(group.key, member.personId, score);
        await saveScore(group.key, member.personId, score);
      }
    }
    setSaveMessage(matched > 0 ? `已匹配并保存 ${matched} 人` : "未匹配到当前轮次人员");
  };

  /**
   * 从抖音监控分数账本同步最终分到当前轮次计分表。
   * 规则：连麦/PK 按分组出场顺序进行 —— 第 N 场最终分写入第 N 组。
   */
  const persistMonitorHits = useCallback(async (hits: ScoreSyncHit[], automatic = false) => {
    if (monitorSyncInFlightRef.current || hits.length === 0) {
      return { saved: 0, failed: 0, groups: 0 };
    }
    monitorSyncInFlightRef.current = true;
    setSyncingLedger(true);
    let saved = 0;
    let failed = 0;
    const slotSet = new Set<number>();
    try {
      for (const hit of hits) {
        const success = await saveScore(hit.groupKey, hit.personId, String(hit.score));
        if (!success) {
          failed += 1;
          continue;
        }
        saved += 1;
        slotSet.add(hit.groupSlot);
      }
      if (saved > 0) {
        setSaveMessage(
          `${automatic ? "已自动同步" : "已同步"} ${saved} 人 / ${slotSet.size} 组到${roundMeta.label}${failed > 0 ? `，${failed} 人失败` : ""}`
        );
      }
      return { saved, failed, groups: slotSet.size };
    } finally {
      monitorSyncInFlightRef.current = false;
      setSyncingLedger(false);
    }
  }, [roundMeta.label, saveScore]);

  const syncScoresFromMonitorLedger = async () => {
    if (currentGroups.length === 0) {
      setSaveMessage("当前轮次没有分组，无法同步");
      return;
    }
    if (!syncContextMatchesRound) {
      setSaveMessage("当前轮次尚未关联监控，请先点“进入直播监控”建立本轮账本");
      return;
    }
    if (!syncContextMatchesGroups) {
      setSaveMessage("本轮分组已变化，请重新进入直播监控后再同步");
      return;
    }
    if (monitorRoundOverflow) {
      setSaveMessage(`本轮只配置 ${currentGroups.length} 组，但账本新增了 ${finishedMonitorRounds.length} 场，请重新关联正确轮次`);
      return;
    }
    if (finishedMonitorRounds.length === 0) {
      setSaveMessage("本轮账本还没有已结束的最终分，请先完成至少一场 PK");
      return;
    }
    if (monitorSyncHits.length === 0) {
      setSaveMessage(`本轮已有 ${finishedMonitorRounds.length} 场最终分，但未匹配到${roundMeta.label}名单，请核对主播ID或昵称`);
      return;
    }

    await persistMonitorHits(monitorSyncHits);
  };

  useEffect(() => {
    autoSyncedHitSignaturesRef.current.clear();
  }, [syncContext?.createdAt]);

  useEffect(() => {
    if (
      !syncContextMatchesGroups
      || monitorRoundOverflow
      || monitorSyncHits.length === 0
      || syncingLedger
      || monitorSyncInFlightRef.current
    ) {
      return;
    }
    const pendingHits = monitorSyncHits.filter((hit) => {
      const signature = `${hit.battleId}:${hit.groupKey}:${hit.personId}:${hit.score}`;
      return !autoSyncedHitSignaturesRef.current.has(signature);
    });
    if (pendingHits.length === 0) return;

    const signatures = pendingHits.map(
      (hit) => `${hit.battleId}:${hit.groupKey}:${hit.personId}:${hit.score}`
    );
    signatures.forEach((signature) => autoSyncedHitSignaturesRef.current.add(signature));
    void persistMonitorHits(pendingHits, true).then(({ failed }) => {
      if (failed > 0) {
        signatures.forEach((signature) => autoSyncedHitSignaturesRef.current.delete(signature));
      }
    });
  }, [
    monitorRoundOverflow,
    monitorSyncHits,
    persistMonitorHits,
    syncContextMatchesGroups,
    syncingLedger,
  ]);

  const startMonitorScope = () => {
    if (currentGroups.length === 0) {
      setSaveMessage("当前轮次没有可监控的分组");
      return;
    }
    const ledger = loadMonitorMatchLedger();
    const context = beginMonitorScoreSyncContext({
      period,
      roundKey,
      roundLabel: roundMeta.label,
      groupKeys: currentGroupKeys,
      rounds: ledger,
    });
    setMonitorLedger(ledger);
    setSyncContext(context);
    window.dispatchEvent(new CustomEvent("app:navigate", { detail: "douyin-monitor" }));
  };

  const openMonitorForCurrentRound = () => {
    if (!syncContextMatchesGroups || monitorRoundOverflow) {
      startMonitorScope();
      return;
    }
    window.dispatchEvent(new CustomEvent("app:navigate", { detail: "douyin-monitor" }));
  };

  const exportCurrentGroups = async () => {
    if (!exportRef.current || currentGroups.length === 0) return;
    setExporting(true);
    try {
      await exportElementAsImage(
        exportRef.current,
        `星嗨争霸赛_${period}_${roundMeta.label}_${currentGroups.length}组.png`,
        { backgroundColor: "#FFF0F8", pixelRatio: 3 }
      );
      setSaveMessage("分组图片已导出");
    } catch (e) {
      console.error("导出争霸赛图片失败", e);
      setSaveMessage("导出图片失败");
    } finally {
      setExporting(false);
    }
  };

  if (!active) return null;
  if (unavailable) return <Wrap><BrowserModeState /></Wrap>;
  if (loading && !data) return <Wrap><LoadingState label="正在加载星嗨争霸赛…" /></Wrap>;
  if (error && !data) return <Wrap><ErrorState message={error} onRetry={fetchData} /></Wrap>;
  if (!data) return <Wrap><EmptyState label="暂无赛事数据" /></Wrap>;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <Sparkles />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-black tracking-normal">星嗨争霸赛</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{period}</Badge>
                <Badge variant={invalidGrouping ? "destructive" : "outline"}>
                  {invalidGrouping ? "人数不满足分组" : `${currentGroups.length} 组`}
                </Badge>
                <Badge variant="outline">参赛 {allMembers.length} 人</Badge>
                {includeResolution.unmatchedNames.length > 0 && (
                  <Badge variant="destructive">
                    未匹配 {includeResolution.unmatchedNames.length}人
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setPeriod(shiftPeriod(period, -1))}
                aria-label="上个月"
                title="上个月"
              >
                <ChevronLeft />
              </Button>
              <Input
                type="month"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
                className="h-7 w-36 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setPeriod(shiftPeriod(period, 1))}
                aria-label="下个月"
                title="下个月"
              >
                <ChevronRight />
              </Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => setPeriod(currentPeriod())}>本月</Button>
            <Button size="icon-sm" variant="outline" onClick={fetchData} disabled={loading} title="刷新赛事数据" aria-label="刷新赛事数据">
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
            <Button
              size="sm"
              variant={notesOpen ? "default" : "outline"}
              onClick={() => setNotesOpen((value) => !value)}
            >
              备注
            </Button>
            <Button size="sm" onClick={exportCurrentGroups} disabled={exporting || currentGroups.length === 0}>
              <Download data-icon="inline-start" />
              {exporting ? "导出中" : "导出图片"}
            </Button>
          </div>
        </div>
      </section>

      {notesOpen && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">导出备注</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <textarea
              value={exportNotes}
              onChange={(event) => setExportNotes(event.target.value)}
              placeholder={"可写多行，例如：\n1. 中午 12:00 开赛\n2. 每组自备裁判\n3. 迟到 5 分钟视为弃权"}
              className="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>备注会显示在导出图片底部，并自动保存在本机。</span>
              <Button size="sm" variant="outline" onClick={() => setExportNotes("")}>
                清空备注
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="grid gap-3 border-b border-border/70 p-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div role="tablist" aria-label="比赛轮次" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-md border border-border bg-muted/30 p-1">
                {BATTLE_ROUNDS.map((round, index) => {
                  const finalLocked = round.key === "final" && !promotionReadyForFinal;
                  return (
                    <Button
                      key={round.key}
                      role="tab"
                      aria-selected={roundKey === round.key}
                      size="sm"
                      variant={roundKey === round.key ? "default" : "ghost"}
                      onClick={() => setRoundKey(round.key)}
                      disabled={finalLocked}
                      title={finalLocked ? `晋级赛还有 ${promotionBlockedGroupCount} 组未结算或名单不完整` : undefined}
                      className="shrink-0"
                    >
                      <span className="text-[10px] opacity-60">0{index + 1}</span>
                      {finalLocked && <LockKeyhole data-icon="inline-start" />}
                      {round.label}
                    </Button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">已录分 {currentStartedGroupCount}/{currentGroups.length} 组</Badge>
                <Badge variant={currentGroups.length > 0 && currentSettledGroupCount === currentGroups.length ? "default" : "secondary"}>
                  已结算 {currentSettledGroupCount}/{currentGroups.length} 组
                </Badge>
                {monitorRunning && <Badge variant="default">后台监控中</Badge>}
                {roundKey === "promotion" && !promotionReadyForFinal && (
                  <Badge variant="outline">决赛待解锁</Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <Button size="sm" variant={bulkOpen ? "secondary" : "outline"} onClick={() => setBulkOpen((value) => !value)}>
                <ClipboardPaste data-icon="inline-start" />
                批量录分
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={openMonitorForCurrentRound}
                disabled={currentGroups.length === 0}
              >
                <MonitorUp data-icon="inline-start" />
                {monitorRoundOverflow
                  ? "重新关联监控"
                  : syncContextMatchesGroups
                    ? "返回直播监控"
                    : "进入直播监控"}
              </Button>
              {syncContextMatchesGroups && !monitorRoundOverflow && finishedMonitorRounds.length > 0 && (
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={startMonitorScope}
                  title="从当前时刻重新记录本轮"
                  aria-label="从当前时刻重新记录本轮"
                >
                  <RefreshCw />
                </Button>
              )}
              <Button size="sm" onClick={() => void syncScoresFromMonitorLedger()} disabled={!canSyncMonitorScores}>
                <ListChecks data-icon="inline-start" />
                {syncingLedger ? "同步中" : `同步最终分${monitorSyncHits.length > 0 ? ` ${monitorSyncHits.length}` : ""}`}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/20 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              {syncContextMatchesGroups && !monitorRoundOverflow && finishedMonitorRounds.length > 0 && !monitorHasUnmatchedRounds ? (
                <CircleCheckBig className="size-4 shrink-0 text-primary" />
              ) : syncContext && (!syncContextMatchesRound || !syncContextMatchesGroups || monitorRoundOverflow || monitorHasUnmatchedRounds) ? (
                <CircleAlert className="size-4 shrink-0 text-destructive" />
              ) : (
                <ListChecks className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <span className="font-bold text-foreground">
                  {!syncContext
                    ? "本轮尚未关联直播监控"
                    : !syncContextMatchesRound
                      ? `当前账本关联 ${syncContext.period} ${syncContext.roundLabel}`
                      : !syncContextMatchesGroups
                        ? "本轮分组已变化"
                        : monitorRoundOverflow
                          ? `新增 ${finishedMonitorRounds.length} 场，超出本轮 ${currentGroups.length} 组`
                          : finishedMonitorRounds.length === 0
                            ? "已关联本轮监控，等待最终分"
                            : monitorHasUnmatchedRounds
                              ? `本轮有 ${finishedMonitorRounds.length - monitorFullyMatchedGroupCount} 场未完整匹配名单`
                              : `本轮最终分 ${finishedMonitorRounds.length}/${currentGroups.length} 场`}
                </span>
                {syncContextMatchesGroups && finishedMonitorRounds.length > 0 && !monitorRoundOverflow && (
                  <span className="ml-2 text-muted-foreground">
                    已匹配 {monitorSyncHits.length} 人 / {monitorMatchedGroupCount} 组
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {roundKey === "group" && (
                <Button size="sm" variant="ghost" onClick={() => setRoundKey("promotion")}>
                  查看晋级赛
                  <ArrowRight data-icon="inline-end" />
                </Button>
              )}
              {roundKey === "promotion" && (
                <Button size="sm" variant="ghost" onClick={() => setRoundKey("final")} disabled={!promotionReadyForFinal}>
                  <Trophy data-icon="inline-start" />
                  进入决赛
                </Button>
              )}
            </div>
          </div>
          {saveMessage && (
            <div aria-live="polite" className="flex items-center gap-2 border-t border-border/70 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <CircleCheckBig className="size-4 shrink-0" />
              <span className="min-w-0 break-words">{saveMessage}</span>
            </div>
          )}
        </section>

        {(roundKey === "group" || totalPages > 1) && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="text-xs text-muted-foreground">
              {roundKey === "group" ? "分组顺序决定直播场次与时间" : `${roundMeta.label}分组`}
            </div>
            <div className="flex items-center gap-2">
              {roundKey === "group" && (
                <Button size="sm" variant="outline" onClick={resetGroupOrder} disabled={baseGroupStageGroups.length === 0}>
                  恢复默认顺序
                </Button>
              )}
              {totalPages > 1 && (
                <>
                  <Button size="icon-sm" variant="outline" disabled={groupPage <= 0} onClick={() => setGroupPage((page) => Math.max(0, page - 1))} aria-label="上一页" title="上一页">
                    <ChevronLeft />
                  </Button>
                  <span className="min-w-12 text-center text-xs font-semibold text-muted-foreground">{groupPage + 1} / {totalPages}</span>
                  <Button size="icon-sm" variant="outline" disabled={groupPage >= totalPages - 1} onClick={() => setGroupPage((page) => Math.min(totalPages - 1, page + 1))} aria-label="下一页" title="下一页">
                    <ChevronRight />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {roundKey === "group" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" />
                小组赛分组设置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-medium">人数方案</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={groupPlan.sizeMode === "preset" ? "default" : "outline"}
                      onClick={() =>
                        setGroupPlan((current) => ({ ...current, sizeMode: "preset" }))
                      }
                    >
                      内置固定
                    </Button>
                    <Button
                      size="sm"
                      variant={groupPlan.sizeMode === "auto" ? "default" : "outline"}
                      onClick={() => setGroupPlan((current) => ({ ...current, sizeMode: "auto" }))}
                    >
                      自动
                    </Button>
                    <Button
                      size="sm"
                      variant={groupPlan.sizeMode === "manual" ? "default" : "outline"}
                      onClick={() => setGroupPlan((current) => ({ ...current, sizeMode: "manual" }))}
                    >
                      手动
                    </Button>
<div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        window.dispatchEvent(new CustomEvent("app:navigate", { detail: "pk" }))
                      }
                    >
                      编辑参赛名单
                    </Button>
                    <Button size="sm" variant="outline" onClick={fillManualToTotal}>
                      按当前人数生成
                    </Button>
                  </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {groupPlan.manualCounts.map((row) => (
                      <label key={row.size} className="rounded-lg border border-border bg-background px-3 py-2">
                        <div className="mb-1 text-xs text-muted-foreground">{row.size}人组 x</div>
                        <Input
                          type="number"
                          min={0}
                          max={20}
                          value={row.count}
                          disabled={groupPlan.sizeMode !== "manual"}
                          onChange={(event) => updateManualCount(row.size, Number(event.target.value))}
                          className="h-8"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">或直接输入：8x2,7x5</div>
                    <Input
                      value={groupPlan.manualText}
                      disabled={groupPlan.sizeMode !== "manual"}
                      onChange={(event) => applyManualText(event.target.value)}
                      placeholder="8x2,7x5"
                      className="h-9"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">排序方式</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={groupPlan.sortMode === "wave_desc" ? "default" : "outline"}
                      onClick={() =>
                        setGroupPlan((current) => ({ ...current, sortMode: "wave_desc" }))
                      }
                    >
                      全量音浪从高到低
                    </Button>
                    <Button
                      size="sm"
                      variant={
                        groupPlan.sortMode === "top_wave_rest_volatility" ? "default" : "outline"
                      }
                      onClick={() =>
                        setGroupPlan((current) => ({
                          ...current,
                          sortMode: "top_wave_rest_volatility",
                        }))
                      }
                    >
                      前两组音浪，剩余按波动
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    <div>当前名单 {allMembers.length} 人</div>
                    <div className={invalidGrouping ? "text-destructive" : ""}>
                      {groupPlanDetail}
                    </div>
                    <div>
                      {groupPlan.sizeMode === "preset"
                        ? "使用内置 7 组固定名单，不随音浪实时重排。不确定谁打谁不打时请改用「自动」。"
                        : groupPlan.sizeMode === "auto"
                          ? "人员从高到低切组；组间最优出场（中上开场→穿插弱组→最强冲高→次强收尾）。名单变了分组会跟着变。"
                          : groupPlan.sortMode === "top_wave_rest_volatility"
                            ? "前两组按总音浪排名截取；其余按日振幅/去峰日均排序，波动大的优先同组；组间再套最优出场。"
                            : "所有组都按总音浪从高到低连续切分，组间最优出场。"}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {bulkOpen && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
              <div>
                <CardTitle className="text-sm">批量录分 · {roundMeta.label}</CardTitle>
                <div className="mt-1 text-xs text-muted-foreground">按主播姓名或抖音 ID 匹配当前名单</div>
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => setBulkOpen(false)} aria-label="关闭批量录分" title="关闭">
                <X />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                placeholder="狼某 1280"
                className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-[3px] focus:ring-ring/50"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{bulkText.trim() ? `${bulkText.trim().split(/\r?\n/).length} 行待匹配` : "等待粘贴"}</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setBulkText("")} disabled={!bulkText}>
                    清空
                  </Button>
                  <Button size="sm" onClick={applyBulkScores}>
                    <ClipboardPaste data-icon="inline-start" />
                    保存匹配到的分数
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {currentGroups.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleGroups.map((group) => {
              const groupNo =
                currentGroups.findIndex((item) => item.key === group.key) + 1;
              const scheduleTime =
                groupNo > 0 ? scheduleByGroupNo.get(groupNo) || "" : "";
              return (
                <GroupCard
                  key={group.key}
                  group={group}
                  roundKey={roundKey}
                  scoreDrafts={scoreDrafts}
                  scoreMap={scoreMap}
                  savingKey={savingKey}
                  onDraftChange={updateDraft}
                  onSave={saveScore}
                  onQuickAdd={quickAddScore}
                  scheduleTime={scheduleTime}
                  finalSlots={
                    roundKey === "promotion"
                      ? promotionFinalCounts[
                          currentGroups.findIndex((item) => item.key === group.key)
                        ] || 0
                      : 0
                  }
                  compact
                  draggable={roundKey === "group"}
                  dragging={draggingGroupKey === group.key}
                  dragOver={dragOverGroupKey === group.key}
                  onDragStart={() => setDraggingGroupKey(group.key)}
                  onDragEnd={() => {
                    setDraggingGroupKey(null);
                    setDragOverGroupKey(null);
                  }}
                  onDragOver={() => {
                    if (roundKey !== "group") return;
                    setDragOverGroupKey(group.key);
                  }}
                  onDrop={() => {
                    if (roundKey !== "group" || !draggingGroupKey) return;
                    reorderGroupStage(draggingGroupKey, group.key);
                    setDraggingGroupKey(null);
                    setDragOverGroupKey(null);
                  }}
                />
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <div className="text-base font-bold">{roundMeta.label}暂无名单</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {roundKey === "promotion"
                  ? "内置晋级名单未匹配到主播，请确认 15 号白名单与当月音浪数据。"
                  : roundKey === "final"
                    ? `晋级赛已结算 ${promotionSettledCount}/${promotionGroups.length} 组；全部录完后生成决赛名单。`
                    : `${roundHint}`}
              </div>
            </CardContent>
          </Card>
        )}
        {invalidGrouping && (
          <Card className="border-red-200 bg-red-50 text-red-800">
            <CardContent className="py-4 text-sm font-medium">
              {groupPlanDetail || `当前参赛人数 ${activeMembers.length} 人，无法完成分组。`}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="fixed -left-[9999px] top-0">
        <BattleExportBoard
          ref={exportRef}
          period={period}
          roundLabel={roundMeta.label}
          groups={currentGroups}
          roundKey={roundKey}
          scoreDrafts={scoreDrafts}
          scoreMap={scoreMap}
          notes={exportNotes}
        />
      </div>
    </div>
  );
}

function parseExportSchedule(notes: string, groupCount = 0, roundKey: string = "group") {
  const lines = String(notes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // 默认：按当前轮次首场时间 + 出场顺序自动生成
  const firstStart = roundFirstStart(roundKey);
  const scheduleByGroup = buildSequentialSchedule(Math.max(groupCount, 1), firstStart);
  const generalLines: string[] = [];

  // 备注里可覆盖：小组第1场 / 复活第1场 / 第1场 12:15
  const roundPrefix =
    roundKey === "revival"
      ? "(?:复活|复活赛)"
      : roundKey === "promotion"
        ? "(?:晋级|晋级赛)"
        : roundKey === "final"
          ? "(?:决赛)"
          : "(?:小组|小组赛)?";

  for (const line of lines) {
    const match = line.match(
      new RegExp(
        `^(?:${roundPrefix})?\\s*第\\s*(\\d+)\\s*(?:组|场)\\s*[:：]?\\s*(\\d{1,2}:\\d{2})(?:\\s*[-~～—到至]\\s*\\d{1,2}:\\d{2})?(?:\\s*开始连麦)?\\s*$`
      )
    );
    if (match) {
      scheduleByGroup.set(Number(match[1]), formatLinkmicLabel(match[2]));
      continue;
    }
    // 单场轮次简写：复活赛 14:00 开始连麦
    if (groupCount <= 1) {
      const single = line.match(
        new RegExp(
          `^${roundPrefix}\\s*[:：]?\\s*(\\d{1,2}:\\d{2})(?:\\s*开始连麦)?\\s*$`
        )
      );
      if (single) {
        scheduleByGroup.set(1, formatLinkmicLabel(single[1]));
        continue;
      }
    }
    generalLines.push(line);
  }

  return { scheduleByGroup, generalLines };
}

const BattleExportBoard = React.forwardRef<
  HTMLDivElement,
  {
    period: string;
    roundLabel: string;
    groups: BattleGroup[];
    roundKey: string;
    scoreDrafts: Record<string, string>;
    scoreMap: Map<string, number>;
    notes?: string;
  }
>(function BattleExportBoard(
  { period, roundLabel, groups, roundKey, scoreDrafts, scoreMap, notes = "" },
  ref
) {
  const { scheduleByGroup, generalLines } = parseExportSchedule(notes, groups.length, roundKey);
  const totalPeople = groups.reduce((sum, group) => sum + group.members.length, 0);
  const showScores = groups.some((group) => groupHasScore(group, scoreMap, scoreDrafts, roundKey));
  const columns = groups.length <= 3 ? groups.length || 1 : groups.length <= 6 ? 3 : 4;
  const boardWidth = Math.max(1280, columns * 320 + 96);
  const periodDisplay = (() => {
    const [y, m] = period.split("-");
    if (!y || !m) return period;
    return `${y}年${Number(m)}月`;
  })();

  // 艳丽赛博糖果色：html-to-image 仅用内联 style 更稳
  const ACCENTS = [
    { main: "#FF2D95", soft: "#FFE4F3", deep: "#C4006C", glow: "rgba(255,45,149,0.28)" },
    { main: "#7C3AED", soft: "#EDE9FE", deep: "#5B21B6", glow: "rgba(124,58,237,0.28)" },
    { main: "#06B6D4", soft: "#CFFAFE", deep: "#0E7490", glow: "rgba(6,182,212,0.28)" },
    { main: "#F59E0B", soft: "#FEF3C7", deep: "#B45309", glow: "rgba(245,158,11,0.30)" },
    { main: "#22C55E", soft: "#DCFCE7", deep: "#15803D", glow: "rgba(34,197,94,0.28)" },
    { main: "#F43F5E", soft: "#FFE4E6", deep: "#BE123C", glow: "rgba(244,63,94,0.28)" },
    { main: "#3B82F6", soft: "#DBEAFE", deep: "#1D4ED8", glow: "rgba(59,130,246,0.28)" },
    { main: "#A855F7", soft: "#F3E8FF", deep: "#7E22CE", glow: "rgba(168,85,247,0.28)" },
  ];
  const COLORS = {
    text: "#1A1033",
    muted: "#6B5B95",
    card: "#FFFFFF",
    ink: "#1A1033",
  };

  return (
    <div
      ref={ref}
      style={{
        width: boardWidth,
        boxSizing: "border-box",
        background:
          "linear-gradient(145deg, #FFF0F8 0%, #F3E8FF 28%, #E0F2FE 62%, #FEF3C7 100%)",
        padding: 36,
        fontFamily:
          '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
        color: COLORS.text,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 装饰光斑 */}
      <div
        style={{
          position: "absolute",
          top: -80,
          right: -40,
          width: 280,
          height: 280,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,45,149,0.35) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -60,
          left: -30,
          width: 240,
          height: 240,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.30) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 180,
          left: "40%",
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(6,182,212,0.22) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* 页眉 */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          marginBottom: 22,
          padding: "18px 20px",
          borderRadius: 22,
          background:
            "linear-gradient(120deg, #FF2D95 0%, #7C3AED 45%, #06B6D4 100%)",
          boxShadow: "0 12px 32px rgba(124,58,237,0.28)",
          color: "#fff",
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              padding: "5px 12px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.22)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 1.2,
              border: "1px solid rgba(255,255,255,0.35)",
            }}
          >
            ★ PENGZAI · STAR BATTLE
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 900,
              letterSpacing: 1,
              color: "#fff",
              textShadow: "0 2px 12px rgba(0,0,0,0.18)",
            }}
          >
            星嗨争霸赛
          </div>
          <div style={{ marginTop: 8, fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>
            {periodDisplay} · {roundLabel} · 共 {totalPeople} 人
          </div>
          {(roundKey === "promotion" || roundKey === "final") && (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {(
                roundKey === "promotion"
                  ? [
                      "规则：每组晋级 1 人",
                      "规则：等待晋级赛全部结束后进入决赛即可",
                      "规则：无复活赛",
                      `时间：${ROUND_FIRST_START.promotion} 起 · 间隔 15 分钟`,
                    ]
                  : [
                      "规则：晋级赛每组第 1 名进入决赛",
                      "规则：等待晋级赛全部结束后进入决赛即可",
                      "规则：无复活赛",
                      `时间：${ROUND_FIRST_START.final} 开始连麦`,
                    ]
              ).map((text) => (
                <span
                  key={text}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "5px 10px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.22)",
                    border: "1px solid rgba(255,255,255,0.35)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {text}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <div
            style={{
              minWidth: 92,
              padding: "12px 16px",
              borderRadius: 16,
              background: "rgba(255,255,255,0.2)",
              border: "1px solid rgba(255,255,255,0.4)",
              color: "#fff",
              textAlign: "center",
              backdropFilter: "blur(6px)",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.1 }}>{groups.length}</div>
            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, opacity: 0.92 }}>组</div>
          </div>
          <div
            style={{
              minWidth: 92,
              padding: "12px 16px",
              borderRadius: 16,
              background: "rgba(255,255,255,0.92)",
              color: "#7C3AED",
              textAlign: "center",
              boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.1 }}>{totalPeople}</div>
            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, color: "#A855F7" }}>人</div>
          </div>
        </div>
      </div>

      {/* 赛程摘要条 */}
      {generalLines.length > 0 && (
        <div
          style={{
            position: "relative",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 20,
            padding: "14px 16px",
            borderRadius: 18,
            background: "rgba(255,255,255,0.82)",
            border: "1px solid rgba(255,255,255,0.95)",
            boxShadow: "0 8px 24px rgba(124,58,237,0.10)",
          }}
        >
          {generalLines.map((line, index) => {
            const accent = ACCENTS[index % ACCENTS.length];
            return (
              <div
                key={`${index}-${line}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  borderRadius: 999,
                  background: accent.soft,
                  color: accent.deep,
                  fontSize: 13,
                  fontWeight: 800,
                  border: `1px solid ${accent.main}33`,
                  boxShadow: `0 4px 12px ${accent.glow}`,
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: `linear-gradient(135deg, ${accent.main}, ${accent.deep})`,
                    flexShrink: 0,
                    boxShadow: `0 0 0 3px ${accent.soft}`,
                  }}
                />
                {line}
              </div>
            );
          })}
        </div>
      )}

      {/* 分组卡片 */}
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 14,
        }}
      >
        {groups.map((group, groupIndex) => {
          const displayMembers = groupHasScore(group, scoreMap, scoreDrafts, roundKey)
            ? rankGroupMembers(group, scoreMap, scoreDrafts, roundKey)
            : group.members;
          const timeLabel = scheduleByGroup.get(groupIndex + 1) || "";
          const groupNo = groupIndex + 1;
          const accent = ACCENTS[groupIndex % ACCENTS.length];

          return (
            <div
              key={group.key}
              style={{
                background: COLORS.card,
                border: `2px solid ${accent.main}55`,
                borderRadius: 20,
                overflow: "hidden",
                boxShadow: `0 10px 28px ${accent.glow}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "12px 14px",
                  background: `linear-gradient(120deg, ${accent.main} 0%, ${accent.deep} 100%)`,
                  color: "#fff",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(255,255,255,0.24)",
                      border: "1px solid rgba(255,255,255,0.45)",
                      color: "#fff",
                      fontSize: 16,
                      fontWeight: 900,
                      flexShrink: 0,
                      boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
                    }}
                  >
                    {groupNo}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 900,
                        color: "#fff",
                        lineHeight: 1.2,
                        textShadow: "0 1px 4px rgba(0,0,0,0.15)",
                      }}
                    >
                      {group.label}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
                      {group.members.length} 人
                    </div>
                  </div>
                </div>
                {timeLabel && (
                  <div
                    style={{
                      flexShrink: 0,
                      padding: "6px 11px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.95)",
                      color: accent.deep,
                      fontSize: 12,
                      fontWeight: 900,
                      letterSpacing: 0.1,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                    }}
                  >
                    {timeLabel}
                  </div>
                )}
              </div>

              <div
                style={{
                  padding: 12,
                  display: "grid",
                  gap: 7,
                  background: `linear-gradient(180deg, ${accent.soft} 0%, #FFFFFF 55%)`,
                }}
              >
                {displayMembers.map((member, index) => {
                  const score = getScoreValue(
                    scoreMap,
                    scoreDrafts,
                    roundKey,
                    group.key,
                    member.personId
                  );
                  return (
                    <div
                      key={member.personId}
                      style={{
                        display: "grid",
                        gridTemplateColumns: showScores
                          ? "28px minmax(0,1fr) 56px"
                          : "28px minmax(0,1fr)",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 12,
                        background: index % 2 === 0 ? "rgba(255,255,255,0.92)" : accent.soft,
                        border: `1px solid ${accent.main}22`,
                        boxShadow: index % 2 === 0 ? "0 2px 6px rgba(26,16,51,0.04)" : "none",
                      }}
                    >
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 8,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background:
                            showScores && score > 0
                              ? `linear-gradient(135deg, ${accent.main}, ${accent.deep})`
                              : `linear-gradient(135deg, ${accent.main}AA, ${accent.deep}AA)`,
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 900,
                          boxShadow: `0 3px 8px ${accent.glow}`,
                        }}
                      >
                        {index + 1}
                      </div>
                      <div
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 15,
                          fontWeight: 800,
                          color: COLORS.text,
                        }}
                      >
                        {member.name}
                      </div>
                      {showScores && (
                        <div
                          style={{
                            textAlign: "right",
                            fontSize: 15,
                            fontWeight: 900,
                            color: score > 0 ? accent.deep : "#A78BFA",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {score > 0 ? score : "—"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部完整时间表（有分组时刻时） */}
      {scheduleByGroup.size > 0 && (
        <div
          style={{
            position: "relative",
            marginTop: 20,
            padding: 16,
            borderRadius: 18,
            background: "rgba(255,255,255,0.88)",
            border: "1px solid rgba(255,255,255,0.95)",
            boxShadow: "0 10px 28px rgba(124,58,237,0.12)",
          }}
        >
          <div
            style={{
              marginBottom: 12,
              fontSize: 13,
              fontWeight: 900,
              color: "#7C3AED",
              letterSpacing: 0.6,
            }}
          >
            ⚡ 连麦时间表（按出场顺序，拖组不改时间）
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(groups.length, 7)}, minmax(0, 1fr))`,
              gap: 8,
            }}
          >
            {groups.map((group, index) => {
              const time = scheduleByGroup.get(index + 1);
              if (!time) return null;
              const accent = ACCENTS[index % ACCENTS.length];
              return (
                <div
                  key={`schedule-${group.key}`}
                  style={{
                    padding: "10px 8px",
                    borderRadius: 14,
                    background: `linear-gradient(160deg, ${accent.soft} 0%, #FFFFFF 100%)`,
                    border: `1.5px solid ${accent.main}55`,
                    textAlign: "center",
                    boxShadow: `0 6px 14px ${accent.glow}`,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 900, color: accent.deep }}>
                    第{index + 1}组
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      fontWeight: 900,
                      color: accent.main,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1.35,
                    }}
                  >
                    {time}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 若备注只有普通行、没有解析出时间表，保留底部备注区 */}
      {generalLines.length > 0 && scheduleByGroup.size === 0 && (
        <div
          style={{
            position: "relative",
            marginTop: 20,
            padding: "14px 16px",
            borderRadius: 18,
            background: "linear-gradient(120deg, #FEF3C7 0%, #FCE7F3 100%)",
            border: "1.5px solid #F9A8D4",
            boxShadow: "0 8px 20px rgba(244,114,182,0.18)",
          }}
        >
          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 900, color: "#BE185D" }}>
            备注
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {generalLines.map((line, index) => (
              <div
                key={`${index}-${line}`}
                style={{ fontSize: 14, fontWeight: 700, color: "#9D174D", lineHeight: 1.55 }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function GroupCard({
  group,
  roundKey,
  scoreDrafts,
  scoreMap,
  savingKey,
  onDraftChange,
  onSave,
  onQuickAdd,
  scheduleTime = "",
  finalSlots = 0,
  compact = false,
  draggable = false,
  dragging = false,
  dragOver = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  group: BattleGroup;
  roundKey: string;
  scoreDrafts: Record<string, string>;
  scoreMap: Map<string, number>;
  savingKey: string | null;
  onDraftChange: (groupKey: string, personId: number, value: string) => void;
  onSave: (groupKey: string, personId: number, value: string) => void;
  onQuickAdd: (groupKey: string, personId: number, delta: number) => void;
  scheduleTime?: string;
  /** 晋级赛该组进决赛名额 */
  finalSlots?: number;
  compact?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
}) {
  const groupScore = group.members.reduce((sum, member) => {
    const key = scoreKey(roundKey, group.key, member.personId);
    return sum + Number(scoreDrafts[key] || scoreMap.get(key) || 0);
  }, 0);
  const avgScore = group.members.length > 0 ? groupScore / group.members.length : 0;
  const scored = groupHasScore(group, scoreMap, scoreDrafts, roundKey);
  const scoredMemberCount = group.members.filter((member) =>
    hasScoreEntry(scoreMap, scoreDrafts, roundKey, group.key, member.personId)
  ).length;
  const settled = groupIsSettled(group, scoreMap, scoreDrafts, roundKey);
  const displayMembers = settled
    ? rankGroupMembers(group, scoreMap, scoreDrafts, roundKey)
    : group.members;
  const rankByPerson = new Map(displayMembers.map((member, index) => [member.personId, index + 1]));

  const rankLabel = (rank: number) => {
    if (!settled) return "";
    if (roundKey === "group") {
      const promote = promoteCountForGroupSize(group.members.length);
      if (rank <= promote) return "晋级";
      if (rank <= group.members.length) return "复活";
      return "";
    }
    if (roundKey === "revival") {
      const promote = promoteCountForGroupSize(group.members.length);
      if (rank <= promote) return "晋级";
      return "";
    }
    if (roundKey === "promotion") {
      if (finalSlots > 0 && rank <= finalSlots) return "决赛";
      return "";
    }
    if (roundKey === "final" && rank === 1) return "冠军";
    return "";
  };

  return (
    <Card
      className={[
        "overflow-hidden transition-all",
        compact ? "shadow-none" : "",
        dragging ? "opacity-55 scale-[0.99]" : "",
        dragOver ? "ring-2 ring-primary/60 border-primary/40" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={
        draggable
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              onDragOver?.();
            }
          : undefined
      }
      onDrop={
        draggable
          ? (event) => {
              event.preventDefault();
              onDrop?.();
            }
          : undefined
      }
    >
      <CardHeader className={compact ? "space-y-1 border-b border-border/60 bg-muted/30 px-3 py-2" : "border-b border-border/60 bg-muted/30 pb-3"}>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className={compact ? "flex min-w-0 items-center gap-1.5 text-sm" : "flex min-w-0 items-center gap-2 text-base"}>
            {draggable && (
              <button
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", group.key);
                  onDragStart?.();
                }}
                onDragEnd={() => onDragEnd?.()}
                className={
                  compact
                    ? "inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md border border-border bg-background text-muted-foreground active:cursor-grabbing"
                    : "inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md border border-border bg-background text-muted-foreground active:cursor-grabbing"
                }
                title="拖动调整组顺序"
                aria-label={`拖动${group.label}`}
              >
                <GripVertical className={compact ? "size-3.5" : "size-4"} />
              </button>
            )}
            <Users className={compact ? "size-3.5 shrink-0 text-primary" : "size-4 shrink-0 text-primary"} />
            <span className="truncate">{group.label}</span>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            {scheduleTime && (
              <Badge
                variant="secondary"
                className={
                  compact
                    ? "h-5 max-w-[9.5rem] truncate px-1.5 text-[10px] tabular-nums"
                    : "font-mono text-xs tabular-nums"
                }
                title={scheduleTime}
              >
                {scheduleTime}
              </Badge>
            )}
            <Badge variant="outline" className={compact ? "h-5 px-1.5 text-[10px]" : undefined}>
              {group.members.length}人
            </Badge>
            {group.incomplete && (
              <Badge variant="destructive" className={compact ? "h-5 px-1.5 text-[10px]" : undefined}>
                名单缺失
              </Badge>
            )}
            {scored && (
              <Badge variant={settled ? "default" : "secondary"} className={compact ? "h-5 px-1.5 text-[10px]" : undefined}>
                {settled ? "已结算" : `${scoredMemberCount}/${group.members.length}`}
              </Badge>
            )}
          </div>
        </div>
        <div className={compact ? "flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground" : "flex flex-wrap gap-2 text-xs text-muted-foreground"}>
          <span>均浪 {formatWave(group.averageWave)}</span>
          <span>均分 {avgScore.toFixed(1)}</span>
          {!compact && scheduleTime && <span>{scheduleTime}</span>}
          {!compact && <span>裁判：待定</span>}
          {!compact && group.source && <span>{group.source}</span>}
        </div>
      </CardHeader>
      <CardContent className={compact ? "space-y-1 p-2" : "space-y-2"}>
        {displayMembers.map((member, index) => {
          const key = scoreKey(roundKey, group.key, member.personId);
          const draft = scoreDrafts[key] ?? "";
          const saving = savingKey === key;
          const label = rankLabel(rankByPerson.get(member.personId) || index + 1);
          if (compact) {
            return (
              <div
                key={member.personId}
                className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border border-border/70 bg-background px-1.5 py-1"
              >
                <span className="text-center text-[11px] font-bold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="flex min-w-0 items-center gap-1">
                  <div className="truncate text-xs font-semibold">{member.name}</div>
                  {label && (
                    <Badge variant={label === "冠军" ? "default" : "secondary"} className="h-4 shrink-0 px-1 text-[9px]">
                      {label}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-0.5">
                  <Input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={draft}
                    placeholder="分"
                    onChange={(event) => onDraftChange(group.key, member.personId, event.target.value)}
                    onBlur={(event) => onSave(group.key, member.personId, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    className="h-6 w-12 px-1 text-right text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-1.5 text-[10px]"
                    disabled={saving}
                    onClick={() => onQuickAdd(group.key, member.personId, 10)}
                  >
                    +10
                  </Button>
                </div>
              </div>
            );
          }
          return (
            <div
              key={member.personId}
              className="grid gap-2 rounded-lg border border-border bg-background px-3 py-2 md:grid-cols-[minmax(0,1fr)_220px]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate text-sm font-semibold">{member.name}</div>
                    {label && (
                      <Badge variant={label === "冠军" ? "default" : "secondary"} className="shrink-0 text-[10px]">
                        {label}
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {member.gender === "male" ? "男团" : "女团"} · 月音浪 {formatWave(member.wave)}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <Input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={draft}
                  placeholder="分数"
                  onChange={(event) => onDraftChange(group.key, member.personId, event.target.value)}
                  onBlur={(event) => onSave(group.key, member.personId, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-8 w-20 text-right"
                />
                {[10, 100].map((delta) => (
                  <Button
                    key={delta}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-2 text-xs"
                    disabled={saving}
                    onClick={() => onQuickAdd(group.key, member.personId, delta)}
                  >
                    +{delta}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs"
                  disabled={saving}
                  onClick={() => onSave(group.key, member.personId, "")}
                >
                  清
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
