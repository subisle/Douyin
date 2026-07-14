"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Download,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  IpcResult,
  LivePkMonitorStatus,
  LivePkChatPayload,
  LivePkEventPayload,
  LivePkGiftPayload,
  LivePkMemberPayload,
  LivePkRankPayload,
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
  resolvePresetBattleGroups,
  resolveRosterNames,
  type RosterConfig,
  type RosterSlot,
} from "./pk-roster-config";

interface BattleGroup {
  key: string;
  label: string;
  members: PkMember[];
  averageWave: number;
  source?: string;
}

const MIN_GROUP_SIZE = 5;
const MAX_GROUP_SIZE = 8;
const PREFERRED_TOP_GROUP_SIZE = 8;
const PREFERRED_TOP_GROUP_COUNT = 2;
const GROUPS_PER_PAGE = 2;
// v2：默认切到内置固定分组，避免沿用旧 localStorage 的 auto 方案
const GROUP_PLAN_STORAGE_KEY = "star-battle-group-plan-v2";
const EXPORT_NOTES_STORAGE_KEY = "star-battle-export-notes-v1";

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
    sizeMode: "preset",
    sortMode: "wave_desc",
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

function defaultExportNotes() {
  return "";
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
  { key: "revival", label: "复活赛", time: "中午" },
  { key: "promotion", label: "晋级赛", time: "晚上" },
  { key: "final", label: "决赛", time: "晚上" },
] as const;

type BattleRoundKey = (typeof BATTLE_ROUNDS)[number]["key"];

interface MonitorLogRow {
  id: string;
  at: string;
  type: "score" | "gift" | "chat" | "member" | "event" | "status";
  name: string;
  userId: string;
  value: string;
  detail: string;
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

function orderMembersForGroups(
  members: PkMember[],
  sizes: number[],
  sortMode: GroupSortMode
): PkMember[] {
  if (members.length === 0) return [];
  if (sortMode === "wave_desc") {
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
      members: group.members,
      averageWave: group.averageWave,
      source: group.source,
    }));
    // 有缺人或多余人时仍展示已匹配组，但标记 invalid 方便页面提示
    const invalid =
      members.length > 0 &&
      (preset.missingNames.length > 0 ||
        preset.leftover.length > 0 ||
        groups.every((group) => group.members.length === 0));
    return { groups, detail: preset.detail, invalid };
  }

  const { sizes, detail } = resolveGroupSizes(members.length, plan);
  if (!sizes) {
    return { groups: [], detail, invalid: members.length > 0 };
  }

  const ordered = orderMembersForGroups(members, sizes, plan.sortMode);
  let cursor = 0;
  const groups = sizes.map((size, index) => {
    const groupMembers = ordered.slice(cursor, cursor + size);
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
  return { groups, detail, invalid: false };
}

function buildStageGroups(
  members: PkMember[],
  labelPrefix = "第",
  plan: GroupPlanConfig = defaultGroupPlan()
): BattleGroup[] {
  const { groups } = buildBattleGroups(members, plan);
  if (groups.length > 0) {
    return groups.map((group, index) => ({
      ...group,
      key: `group-${index + 1}`,
      label: `${labelPrefix}${index + 1}组`,
    }));
  }
  if (members.length === 0) return [];
  const averageWave = members.reduce((sum, item) => sum + item.wave, 0) / members.length;
  return [
    {
      key: "group-1",
      label: `${labelPrefix}1组`,
      members,
      averageWave,
      source: "人数不足5人，先按单组显示",
    },
  ];
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

function pickRankedMember(
  group: BattleGroup,
  scoreMap: Map<string, number>,
  scoreDrafts: Record<string, string>,
  roundKey: string,
  rankIndex: number
) {
  if (!groupHasScore(group, scoreMap, scoreDrafts, roundKey)) return undefined;
  return rankGroupMembers(group, scoreMap, scoreDrafts, roundKey)[rankIndex];
}

function isPkMember(member: PkMember | undefined): member is PkMember {
  return Boolean(member);
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

function namesMatch(a: string, b: string) {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function monitorName(payload: {
  nickname?: string;
  realName?: string;
  displayName?: string;
  isMystery?: boolean;
}) {
  const realName = payload.realName || payload.nickname || "";
  const displayName = payload.displayName || "";
  if (payload.isMystery && displayName && realName && displayName !== realName) {
    return `${realName}(${displayName})`;
  }
  return realName || displayName || "未知";
}

function monitorIdentityDetail(payload: {
  displayName?: string;
  realName?: string;
  secUid?: string;
  uniqueId?: string;
  isMystery?: boolean;
  mysteryMan?: number;
  userLevel?: number;
  badgeLevel?: number;
  consumeLevel?: number;
  payScore?: number;
  totalRechargeDiamondCount?: number;
  fanTicketCount?: number;
  ipLocation?: string;
  followerCount?: number;
  cacheHit?: boolean;
}) {
  const parts: string[] = [];
  if (payload.cacheHit) parts.push("缓存命中");
  if (payload.isMystery) parts.push(`神秘人${payload.mysteryMan ? `L${payload.mysteryMan}` : ""}`);
  if (payload.displayName && payload.realName && payload.displayName !== payload.realName) {
    parts.push(`${payload.displayName} -> ${payload.realName}`);
  }
  if (payload.uniqueId) parts.push(`抖音号:${payload.uniqueId}`);
  if (payload.secUid) parts.push(`sec:${payload.secUid.slice(0, 12)}...`);
  if (payload.userLevel) parts.push(`用户等级:${payload.userLevel}`);
  if (payload.badgeLevel) parts.push(`徽章等级:${payload.badgeLevel}`);
  if (payload.consumeLevel) parts.push(`财富等级:${payload.consumeLevel}`);
  if (payload.payScore) parts.push(`付费分:${payload.payScore}`);
  if (payload.totalRechargeDiamondCount) parts.push(`充值钻石:${payload.totalRechargeDiamondCount}`);
  if (payload.fanTicketCount) parts.push(`粉丝票:${payload.fanTicketCount}`);
  if (payload.ipLocation) parts.push(`IP:${payload.ipLocation}`);
  if (payload.followerCount) parts.push(`粉丝:${payload.followerCount}`);
  return parts.join(" / ");
}

function eventLabel(eventType: string) {
  const labels: Record<string, string> = {
    "room-user-seq": "在线榜",
    "room-stats": "在线人数",
    fansclub: "粉丝团",
    social: "社交",
    like: "点赞",
    "pico-like": "互动点赞",
    "chat-like": "弹幕点赞",
    "room-message": "房间消息",
    "room-verify": "房间校验",
    "room-start": "开播",
    "short-touch-area": "短触区",
    "in-room-banner": "房间横幅",
    "ranklist-hour-entrance": "小时榜",
    "rank-list-hour-enter": "小时榜",
    "gift-update": "礼物更新",
    "linkmic-score": "连线分数",
  };
  return labels[eventType] || eventType;
}

function textValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function monitorEventValue(payload: LivePkEventPayload) {
  if (typeof payload.displayValue === "number" && payload.displayValue > 0) return String(payload.displayValue);
  if (typeof payload.totalUser === "number" && payload.totalUser > 0) return String(payload.totalUser);
  if (typeof payload.hotScore === "number" && payload.hotScore > 0) return String(payload.hotScore);
  if (typeof payload.count === "number" && payload.count > 0) return String(payload.count);
  if (typeof payload.total === "number" && payload.total > 0) return String(payload.total);
  if (typeof payload.followCount === "number" && payload.followCount > 0) return String(payload.followCount);
  return "";
}

function monitorEventDetail(payload: LivePkEventPayload) {
  const detail = monitorIdentityDetail(payload);
  const body =
    payload.eventType === "room-stats"
      ? [
          payload.displayShort,
          payload.displayMiddle,
          payload.displayLong,
          payload.total ? `累计 ${payload.total}` : "",
        ].filter(Boolean).join(" / ")
      : payload.eventType === "room-user-seq"
        ? [
            payload.totalUserText || (payload.totalUser ? `在线 ${payload.totalUser}` : ""),
            payload.popularityText || (payload.popularity ? `人气 ${payload.popularity}` : ""),
            payload.upRightStatsText,
            payload.ranks?.length ? `榜单 ${payload.ranks.length} 人` : "",
          ].filter(Boolean).join(" / ")
        : payload.eventType === "like" || payload.eventType === "pico-like"
          ? [
              payload.count ? `本次 ${payload.count}` : "",
              payload.total ? `累计 ${payload.total}` : "",
              textValue(payload.emoji),
              textValue(payload.scene),
            ].filter(Boolean).join(" / ")
          : payload.eventType === "chat-like"
            ? [
                payload.count ? `弹幕点赞 ${payload.count}` : "",
                Array.isArray(payload.entries) ? `${payload.entries.length} 条消息` : "",
              ].filter(Boolean).join(" / ")
          : payload.eventType === "social"
            ? [
                payload.action !== undefined ? `动作 ${textValue(payload.action)}` : "",
                payload.followCount ? `关注数 ${payload.followCount}` : "",
                textValue(payload.shareTarget),
              ].filter(Boolean).join(" / ")
            : payload.eventType === "fansclub"
              ? [
                  textValue(payload.content),
                  payload.leftDiamond ? `剩余钻石 ${payload.leftDiamond}` : "",
                ].filter(Boolean).join(" / ")
              : payload.eventType === "linkmic-score"
                ? [
                    payload.hotScore ? `热度分 ${payload.hotScore}` : "",
                    payload.scoreSource !== undefined ? `来源 ${textValue(payload.scoreSource)}` : "",
                    textValue(payload.extra),
                  ].filter(Boolean).join(" / ")
                : payload.eventType === "short-touch-area"
                  ? [
                      textValue(payload.name),
                      payload.messageType !== undefined ? `消息类型 ${textValue(payload.messageType)}` : "",
                      textValue(payload.containerPayload),
                    ].filter(Boolean).join(" / ")
                  : payload.eventType === "in-room-banner"
                    ? [
                        payload.position !== undefined ? `位置 ${textValue(payload.position)}` : "",
                        payload.actionType !== undefined ? `动作 ${textValue(payload.actionType)}` : "",
                        textValue(payload.containerUrl),
                        textValue(payload.lynxContainerUrl),
                      ].filter(Boolean).join(" / ")
                    : payload.eventType === "gift-update"
                      ? [
                          payload.updateType !== undefined ? `更新 ${textValue(payload.updateType)}` : "",
                          Array.isArray(payload.updateGiftIds) ? `礼物 ${payload.updateGiftIds.length}` : "",
                          Array.isArray(payload.updateAssetIds) ? `资产 ${payload.updateAssetIds.length}` : "",
                        ].filter(Boolean).join(" / ")
                : [
                    textValue(payload.content),
                    textValue(payload.tipContent),
                    textValue(payload.displayLong),
                    payload.infoBytes ? `info ${payload.infoBytes} bytes` : "",
                  ].filter(Boolean).join(" / ");
  return [detail, body, payload.method].filter(Boolean).join(" / ");
}

function findRankScore(payload: LivePkRankPayload, member: PkMember) {
  const memberIds = new Set(memberIdentityValues(member));
  const hit = payload.ranks.find(
    (rank) =>
      (rank.userId && memberIds.has(rank.userId)) ||
      (rank.uniqueId && memberIds.has(rank.uniqueId)) ||
      namesMatch(rank.nickname, member.name)
  );
  if (!hit || !Number.isFinite(hit.score) || hit.score <= 0) return "";
  return String(hit.score);
}

function rankMatchesMember(rank: LivePkRankPayload["ranks"][number], member: PkMember) {
  const memberIds = new Set(memberIdentityValues(member));
  return (
    (rank.userId && memberIds.has(rank.userId)) ||
    (rank.uniqueId && memberIds.has(rank.uniqueId)) ||
    namesMatch(rank.nickname, member.name)
  );
}

export function StarBattlePage() {
  const exportRef = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<PkRosterData | null>(null);
  const [rosterConfigs, setRosterConfigs] = useState<Record<RosterSlot, RosterConfig>>(loadRosterConfigs);
  const [scores, setScores] = useState<StarBattleScore[]>([]);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [roundKey, setRoundKey] = useState<BattleRoundKey>("group");
  const [groupPlan, setGroupPlan] = useState<GroupPlanConfig>(loadGroupPlan);
  const [groupPage, setGroupPage] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [monitorOpen] = useState(false);
  const [monitorUrl, setMonitorUrl] = useState("");
  const [monitorWs, setMonitorWs] = useState("");
  const [monitorCookie, setMonitorCookie] = useState("");
  const [manualMonitorOpen, setManualMonitorOpen] = useState(false);
  const [monitorStatus, setMonitorStatus] = useState<LivePkMonitorStatus>({
    status: "idle",
    startedAt: null,
    lastError: null,
    lastRankAt: null,
  });
  const [monitorMessage, setMonitorMessage] = useState("");
  const [monitorLogs, setMonitorLogs] = useState<MonitorLogRow[]>([]);
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
  const initialGroups = useMemo(
    () =>
      groupStageResult.groups.map((group, index) => ({
        ...group,
        key: `group-${index + 1}`,
        label: `第${index + 1}组`,
      })),
    [groupStageResult.groups]
  );
  const activeMembers = allMembers;
  const invalidGrouping = groupStageResult.invalid;
  const groupPlanDetail = groupStageResult.detail;
  const laterStagePlan = useMemo<GroupPlanConfig>(
    () => ({
      ...defaultGroupPlan(),
      // 复活/晋级/决赛不沿用固定小组名单，按当前晋级人数自动切
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
      initialGroups
        .map((group) => pickRankedMember(group, scoreMap, scoreDrafts, "group", 0))
        .filter(isPkMember),
    [initialGroups, scoreDrafts, scoreMap]
  );
  const groupSeconds = useMemo(
    () =>
      initialGroups
        .map((group) => pickRankedMember(group, scoreMap, scoreDrafts, "group", 1))
        .filter(isPkMember),
    [initialGroups, scoreDrafts, scoreMap]
  );
  const revivalGroups = useMemo(
    () => buildStageGroups(groupSeconds, "复活", laterStagePlan),
    [groupSeconds, laterStagePlan]
  );
  const revivalWinners = useMemo(
    () =>
      revivalGroups
        .map((group) => pickRankedMember(group, scoreMap, scoreDrafts, "revival", 0))
        .filter(isPkMember),
    [revivalGroups, scoreDrafts, scoreMap]
  );
  const promotionGroups = useMemo(
    () => buildStageGroups([...groupWinners, ...revivalWinners], "晋级", laterStagePlan),
    [groupWinners, laterStagePlan, revivalWinners]
  );
  const promotionWinners = useMemo(
    () =>
      promotionGroups
        .map((group) => pickRankedMember(group, scoreMap, scoreDrafts, "promotion", 0))
        .filter(isPkMember),
    [promotionGroups, scoreDrafts, scoreMap]
  );
  const finalGroups = useMemo(
    () => buildStageGroups(promotionWinners, "决赛", laterStagePlan),
    [laterStagePlan, promotionWinners]
  );
  const currentGroups = useMemo(() => {
    if (roundKey === "revival") return revivalGroups;
    if (roundKey === "promotion") return promotionGroups;
    if (roundKey === "final") return finalGroups;
    return initialGroups;
  }, [finalGroups, initialGroups, promotionGroups, revivalGroups, roundKey]);
  const roundMeta = BATTLE_ROUNDS.find((round) => round.key === roundKey) || BATTLE_ROUNDS[0];
  const roundHint =
    roundKey === "revival"
      ? "小组赛每组第二名进入复活赛"
      : roundKey === "promotion"
        ? "小组赛第一名 + 复活赛第一名进入晋级赛"
        : roundKey === "final"
          ? "晋级赛每组第一名进入决赛"
          : groupPlan.sizeMode === "preset"
            ? "小组赛使用内置固定分组；沿用 PK 15号名单"
            : groupPlan.sortMode === "top_wave_rest_volatility"
              ? "前两组按音浪从高到低，剩余按波动聚类；沿用 PK 15号名单"
              : "按音浪从高到低分组；沿用 PK 15号名单";

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

  useEffect(() => {
    setGroupPage(0);
  }, [period, roundKey, groupPlan]);

  useEffect(() => {
    setGroupPage((page) => Math.min(page, totalPages - 1));
  }, [totalPages]);

  const saveScore = useCallback(
    async (groupKey: string, personId: number, rawValue: string) => {
      const api = getDataApi();
      if (!api?.saveStarBattleScore) return;
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
        return;
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
    },
    [period, roundKey]
  );

  const updateDraft = useCallback((groupKey: string, personId: number, value: string) => {
    const key = scoreKey(roundKey, groupKey, personId);
    setScoreDrafts((prev) => ({ ...prev, [key]: value }));
  }, [roundKey]);

  const appendMonitorLogs = useCallback((rows: Omit<MonitorLogRow, "id">[]) => {
    if (rows.length === 0) return;
    setMonitorLogs((prev) => [
      ...rows.map((row, index) => ({
        ...row,
        id: `${row.at}-${row.type}-${row.userId || row.name}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      })),
      ...prev,
    ].slice(0, 300));
  }, []);

  const exportMonitorLogs = () => {
    const header = ["时间", "类型", "昵称", "用户ID", "数值", "详情"];
    const lines = [
      header,
      ...monitorLogs.map((row) => [row.at, row.type, row.name, row.userId, row.value, row.detail]),
    ].map((cols) =>
      cols.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
    );
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `直播监控_${period}_${roundMeta.label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  const exportCurrentGroups = async () => {
    if (!exportRef.current || currentGroups.length === 0) return;
    setExporting(true);
    try {
      await exportElementAsImage(
        exportRef.current,
        `星嗨争霸赛_${period}_${roundMeta.label}_${currentGroups.length}组.png`,
        { backgroundColor: "#f8fafc", pixelRatio: 3 }
      );
      setSaveMessage("分组图片已导出");
    } catch (e) {
      console.error("导出争霸赛图片失败", e);
      setSaveMessage("导出图片失败");
    } finally {
      setExporting(false);
    }
  };

  const startMonitor = async () => {
    const api = getDataApi();
    if (!api?.startLivePkMonitor) return;
    const res = await api.startLivePkMonitor({ websocketUrl: monitorWs, cookie: monitorCookie });
    if (res.success) {
      setMonitorStatus(res.data);
      setMonitorMessage("监控启动中");
    } else {
      setMonitorMessage(res.error || "监控启动失败");
    }
  };

  const startBuiltInMonitor = async () => {
    const api = getDataApi();
    if (!api?.startLivePkMonitorFromUrl) return;
    const res = await api.startLivePkMonitorFromUrl({
      liveRoomUrl: monitorUrl,
      cookie: monitorCookie,
    });
    if (res.success) {
      setMonitorStatus(res.data);
      setMonitorMessage("内置监控已启动");
    } else {
      setMonitorMessage(res.error || "内置监控启动失败");
    }
  };

  const stopMonitor = async () => {
    const api = getDataApi();
    if (!api?.stopLivePkMonitor) return;
    const res = await api.stopLivePkMonitor();
    if (res.success) {
      setMonitorStatus(res.data);
      setMonitorMessage("监控已停止");
    } else {
      setMonitorMessage(res.error || "停止失败");
    }
  };

  useEffect(() => {
    const api = getDataApi();
    if (!api?.onLivePkStatus) return;
    const offStatus = api.onLivePkStatus((status) => {
      setMonitorStatus(status);
      appendMonitorLogs([{
        at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        type: "status",
        name: "监控状态",
        userId: "",
        value: status.status,
        detail: status.lastError || "",
      }]);
    });
    const offError = api.onLivePkError?.((message) => {
      setMonitorMessage(message);
      appendMonitorLogs([{
        at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        type: "status",
        name: "错误",
        userId: "",
        value: "",
        detail: message,
      }]);
    }) ?? (() => undefined);
    const offCapture = api.onLivePkCaptureStatus?.((message) => {
      setMonitorMessage(message);
      appendMonitorLogs([{
        at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        type: "status",
        name: "采集",
        userId: "",
        value: "",
        detail: message,
      }]);
    }) ?? (() => undefined);
    void api.getLivePkMonitorStatus?.().then((res) => {
      if (res.success) setMonitorStatus(res.data);
    });
    return () => {
      offStatus();
      offError();
      offCapture();
    };
  }, [appendMonitorLogs]);

  useEffect(() => {
    const api = getDataApi();
    if (!api?.onLivePkRank) return;
    const offRank = api.onLivePkRank((payload) => {
      let matched = 0;
      const logRows: Omit<MonitorLogRow, "id">[] = [];
      for (const group of currentGroups) {
        for (const member of group.members) {
          const score = findRankScore(payload, member);
          if (!score) continue;
          matched += 1;
          updateDraft(group.key, member.personId, score);
          void saveScore(group.key, member.personId, score);
          logRows.push({
            at: new Date(payload.at).toLocaleTimeString("zh-CN", { hour12: false }),
            type: "score",
            name: member.name,
            userId: member.anchorId,
            value: score,
            detail: `${roundMeta.label} ${group.label}`,
          });
        }
      }
      const unmatched = payload.ranks
        .filter((rank) => rank.score > 0)
        .filter((rank) => !currentGroups.some((group) =>
          group.members.some((member) => rankMatchesMember(rank, member))
        ))
        .slice(0, 12)
        .map((rank) => ({
          at: new Date(payload.at).toLocaleTimeString("zh-CN", { hour12: false }),
          type: "score" as const,
          name: monitorName(rank) || "未匹配",
          userId: rank.userId || rank.uniqueId || rank.secUid || "",
          value: String(rank.score),
          detail: monitorIdentityDetail(rank) || "未匹配当前轮次",
        }));
      appendMonitorLogs([...logRows, ...unmatched]);
      if (matched > 0) {
        setMonitorMessage(`直播分数已同步 ${matched} 人`);
      }
    });
    return offRank;
  }, [appendMonitorLogs, currentGroups, roundMeta.label, saveScore, updateDraft]);

  useEffect(() => {
    const api = getDataApi();
    const offGift = api?.onLivePkGift?.((payload: LivePkGiftPayload) => {
      const giftDetail = [
        `${payload.giftName} x${payload.count}`,
        payload.diamondCount ? `单价 ${payload.diamondCount}` : "",
        payload.baseScore ? `基础 ${payload.baseScore}` : "",
        `实际 ${payload.fanTicket || 0}`,
        payload.bonusScore ? `加成 +${payload.bonusScore}${payload.bonusRate ? ` x${payload.bonusRate.toFixed(2)}` : ""}` : "",
        payload.roomFanTicketCount ? `房间累计 ${payload.roomFanTicketCount}` : "",
        payload.clientGiftSource ? `来源 ${payload.clientGiftSource}` : "",
      ].filter(Boolean).join(" / ");
      appendMonitorLogs([{
        at: new Date(payload.at).toLocaleTimeString("zh-CN", { hour12: false }),
        type: "gift",
        name: monitorName(payload),
        userId: payload.userId || payload.uniqueId || payload.secUid || "",
        value: String(payload.fanTicket || ""),
        detail: [monitorIdentityDetail(payload), giftDetail]
          .filter(Boolean)
          .join(" / "),
      }]);
    }) ?? (() => undefined);
    const offMember = api?.onLivePkMember?.((payload: LivePkMemberPayload) => {
      appendMonitorLogs([{
        at: new Date(payload.at).toLocaleTimeString("zh-CN", { hour12: false }),
        type: "member",
        name: monitorName(payload),
        userId: payload.userId || payload.uniqueId || payload.secUid || "",
        value: payload.memberCount ? String(payload.memberCount) : "",
        detail: monitorIdentityDetail(payload),
      }]);
    }) ?? (() => undefined);
    const offChat = api?.onLivePkChat?.((payload: LivePkChatPayload) => {
      appendMonitorLogs([{
        at: new Date(payload.at).toLocaleTimeString("zh-CN", { hour12: false }),
        type: "chat",
        name: monitorName(payload),
        userId: payload.userId || payload.uniqueId || payload.secUid || "",
        value: "",
        detail: [
          monitorIdentityDetail(payload),
          payload.content,
          payload.priorityLevel ? `优先级 ${payload.priorityLevel}` : "",
        ].filter(Boolean).join(" / "),
      }]);
    }) ?? (() => undefined);
    const offEvent = api?.onLivePkEvent?.((payload: LivePkEventPayload) => {
      appendMonitorLogs([{
        at: new Date(payload.at).toLocaleTimeString("zh-CN", { hour12: false }),
        type: "event",
        name: payload.nickname || eventLabel(payload.eventType),
        userId: payload.userId || payload.uniqueId || payload.secUid || "",
        value: monitorEventValue(payload),
        detail: monitorEventDetail(payload),
      }]);
    }) ?? (() => undefined);
    return () => {
      offGift();
      offMember();
      offChat();
      offEvent();
    };
  }, [appendMonitorLogs]);

  if (unavailable) return <Wrap><BrowserModeState /></Wrap>;
  if (loading && !data) return <Wrap><LoadingState label="正在加载星嗨争霸赛…" /></Wrap>;
  if (error && !data) return <Wrap><ErrorState message={error} onRetry={fetchData} /></Wrap>;
  if (!data) return <Wrap><EmptyState label="暂无赛事数据" /></Wrap>;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
              <Sparkles className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-black tracking-normal">星嗨争霸赛</h2>
              <div className="mt-1 flex flex-wrap gap-2">
                <Badge variant="secondary">{period}</Badge>
                <Badge variant="outline">{roundMeta.label}</Badge>
                <Badge variant={invalidGrouping ? "destructive" : "outline"}>
                  {invalidGrouping ? "人数不满足分组" : `${currentGroups.length} 组`}
                </Badge>
                <Badge variant="secondary">
                  沿用PK 15号名单 {allMembers.length}人
                </Badge>
                {includeResolution.unmatchedNames.length > 0 && (
                  <Badge variant="destructive">
                    未匹配 {includeResolution.unmatchedNames.length}人
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="icon" variant="outline" onClick={() => setPeriod(shiftPeriod(period, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="h-9 w-40 bg-background/80"
            />
            <Button size="icon" variant="outline" onClick={() => setPeriod(shiftPeriod(period, 1))}>
              <ChevronRight className="size-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPeriod(currentPeriod())}>
              本月
            </Button>
            <Button size="sm" variant="outline" onClick={fetchData} disabled={loading}>
              <RefreshCw className="size-4" />
              刷新
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBulkOpen((value) => !value)}>
              <ClipboardPaste className="size-4" />
              批量录分
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.dispatchEvent(new CustomEvent("app:navigate", { detail: "douyin-monitor" }))}
            >
              <RefreshCw className={`size-4 ${monitorStatus.status === "running" ? "animate-spin" : ""}`} />
              直播监控
            </Button>
            <Button
              size="sm"
              variant={notesOpen ? "default" : "outline"}
              onClick={() => setNotesOpen((value) => !value)}
            >
              备注
            </Button>
            <Button size="sm" onClick={exportCurrentGroups} disabled={exporting || currentGroups.length === 0}>
              <Download className="size-4" />
              {exporting ? "导出中" : "导出图片"}
            </Button>
            {saveMessage && <span className="text-xs font-semibold text-muted-foreground">{saveMessage}</span>}
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
          <div className="flex flex-wrap gap-2">
            {BATTLE_ROUNDS.map((round) => (
              <Button
                key={round.key}
                size="sm"
                variant={roundKey === round.key ? "default" : "outline"}
                onClick={() => setRoundKey(round.key)}
              >
                {round.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={groupPage <= 0}
              onClick={() => setGroupPage((page) => Math.max(0, page - 1))}
            >
              <ChevronLeft className="size-4" />
              上一页
            </Button>
            <span className="min-w-16 text-center text-xs font-semibold text-muted-foreground">
              {groupPage + 1} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={groupPage >= totalPages - 1}
              onClick={() => setGroupPage((page) => Math.min(totalPages - 1, page + 1))}
            >
              下一页
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

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
                    <Button size="sm" variant="outline" onClick={fillManualToTotal}>
                      按当前人数生成
                    </Button>
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
                        ? "使用内置 7 组固定名单（8+8+8+8+7+7+7），不随音浪实时重排。"
                        : groupPlan.sortMode === "top_wave_rest_volatility"
                          ? "前两组按总音浪排名截取；其余按日振幅/去峰日均排序，波动大的优先同组。"
                          : "所有组都按总音浪从高到低连续切分。"}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {bulkOpen && (
          <Card>
            <CardContent className="space-y-3 py-4">
              <textarea
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                placeholder="粘贴 PK 页面文本，例如：狼某 1280。系统会按当前轮次人员姓名或抖音ID匹配分数。"
                className="min-h-28 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={applyBulkScores}>
                  保存匹配到的分数
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBulkText("")}>
                  清空文本
                </Button>
                <span className="text-xs text-muted-foreground">
                  复制 PK 页面文本后可一次匹配当前轮次人员。
                </span>
              </div>
            </CardContent>
          </Card>
        )}
        {monitorOpen && (
          <Card>
            <CardContent className="space-y-3 py-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  value={monitorUrl}
                  onChange={(event) => setMonitorUrl(event.target.value)}
                  placeholder="抖音直播间地址，例如 https://live.douyin.com/xxxx"
                />
                <Button
                  size="sm"
                  onClick={startBuiltInMonitor}
                  disabled={monitorStatus.status === "connecting" || monitorStatus.status === "running"}
                >
                  内置监控
                </Button>
              </div>
              {manualMonitorOpen && (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <Input
                    value={monitorWs}
                    onChange={(event) => setMonitorWs(event.target.value)}
                    placeholder="备用：WebSocket 地址，包含 webcast/im/push"
                  />
                  <textarea
                    value={monitorCookie}
                    onChange={(event) => setMonitorCookie(event.target.value)}
                    placeholder="备用：Cookie；填了以后内置监控和手动连接都会使用"
                    className="min-h-20 rounded-md border border-input bg-background/80 px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={startMonitor}
                  disabled={monitorStatus.status === "connecting" || monitorStatus.status === "running"}
                  variant="outline"
                >
                  手动连接
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setManualMonitorOpen((value) => !value)}>
                  {manualMonitorOpen ? "收起备用" : "备用输入"}
                </Button>
                <Button size="sm" variant="outline" onClick={stopMonitor}>
                  停止
                </Button>
                <Badge variant={monitorStatus.status === "running" ? "default" : "outline"}>
                  {monitorStatus.status === "running"
                    ? "监控中"
                    : monitorStatus.status === "connecting"
                      ? "连接中"
                      : monitorStatus.status === "error"
                        ? "错误"
                        : "未启动"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {monitorMessage || monitorStatus.lastError || "收到直播排行后自动写入当前轮次分数"}
                </span>
              </div>
              <div className="rounded-lg border border-border bg-muted/20">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <div className="text-sm font-bold">监控输出</div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{monitorLogs.length} 条</Badge>
                    <Button size="sm" variant="outline" onClick={exportMonitorLogs} disabled={monitorLogs.length === 0}>
                      导出CSV
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMonitorLogs([])} disabled={monitorLogs.length === 0}>
                      清空
                    </Button>
                  </div>
                </div>
                <div className="max-h-56 overflow-auto p-2">
                  {monitorLogs.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                      暂无输出，启动监控后会持续显示分数、进场、礼物和弹幕。
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {monitorLogs.slice(0, 80).map((row) => (
                        <div
                          key={row.id}
                          className="grid grid-cols-[70px_52px_minmax(80px,120px)_90px_minmax(0,1fr)] gap-2 rounded-md bg-background px-2 py-1.5 text-xs"
                        >
                          <span className="text-muted-foreground">{row.at}</span>
                          <span className="font-bold">
                            {row.type === "score" ? "分数" : row.type === "gift" ? "礼物" : row.type === "chat" ? "弹幕" : row.type === "member" ? "进场" : "状态"}
                          </span>
                          <span className="truncate font-semibold">{row.name}</span>
                          <span className="truncate text-right font-bold">{row.value}</span>
                          <span className="truncate text-muted-foreground">{row.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {currentGroups.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleGroups.map((group) => (
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
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <div className="text-base font-bold">{roundMeta.label}暂无名单</div>
              <div className="mt-2 text-sm text-muted-foreground">{roundHint}，请先录入上一轮分数。</div>
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
  const noteLines = String(notes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div ref={ref} className="bg-slate-50 p-8" style={{ width: 1280 }}>
      <div className="mb-6 flex items-end justify-between border-b border-slate-200 pb-4">
        <div>
          <div className="text-3xl font-black text-slate-950">星嗨争霸赛</div>
          <div className="mt-2 text-sm font-semibold text-slate-500">
            {period} · {roundLabel}
          </div>
        </div>
        <div className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
          {groups.length} 组
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {groups.map((group) => {
          const displayMembers = groupHasScore(group, scoreMap, scoreDrafts, roundKey)
            ? rankGroupMembers(group, scoreMap, scoreDrafts, roundKey)
            : group.members;
          return (
            <div key={group.key} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-lg font-black text-slate-950">{group.label}</div>
                <div className="text-xs font-bold text-slate-500">{group.members.length}人</div>
              </div>
              <div className="space-y-2">
                {displayMembers.map((member, index) => {
                  const score = getScoreValue(scoreMap, scoreDrafts, roundKey, group.key, member.personId);
                  return (
                    <div
                      key={member.personId}
                      className="grid grid-cols-[42px_minmax(0,1fr)_90px] items-center gap-3 rounded-xl bg-slate-50 px-3 py-2"
                    >
                      <div className="flex size-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-black text-white">
                        {index + 1}
                      </div>
                      <div className="truncate text-base font-bold text-slate-900">{member.name}</div>
                      <div className="text-right text-base font-black text-slate-950">
                        {score > 0 ? score : "-"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {noteLines.length > 0 && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="mb-2 text-sm font-black tracking-wide text-amber-900">备注</div>
          <div className="space-y-1.5 text-sm font-semibold leading-6 text-amber-950">
            {noteLines.map((line, index) => (
              <div key={`${index}-${line}`}>{line}</div>
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
}: {
  group: BattleGroup;
  roundKey: string;
  scoreDrafts: Record<string, string>;
  scoreMap: Map<string, number>;
  savingKey: string | null;
  onDraftChange: (groupKey: string, personId: number, value: string) => void;
  onSave: (groupKey: string, personId: number, value: string) => void;
  onQuickAdd: (groupKey: string, personId: number, delta: number) => void;
}) {
  const groupScore = group.members.reduce((sum, member) => {
    const key = scoreKey(roundKey, group.key, member.personId);
    return sum + Number(scoreDrafts[key] || scoreMap.get(key) || 0);
  }, 0);
  const avgScore = group.members.length > 0 ? groupScore / group.members.length : 0;
  const scored = groupHasScore(group, scoreMap, scoreDrafts, roundKey);
  const displayMembers = scored
    ? rankGroupMembers(group, scoreMap, scoreDrafts, roundKey)
    : group.members;
  const rankByPerson = new Map(displayMembers.map((member, index) => [member.personId, index + 1]));

  const rankLabel = (rank: number) => {
    if (!scored) return "";
    if (roundKey === "group") {
      if (rank === 1) return "晋级";
      if (rank === 2) return "复活";
    }
    if (roundKey === "revival" && rank === 1) return "晋级";
    if (roundKey === "promotion" && rank === 1) return "决赛";
    if (roundKey === "final" && rank === 1) return "冠军";
    return "";
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60 bg-muted/30 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" />
            {group.label}
          </CardTitle>
          <Badge variant="outline">
            {group.members.length}人 + 裁判
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>平均 {formatWave(group.averageWave)}</span>
          <span>本轮均分 {avgScore.toFixed(1)}</span>
          <span>裁判：待定</span>
          {group.source && <span>{group.source}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {displayMembers.map((member, index) => {
          const key = scoreKey(roundKey, group.key, member.personId);
          const draft = scoreDrafts[key] ?? "";
          const saving = savingKey === key;
          const label = rankLabel(rankByPerson.get(member.personId) || index + 1);
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
