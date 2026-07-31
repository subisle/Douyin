"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  ChevronDown,
  Cookie,
  Download,
  Eraser,
  FileJson,
  FileSpreadsheet,
  Gift,
  Grip,
  MessageSquareText,
  Monitor,
  Play,
  Swords,
  Square,
  Users,
  X,
} from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  MATCH_LEDGER_STORAGE_KEY,
  MATCH_LEDGER_UPDATED_EVENT,
} from "./monitor-score-sync";
import type {
  IpcResult,
  LivePkChatPayload,
  LivePkEmbeddedBounds,
  LivePkEmbeddedState,
  LivePkEventPayload,
  LivePkGiftPayload,
  LivePkMemberPayload,
  LivePkMonitorStatus,
  LivePkRankPayload,
} from "@/types/electron";

type MonitorLogType = "rank" | "gift" | "chat" | "member" | "event" | "status";
type MonitorFilter = "all" | MonitorLogType | "user" | "score";
type MonitorMatchMode = "pk" | "linkmic" | "single" | "unknown";

interface MonitorLogRow {
  id: string;
  at: string;
  type: MonitorLogType;
  label: string;
  name: string;
  userId: string;
  value: string;
  detail: string;
  payload: unknown;
}
interface MonitorRoomAppearance {
  roomLabel: string;
  roomId: string;
  anchorId: string;
}

interface MonitorUserRow {
  key: string;
  nickname: string;
  displayName: string;
  realName: string;
  douyinId: string;
  userId: string;
  secUid: string;
  webcastUid: string;
  userLevel: number;
  badgeLevel: number;
  consumeLevel: number;
  wealthLevel: number;
  fansClubLevel: number;
  honorLevel: number;
  payScore: number;
  fanTicketCount: number;
  totalRechargeDiamondCount: number;
  gender: number;
  followStatus: number;
  ipLocation: string;
  followerCount: number;
  isMystery: boolean;
  cacheHit: boolean;
  hasStrongIdentity: boolean;
  identitySource: string;
  lastAt: string;
  lastType: MonitorLogType;
  chats: number;
  gifts: number;
  giftNames: string[];
  members: number;
  fanTicket: number;
  roomAppearances: MonitorRoomAppearance[];
}

interface MonitorRoomInfo {
  roomId: string;
  title: string;
  ownerNickname: string;
  ownerUserId: string;
  ownerDouyinId: string;
  ownerDouyinIdSource: string;
  ownerWebRid: string;
  ownerSecUid: string;
  onlineText: string;
  likeCount: number;
  roomFanTicket: number;
  updatedAt: string;
}

interface MonitorScoreRow {
  anchorId: string;
  name: string;
  uniqueId: string;
  score: number;
  scoreText: string;
  scoreRelative: boolean;
  multiPkTeamScore: number;
  source: string;
}

interface MonitorRoundRow {
  round: number;
  battleId: string;
  mode: MonitorMatchMode;
  modeLabel: string;
  phase: string;
  status: "running" | "finished";
  startedAt: string;
  endedAt: string;
  scores: MonitorScoreRow[];
  winnerId: string;
  winnerName: string;
}

interface MonitorLiveState {
  mode: string;
  modeLabel: string;
  isPkActive: boolean;
  isLinkmic: boolean;
  participantCount: number;
  battleId: string;
  channelId: string;
  countdown: number;
  hasOfficialCountdown: boolean;
  phase: string;
  matchStatus: "idle" | "running" | "finished";
  scores: MonitorScoreRow[];
  rounds: MonitorRoundRow[];
  currentMatchStartedAt: string;
  updatedAt: string;
}

const FILTERS: { key: MonitorFilter; label: string }[] = [
  { key: "score", label: "分数监控" },
  { key: "all", label: "全部" },
  { key: "gift", label: "礼物" },
  { key: "chat", label: "弹幕" },
  { key: "member", label: "进/离" },
  { key: "event", label: "事件" },
  { key: "user", label: "用户" },
];
const USER_CACHE_STORAGE_KEY = "douyin-monitor-user-cache-v1";
/** 争霸赛默认单场时长（秒） */
const MATCH_DURATION_SEC = 10 * 60;
/** 事件流保留条数；分数场次另有独立 ledger，不依赖此上限 */
const MONITOR_LOG_LIMIT = 2500;
const MATCH_LEDGER_LIMIT = 80;

function formatTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toLocaleTimeString("zh-CN", { hour12: false })
    : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function safeText(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function safeNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function safeBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function compactNumber(value: unknown) {
  const number = safeNumber(value);
  if (number >= 100000000) return `${(number / 100000000).toFixed(1)}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`;
  return String(number || 0);
}

function countdownText(value: unknown) {
  const seconds = Math.max(0, safeNumber(value));
  if (seconds < 60) return `${seconds.toFixed(seconds < 20 ? 1 : 0)}秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}分${rest.toFixed(1)}秒`;
}

function compactId(value: string) {
  if (!value) return "-";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function moneyText(value: number) {
  return `¥${value.toFixed(2)}`;
}

function giftMoney(user: Pick<MonitorUserRow, "fanTicket">) {
  return user.fanTicket / 10;
}

function giftTier(user: Pick<MonitorUserRow, "fanTicket" | "gifts">) {
  if (user.gifts <= 0) return "";
  const amount = giftMoney(user);
  if (amount >= 1000) return "1000+";
  if (amount >= 500) return "500+";
  if (amount >= 100) return "100+";
  return "";
}

function levelText(user: Pick<MonitorUserRow, "wealthLevel" | "consumeLevel">) {
  const level = user.wealthLevel || user.consumeLevel;
  return level ? `财富 ${level}` : "-";
}

function userLevelSummary(user: Pick<MonitorUserRow, "wealthLevel" | "consumeLevel" | "fansClubLevel" | "userLevel" | "badgeLevel">) {
  const levels = [
    user.wealthLevel || user.consumeLevel ? `财富${user.wealthLevel || user.consumeLevel}` : "",
    user.fansClubLevel ? `粉丝团${user.fansClubLevel}` : "",
    user.userLevel ? `用户${user.userLevel}` : "",
    user.badgeLevel ? `徽章${user.badgeLevel}` : "",
  ].filter(Boolean);
  return levels.length ? levels.join(" / ") : "-";
}

function giftNameFromPayload(payload: Record<string, unknown>) {
  return safeText(payload.giftName) || safeText(payload.giftId) || "礼物";
}

function giftCountFromPayload(payload: Record<string, unknown>) {
  return Math.max(1, safeNumber(payload.count) || safeNumber(payload.totalCount) || safeNumber(payload.repeatCount) || safeNumber(payload.comboCount));
}

function giftFanTicketFromPayload(payload: Record<string, unknown>) {
  return Math.max(0, safeNumber(payload.fanTicket));
}

function giftLabelFromPayload(payload: Record<string, unknown>, count = giftCountFromPayload(payload)) {
  const giftName = giftNameFromPayload(payload);
  return `${giftName} x${Math.max(1, count)}`;
}

function giftStreakKey(payload: Record<string, unknown>) {
  const owner =
    safeText(payload.userId) ||
    safeText(payload.secUid) ||
    safeText(payload.uniqueId) ||
    safeText(payload.webcastUid) ||
    safeText(payload.realName) ||
    safeText(payload.nickname) ||
    safeText(payload.displayName);
  const giftId = safeText(payload.giftId) || giftNameFromPayload(payload);
  // 仅在有连击/批次标识时做增量去重；免费礼物等无标识消息按整帧计入。
  const streak =
    safeText(payload.groupId) ||
    safeText(payload.logId) ||
    safeText(payload.traceId);
  if (!owner || !giftId || !streak) return "";
  return `${owner}|${giftId}|${streak}`;
}

function giftIncrementalFromPayload(
  payload: Record<string, unknown>,
  previous?: { count: number; fanTicket: number }
) {
  const count = giftCountFromPayload(payload);
  const fanTicket = giftFanTicketFromPayload(payload);
  if (!previous) {
    return {
      count,
      fanTicket,
      totalCount: count,
      totalFanTicket: fanTicket,
    };
  }
  // 新一轮连击（计数回落）时重新起算。
  if (count < previous.count || fanTicket < previous.fanTicket) {
    return {
      count,
      fanTicket,
      totalCount: count,
      totalFanTicket: fanTicket,
    };
  }
  return {
    count: Math.max(0, count - previous.count),
    fanTicket: Math.max(0, fanTicket - previous.fanTicket),
    totalCount: count,
    totalFanTicket: fanTicket,
  };
}

function summarizeGiftMetrics(logs: MonitorLogRow[]) {
  const streakState = new Map<string, { count: number; fanTicket: number }>();
  let gifts = 0;
  let fanTicket = 0;
  let roomFanTicket = 0;
  for (const row of logs.slice().reverse()) {
    if (row.type !== "gift") continue;
    const payload = row.payload as Record<string, unknown>;
    roomFanTicket = Math.max(roomFanTicket, safeNumber(payload.roomFanTicketCount));
    const key = giftStreakKey(payload);
    const previous = key ? streakState.get(key) : undefined;
    const incremental = giftIncrementalFromPayload(payload, previous);
    if (key) {
      streakState.set(key, {
        count: incremental.totalCount,
        fanTicket: incremental.totalFanTicket,
      });
    }
    gifts += incremental.count;
    fanTicket += incremental.fanTicket;
  }
  return {
    gifts,
    fanTicket: roomFanTicket > 0 ? roomFanTicket : fanTicket,
    roomFanTicket,
  };
}

function mergeGiftNames(...lists: string[][]) {
  const totals = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      const text = safeText(item);
      if (!text) continue;
      const match = text.match(/^(.*?)\s*x(\d+)$/i);
      const name = (match?.[1] || text).trim();
      const count = match ? Number(match[2] || 0) : 1;
      if (!name) continue;
      totals.set(name, (totals.get(name) || 0) + (Number.isFinite(count) && count > 0 ? count : 1));
    }
  }
  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([name, count]) => `${name} x${count}`);
}

function mergeRoomAppearances(...lists: MonitorRoomAppearance[][]) {
  const rooms = new Map<string, MonitorRoomAppearance>();
  for (const list of lists) {
    for (const item of list) {
      const roomId = safeText(item.roomId);
      const anchorId = safeText(item.anchorId);
      const roomLabel = safeText(item.roomLabel) || roomId || "抖音直播间";
      if (!roomId && !anchorId && !roomLabel) continue;
      const key = roomId || `${roomLabel}:${anchorId}`;
      const previous = rooms.get(key);
      rooms.set(key, {
        roomLabel: roomLabel || previous?.roomLabel || "抖音直播间",
        roomId: roomId || previous?.roomId || "",
        anchorId: anchorId || previous?.anchorId || "",
      });
    }
  }
  return Array.from(rooms.values());
}

function roomAppearanceFromPayload(payload: Record<string, unknown>, fallbackUrl = ""): MonitorRoomAppearance {
  const roomId = safeText(payload.roomId);
  const title = safeText(payload.title);
  const anchorId =
    safeText(payload.ownerDouyinId) ||
    safeText(payload.ownerUserId) ||
    safeText(payload.ownerWebRid) ||
    safeText(payload.ownerSecUid);
  const roomLabel = [
    title || fallbackUrl || "抖音直播间",
    roomId ? `直播间ID ${roomId}` : "",
  ].filter(Boolean).join(" / ");
  return { roomLabel, roomId, anchorId };
}

function exportRoomAppearanceText(rooms: MonitorRoomAppearance[]) {
  const labels = rooms
    .map((room) => {
      const label = safeText(room.roomLabel)
        .replace(/\s*\/\s*直播间ID\s*\S+/g, "")
        .replace(/直播间ID\s*\S+/g, "")
        .replace(/https?:\/\/live\.douyin\.com\/\S+/g, "抖音直播间")
        .trim();
      return label || "抖音直播间";
    })
    .filter(Boolean);
  const uniqueLabels = Array.from(new Set(labels));
  return uniqueLabels.length ? uniqueLabels.join("；") : "-";
}

function roomAnchorIdsText(rooms: MonitorRoomAppearance[]) {
  const ids = Array.from(new Set(rooms.map((room) => room.anchorId).filter(Boolean)));
  return ids.length ? ids.join("；") : "-";
}

function collectAnchorIdsFromRoomInfoPayload(payload: Record<string, unknown>) {
  return [
    payload.ownerDouyinId,
    payload.ownerUserId,
    payload.ownerWebRid,
    payload.ownerSecUid,
    payload.uniqueId,
    payload.userId,
    payload.webRid,
    payload.secUid,
  ].map(safeText).filter(Boolean);
}

function userMatchesAnyId(user: MonitorUserRow, ids: Set<string>) {
  if (ids.size === 0) return false;
  return [user.douyinId, user.userId, user.secUid, user.webcastUid, user.key]
    .map(safeText)
    .some((id) => id && ids.has(id));
}

function scoreNumber(value: unknown) {
  if (typeof value === "number") return value;
  const text = safeText(value).replace(/,/g, "").trim().toLowerCase();
  if (!text) return 0;
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const base = Number(match[0]);
  if (!Number.isFinite(base)) return 0;
  if (text.includes("亿")) return Math.round(base * 100000000);
  if (text.includes("万") || text.includes("w")) return Math.round(base * 10000);
  if (text.includes("k")) return Math.round(base * 1000);
  return Math.round(base);
}

function scoreFromPayload(value: unknown, source = ""): MonitorScoreRow | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const anchorId =
    safeText(payload.anchorId) ||
    safeText(payload.anchorID) ||
    safeText(payload.anchor_id) ||
    safeText(payload.userId) ||
    safeText(payload.userID) ||
    safeText(payload.user_id) ||
    safeText(payload.openId);
  if (!anchorId || anchorId === "0") return null;
  const name =
    safeText(payload.realName) ||
    safeText(payload.displayName) ||
    safeText(payload.nickname) ||
    safeText(payload.anchorName);
  const baseScoreText =
    safeText(payload.scoreText) ||
    safeText(payload.score_str);
  const teamScoreText = safeText(payload.multiPkTeamScoreText);
  const teamScore = scoreNumber(payload.multiPkTeamScore) || scoreNumber(teamScoreText);
  const baseScore = scoreNumber(payload.score) || scoreNumber(payload.hotScore) || scoreNumber(baseScoreText);
  const score = teamScore || baseScore;
  const scoreText = teamScoreText || (teamScore ? compactNumber(teamScore) : baseScoreText) || compactNumber(score);
  return {
    anchorId,
    name,
    uniqueId: safeText(payload.uniqueId) || safeText(payload.douyinId),
    score,
    scoreText,
    scoreRelative: safeBoolean(payload.scoreRelative),
    multiPkTeamScore: teamScore,
    source: source || safeText(payload.rankSource) || safeText(payload.identitySource),
  };
}

function scoreIdentityKey(score: MonitorScoreRow) {
  const visibleName = displayScoreName(score).replace(/\s+/g, "");
  if (visibleName && visibleName !== "未知用户") return `name:${visibleName}`;
  return `id:${score.anchorId}`;
}

function dedupeScoreRows(rows: MonitorScoreRow[]) {
  const scores = new Map<string, MonitorScoreRow>();
  for (const row of rows) {
    if (!hasEffectiveScore(row)) continue;
    const key = scoreIdentityKey(row);
    const previous = scores.get(key);
    if (!previous || row.score >= previous.score) scores.set(key, row);
  }
  return Array.from(scores.values());
}

function sameScoreRows(a: MonitorScoreRow[], b: MonitorScoreRow[]) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.anchorId !== right.anchorId ||
      left.name !== right.name ||
      left.uniqueId !== right.uniqueId ||
      left.score !== right.score ||
      left.scoreText !== right.scoreText ||
      left.multiPkTeamScore !== right.multiPkTeamScore
    ) {
      return false;
    }
  }
  return true;
}

function scoreSummary(scores: MonitorScoreRow[], limit = 9) {
  if (scores.length === 0) return "暂无";
  return scores
    .slice(0, limit)
    .map((score) => `${score.name || compactId(score.anchorId)} ${score.scoreText || compactNumber(score.score)}`)
    .join(" / ");
}

function scorePointText(score: MonitorScoreRow) {
  const value = score.scoreText || compactNumber(score.score);
  if (!value) return "0分";
  return /分|票|音浪/.test(value) ? value : `${value}分`;
}

function currentScoreSummary(scores: MonitorScoreRow[], limit = 9) {
  if (scores.length === 0) return "暂无";
  return scores
    .slice(0, limit)
    .map(scorePointText)
    .join(" / ");
}

function roundScoreSummary(round?: MonitorRoundRow) {
  if (!round || round.scores.length === 0) return "暂无";
  return currentScoreSummary(round.scores);
}

function hasEffectiveScore(score: MonitorScoreRow) {
  return score.score > 0 || scoreNumber(score.scoreText) > 0;
}

function rankedScores(scores: MonitorScoreRow[]) {
  return [...scores].sort((a, b) => b.score - a.score || a.anchorId.localeCompare(b.anchorId));
}

function winnerFromScores(scores: MonitorScoreRow[]) {
  const ranked = rankedScores(scores.filter(hasEffectiveScore));
  if (ranked.length === 0) return { winnerId: "", winnerName: "" };
  return {
    winnerId: ranked[0].anchorId,
    winnerName: displayScoreName(ranked[0]) || ranked[0].anchorId,
  };
}

function isTerminalBattlePhase(phase: string) {
  const value = phase.trim().toLowerCase();
  return ["punish", "end", "finish", "finished", "settled", "result", "settle", "over"].includes(value);
}

function isMatchFinishedPayload(payload: Record<string, unknown>) {
  const hasPkActive = Object.prototype.hasOwnProperty.call(payload, "isPkActive");
  const countdown = payload.pkCountDown === undefined ? null : safeNumber(payload.pkCountDown);
  const phase = safeText(payload.battlePhase);
  if (countdown !== null && countdown <= 0) return true;
  if (isTerminalBattlePhase(phase)) return true;
  if (hasPkActive && !safeBoolean(payload.isPkActive) && (countdown !== null || phase)) return true;
  return false;
}


function cloneScoreRow(score: MonitorScoreRow): MonitorScoreRow {
  return { ...score };
}

function mergeScoreMap(
  current: MonitorScoreRow[],
  next: MonitorScoreRow[],
  options: { replace?: boolean; onlyIncrease?: boolean } = {}
) {
  const map = new Map<string, MonitorScoreRow>();
  if (!options.replace) {
    current.forEach((score) => map.set(score.anchorId, cloneScoreRow(score)));
  }
  next.forEach((score) => {
    if (!score.anchorId) return;
    const previous = map.get(score.anchorId);
    if (!previous) {
      map.set(score.anchorId, cloneScoreRow(score));
      return;
    }
    const nextScore = options.onlyIncrease ? Math.max(previous.score, score.score) : score.score;
    map.set(score.anchorId, {
      ...previous,
      ...score,
      name: displayScoreName(score) ? score.name : previous.name,
      uniqueId: score.uniqueId || previous.uniqueId,
      score: nextScore,
      scoreText:
        nextScore === score.score
          ? (score.scoreText || previous.scoreText || compactNumber(nextScore))
          : (previous.scoreText || score.scoreText || compactNumber(nextScore)),
      multiPkTeamScore: Math.max(previous.multiPkTeamScore, score.multiPkTeamScore),
    });
  });
  return rankedScores(Array.from(map.values()));
}

function emptyMatchRound(partial: Partial<MonitorRoundRow> & Pick<MonitorRoundRow, "round" | "battleId">): MonitorRoundRow {
  return {
    round: partial.round,
    battleId: partial.battleId,
    mode: partial.mode || "unknown",
    modeLabel: partial.modeLabel || matchModeLabel(partial.mode || "unknown"),
    phase: partial.phase || "",
    status: partial.status || "running",
    startedAt: partial.startedAt || "",
    endedAt: partial.endedAt || "",
    scores: partial.scores || [],
    winnerId: partial.winnerId || "",
    winnerName: partial.winnerName || "",
  };
}

function decorateMatchRound(row: MonitorRoundRow, scores?: MonitorScoreRow[]): MonitorRoundRow {
  const nextScores = scores || row.scores;
  const winner = winnerFromScores(nextScores);
  return {
    ...row,
    scores: rankedScores(nextScores),
    winnerId: winner.winnerId,
    winnerName: winner.winnerName,
  };
}

function findLedgerRoundIndex(ledger: MonitorRoundRow[], battleId: string) {
  if (!battleId) return -1;
  for (let index = ledger.length - 1; index >= 0; index -= 1) {
    if (sameBattleId(ledger[index].battleId, battleId) || ledger[index].battleId === battleId) {
      return index;
    }
  }
  return -1;
}

function upsertMatchLedger(
  ledger: MonitorRoundRow[],
  payload: LivePkEventPayload | Record<string, unknown>,
  at = ""
): MonitorRoundRow[] {
  const eventType = safeText(payload.eventType);
  const battleId = safeText(payload.battleId) || safeText(payload.channelId);
  const nextScores = scoreRowsFromEvent(payload as LivePkEventPayload, eventType || "pk-score-snapshot");
  const finished = isMatchFinishedPayload(payload as Record<string, unknown>);
  const mode = matchModeFromLive({
    mode: safeText(payload.liveMode),
    isPkActive: safeBoolean(payload.isPkActive) || safeText(payload.liveMode) === "pk",
    isLinkmic: safeText(payload.liveMode) === "linkmic",
  });
  const phase = safeText(payload.battlePhase);
  const stamp = at || formatTime(safeText(payload.at));

  // 无关事件不入账
  if (
    eventType
    && !["pk-battle", "pk-score-snapshot", "linkmic-score", "live-mode"].includes(eventType)
  ) {
    return ledger;
  }
  if (!battleId && nextScores.length === 0 && !finished) {
    return ledger;
  }

  let next = ledger.map((row) => ({ ...row, scores: row.scores.map(cloneScoreRow) }));
  let index = battleId ? findLedgerRoundIndex(next, battleId) : -1;
  const activeIndex = [...next].map((row, i) => ({ row, i })).reverse().find((item) => item.row.status === "running")?.i ?? -1;

  // 新 battle：先结算上一场进行中的
  if (index < 0 && battleId && activeIndex >= 0) {
    const active = next[activeIndex];
    if (!sameBattleId(active.battleId, battleId) && active.battleId !== battleId) {
      next[activeIndex] = decorateMatchRound({
        ...active,
        status: "finished",
        endedAt: active.endedAt || stamp,
        phase: active.phase || phase,
      });
    } else {
      index = activeIndex;
    }
  }

  if (index < 0) {
    // 无有效分数且不是结束，不建空场
    if (nextScores.length === 0 && !finished && eventType === "live-mode") {
      return next;
    }
    const roundNo = next.length + 1;
    next.push(emptyMatchRound({
      round: roundNo,
      battleId: battleId || `round-${roundNo}`,
      mode: mode === "unknown" ? "pk" : mode,
      modeLabel: matchModeLabel(mode === "unknown" ? "pk" : mode),
      phase,
      status: finished ? "finished" : "running",
      startedAt: stamp,
      endedAt: finished ? stamp : "",
      scores: nextScores,
    }));
    index = next.length - 1;
  }

  const current = next[index];
  // 已锁定的最终分：只允许同 battle 分数抬升，不允许被空快照清空
  const mergedScores = mergeScoreMap(
    current.scores,
    nextScores,
    { onlyIncrease: true }
  );
  const shouldFinish = finished || current.status === "finished";
  next[index] = decorateMatchRound({
    ...current,
    battleId: preferBattleId(current.battleId, battleId) || current.battleId,
    mode: current.mode === "unknown" && mode !== "unknown" ? mode : current.mode,
    modeLabel: matchModeLabel(
      current.mode === "unknown" && mode !== "unknown" ? mode : current.mode
    ),
    phase: phase || current.phase,
    status: shouldFinish ? "finished" : "running",
    startedAt: current.startedAt || stamp,
    endedAt: shouldFinish ? (current.endedAt || stamp) : "",
    scores: mergedScores.length > 0 ? mergedScores : current.scores,
  });

  if (next.length > MATCH_LEDGER_LIMIT) {
    next = next.slice(next.length - MATCH_LEDGER_LIMIT);
    next = next.map((row, i) => ({ ...row, round: i + 1 }));
  }
  return next;
}

function mergeLiveRoundsWithLedger(
  logRounds: MonitorRoundRow[],
  ledger: MonitorRoundRow[]
): MonitorRoundRow[] {
  if (ledger.length === 0) return logRounds;
  if (logRounds.length === 0) return ledger;

  const merged: MonitorRoundRow[] = ledger.map((row) => decorateMatchRound({
    ...row,
    scores: row.scores.map(cloneScoreRow),
  }));

  logRounds.forEach((logRound) => {
    const index = logRound.battleId
      ? findLedgerRoundIndex(merged, logRound.battleId)
      : -1;
    if (index < 0) {
      // 日志里多出来的场次补进 ledger 视图
      if (logRound.scores.some(hasEffectiveScore) || logRound.mode === "pk" || logRound.mode === "linkmic") {
        merged.push(decorateMatchRound({
          ...logRound,
          round: merged.length + 1,
          scores: logRound.scores.map(cloneScoreRow),
        }));
      }
      return;
    }
    const base = merged[index];
    // ledger 已 finished 时以 ledger 分数为准，并吸收日志里更高分
    const scores = mergeScoreMap(base.scores, logRound.scores, { onlyIncrease: true });
    merged[index] = decorateMatchRound({
      ...base,
      mode: base.mode === "unknown" ? logRound.mode : base.mode,
      modeLabel: base.mode === "unknown" ? logRound.modeLabel : base.modeLabel,
      phase: base.phase || logRound.phase,
      status: base.status === "finished" || logRound.status === "finished" ? "finished" : "running",
      startedAt: base.startedAt || logRound.startedAt,
      endedAt: base.endedAt || logRound.endedAt,
      scores,
    });
  });

  return merged.map((row, index) => ({ ...row, round: index + 1 }));
}

function loadMatchLedger(): MonitorRoundRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MATCH_LEDGER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row, index) => {
        if (!row || typeof row !== "object") return null;
        const item = row as Partial<MonitorRoundRow>;
        const scores = Array.isArray(item.scores)
          ? item.scores.map((score) => scoreFromPayload(score, "ledger")).filter(Boolean) as MonitorScoreRow[]
          : [];
        return decorateMatchRound(emptyMatchRound({
          round: safeNumber(item.round) || index + 1,
          battleId: safeText(item.battleId) || `round-${index + 1}`,
          mode: (item.mode as MonitorMatchMode) || "unknown",
          modeLabel: safeText(item.modeLabel),
          phase: safeText(item.phase),
          status: item.status === "finished" ? "finished" : "running",
          startedAt: safeText(item.startedAt),
          endedAt: safeText(item.endedAt),
          scores,
        }));
      })
      .filter(Boolean) as MonitorRoundRow[];
  } catch {
    return [];
  }
}

function notifyMatchLedgerUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MATCH_LEDGER_UPDATED_EVENT));
}

function saveMatchLedger(ledger: MonitorRoundRow[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MATCH_LEDGER_STORAGE_KEY, JSON.stringify(ledger.slice(-MATCH_LEDGER_LIMIT)));
    notifyMatchLedgerUpdated();
  } catch {
    // ignore quota
  }
}


function matchModeFromLive({
  mode,
  isPkActive,
  isLinkmic,
}: {
  mode?: string;
  isPkActive?: boolean;
  isLinkmic?: boolean;
}): MonitorMatchMode {
  if (isPkActive || mode === "pk") return "pk";
  if (isLinkmic || mode === "linkmic") return "linkmic";
  if (mode === "single" || mode === "normal") return "single";
  return "unknown";
}

function matchModeLabel(mode: MonitorMatchMode) {
  if (mode === "pk") return "PK";
  if (mode === "linkmic") return "连麦";
  if (mode === "single") return "单人";
  return "未知";
}

function parseClockToMs(value: string) {
  const text = safeText(value).trim();
  if (!text) return Number.NaN;
  const full = Date.parse(text);
  if (Number.isFinite(full)) return full;
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return Number.NaN;
  const now = new Date();
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number(match[1]),
    Number(match[2]),
    Number(match[3] || 0),
    0
  );
  return next.getTime();
}

function formatElapsed(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function preferredAnchorId(score: MonitorScoreRow, roomInfo?: MonitorRoomInfo | null) {
  if (!roomInfo) return score.anchorId;
  const candidates = [
    roomInfo.ownerUserId,
    roomInfo.ownerDouyinId,
    roomInfo.ownerWebRid,
    roomInfo.ownerSecUid,
  ].filter(Boolean);
  if (candidates.includes(score.anchorId)) {
    return roomInfo.ownerUserId || roomInfo.ownerDouyinId || score.anchorId;
  }
  return score.anchorId;
}

function mergeScoreRows(
  current: MonitorScoreRow[],
  next: MonitorScoreRow[],
  replace = false
) {
  if (next.length === 0) return current;
  if (replace) return dedupeScoreRows(next);
  const scores = new Map(current.map((score) => [scoreIdentityKey(score), score]));
  next.forEach((score) => scores.set(scoreIdentityKey(score), score));
  return dedupeScoreRows(Array.from(scores.values()));
}

function scoreRowsFromEvent(payload: LivePkEventPayload, source = "") {
  if (Array.isArray(payload.scores)) {
    return dedupeScoreRows(payload.scores.map((score) => scoreFromPayload(score, source)).filter(Boolean) as MonitorScoreRow[]);
  }
  const score = scoreFromPayload(payload, source);
  return score ? [score] : [];
}

function isAnchorScoreRankPayload(payload: LivePkRankPayload | Record<string, unknown>) {
  return (
    payload.interactionScoreStatus !== undefined ||
    payload.interactionScoreAction !== undefined ||
    safeText(payload.rankSource) === "interaction-score"
  );
}

function scoreRowsFromRankPayload(payload: LivePkRankPayload) {
  if (!isAnchorScoreRankPayload(payload)) return [];
  return dedupeScoreRows(payload.ranks.map((rank) => scoreFromPayload(rank, "interaction-score")).filter(Boolean) as MonitorScoreRow[]);
}

function sameBattleId(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (!/^\d{16,}$/.test(a) || !/^\d{16,}$/.test(b)) return false;
  if (a.slice(0, 12) !== b.slice(0, 12)) return false;
  try {
    const diff = BigInt(a) - BigInt(b);
    return diff * diff <= BigInt(100000000);
  } catch {
    return false;
  }
}

function preferBattleId(current: string, next: string) {
  if (!next) return current;
  if (!current) return next;
  if (!sameBattleId(current, next)) return current;
  if (/0{3,}$/.test(current) && !/0{3,}$/.test(next)) return next;
  return current;
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

function looksMaskedName(value: string) {
  const text = value.trim();
  return !text || text === "未知" || /[*＊]/.test(text);
}

function looksGarbledName(value: string) {
  const text = value.trim();
  if (!text) return true;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) return true;
  if (/[�ÃÂÐÑåäöøæ]/.test(text)) return true;
  const letters = text.match(/[A-Za-z]/g)?.length || 0;
  const oddLatin = text.match(/[À-ÿ]/g)?.length || 0;
  return oddLatin > 0 && oddLatin + letters >= Math.max(2, text.length - 1);
}

function displayScoreName(score: MonitorScoreRow) {
  const name = score.name.trim();
  return looksGarbledName(name) || looksMaskedName(name) ? "" : name;
}

function realUserName(user: MonitorUserRow) {
  const candidates = [user.realName, user.nickname, user.displayName]
    .map((value) => value.trim())
    .filter(Boolean);
  return candidates.find((value) => !looksMaskedName(value) && !looksGarbledName(value)) || candidates[0] || "未知用户";
}

function hasInternalIdentity(user: Pick<MonitorUserRow, "userId" | "secUid" | "webcastUid">) {
  const userId = user.userId.trim();
  return Boolean(user.secUid || user.webcastUid || (userId && userId !== "111111"));
}

function logIdentityText(row: MonitorLogRow) {
  const payload = row.payload as { uniqueId?: string } | undefined;
  if (payload?.uniqueId) return payload.uniqueId;
  return row.userId ? "已关联" : "-";
}

function identityStatus(user: MonitorUserRow) {
  if (user.douyinId) return { label: "抖音号", tone: "default" as const };
  if (hasInternalIdentity(user)) return { label: "已关联", tone: "secondary" as const };
  return { label: "待补全", tone: "outline" as const };
}

function identityValue(user: MonitorUserRow) {
  if (user.douyinId) return user.douyinId;
  if (hasInternalIdentity(user)) return "内部记录";
  return "-";
}

function userKey(payload: Partial<MonitorUserRow> & {
  uniqueId?: string;
  webcastUid?: string;
}) {
  return (
    payload.userId ||
    payload.secUid ||
    payload.uniqueId ||
    payload.douyinId ||
    payload.webcastUid ||
    payload.realName ||
    payload.nickname ||
    payload.displayName ||
    ""
  );
}

function hasStrongIdentity(payload: {
  userId?: string;
  secUid?: string;
  uniqueId?: string;
  webcastUid?: string;
  douyinId?: string;
}) {
  const userId = String(payload.userId || "").trim();
  return Boolean(
    payload.secUid ||
    payload.uniqueId ||
    payload.douyinId ||
    payload.webcastUid ||
    (userId && userId !== "111111")
  );
}

function identitySourceFor(type: MonitorLogType, payload: Record<string, unknown>) {
  const explicitSource = safeText(payload.identitySource);
  if (explicitSource) return explicitSource;
  if (type === "gift" && hasStrongIdentity({
    userId: safeText(payload.userId),
    secUid: safeText(payload.secUid),
    uniqueId: safeText(payload.uniqueId),
    webcastUid: safeText(payload.webcastUid),
  })) {
    return "礼物消息";
  }
  if (safeText(payload.uniqueId)) return "抖音号字段";
  if (safeText(payload.secUid)) return "sec_uid";
  if (safeText(payload.webcastUid)) return "webcast_uid";
  if (safeText(payload.userId)) return "用户ID";
  return "";
}

function userFromPayload(
  payload: Record<string, unknown>,
  type: MonitorLogType,
  at: string
): MonitorUserRow | null {
  const nickname = safeText(payload.nickname);
  const displayName = safeText(payload.displayName);
  const realName = safeText(payload.realName);
  const douyinId = safeText(payload.uniqueId);
  const userId = safeText(payload.userId);
  const secUid = safeText(payload.secUid);
  const webcastUid = safeText(payload.webcastUid);
  const key = userKey({ userId, secUid, douyinId, webcastUid, realName, nickname, displayName });
  if (!key || key === "未知") return null;
  const fanTicket = Number(payload.fanTicket || 0);
  const strongIdentity =
    payload.hasStrongIdentity === true || hasStrongIdentity({ userId, secUid, douyinId, webcastUid });
  return {
    key,
    nickname: monitorName({
      nickname,
      realName,
      displayName,
      isMystery: Boolean(payload.isMystery),
    }),
    displayName,
    realName,
    douyinId,
    userId,
    secUid,
    webcastUid,
    userLevel: Number(payload.userLevel || 0),
    badgeLevel: Number(payload.badgeLevel || 0),
    consumeLevel: Number(payload.consumeLevel || 0),
    wealthLevel: Number(payload.wealthLevel || 0),
    fansClubLevel: Number(payload.fansClubLevel || 0),
    honorLevel: Number(payload.honorLevel || 0),
    payScore: Number(payload.payScore || 0),
    fanTicketCount: Number(payload.fanTicketCount || 0),
    totalRechargeDiamondCount: Number(payload.totalRechargeDiamondCount || 0),
    gender: Number(payload.gender || 0),
    followStatus: Number(payload.followStatus || 0),
    ipLocation: safeText(payload.ipLocation),
    followerCount: Number(payload.followerCount || 0),
    isMystery: Boolean(payload.isMystery),
    cacheHit: Boolean(payload.cacheHit),
    hasStrongIdentity: strongIdentity,
    identitySource: identitySourceFor(type, payload),
    lastAt: at,
    lastType: type,
    chats: type === "chat" ? 1 : 0,
    gifts: type === "gift" ? Math.max(0, safeNumber(payload.__giftDeltaCount) || giftCountFromPayload(payload)) : 0,
    giftNames: type === "gift"
      ? [giftLabelFromPayload(payload, Math.max(0, safeNumber(payload.__giftDeltaCount) || giftCountFromPayload(payload)))].filter(Boolean)
      : [],
    members: type === "member" ? 1 : 0,
    fanTicket: type === "gift"
      ? Math.max(0, safeNumber(payload.__giftDeltaFanTicket) || fanTicket)
      : fanTicket,
    roomAppearances: [],
  };
}

function mergeUserRow(previous: MonitorUserRow | undefined, next: MonitorUserRow) {
  if (!previous) return next;
  const prefer = (a: string, b: string) => a || b;
  const nextHasInteraction = next.chats > 0 || next.gifts > 0 || next.members > 0 || next.fanTicket > 0;
  return {
    ...previous,
    nickname: prefer(next.nickname !== "未知" ? next.nickname : "", previous.nickname) || "未知",
    displayName: prefer(next.displayName, previous.displayName),
    realName: prefer(next.realName, previous.realName),
    douyinId: prefer(next.douyinId, previous.douyinId),
    userId: prefer(next.userId, previous.userId),
    secUid: prefer(next.secUid, previous.secUid),
    webcastUid: prefer(next.webcastUid, previous.webcastUid),
    userLevel: Math.max(previous.userLevel, next.userLevel),
    badgeLevel: Math.max(previous.badgeLevel, next.badgeLevel),
    consumeLevel: Math.max(previous.consumeLevel, next.consumeLevel),
    wealthLevel: Math.max(previous.wealthLevel, next.wealthLevel),
    fansClubLevel: Math.max(previous.fansClubLevel, next.fansClubLevel),
    honorLevel: Math.max(previous.honorLevel, next.honorLevel),
    payScore: Math.max(previous.payScore, next.payScore),
    fanTicketCount: Math.max(previous.fanTicketCount, next.fanTicketCount),
    totalRechargeDiamondCount: Math.max(
      previous.totalRechargeDiamondCount,
      next.totalRechargeDiamondCount
    ),
    ipLocation: prefer(next.ipLocation, previous.ipLocation),
    followerCount: Math.max(previous.followerCount, next.followerCount),
    gender: Math.max(previous.gender, next.gender),
    followStatus: Math.max(previous.followStatus, next.followStatus),
    isMystery: previous.isMystery || next.isMystery,
    cacheHit: previous.cacheHit || next.cacheHit,
    hasStrongIdentity: previous.hasStrongIdentity || next.hasStrongIdentity,
    identitySource: prefer(next.identitySource, previous.identitySource),
    lastAt: next.lastAt || previous.lastAt,
    lastType: nextHasInteraction ? next.lastType || previous.lastType : previous.lastType,
    chats: previous.chats + next.chats,
    gifts: previous.gifts + next.gifts,
    giftNames: mergeGiftNames(previous.giftNames, next.giftNames),
    members: previous.members + next.members,
    fanTicket: previous.fanTicket + next.fanTicket,
    roomAppearances: mergeRoomAppearances(previous.roomAppearances, next.roomAppearances),
  };
}

function userWithRoom(user: MonitorUserRow, room: MonitorRoomAppearance | null) {
  if (!room) return user;
  return {
    ...user,
    roomAppearances: mergeRoomAppearances(user.roomAppearances, [room]),
  };
}

function hasCachedUserActivity(user: Pick<MonitorUserRow, "chats" | "gifts" | "members" | "fanTicket" | "giftNames">) {
  return (
    safeNumber(user.chats) > 0 ||
    safeNumber(user.gifts) > 0 ||
    safeNumber(user.members) > 0 ||
    safeNumber(user.fanTicket) > 0 ||
    user.giftNames.length > 0
  );
}

function normalizeCachedUser(value: unknown): MonitorUserRow | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Partial<MonitorUserRow>;
  const douyinId = safeText(user.douyinId);
  if (!douyinId) return null;
  const cachedGifts = safeNumber(user.gifts);
  const cachedGiftNames = Array.isArray(user.giftNames) ? user.giftNames.map(safeText).filter(Boolean) : [];
  if (!hasCachedUserActivity({
    chats: safeNumber(user.chats),
    gifts: cachedGifts,
    members: safeNumber(user.members),
    fanTicket: safeNumber(user.fanTicket),
    giftNames: cachedGiftNames,
  })) return null;
  return {
    key: safeText(user.key) || douyinId,
    nickname: safeText(user.nickname),
    displayName: safeText(user.displayName),
    realName: safeText(user.realName),
    douyinId,
    userId: safeText(user.userId),
    secUid: safeText(user.secUid),
    webcastUid: safeText(user.webcastUid),
    userLevel: safeNumber(user.userLevel),
    badgeLevel: safeNumber(user.badgeLevel),
    consumeLevel: safeNumber(user.consumeLevel),
    wealthLevel: safeNumber(user.wealthLevel),
    fansClubLevel: safeNumber(user.fansClubLevel),
    honorLevel: safeNumber(user.honorLevel),
    payScore: safeNumber(user.payScore),
    fanTicketCount: safeNumber(user.fanTicketCount),
    totalRechargeDiamondCount: safeNumber(user.totalRechargeDiamondCount),
    gender: safeNumber(user.gender),
    followStatus: safeNumber(user.followStatus),
    ipLocation: safeText(user.ipLocation),
    followerCount: safeNumber(user.followerCount),
    isMystery: Boolean(user.isMystery),
    cacheHit: Boolean(user.cacheHit),
    hasStrongIdentity: true,
    identitySource: safeText(user.identitySource) || "本地缓存",
    lastAt: safeText(user.lastAt),
    lastType: (safeText(user.lastType) as MonitorLogType) || "event",
    chats: safeNumber(user.chats),
    gifts: safeNumber(user.gifts),
    giftNames: cachedGiftNames,
    members: safeNumber(user.members),
    fanTicket: safeNumber(user.fanTicket),
    roomAppearances: Array.isArray(user.roomAppearances)
      ? mergeRoomAppearances(user.roomAppearances)
      : [],
  };
}

function loadCachedMonitorUsers() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USER_CACHE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCachedUser).filter(Boolean) as MonitorUserRow[];
  } catch {
    return [];
  }
}

function userAliasKeys(user: MonitorUserRow) {
  return [
    user.douyinId,
    user.userId,
    user.secUid,
    user.webcastUid,
    user.key,
    user.realName,
    user.nickname,
    user.displayName,
  ].filter(Boolean);
}

function hasAnyUserAlias(user: MonitorUserRow, aliases: Set<string>) {
  return userAliasKeys(user).some((key) => aliases.has(key));
}

function mergeUserCollection(users: MonitorUserRow[]) {
  const merged = new Map<string, MonitorUserRow>();
  const aliases = new Map<string, string>();
  for (const user of users) {
    const aliasKeys = userAliasKeys(user);
    const existingKey = aliasKeys.map((key) => aliases.get(key)).find(Boolean);
    const canonicalKey = existingKey || user.douyinId || user.secUid || user.userId || user.webcastUid || user.key;
    const mergedUser = mergeUserRow(merged.get(canonicalKey), { ...user, key: canonicalKey });
    merged.set(canonicalKey, mergedUser);
    for (const key of userAliasKeys(mergedUser)) aliases.set(key, canonicalKey);
  }
  return Array.from(merged.values());
}

function sortMonitorUsers(users: MonitorUserRow[]) {
  return [...users].sort((a, b) => {
    if (b.fanTicket !== a.fanTicket) return b.fanTicket - a.fanTicket;
    if (b.gifts !== a.gifts) return b.gifts - a.gifts;
    if (Boolean(a.douyinId) !== Boolean(b.douyinId)) return a.douyinId ? -1 : 1;
    if (a.hasStrongIdentity !== b.hasStrongIdentity) return a.hasStrongIdentity ? -1 : 1;
    const timeDelta = new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
    if (timeDelta) return timeDelta;
    return b.chats - a.chats;
  });
}

function sameCachedUsers(left: MonitorUserRow[], right: MonitorUserRow[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function collectUsersFromLog(
  row: MonitorLogRow,
  giftStreakState?: Map<string, { count: number; fanTicket: number }>
) {
  const payload = row.payload as Record<string, unknown>;
  const users: MonitorUserRow[] = [];
  const push = (item: unknown, type = row.type) => {
    if (!item || typeof item !== "object") return;
    const user = userFromPayload(item as Record<string, unknown>, type, row.at);
    if (user) users.push(user);
  };

  if (row.type === "gift") {
    const key = giftStreakKey(payload);
    const previous = giftStreakState && key ? giftStreakState.get(key) : undefined;
    const incremental = giftIncrementalFromPayload(payload, previous);
    if (giftStreakState && key) {
      giftStreakState.set(key, {
        count: incremental.totalCount,
        fanTicket: incremental.totalFanTicket,
      });
    }
    // 连击帧只累计增量，避免 totalCount/repeatCount 重复叠加。
    if (incremental.count <= 0 && incremental.fanTicket <= 0) return users;
    push({
      ...payload,
      __giftDeltaCount: incremental.count,
      __giftDeltaFanTicket: incremental.fanTicket,
      fanTicket: incremental.fanTicket,
      count: incremental.count,
    }, "gift");
    return users;
  }

  push(payload);
  push(payload.rank, "rank");
  push(payload.fromUser, "event");
  push(payload.toUser, "event");
  if (Array.isArray(payload.ranks)) payload.ranks.forEach((item) => push(item, "rank"));
  if (Array.isArray(payload.seats)) payload.seats.forEach((item) => push(item, "event"));
  return users;
}

function isProfileEnrichmentLog(row: MonitorLogRow) {
  const payload = row.payload as Record<string, unknown>;
  return row.type === "event" && payload.eventType === "user-profile";
}

function identityDetail(payload: {
  displayName?: string;
  realName?: string;
  userId?: string;
  secUid?: string;
  uniqueId?: string;
  webcastUid?: string;
  isMystery?: boolean;
  mysteryMan?: number;
  userLevel?: number;
  badgeLevel?: number;
  consumeLevel?: number;
  wealthLevel?: number;
  fansClubLevel?: number;
  honorLevel?: number;
  payScore?: number;
  totalRechargeDiamondCount?: number;
  fanTicketCount?: number;
  ipLocation?: string;
  followerCount?: number;
  cacheHit?: boolean;
}) {
  const parts: string[] = [];
  if (payload.isMystery) parts.push(`神秘人${payload.mysteryMan ? `L${payload.mysteryMan}` : ""}`);
  if (payload.ipLocation) parts.push(payload.ipLocation);
  if (payload.wealthLevel || payload.consumeLevel) {
    parts.push(`财富${payload.wealthLevel || payload.consumeLevel}`);
  }
  if (payload.fansClubLevel) parts.push(`粉丝团${payload.fansClubLevel}`);
  return parts.join(" · ");
}

function memberActionLabel(payload: Pick<LivePkMemberPayload, "memberAction" | "memberActionText" | "actionDescription">) {
  const text = safeText(payload.memberActionText) || safeText(payload.actionDescription);
  if (text) return text;
  if (payload.memberAction === 2) return "离场";
  if (payload.memberAction === 1 || payload.memberAction === undefined) return "进场";
  return `动作 ${payload.memberAction}`;
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
    "live-mode": "直播形态",
    "pk-battle": "PK状态",
    "pk-score-snapshot": "PK分数",
    "room-info": "房间信息",
    "gift-catalog": "礼物目录",
    "audience-rank": "观众榜",
    "wish-list": "心愿单",
    "interaction-info": "互动配置",
    "user-profile": "资料补齐",
  };
  return labels[eventType] || eventType || "事件";
}

function eventValue(payload: LivePkEventPayload) {
  const likeCount = safeNumber(payload.likeCount);
  const paidCount = safeNumber(payload.paidCount);
  if (payload.eventType === "live-mode") return safeText(payload.liveModeLabel) || safeText(payload.liveMode);
  if (payload.eventType === "pk-battle" || payload.eventType === "pk-score-snapshot" || payload.eventType === "linkmic-score") return "";
  if (typeof payload.displayValue === "number" && payload.displayValue > 0) return String(payload.displayValue);
  if (typeof payload.totalUser === "number" && payload.totalUser > 0) return String(payload.totalUser);
  if (typeof payload.hotScore === "number" && payload.hotScore > 0) return String(payload.hotScore);
  if (typeof payload.count === "number" && payload.count > 0) return String(payload.count);
  if (typeof payload.total === "number" && payload.total > 0) return String(payload.total);
  if (typeof payload.followCount === "number" && payload.followCount > 0) return String(payload.followCount);
  if (likeCount > 0) return String(likeCount);
  if (paidCount > 0) return String(paidCount);
  return "";
}

function eventDetail(payload: LivePkEventPayload) {
  const detail = identityDetail(payload);
  const likeCount = safeNumber(payload.likeCount);
  const maxDiamond = safeNumber(payload.maxDiamond);
  const paidCount = safeNumber(payload.paidCount);
  const wishSwitch = safeNumber(payload.wishSwitch);
  const likeIconCount = safeNumber(payload.likeIconCount);
  const frequentlyChatCount = safeNumber(payload.frequentlyChatCount);
  const participants = Array.isArray(payload.participants) ? payload.participants as Record<string, unknown>[] : [];
  const participantText = participants
    .slice(0, 6)
    .map((item) => safeText(item.realName) || safeText(item.displayName) || safeText(item.nickname) || safeText(item.userId))
    .filter(Boolean)
    .join(" / ");
  const body =
    payload.eventType === "room-stats"
      ? [payload.displayShort, payload.displayMiddle, payload.displayLong, payload.total ? `累计 ${payload.total}` : ""]
          .filter(Boolean)
          .join(" / ")
      : payload.eventType === "room-user-seq"
        ? [
            payload.totalUserText || (payload.totalUser ? `在线 ${payload.totalUser}` : ""),
            payload.popularityText || (payload.popularity ? `人气 ${payload.popularity}` : ""),
            safeText(payload.upRightStatsText),
            payload.ranks?.length ? `榜单 ${payload.ranks.length} 人` : "",
          ].filter(Boolean).join(" / ")
        : payload.eventType === "room-info"
          ? [
              safeText(payload.title),
              safeText(payload.roomId),
              safeText(payload.userCountText),
              safeText(payload.liveModeLabel) || (payload.liveMode ? `形态 ${safeText(payload.liveMode)}` : ""),
              likeCount ? `点赞 ${likeCount}` : "",
            ].filter(Boolean).join(" / ")
        : payload.eventType === "live-mode"
          ? [
              safeText(payload.liveModeLabel) || safeText(payload.liveMode),
              payload.participantCount
                ? `${safeText(payload.participantCount)}${safeText(payload.liveMode) === "pk" || safeBoolean(payload.isPkActive) ? "方" : "人"}`
                : "",
              payload.battlePhase ? `阶段 ${safeText(payload.battlePhase)}` : "",
              payload.battleStatus !== undefined ? `状态 ${safeText(payload.battleStatus)}` : "",
              participantText,
            ].filter(Boolean).join(" / ")
        : payload.eventType === "pk-battle"
          ? [
              payload.isPkActive ? "PK中" : "非PK中",
              payload.participantCount ? `${safeText(payload.participantCount)}方` : "",
              payload.battlePhase ? `阶段 ${safeText(payload.battlePhase)}` : "",
              payload.duration ? `${safeText(payload.duration)}秒` : "",
              safeText(payload.battleId),
            ].filter(Boolean).join(" / ")
        : payload.eventType === "pk-score-snapshot"
          ? [
              payload.isPkActive ? "PK中" : "非PK中",
              payload.participantCount ? `${safeText(payload.participantCount)}方` : "",
              payload.pkCountDown !== undefined ? `倒计时 ${countdownText(payload.pkCountDown)}` : "",
              payload.battlePhase ? `阶段 ${safeText(payload.battlePhase)}` : "",
              safeText(payload.battleId),
            ].filter(Boolean).join(" / ")
        : payload.eventType === "gift-catalog"
          ? [
              payload.count ? `礼物 ${payload.count}` : "",
              paidCount ? `付费 ${paidCount}` : "",
              maxDiamond ? `最高 ${maxDiamond}钻` : "",
            ].filter(Boolean).join(" / ")
        : payload.eventType === "wish-list"
          ? [
              payload.count ? `心愿 ${payload.count}` : "暂无心愿",
              payload.wishSwitch !== undefined ? `开关 ${wishSwitch}` : "",
              safeText(payload.anchorName),
            ].filter(Boolean).join(" / ")
        : payload.eventType === "interaction-info"
          ? [
              likeIconCount ? `点赞图标 ${likeIconCount}` : "",
              frequentlyChatCount ? `快捷弹幕 ${frequentlyChatCount}` : "",
            ].filter(Boolean).join(" / ")
        : payload.eventType === "like" || payload.eventType === "pico-like"
          ? [
              payload.count ? `本次 ${payload.count}` : "",
              payload.total ? `累计 ${payload.total}` : "",
              safeText(payload.emoji),
              safeText(payload.scene),
            ].filter(Boolean).join(" / ")
          : payload.eventType === "chat-like"
            ? [
                payload.count ? `弹幕点赞 ${payload.count}` : "",
                Array.isArray(payload.entries) ? `${payload.entries.length} 条消息` : "",
              ].filter(Boolean).join(" / ")
            : payload.eventType === "linkmic-score"
              ? [
                  payload.scoreSource !== undefined ? `来源 ${safeText(payload.scoreSource)}` : "",
                  safeText(payload.extra),
                ].filter(Boolean).join(" / ")
              : payload.eventType === "short-touch-area"
                ? [
                    safeText(payload.name),
                    payload.messageType !== undefined ? `消息类型 ${safeText(payload.messageType)}` : "",
                    safeText(payload.containerPayload),
                  ].filter(Boolean).join(" / ")
                : payload.eventType === "in-room-banner"
                  ? [
                      payload.position !== undefined ? `位置 ${safeText(payload.position)}` : "",
                      payload.actionType !== undefined ? `动作 ${safeText(payload.actionType)}` : "",
                      safeText(payload.containerUrl),
                      safeText(payload.lynxContainerUrl),
                    ].filter(Boolean).join(" / ")
                  : [
                      safeText(payload.content),
                      safeText(payload.tipContent),
                      safeText(payload.shareTarget),
                      safeText(payload.method),
                    ].filter(Boolean).join(" / ");
  return [detail, body].filter(Boolean).join(" / ");
}

function makeId(type: string) {
  return `${Date.now()}-${type}-${Math.random().toString(36).slice(2, 9)}`;
}

function toCsvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildLiveState(logs: MonitorLogRow[], liveScores: MonitorScoreRow[] = []): MonitorLiveState {
  const scores = new Map<string, MonitorScoreRow>();
  const rounds: MonitorRoundRow[] = [];
  let round = 0;
  let currentBattleId = "";
  let currentMatchMode: MonitorMatchMode = "unknown";
  let currentMatchStartedAt = "";
  let currentPhase = "";
  let roomOwnerScore: MonitorScoreRow | null = null;
  let roomOwnerGiftScore = 0;
  let mode = "unknown";
  let modeLabel = "未知";
  let isPkActive = false;
  let isLinkmic = false;
  let participantCount = 0;
  let hasLiveParticipantCount = false;
  let channelId = "";
  let countdown = 0;
  let hasOfficialCountdown = false;
  let phase = "";
  let matchStatus: MonitorLiveState["matchStatus"] = "idle";
  let updatedAt = "";

  const currentMatchModeFromState = (): MonitorMatchMode =>
    matchModeFromLive({ mode, isPkActive, isLinkmic });

  const decorateRound = (row: MonitorRoundRow, nextScores?: MonitorScoreRow[]): MonitorRoundRow => {
    const scoresForRound = nextScores || row.scores;
    const winner = winnerFromScores(scoresForRound);
    return {
      ...row,
      scores: scoresForRound,
      winnerId: winner.winnerId,
      winnerName: winner.winnerName,
    };
  };

  const ensureRound = (battleId: string, forceNew = false, at = "", matchMode?: MonitorMatchMode) => {
    const nextBattleId = battleId || currentBattleId || `round-${round || 1}`;
    const isSameBattle = Boolean(battleId && sameBattleId(battleId, currentBattleId));
    const nextMode = matchMode || currentMatchModeFromState();
    if (forceNew || round === 0 || (battleId && currentBattleId && !isSameBattle)) {
      if (round > 0 && rounds[rounds.length - 1]?.status !== "finished") {
        const previous = rounds[rounds.length - 1];
        rounds[rounds.length - 1] = decorateRound({
          ...previous,
          status: "finished",
          endedAt: at || previous.endedAt || updatedAt,
          phase: previous.phase || currentPhase || phase,
          scores: Array.from(scores.values()).length > 0 ? Array.from(scores.values()) : previous.scores,
        });
      }
      round = round + 1;
      currentBattleId = nextBattleId;
      currentMatchMode = nextMode;
      currentMatchStartedAt = at || updatedAt || "";
      currentPhase = "";
      matchStatus = "running";
      scores.clear();
      rounds.push({
        round,
        battleId: nextBattleId,
        mode: nextMode,
        modeLabel: matchModeLabel(nextMode),
        phase: "",
        status: "running",
        startedAt: currentMatchStartedAt,
        endedAt: "",
        scores: [],
        winnerId: "",
        winnerName: "",
      });
    } else if (battleId) {
      currentBattleId = preferBattleId(currentBattleId, battleId);
      if (round > 0) {
        const previous = rounds[rounds.length - 1];
        const upgradedMode =
          previous.mode === "unknown" || (previous.mode === "linkmic" && nextMode === "pk")
            ? nextMode
            : previous.mode;
        currentMatchMode = upgradedMode;
        rounds[rounds.length - 1] = decorateRound({
          ...previous,
          battleId: currentBattleId,
          mode: upgradedMode,
          modeLabel: matchModeLabel(upgradedMode),
          startedAt: previous.startedAt || at || currentMatchStartedAt,
          status: previous.status === "finished" ? "finished" : "running",
        });
        if (!currentMatchStartedAt) currentMatchStartedAt = rounds[rounds.length - 1].startedAt;
      }
    } else if (round > 0 && nextMode !== "unknown") {
      const previous = rounds[rounds.length - 1];
      if (previous.mode === "unknown" || (previous.mode === "linkmic" && nextMode === "pk")) {
        currentMatchMode = nextMode;
        rounds[rounds.length - 1] = decorateRound({
          ...previous,
          mode: nextMode,
          modeLabel: matchModeLabel(nextMode),
        });
      }
    }
  };

  const snapshotRound = (at = "", nextPhase = "") => {
    if (round === 0) return;
    const previous = rounds[rounds.length - 1];
    const modeForRound = currentMatchMode === "unknown" ? previous.mode : currentMatchMode;
    rounds[rounds.length - 1] = decorateRound({
      ...previous,
      battleId: currentBattleId,
      mode: modeForRound,
      modeLabel: matchModeLabel(modeForRound),
      phase: nextPhase || previous.phase || currentPhase || phase,
      startedAt: previous.startedAt || currentMatchStartedAt || at,
      status: previous.status,
      scores: Array.from(scores.values()),
    });
  };

  const applyScores = (nextScores: MonitorScoreRow[], replace: boolean, at = "", nextPhase = "") => {
    if (nextScores.length === 0) return;
    if (replace) scores.clear();
    nextScores.forEach((score) => {
      const previous = scores.get(score.anchorId);
      scores.set(score.anchorId, previous ? {
        ...previous,
        ...score,
        name: displayScoreName(score) ? score.name : previous.name,
        uniqueId: score.uniqueId || previous.uniqueId,
        score: Math.max(previous.score, score.score),
        scoreText: score.score >= previous.score ? (score.scoreText || previous.scoreText) : previous.scoreText,
      } : score);
    });
    participantCount = Math.max(participantCount, scores.size);
    if (round > 0 && rounds[rounds.length - 1]?.status !== "finished") {
      matchStatus = "running";
    }
    snapshotRound(at, nextPhase);
  };

  const finishActiveRound = (at = "", nextPhase = "") => {
    if (round === 0) return;
    const previous = rounds[rounds.length - 1];
    const nextScores = Array.from(scores.values()).length > 0 ? Array.from(scores.values()) : previous.scores;
    rounds[rounds.length - 1] = decorateRound({
      ...previous,
      status: "finished",
      endedAt: previous.endedAt || at || updatedAt,
      phase: nextPhase || previous.phase || currentPhase || phase,
      scores: nextScores,
    });
    matchStatus = "finished";
  };

  const rememberRoomOwner = (payload: Record<string, unknown>) => {
    const anchorId =
      safeText(payload.ownerUserId) ||
      safeText(payload.userId) ||
      safeText(payload.ownerDouyinId) ||
      safeText(payload.uniqueId) ||
      safeText(payload.ownerWebRid) ||
      safeText(payload.ownerSecUid) ||
      safeText(payload.roomId);
    if (!anchorId) return;
    roomOwnerScore = {
      anchorId,
      name:
        safeText(payload.ownerNickname) ||
        safeText(payload.realName) ||
        safeText(payload.nickname) ||
        safeText(payload.title) ||
        "本直播间",
      uniqueId: safeText(payload.ownerDouyinId) || safeText(payload.uniqueId),
      score: roomOwnerGiftScore,
      scoreText: roomOwnerGiftScore ? compactNumber(roomOwnerGiftScore) : "0",
      scoreRelative: false,
      multiPkTeamScore: 0,
      source: "room-gift-score",
    };
  };

  const applyGiftScore = (payload: Record<string, unknown>, at: string) => {
    if (!roomOwnerScore) return;
    const roomFanTicketCount = safeNumber(payload.roomFanTicketCount);
    const fanTicket = safeNumber(payload.fanTicket);
    const nextScore = roomFanTicketCount > 0
      ? Math.max(roomOwnerGiftScore, roomFanTicketCount)
      : roomOwnerGiftScore + fanTicket;
    if (nextScore <= roomOwnerGiftScore) return;
    roomOwnerGiftScore = nextScore;
    const nextOwnerScore = {
      ...roomOwnerScore,
      score: roomOwnerGiftScore,
      scoreText: compactNumber(roomOwnerGiftScore),
      source: "room-gift-score",
    };
    roomOwnerScore = nextOwnerScore;
    scores.set(nextOwnerScore.anchorId, nextOwnerScore);
    updatedAt = at || updatedAt;
  };

  for (const row of logs.slice().reverse()) {
    const payload = row.payload as Record<string, unknown>;
    if (row.type === "event") {
      const eventType = safeText(payload.eventType);
      if (eventType === "room-info" || eventType === "live-mode" || eventType === "pk-battle" || eventType === "pk-score-snapshot" || eventType === "linkmic-score") {
        const nextMode = safeText(payload.liveMode);
        const hasPkActive = Object.prototype.hasOwnProperty.call(payload, "isPkActive");
        const nextPkActive = hasPkActive ? safeBoolean(payload.isPkActive) : nextMode === "pk";
        const previousActive = isPkActive || isLinkmic;
        if (nextMode) mode = nextMode;
        if (nextMode || hasPkActive) {
          isPkActive = nextPkActive || mode === "pk";
          isLinkmic = !isPkActive && mode === "linkmic";
          modeLabel = liveModeStatusText({ mode, modeLabel, isPkActive, isLinkmic });
        } else if (safeText(payload.liveModeLabel)) {
          modeLabel = safeText(payload.liveModeLabel);
        }
        if (payload.participantCount !== undefined) {
          participantCount = safeNumber(payload.participantCount);
          hasLiveParticipantCount = true;
        }
        channelId = safeText(payload.channelId) || channelId;
        if (payload.pkCountDown !== undefined) {
          countdown = Math.max(0, safeNumber(payload.pkCountDown));
          hasOfficialCountdown = true;
        }
        phase = safeText(payload.battlePhase) || phase;
        if (safeText(payload.battlePhase)) currentPhase = safeText(payload.battlePhase);
        updatedAt = row.at || updatedAt;

        const finished = isMatchFinishedPayload(payload);
        const nextActive = (isPkActive || isLinkmic) && !finished;
        if (nextActive && (!previousActive || round === 0)) {
          ensureRound(
            safeText(payload.battleId) || safeText(payload.channelId),
            true,
            row.at,
            currentMatchModeFromState()
          );
        } else if (finished && (previousActive || (round > 0 && rounds[rounds.length - 1]?.status !== "finished"))) {
          if (round === 0) {
            ensureRound(
              safeText(payload.battleId) || safeText(payload.channelId),
              true,
              row.at,
              currentMatchModeFromState()
            );
          }
          finishActiveRound(row.at, safeText(payload.battlePhase));
        } else if (nextActive) {
          ensureRound(
            safeText(payload.battleId) || safeText(payload.channelId),
            false,
            row.at,
            currentMatchModeFromState()
          );
        }
      }

      if (eventType === "room-info") {
        rememberRoomOwner(payload);
      }

      if (eventType === "pk-battle" || eventType === "pk-score-snapshot") {
        const battleId = safeText(payload.battleId);
        const finished = isMatchFinishedPayload(payload);
        ensureRound(
          battleId,
          Boolean(battleId && currentBattleId && !sameBattleId(battleId, currentBattleId)),
          row.at,
          "pk"
        );
        const nextScores = scoreRowsFromEvent(payload as LivePkEventPayload, eventType);
        applyScores(nextScores, true, row.at, safeText(payload.battlePhase));
        if (finished) {
          finishActiveRound(row.at, safeText(payload.battlePhase));
        }
      } else if (eventType === "linkmic-score") {
        ensureRound(safeText(payload.battleId) || safeText(payload.channelId), false, row.at, "linkmic");
        const nextScores = scoreRowsFromEvent(payload as LivePkEventPayload, eventType);
        applyScores(nextScores, false, row.at, safeText(payload.battlePhase));
      }
    }

    if (row.type === "rank") {
      if (isAnchorScoreRankPayload(payload)) {
        ensureRound(safeText(payload.battleId), false, row.at, currentMatchModeFromState());
        const nextScores = Array.isArray(payload.ranks)
          ? dedupeScoreRows(payload.ranks.map((rank) => scoreFromPayload(rank, "interaction-score")).filter(Boolean) as MonitorScoreRow[])
          : [];
        applyScores(nextScores, false, row.at);
        updatedAt = row.at || updatedAt;
      }
    }

    if (row.type === "gift") {
      applyGiftScore(payload, row.at);
    }
  }

  const logScores = Array.from(scores.values());
  const currentScores = liveScores.length > 0
    ? mergeScoreRows(logScores, liveScores, false)
    : logScores;
  if (!hasLiveParticipantCount) {
    participantCount = Math.max(participantCount, currentScores.length);
  }
  modeLabel = liveModeStatusText({ mode, modeLabel, isPkActive, isLinkmic });
  if ((isPkActive || isLinkmic) && round === 0 && currentScores.length > 0) {
    ensureRound(currentBattleId || "live-score", true, updatedAt, currentMatchModeFromState());
    applyScores(currentScores, true, updatedAt);
  }
  if (round > 0 && currentScores.length > 0) {
    scores.clear();
    currentScores.forEach((score) => scores.set(score.anchorId, score));
    snapshotRound(updatedAt, currentPhase || phase);
  }
  if (round > 0 && matchStatus === "idle") {
    matchStatus = rounds[rounds.length - 1]?.status === "finished" ? "finished" : "running";
  }

  return {
    mode,
    modeLabel,
    isPkActive,
    isLinkmic,
    participantCount,
    battleId: currentBattleId,
    channelId,
    countdown,
    hasOfficialCountdown,
    phase,
    matchStatus,
    scores: rankedScores(currentScores),
    rounds,
    currentMatchStartedAt: currentMatchStartedAt || (rounds[rounds.length - 1]?.startedAt || ""),
    updatedAt,
  };
}

function liveModeStatusText({
  mode,
  modeLabel,
  isPkActive,
  isLinkmic,
}: Pick<MonitorLiveState, "mode" | "modeLabel" | "isPkActive" | "isLinkmic">) {
  if (isPkActive || mode === "pk") return "PK";
  if (isLinkmic || mode === "linkmic") return "连麦";
  if (mode === "single" || mode === "normal" || mode === "unknown" || modeLabel === "未知") return "正常";
  return modeLabel || "正常";
}

function compactLogDetail(row: MonitorLogRow, liveState: MonitorLiveState) {
  const payload = row.payload as Record<string, unknown>;
  const visibleIdentity = logIdentityText(row);
  const identity = visibleIdentity && visibleIdentity !== "-" && visibleIdentity !== "已关联"
    ? ` (${visibleIdentity})`
    : "";
  if (row.type === "gift") {
    const gift = payload as unknown as LivePkGiftPayload;
    const count = giftCountFromPayload(payload);
    const rmb = safeNumber(gift.diamondCount) * count / 10;
    return [
      `${row.name}${identity} 送出 ${gift.giftName || giftNameFromPayload(payload)} x${count}`,
      rmb ? moneyText(rmb) : "",
      gift.fanTicket ? `音浪 ${compactNumber(gift.fanTicket)}` : "",
    ].filter(Boolean).join(" · ");
  }
  if (row.type === "chat") {
    const chat = payload as unknown as LivePkChatPayload;
    return `${row.name}${identity}: ${chat.content || row.detail}`;
  }
  if (row.type === "member") {
    return `${row.name}${identity} ${row.label}`;
  }
    if (row.type === "rank") {
      const rank = (payload.rank || payload) as Record<string, unknown>;
      const score = scoreFromPayload(rank);
      return score
      ? `主播ID ${compactId(score.anchorId)} · ${score.name || "主播"}`
      : row.detail;
    }
  if (row.type === "event") {
    const eventType = safeText(payload.eventType);
    if (eventType === "live-mode") {
      const unit = safeBoolean(payload.isPkActive) || safeText(payload.liveMode) === "pk" ? "方" : "人";
      return `${liveState.modeLabel} · ${safeNumber(payload.participantCount) || liveState.participantCount}${unit}`;
    }
    if (eventType === "pk-battle" || eventType === "pk-score-snapshot") {
      const eventScores = Array.isArray(payload.scores)
        ? scoreRowsFromEvent(payload as LivePkEventPayload, eventType)
        : liveState.scores;
      return `PK ${safeBoolean(payload.isPkActive) ? "进行中" : "未开始"} · ${safeNumber(payload.participantCount) || eventScores.length}方`;
    }
  }
  return row.detail;
}

export function DouyinMonitorPage({ active = true }: { active?: boolean }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const [liveRoomUrl, setLiveRoomUrl] = useState("");
  const [cookie, setCookie] = useState("");
  const [status, setStatus] = useState<LivePkMonitorStatus>({
    status: "idle",
    startedAt: null,
    lastError: null,
    lastRankAt: null,
  });
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<MonitorLogRow[]>([]);
  const [cachedUsers, setCachedUsers] = useState<MonitorUserRow[]>(loadCachedMonitorUsers);
  const [filter, setFilter] = useState<MonitorFilter>("score");
  const [busy, setBusy] = useState(false);
  const [liveScores, setLiveScores] = useState<MonitorScoreRow[]>([]);
  const liveScoresRef = useRef<MonitorScoreRow[]>([]);
  const [matchLedger, setMatchLedger] = useState<MonitorRoundRow[]>(() => loadMatchLedger());
  const matchLedgerRef = useRef<MonitorRoundRow[]>(matchLedger);
  const [liveCountdownMs, setLiveCountdownMs] = useState(0);
  const countdownEndAtRef = useRef<number | null>(null);
  const countdownSourceMsRef = useRef<number | null>(null);
  const [cookieSaved, setCookieSaved] = useState(false);
  const [cookieUpdatedAt, setCookieUpdatedAt] = useState<string | null>(null);
  const [showCookiePanel, setShowCookiePanel] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [embeddedState, setEmbeddedState] = useState<LivePkEmbeddedState>({
    embedded: false,
    liveRoomUrl: "",
  });
  const [previewFrame, setPreviewFrame] = useState({ x: 24, y: 128, width: 460, height: 680 });

  const syncPreviewBounds = useCallback(async () => {
    const api = getDataApi();
    const stage = previewStageRef.current;
    if (!api?.setLivePkEmbeddedBounds || !stage || !previewOpen) return;
    const rect = stage.getBoundingClientRect();
    const bounds: LivePkEmbeddedBounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
    await api.setLivePkEmbeddedBounds(bounds);
  }, [previewOpen]);

  const appendRows = useCallback((rows: Omit<MonitorLogRow, "id">[]) => {
    if (rows.length === 0) return;
    setLogs((prev) => [
      ...rows.map((row) => ({ ...row, id: makeId(row.type) })),
      ...prev,
    ].slice(0, MONITOR_LOG_LIMIT));
  }, []);

  const clearLiveScores = useCallback(() => {
    liveScoresRef.current = [];
    setLiveScores([]);
  }, []);

  const commitLiveScores = useCallback((updater: (current: MonitorScoreRow[]) => MonitorScoreRow[]) => {
    const nextScores = updater(liveScoresRef.current);
    if (nextScores === liveScoresRef.current || sameScoreRows(liveScoresRef.current, nextScores)) return;
    liveScoresRef.current = nextScores;
    setLiveScores(nextScores);
  }, []);

  const commitMatchLedger = useCallback((payload: LivePkEventPayload | Record<string, unknown>, at = "") => {
    const next = upsertMatchLedger(matchLedgerRef.current, payload, at);
    if (next === matchLedgerRef.current) return;
    // shallow compare by length + last battle/status/score sum
    const prev = matchLedgerRef.current;
    const same =
      prev.length === next.length
      && prev.every((row, index) => {
        const other = next[index];
        return (
          row.battleId === other.battleId
          && row.status === other.status
          && row.phase === other.phase
          && row.endedAt === other.endedAt
          && row.scores.length === other.scores.length
          && row.scores.every((score, scoreIndex) => {
            const right = other.scores[scoreIndex];
            return score.anchorId === right.anchorId && score.score === right.score;
          })
        );
      });
    if (same) return;
    matchLedgerRef.current = next;
    setMatchLedger(next);
    saveMatchLedger(next);
  }, []);

  const clearMatchLedger = useCallback(() => {
    matchLedgerRef.current = [];
    setMatchLedger([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(MATCH_LEDGER_STORAGE_KEY);
      notifyMatchLedgerUpdated();
    }
  }, []);

  const clearLiveCountdown = useCallback(() => {
    countdownEndAtRef.current = null;
    countdownSourceMsRef.current = null;
    setLiveCountdownMs(0);
  }, []);

  const syncLiveCountdown = useCallback((payload: LivePkEventPayload) => {
    if (payload.pkCountDown === undefined) return;
    const nextMs = Math.max(0, safeNumber(payload.pkCountDown) * 1000);
    if (nextMs <= 0 || (Object.prototype.hasOwnProperty.call(payload, "isPkActive") && !safeBoolean(payload.isPkActive))) {
      clearLiveCountdown();
      return;
    }
    const now = performance.now();
    const currentMs = countdownEndAtRef.current === null
      ? 0
      : Math.max(0, countdownEndAtRef.current - now);
    if (countdownSourceMsRef.current === nextMs && currentMs > 0) return;
    countdownSourceMsRef.current = nextMs;
    countdownEndAtRef.current = now + nextMs;
    setLiveCountdownMs(nextMs);
  }, [clearLiveCountdown]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const endAt = countdownEndAtRef.current;
      if (endAt === null) return;
      const nextMs = Math.max(0, endAt - performance.now());
      setLiveCountdownMs((current) => (Math.abs(current - nextMs) < 40 ? current : nextMs));
      if (nextMs <= 0) {
        countdownEndAtRef.current = null;
        countdownSourceMsRef.current = null;
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const api = getDataApi();
    if (!api) return;
    const offStatus = api.onLivePkStatus((next) => {
      setStatus(next);
      // 停止时保留最后一场比分与场次，方便查看最终分；仅清倒计时动画。
      if (next.status !== "running") {
        clearLiveCountdown();
      }
      appendRows([{
        at: formatTime(),
        type: "status",
        label: "状态",
        name: "监控状态",
        userId: "",
        value: next.status,
        detail: next.lastError || "",
        payload: next,
      }]);
    });
    const offCapture = api.onLivePkCaptureStatus?.((next) => {
      setMessage(next);
      appendRows([{
        at: formatTime(),
        type: "status",
        label: "采集",
        name: "采集",
        userId: "",
        value: "",
        detail: next,
        payload: { message: next },
      }]);
    }) ?? (() => undefined);
    const offError = api.onLivePkError?.((next) => {
      setMessage(next);
      appendRows([{
        at: formatTime(),
        type: "status",
        label: "错误",
        name: "错误",
        userId: "",
        value: "",
        detail: next,
        payload: { message: next },
      }]);
    }) ?? (() => undefined);
    const offEmbedded = api.onLivePkEmbeddedState?.((payload) => {
      setEmbeddedState(payload);
      if (!payload.embedded) setPreviewOpen(false);
    }) ?? (() => undefined);
    const offGift = api.onLivePkGift?.((payload: LivePkGiftPayload) => {
      const count = giftCountFromPayload(payload as unknown as Record<string, unknown>);
      const diamond = safeNumber(payload.diamondCount);
      const fanTicket = giftFanTicketFromPayload(payload as unknown as Record<string, unknown>);
      const money = diamond > 0 ? moneyText((diamond * count) / 10) : "";
      const giftDetail = [
        `${giftNameFromPayload(payload as unknown as Record<string, unknown>)} x${count}`,
        money,
        fanTicket ? `音浪 ${compactNumber(fanTicket)}` : "",
        identityDetail(payload),
      ].filter(Boolean).join(" · ");
      appendRows([{
        at: formatTime(payload.at),
        type: "gift",
        label: "礼物",
        name: monitorName(payload),
        userId: payload.uniqueId || "",
        value: fanTicket ? String(fanTicket) : "",
        detail: giftDetail,
        payload,
      }]);
    }) ?? (() => undefined);
    const offChat = api.onLivePkChat?.((payload: LivePkChatPayload) => {
      appendRows([{
        at: formatTime(payload.at),
        type: "chat",
        label: "弹幕",
        name: monitorName(payload),
        userId: payload.uniqueId || "",
        value: "",
        detail: safeText(payload.content),
        payload,
      }]);
    }) ?? (() => undefined);
    const offMember = api.onLivePkMember?.((payload: LivePkMemberPayload) => {
      const actionLabel = memberActionLabel(payload);
      appendRows([{
        at: formatTime(payload.at),
        type: "member",
        label: actionLabel,
        name: monitorName(payload),
        userId: payload.uniqueId || "",
        value: payload.memberCount ? String(payload.memberCount) : "",
        detail: [actionLabel, identityDetail(payload)].filter(Boolean).join(" · "),
        payload,
      }]);
    }) ?? (() => undefined);
    const offRank = api.onLivePkRank?.((payload: LivePkRankPayload) => {
      const nextScores = scoreRowsFromRankPayload(payload);
      commitLiveScores((current) => mergeScoreRows(current, nextScores, true));
    }) ?? (() => undefined);
    const offEvent = api.onLivePkEvent?.((payload: LivePkEventPayload) => {
      syncLiveCountdown(payload);
      if (
        payload.eventType === "pk-battle"
        || payload.eventType === "pk-score-snapshot"
        || payload.eventType === "linkmic-score"
        || payload.eventType === "live-mode"
      ) {
        commitMatchLedger(payload, formatTime(payload.at));
      }
      if (payload.eventType === "pk-battle" || payload.eventType === "pk-score-snapshot") {
        const nextScores = scoreRowsFromEvent(payload, payload.eventType);
        // PK 结束（punish / isPkActive=false）时必须保留最终分，不能清空。
        if (nextScores.length > 0) {
          const finished = isMatchFinishedPayload(payload as unknown as Record<string, unknown>);
          commitLiveScores((current) =>
            finished
              ? mergeScoreMap(current, nextScores, { onlyIncrease: true })
              : mergeScoreRows(current, nextScores, true)
          );
        }
        if (
          (Object.prototype.hasOwnProperty.call(payload, "isPkActive") && !safeBoolean(payload.isPkActive))
          || (payload.pkCountDown !== undefined && safeNumber(payload.pkCountDown) <= 0)
          || isTerminalBattlePhase(safeText(payload.battlePhase))
        ) {
          clearLiveCountdown();
        }
      } else if (payload.eventType === "linkmic-score") {
        commitLiveScores((current) => mergeScoreRows(current, scoreRowsFromEvent(payload, payload.eventType), false));
      }
      if (payload.eventType === "pk-score-snapshot" || payload.eventType === "linkmic-score") return;
      appendRows([{
        at: formatTime(payload.at),
        type: "event",
        label: eventLabel(payload.eventType),
        name: payload.uniqueId || payload.userId || payload.secUid || payload.webcastUid
          ? monitorName(payload)
          : eventLabel(payload.eventType),
        userId: payload.uniqueId || "",
        value: eventValue(payload),
        detail: eventDetail(payload),
        payload,
      }]);
    }) ?? (() => undefined);
    void api.getLivePkMonitorStatus?.().then((result) => {
      if (result.success) setStatus(result.data);
    });
    return () => {
      offStatus();
      offCapture();
      offError();
      offGift();
      offChat();
      offMember();
      offRank();
      offEvent();
      offEmbedded();
    };
  }, [appendRows, clearLiveCountdown, clearLiveScores, commitLiveScores, commitMatchLedger, syncLiveCountdown]);

  useEffect(() => {
    if (!previewOpen) return;
    void syncPreviewBounds();
  }, [previewFrame, previewOpen, syncPreviewBounds]);

  useEffect(() => {
    if (!previewOpen) return;
    const onResize = () => void syncPreviewBounds();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [previewOpen, syncPreviewBounds]);

  useEffect(() => {
    if (active || !previewOpen) return;
    setPreviewOpen(false);
    setEmbeddedState({ embedded: false, liveRoomUrl: "" });
    void getDataApi()?.closeLivePkEmbeddedMonitor?.({ stopMonitor: false });
  }, [active, previewOpen]);

  useEffect(() => {
    const api = getDataApi();
    void api?.readLivePkCookie?.().then((result) => {
      if (!result.success || !result.data.saved || !result.data.cookie) return;
      setCookie(result.data.cookie);
      setCookieSaved(true);
      setCookieUpdatedAt(result.data.updatedAt || null);
      setMessage("已加载本机保存的 Cookie");
    });
  }, []);

  const currentLogUsers = useMemo(() => {
    const users: MonitorUserRow[] = [];
    const profileUsers: MonitorUserRow[] = [];
    const anchorIds = new Set<string>();
    const giftStreakState = new Map<string, { count: number; fanTicket: number }>();
    let currentRoom: MonitorRoomAppearance | null = null;
    for (const row of logs.slice().reverse()) {
      const payload = row.payload as Record<string, unknown>;
      if (row.type === "event" && payload.eventType === "room-info") {
        currentRoom = roomAppearanceFromPayload(payload, liveRoomUrl);
        collectAnchorIdsFromRoomInfoPayload(payload).forEach((id) => anchorIds.add(id));
      }
      for (const user of collectUsersFromLog(row, giftStreakState)) {
        const rowUser = userWithRoom(user, currentRoom);
        if (isProfileEnrichmentLog(row)) {
          profileUsers.push(rowUser);
        } else {
          users.push(rowUser);
        }
      }
    }
    const activityUsers = mergeUserCollection(users);
    const activityAliases = new Set(activityUsers.flatMap(userAliasKeys));
    const matchedProfileUsers = profileUsers.filter((user) => hasAnyUserAlias(user, activityAliases));
    return sortMonitorUsers(
      mergeUserCollection([...activityUsers, ...matchedProfileUsers])
        .filter((user) => !userMatchesAnyId(user, anchorIds))
    );
  }, [liveRoomUrl, logs]);

  const currentAnchorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of logs) {
      const payload = row.payload as Record<string, unknown>;
      if (row.type === "event" && payload.eventType === "room-info") {
        collectAnchorIdsFromRoomInfoPayload(payload).forEach((id) => ids.add(id));
      }
    }
    return ids;
  }, [logs]);

  useEffect(() => {
    const cacheableUsers = currentLogUsers.filter((user) => Boolean(user.douyinId));
    setCachedUsers((previous) => {
      const next = sortMonitorUsers(mergeUserCollection([...previous, ...cacheableUsers]))
        .filter((user) => Boolean(user.douyinId))
        .filter(hasCachedUserActivity)
        .filter((user) => !userMatchesAnyId(user, currentAnchorIds));
      if (sameCachedUsers(previous, next)) return previous;
      window.localStorage.setItem(USER_CACHE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [currentAnchorIds, currentLogUsers]);

  const userRows = useMemo(
    () => sortMonitorUsers(mergeUserCollection([...cachedUsers, ...currentLogUsers]).filter((user) => !userMatchesAnyId(user, currentAnchorIds))),
    [cachedUsers, currentAnchorIds, currentLogUsers]
  );
  const exportableUserRows = useMemo(
    () => userRows.filter((user) => Boolean(user.douyinId)),
    [userRows]
  );

  const userIdentitySummary = useMemo(() => ({
    douyin: userRows.filter((user) => Boolean(user.douyinId)).length,
    linked: userRows.filter((user) => !user.douyinId && hasInternalIdentity(user)).length,
    pending: userRows.filter((user) => !user.douyinId && !hasInternalIdentity(user)).length,
  }), [userRows]);

  const roomInfo = useMemo<MonitorRoomInfo>(() => {
    const info: MonitorRoomInfo = {
      roomId: "",
      title: "",
      ownerNickname: "",
      ownerUserId: "",
      ownerDouyinId: "",
      ownerDouyinIdSource: "",
      ownerWebRid: "",
      ownerSecUid: "",
      onlineText: "",
      likeCount: 0,
      roomFanTicket: 0,
      updatedAt: "",
    };
    for (const row of logs.slice().reverse()) {
      const payload = row.payload as Record<string, unknown>;
      if (row.type === "event" && payload.eventType === "room-info") {
        info.roomId = safeText(payload.roomId) || info.roomId;
        info.title = safeText(payload.title) || info.title;
        info.ownerNickname = safeText(payload.ownerNickname) || safeText(payload.realName) || safeText(payload.nickname) || info.ownerNickname;
        info.ownerUserId = safeText(payload.ownerUserId) || safeText(payload.userId) || info.ownerUserId;
        info.ownerDouyinId = safeText(payload.ownerDouyinId) || safeText(payload.uniqueId) || info.ownerDouyinId;
        info.ownerDouyinIdSource = safeText(payload.ownerDouyinIdSource) || info.ownerDouyinIdSource;
        info.ownerWebRid = safeText(payload.ownerWebRid) || safeText(payload.webRid) || info.ownerWebRid;
        info.ownerSecUid = safeText(payload.ownerSecUid) || safeText(payload.secUid) || info.ownerSecUid;
        info.onlineText = safeText(payload.onlineDisplay) || safeText(payload.userCountText) || info.onlineText;
        info.likeCount = Math.max(info.likeCount, safeNumber(payload.likeCount));
        info.updatedAt = row.at || info.updatedAt;
      }
      if (row.type === "gift") {
        info.roomFanTicket = Math.max(
          info.roomFanTicket,
          safeNumber(payload.roomFanTicketCount)
        );
        info.updatedAt = row.at || info.updatedAt;
      }
    }
    return info;
  }, [logs]);

  const liveState = useMemo(() => {
    const next = buildLiveState(logs, liveScores);
    const rounds = mergeLiveRoundsWithLedger(next.rounds, matchLedger);
    const latest = rounds[rounds.length - 1];
    const mergedScores =
      latest && latest.scores.length > 0
        ? mergeScoreMap(next.scores, latest.scores, { onlyIncrease: true })
        : next.scores;
    const matchStatus =
      latest?.status === "finished" && !next.isPkActive
        ? "finished"
        : next.isPkActive || next.isLinkmic
          ? "running"
          : latest
            ? latest.status
            : next.matchStatus;
    const base = {
      ...next,
      scores: rankedScores(mergedScores),
      rounds,
      matchStatus,
      battleId: latest?.battleId || next.battleId,
      phase: next.phase || latest?.phase || "",
      currentMatchStartedAt: latest?.startedAt || next.currentMatchStartedAt,
    };
    return liveCountdownMs > 0
      ? { ...base, countdown: liveCountdownMs / 1000, hasOfficialCountdown: true }
      : base;
  }, [liveCountdownMs, liveScores, logs, matchLedger]);
  const completedLiveRounds = useMemo(
    () => liveState.rounds.filter((round) => round.status === "finished"),
    [liveState.rounds]
  );

  const stats = useMemo(() => {
    const eventRows = logs.filter((row) => row.type === "event");
    const online = eventRows.find((row) => {
      const payload = row.payload as LivePkEventPayload;
      return payload.eventType === "room-stats" || payload.eventType === "room-user-seq";
    });
    const giftMetrics = summarizeGiftMetrics(logs);
    return {
      total: logs.length,
      gifts: giftMetrics.gifts,
      chats: logs.filter((row) => row.type === "chat").length,
      members: logs.filter((row) => row.type === "member").length,
      events: eventRows.length,
      users: userRows.length,
      fanTicket: giftMetrics.fanTicket || roomInfo.roomFanTicket,
      online: roomInfo.onlineText || online?.value || "",
    };
  }, [logs, roomInfo.onlineText, roomInfo.roomFanTicket, userRows.length]);

  const filteredLogs = useMemo(() => {
    const noisyEventTypes = new Set([
      "gift-catalog",
      "interaction-info",
      "short-touch-area",
      "in-room-banner",
      "room-verify",
      "ranklist-hour-entrance",
      "rank-list-hour-enter",
      "user-profile",
    ]);
    return logs.filter((row) => {
      if (filter === "user" || filter === "score") return false;
      if (filter !== "all" && row.type !== filter) return false;
      if (filter === "all" && row.type === "event") {
        const eventType = safeText((row.payload as Record<string, unknown>).eventType);
        if (noisyEventTypes.has(eventType)) return false;
      }
      if (filter === "all" && row.type === "status" && !row.detail) return false;
      return true;
    });
  }, [filter, logs]);

  const startMonitor = async () => {
    const api = getDataApi();
    if (!api?.startLivePkMonitorFromUrl) {
      setMessage("当前环境不支持直播监控");
      return;
    }
    if (/sessionid=|uid_tt=|sid_tt=|ttwid=/.test(liveRoomUrl)) {
      setMessage("当前输入的是 Cookie，请填到 Cookie 输入框；直播间地址需要以 https://live.douyin.com/ 开头");
      return;
    }
    if (!liveRoomUrl.trim()) {
      setMessage("请填写直播间地址");
      return;
    }
    const previousLogs = logs;
    setLogs([]);
    clearLiveScores();
    clearLiveCountdown();
    setBusy(true);
    setMessage("正在隐藏采集直播间连接");
    const cookieText = cookie.trim();
    const result: IpcResult<LivePkMonitorStatus> = await api.startLivePkMonitorFromUrl({
      liveRoomUrl,
      cookie: cookieText,
    });
    setBusy(false);
    if (!result.success) {
      setLogs(previousLogs);
      setMessage(result.error || "启动失败");
      return;
    }
    setStatus(result.data);
  };

  const openPreview = async () => {
    const api = getDataApi();
    if (!api?.openLivePkEmbeddedMonitor) {
      setMessage("当前环境不支持直播预览");
      return;
    }
    if (!liveRoomUrl.trim()) {
      setMessage("请填写直播间地址");
      return;
    }
    setBusy(true);
    setPreviewOpen(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const stage = previewStageRef.current;
    const rect = stage?.getBoundingClientRect();
    const result: IpcResult<LivePkMonitorStatus> = await api.openLivePkEmbeddedMonitor({
      liveRoomUrl,
      cookie: cookie.trim(),
      bounds: rect
        ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
        : { x: previewFrame.x, y: previewFrame.y + 42, width: previewFrame.width, height: previewFrame.height - 42 },
    });
    setBusy(false);
    if (!result.success) {
      setPreviewOpen(false);
      setMessage(result.error || "直播预览打开失败");
      return;
    }
    setStatus(result.data);
    setEmbeddedState({ embedded: true, liveRoomUrl });
  };

  const stopMonitor = async () => {
    const api = getDataApi();
    if (!api?.stopLivePkMonitor) {
      setMessage("当前环境不支持停止直播监控");
      return false;
    }
    setBusy(true);
    const result = await api.stopLivePkMonitor();
    setBusy(false);
    if (!result.success) {
      setMessage(result.error || "停止直播监控失败");
      return false;
    }
    setStatus(result.data);
    // 停止后保留最终比分与历史场次，只清倒计时动画。
    clearLiveCountdown();
    setPreviewOpen(false);
    setEmbeddedState({ embedded: false, liveRoomUrl: "" });
    return true;
  };

  const closePreview = async () => {
    setPreviewOpen(false);
    setEmbeddedState({ embedded: false, liveRoomUrl: "" });
    const result = await getDataApi()?.closeLivePkEmbeddedMonitor?.({ stopMonitor: false });
    if (result?.success) setStatus(result.data);
  };

  const beginPreviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startFrame = previewFrame;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      setPreviewFrame((frame) => ({
        ...frame,
        x: Math.max(8, startFrame.x + moveEvent.clientX - startX),
        y: Math.max(72, startFrame.y + moveEvent.clientY - startY),
      }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const saveCookie = async () => {
    const api = getDataApi();
    if (!cookie.trim()) {
      setMessage("Cookie 为空");
      return;
    }
    const result = await api?.saveLivePkCookie?.(cookie);
    if (!result?.success) {
      setMessage(result?.error || "保存 Cookie 失败");
      return;
    }
    setCookieSaved(true);
    setCookieUpdatedAt(result.data.updatedAt);
    setMessage("Cookie 已保存到本机安全存储");
  };

  const clearCookie = async () => {
    const result = await getDataApi()?.clearLivePkCookie?.();
    if (!result?.success) {
      setMessage(result?.error || "清除 Cookie 失败");
      return;
    }
    setCookie("");
    setCookieSaved(false);
    setCookieUpdatedAt(null);
    setMessage("已清除本机 Cookie");
  };

  const clearCachedUsers = () => {
    window.localStorage.removeItem(USER_CACHE_STORAGE_KEY);
    setCachedUsers([]);
    setMessage("已清空用户列表缓存");
  };

  const exportCsv = () => {
    const header = ["时间", "类型", "昵称", "抖音号", "数值", "详情"];
    const rows = logs.slice().reverse().map((row) => [
      row.at,
      row.label,
      row.name,
      logIdentityText(row),
      row.value,
      compactLogDetail(row, liveState),
    ]);
    const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");
    downloadText(`抖音直播监控_${Date.now()}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
  };

  const exportJson = () => {
    const rows = logs.slice().reverse().map((row) => {
      const payload = (row.payload && typeof row.payload === "object")
        ? row.payload as Record<string, unknown>
        : {};
      const base = {
        at: row.at,
        type: row.type,
        label: row.label,
        name: row.name,
        douyinId: logIdentityText(row),
        value: row.value,
        detail: compactLogDetail(row, liveState),
      };
      if (row.type === "gift") {
        return {
          ...base,
          giftName: safeText(payload.giftName) || safeText(payload.giftId),
          count: giftCountFromPayload(payload),
          diamondCount: safeNumber(payload.diamondCount),
          fanTicket: giftFanTicketFromPayload(payload),
          roomFanTicketCount: safeNumber(payload.roomFanTicketCount),
          userId: safeText(payload.userId),
          secUid: safeText(payload.secUid),
          uniqueId: safeText(payload.uniqueId),
        };
      }
      if (row.type === "chat") {
        return {
          ...base,
          content: safeText(payload.content),
          uniqueId: safeText(payload.uniqueId),
          userId: safeText(payload.userId),
        };
      }
      if (row.type === "member") {
        return {
          ...base,
          action: safeText(payload.memberActionText) || row.label,
          memberCount: safeNumber(payload.memberCount),
          uniqueId: safeText(payload.uniqueId),
          userId: safeText(payload.userId),
        };
      }
      if (row.type === "event") {
        return {
          ...base,
          eventType: safeText(payload.eventType),
          liveMode: safeText(payload.liveMode),
          isPkActive: payload.isPkActive,
          participantCount: safeNumber(payload.participantCount),
          battleId: safeText(payload.battleId),
          scores: Array.isArray(payload.scores) ? payload.scores : undefined,
        };
      }
      return base;
    });
    downloadText(
      `抖音直播监控_${Date.now()}.json`,
      JSON.stringify(rows, null, 2),
      "application/json;charset=utf-8"
    );
  };

  const exportUsersCsv = () => {
    const header = [
      "序号",
      "昵称",
      "抖音号",
      "等级",
      "IP",
      "礼物次数",
      "本场音浪",
      "累计音浪",
      "消费金额",
      "弹幕",
      "进/离",
      "送过的礼物",
      "出现在哪个直播间",
      "直播间主播ID",
    ];
    const fallbackRoom = {
      roomLabel: roomInfo.title || "抖音直播间",
      roomId: "",
      anchorId: roomInfo.ownerDouyinId || roomInfo.ownerUserId || roomInfo.ownerWebRid || roomInfo.ownerSecUid || "",
    };
    const rows = exportableUserRows.map((user, index) => {
      const rooms = user.roomAppearances.length ? user.roomAppearances : [fallbackRoom];
      return [
        index + 1,
        realUserName(user),
        user.douyinId,
        userLevelSummary(user),
        user.ipLocation,
        user.gifts,
        user.fanTicket,
        user.fanTicketCount,
        giftMoney(user).toFixed(2),
        user.chats,
        user.members,
        user.giftNames.length ? user.giftNames.join("；") : "-",
        exportRoomAppearanceText(rooms),
        roomAnchorIdsText(rooms),
      ];
    });
    const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");
    downloadText(`抖音直播用户_${Date.now()}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
  };

  const exportUsersJson = () => {
    const rows = exportableUserRows.map((user) => ({
      nickname: realUserName(user),
      douyinId: user.douyinId,
      userId: user.userId,
      secUid: user.secUid,
      level: userLevelSummary(user),
      wealthLevel: user.wealthLevel || user.consumeLevel,
      fansClubLevel: user.fansClubLevel,
      ipLocation: user.ipLocation,
      gifts: user.gifts,
      giftNames: user.giftNames,
      fanTicket: user.fanTicket,
      fanTicketCount: user.fanTicketCount,
      spendYuan: Number(giftMoney(user).toFixed(2)),
      chats: user.chats,
      members: user.members,
      lastAt: user.lastAt,
      lastType: user.lastType,
      roomAppearances: user.roomAppearances.map((room) => ({
        roomLabel: exportRoomAppearanceText([room]),
        anchorId: room.anchorId,
      })),
    }));
    downloadText(
      `抖音直播用户_${Date.now()}.json`,
      JSON.stringify(rows, null, 2),
      "application/json;charset=utf-8"
    );
  };


  const exportScoreMatches = () => {
    const rows = completedLiveRounds
      .filter((round) => round.scores.some(hasEffectiveScore) || round.mode === "pk" || round.mode === "linkmic")
      .flatMap((round) => {
        const ranked = rankedScores(round.scores.filter(hasEffectiveScore));
        if (ranked.length === 0) {
          return [[
            round.round,
            round.modeLabel || matchModeLabel(round.mode),
            round.status === "finished" ? "已结束" : "进行中",
            round.phase || "",
            round.startedAt || "",
            round.endedAt || "",
            round.battleId || "",
            "",
            "",
            "",
            "",
            "",
            roomInfo.ownerUserId || roomInfo.ownerDouyinId || "",
            roomInfo.ownerNickname || "",
          ]];
        }
        return ranked.map((score, index) => [
          round.round,
          round.modeLabel || matchModeLabel(round.mode),
          round.status === "finished" ? "已结束" : "进行中",
          round.phase || "",
          round.startedAt || "",
          round.endedAt || "",
          round.battleId || "",
          index + 1,
          displayScoreName(score) || "",
          preferredAnchorId(score, roomInfo),
          score.uniqueId || "",
          score.score,
          roomInfo.ownerUserId || roomInfo.ownerDouyinId || "",
          roomInfo.ownerNickname || "",
          round.winnerId === score.anchorId || round.winnerId === preferredAnchorId(score, roomInfo) ? "是" : "",
        ]);
      });
    const header = [
      "场次",
      "形态",
      "状态",
      "阶段",
      "开始",
      "结束",
      "battleId",
      "排名",
      "主播",
      "主播ID",
      "抖音号",
      "分数",
      "本房主播ID",
      "本房主播",
      "是否胜者",
    ];
    const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");
    downloadText(`抖音分数场次_${Date.now()}.csv`, `﻿${csv}`, "text/csv;charset=utf-8");
  };

  const running = status.status === "running";

  if (!active) return null;

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[600px] flex-col gap-3">
      <section className="shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/25 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn("size-2.5 rounded-full", running ? "bg-primary ring-4 ring-primary/15" : "bg-muted-foreground/35")} />
            <div className="min-w-0">
              <h2 className="truncate text-base font-black tracking-normal">抖音直播监控</h2>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                <span>{running ? "实时采集中" : "待启动"}</span>
                {status.startedAt && <span className="tabular-nums">{formatTime(status.startedAt)}</span>}
              </div>
            </div>
            <Badge variant={running ? "default" : "secondary"}>
              {status.status}
            </Badge>
            {stats.online && <Badge variant="outline">在线 {stats.online}</Badge>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button size="sm" onClick={startMonitor} disabled={busy || status.status === "running"}>
              <Play data-icon="inline-start" />
              开始
            </Button>
            <Button size="sm" variant="outline" onClick={openPreview} disabled={busy || previewOpen}>
              <Monitor data-icon="inline-start" />
              预览
            </Button>
            <Button size="sm" variant="outline" onClick={stopMonitor} disabled={busy}>
              <Square data-icon="inline-start" />
              停止
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={exportCsv}
              disabled={logs.length === 0}
              title="导出事件 CSV"
            >
              <FileSpreadsheet />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={exportJson}
              disabled={logs.length === 0}
              title="导出事件 JSON"
            >
              <FileJson />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={exportUsersCsv}
              disabled={exportableUserRows.length === 0}
              title="导出用户 CSV"
            >
              <Download />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={exportUsersJson}
              disabled={exportableUserRows.length === 0}
              title="导出用户 JSON"
            >
              <Users />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={exportScoreMatches}
              disabled={completedLiveRounds.length === 0}
              title="导出分数场次 CSV（含最终分）"
            >
              <Swords />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => setLogs([])}
              disabled={logs.length === 0}
              title="清空日志"
            >
              <Eraser />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => {
                clearMatchLedger();
                clearLiveScores();
                clearLiveCountdown();
                setMessage("已清空分数场次账本与实时比分");
              }}
              disabled={matchLedger.length === 0 && liveScores.length === 0}
              title="清空分数场次（最终分账本）"
            >
              <BarChart3 />
            </Button>
          </div>
        </div>

        <div className="grid gap-2 px-3 py-2.5 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background/80 px-2 py-1 shadow-xs">
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">直播间</span>
            <Input
              value={liveRoomUrl}
              onChange={(event) => setLiveRoomUrl(event.target.value)}
              placeholder="https://live.douyin.com/..."
              className="h-7 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCookiePanel((value) => !value)}
              className="h-9"
            >
              <Cookie data-icon="inline-start" />
              Cookie
              <ChevronDown
                data-icon="inline-end"
                className={cn("transition-transform", showCookiePanel && "rotate-180")}
              />
            </Button>
            <div className="hidden min-w-[220px] truncate rounded-md border border-border/70 bg-background/70 px-2 py-2 text-xs font-semibold text-muted-foreground sm:block">
              {message || (cookieSaved ? "已加载本机 Cookie" : "未保存 Cookie")}
            </div>
          </div>
        </div>

        {showCookiePanel && (
          <div className="mx-3 mb-3 grid gap-2 rounded-md border border-border bg-background/80 p-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <textarea
              value={cookie}
              onChange={(event) => setCookie(event.target.value)}
              placeholder="Cookie"
              className="h-14 min-w-0 resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none transition focus:border-ring focus:ring-[3px] focus:ring-ring/50"
            />
            <div className="flex flex-wrap items-center gap-2 md:w-[250px]">
              <Button size="sm" variant="outline" onClick={saveCookie}>
                保存
              </Button>
              <Button size="sm" variant="outline" onClick={clearCookie} disabled={!cookieSaved && !cookie}>
                清除
              </Button>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
                {cookieSaved
                  ? `已保存${cookieUpdatedAt ? ` ${new Date(cookieUpdatedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}`
                  : "未保存"}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] gap-3 max-lg:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-3">
          <LiveStateStrip liveState={liveState} roomInfo={roomInfo} />
        </aside>

        <main className="flex min-h-0 flex-col gap-3">
          {filter !== "score" && (
            <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(8.25rem,1fr))] gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
              <StatCard icon={Activity} label="总事件" value={stats.total} />
              <StatCard icon={Gift} label="礼物" value={stats.gifts} />
              <StatCard icon={MessageSquareText} label="弹幕" value={stats.chats} />
              <StatCard icon={Users} label="用户" value={stats.users} />
              <StatCard icon={BarChart3} label="音浪" value={compactNumber(stats.fanTicket)} />
              <StatCard icon={Users} label="进/离" value={stats.members} />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/25 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {filter === "score" ? (
                  <Swords className="size-4 text-muted-foreground" />
                ) : (
                  <MessageSquareText className="size-4 text-muted-foreground" />
                )}
                <span className="text-xs font-black">{filter === "score" ? "分数监控" : "事件流"}</span>
                {filter === "score" ? (
                  <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {`${liveState.scores.length} 方 · ${completedLiveRounds.length} 场`}
                    {liveState.hasOfficialCountdown
                      ? ` · 剩余 ${countdownText(liveState.countdown)}`
                      : ` · 单场约 ${MATCH_DURATION_SEC / 60} 分钟`}
                    {liveState.matchStatus === "finished" ? " · 已出最终分" : ""}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{filteredLogs.length} 条</span>
                )}
                {filter === "user" && (
                  <span className="hidden text-[11px] font-semibold tabular-nums text-muted-foreground sm:inline">
                    用户 {userRows.length} · 抖音号 {userIdentitySummary.douyin} · 已关联 {userIdentitySummary.linked} · 待补 {userIdentitySummary.pending}
                  </span>
                )}
              </div>
              <div className="flex max-w-full items-center gap-1 overflow-x-auto">
                {filter === "user" && (
                  <>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={exportUsersCsv}
                      disabled={exportableUserRows.length === 0}
                      title="导出用户列表 CSV"
                    >
                      <Download />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={clearCachedUsers}
                      disabled={cachedUsers.length === 0}
                      title="清空有抖音号的用户缓存"
                    >
                      <Eraser />
                    </Button>
                  </>
                )}
                <div className="flex items-center gap-1 rounded-md border border-border/70 bg-background/80 p-0.5">
                  {FILTERS.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => setFilter(item.key)}
                      className={cn(
                        "h-6 shrink-0 rounded-[5px] px-2.5 text-[11px] font-semibold transition",
                        filter === item.key
                          ? "bg-foreground text-background shadow-xs"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {filter === "score" ? (
              <ScoreMonitorPanel
                liveState={liveState}
                roomInfo={roomInfo}
                running={running}
              />
            ) : (
              <>
                {filter === "user" && (
                  <div className="grid grid-cols-3 gap-1 border-b border-border/70 bg-muted/20 p-2 text-center text-[10px] font-bold tabular-nums sm:hidden">
                    <div className="rounded-md bg-background/70 px-1.5 py-1">
                      <div className="text-muted-foreground">抖音号</div>
                      <div>{userIdentitySummary.douyin}</div>
                    </div>
                    <div className="rounded-md bg-background/70 px-1.5 py-1">
                      <div className="text-muted-foreground">已关联</div>
                      <div>{userIdentitySummary.linked}</div>
                    </div>
                    <div className="rounded-md bg-background/70 px-1.5 py-1">
                      <div className="text-muted-foreground">待补</div>
                      <div>{userIdentitySummary.pending}</div>
                    </div>
                  </div>
                )}
                {filter === "user" ? (
                  <div className="grid min-w-[620px] grid-cols-[minmax(150px,1fr)_190px_90px_130px] border-b border-border bg-muted/45 px-3 py-2 text-xs font-semibold text-muted-foreground">
                    <div>昵称</div>
                    <div>抖音号 / 状态</div>
                    <div>财富</div>
                    <div>音浪</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-[72px_58px_minmax(110px,0.55fr)_minmax(130px,0.75fr)_minmax(0,2fr)] border-b border-border bg-muted/45 px-3 py-2 text-xs font-semibold text-muted-foreground">
                    <div>时间</div>
                    <div>类型</div>
                    <div>昵称</div>
                    <div>抖音号</div>
                    <div>内容</div>
                  </div>
                )}
                <div className="h-full overflow-auto pb-10">
                  {filter === "user" ? (
                    userRows.length === 0 ? (
                      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                        暂无用户，等待弹幕、礼物或进场数据
                      </div>
                    ) : (
                      userRows.map((user) => (
                        <div
                          key={user.key}
                          className="grid min-w-[620px] grid-cols-[minmax(150px,1fr)_190px_90px_130px] border-b border-border/70 px-3 py-2 text-xs transition hover:bg-muted/25"
                        >
                          <div className="break-words font-semibold" title={realUserName(user)}>
                            {realUserName(user)}
                            {user.isMystery && <span className="ml-1 text-[10px] text-muted-foreground">脱敏</span>}
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Badge variant={identityStatus(user).tone} className="h-5 shrink-0 px-1.5 text-[10px]">
                                {identityStatus(user).label}
                              </Badge>
                              <span className="truncate font-semibold" title={identityValue(user)}>
                                {identityValue(user)}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={user.douyinId || identityValue(user)}>
                              {user.hasStrongIdentity ? "已识别" : "等待补全"}
                            </div>
                          </div>
                          <div className="tabular-nums">{levelText(user)}</div>
                          <div className="space-y-0.5">
                            <div className="tabular-nums">本场 {compactNumber(user.fanTicket)}</div>
                            <div className="tabular-nums text-muted-foreground">累计 {compactNumber(user.fanTicketCount)}</div>
                            {giftTier(user) && (
                              <Badge
                                variant={giftMoney(user) >= 1000 ? "default" : "outline"}
                                className="h-5 px-1.5 text-[10px] tabular-nums"
                                title={`${moneyText(giftMoney(user))}，礼物 ${user.gifts} 次`}
                              >
                                ¥{giftTier(user)}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))
                    )
                  ) : filteredLogs.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                      暂无数据
                    </div>
                  ) : (
                    filteredLogs.map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-[72px_58px_minmax(110px,0.55fr)_minmax(130px,0.75fr)_minmax(0,2fr)] gap-0 border-b border-border/70 px-3 py-2 text-xs transition hover:bg-muted/25"
                      >
                        <div className="text-muted-foreground">{row.at}</div>
                        <div><Badge variant="outline" className="h-5 px-1.5 text-[10px]">{row.label}</Badge></div>
                        <div className="truncate font-semibold" title={row.name}>{row.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground" title={logIdentityText(row)}>
                          {logIdentityText(row)}
                        </div>
                        <div className="truncate text-muted-foreground" title={compactLogDetail(row, liveState)}>
                          {compactLogDetail(row, liveState)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </section>
      {previewOpen && (
        <div
          ref={previewRef}
          className="app-no-drag fixed z-40 overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
          style={{
            left: previewFrame.x,
            top: previewFrame.y,
            width: previewFrame.width,
            height: previewFrame.height,
          }}
        >
          <div
            className="flex h-10 cursor-move select-none items-center justify-between gap-2 border-b border-border bg-card px-3"
            onPointerDown={beginPreviewDrag}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Grip className="size-4 text-muted-foreground" />
              <span className="truncate text-sm font-bold">直播预览</span>
              <Badge variant={embeddedState.embedded ? "default" : "secondary"} className="h-5 px-1.5 text-[10px]">
                {embeddedState.embedded ? "已连接" : "加载中"}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="outline" onClick={closePreview} title="关闭直播预览">
                <X />
              </Button>
            </div>
          </div>
          <div
            ref={previewStageRef}
            className="relative h-[calc(100%-40px)] bg-black"
          >
            {!embeddedState.embedded && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-white/70">
                正在加载直播画面
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LiveStateStrip({
  liveState,
  roomInfo,
}: {
  liveState: MonitorLiveState;
  roomInfo?: MonitorRoomInfo;
}) {
  const [showRounds, setShowRounds] = useState(false);
  const currentScore = currentScoreSummary(liveState.scores);
  const visibleScores = [...liveState.scores]
    .sort((a, b) => b.score - a.score)
    .slice(0, 9);
  const leaderScore = visibleScores.reduce((max, score) => Math.max(max, score.score), 0);
  const matchRounds = liveState.rounds
    .map((round) => ({ ...round, scores: rankedScores(round.scores.filter(hasEffectiveScore)) }))
    .filter((round) =>
      round.status === "finished"
      && (round.scores.length > 0 || round.mode === "pk" || round.mode === "linkmic")
    );
  const latestRound = matchRounds[matchRounds.length - 1];
  const hostId = roomInfo?.ownerUserId || roomInfo?.ownerDouyinId || roomInfo?.ownerWebRid || "";
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-2 shadow-sm">
        <div className="shrink-0 min-w-0 rounded-md bg-muted/25 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full", liveState.isPkActive ? "bg-primary" : liveState.isLinkmic ? "bg-chart-2" : "bg-muted-foreground/40")} />
            <span className="text-xs font-semibold text-muted-foreground">直播状态</span>
            <Badge variant={liveState.isPkActive ? "default" : liveState.isLinkmic ? "outline" : "secondary"}>
              {liveState.modeLabel}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1 text-xs font-semibold">
            <span className="text-lg font-black leading-none">{liveState.modeLabel === "正常" ? "普通直播" : `${liveState.modeLabel}中`}</span>
            <span className="pb-0.5 tabular-nums text-muted-foreground">
              {liveState.participantCount || 0} {liveState.isPkActive ? "方" : "人"}
            </span>
            {liveState.countdown > 0 && <span>倒计时 {countdownText(liveState.countdown)}</span>}
          </div>
          {(roomInfo?.ownerNickname || hostId) && (
            <div className="mt-2 space-y-0.5 text-[11px] font-semibold text-muted-foreground">
              {roomInfo?.ownerNickname && <div className="truncate" title={roomInfo.ownerNickname}>本房 {roomInfo.ownerNickname}</div>}
              {hostId && (
                <div className="truncate font-mono" title={hostId}>
                  主播ID {hostId}
                </div>
              )}
            </div>
          )}
          <div className="mt-3 rounded-md border border-border/60 bg-background/60 px-3 py-2" title={currentScore}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-muted-foreground">主播分数</div>
              <div className="text-[11px] font-black tabular-nums text-muted-foreground">{visibleScores.length} 方</div>
            </div>
            {visibleScores.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {visibleScores.map((score, index) => (
                  <div key={score.anchorId || index} className="grid grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)_4rem] items-center gap-2">
                    <div className="truncate text-[11px] font-semibold text-muted-foreground" title={displayScoreName(score) || preferredAnchorId(score, roomInfo)}>
                      {displayScoreName(score) || compactId(preferredAnchorId(score, roomInfo)) || `第${index + 1}方`}
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-border/60">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          score.score > 0 && score.score === leaderScore ? "bg-primary" : "bg-muted-foreground/45"
                        )}
                        style={{
                          width: `${leaderScore > 0 ? Math.max(4, Math.min(100, (score.score / leaderScore) * 100)) : 0}%`,
                        }}
                      />
                    </div>
                    <div className="truncate text-right text-sm font-black tabular-nums">
                      {scorePointText(score)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 truncate text-sm font-black tabular-nums text-muted-foreground">
                {currentScore}
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md bg-muted/25">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">分数场次</span>
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {matchRounds.length} 场
            </Badge>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {matchRounds.length === 0 ? (
              <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 text-center">
                <Swords className="size-5 text-muted-foreground" />
                <div className="text-xs font-semibold text-muted-foreground">
                  {liveState.isPkActive || liveState.isLinkmic ? "当前 PK / 连麦进行中" : "暂无已结束场次"}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {matchRounds.slice().reverse().slice(0, 8).map((round) => (
                  <button
                    key={`${round.round}-${round.battleId}`}
                    type="button"
                    onClick={() => setShowRounds(true)}
                    className="w-full rounded-md border border-border/70 bg-background/60 px-2.5 py-2 text-left transition hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    title={scoreSummary(round.scores)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black">第 {round.round} 场 · {round.modeLabel || "未知"}</span>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
                        {round.status === "finished" ? "最终分 · " : ""}{round.scores.length} 方
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {round.status === "finished" && round.winnerName ? `胜者 ${round.winnerName} · ` : ""}{roundScoreSummary(round)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowRounds(true)}
            disabled={matchRounds.length === 0}
            className="shrink-0 border-t border-border/60 px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground transition hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            title={matchRounds.map((round) => `第${round.round}场 ${scoreSummary(round.scores)}`).join(" | ")}
          >
            {latestRound ? `最新 第${latestRound.round}场 · ${roundScoreSummary(latestRound)}` : "PK / 连麦结束后显示场次"}
          </button>
        </div>
      </div>
      <PkRoundsDialog
        open={showRounds}
        onClose={() => setShowRounds(false)}
        rounds={matchRounds}
        roomInfo={roomInfo}
      />
    </>
  );
}

function ScoreMonitorPanel({
  liveState,
  roomInfo,
  running,
}: {
  liveState: MonitorLiveState;
  roomInfo: MonitorRoomInfo;
  running: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const hostIds = [roomInfo.ownerUserId, roomInfo.ownerDouyinId, roomInfo.ownerWebRid, roomInfo.ownerSecUid].filter(Boolean);
  const hostId = roomInfo.ownerUserId || roomInfo.ownerDouyinId || roomInfo.ownerWebRid || roomInfo.ownerSecUid || "";
  const visibleScores = rankedScores(liveState.scores).slice(0, 12);
  const leaderScore = visibleScores.reduce((max, score) => Math.max(max, score.score), 0);
  const trackedRounds = liveState.rounds
    .map((round) => ({ ...round, scores: rankedScores(round.scores.filter(hasEffectiveScore)) }))
    .filter((round) => round.scores.length > 0 || round.mode === "pk" || round.mode === "linkmic")
    .slice()
    .reverse();
  const finishedRounds = trackedRounds.filter((round) => round.status === "finished");
  const activeRound = liveState.rounds[liveState.rounds.length - 1];
  const latestFinished = [...liveState.rounds].reverse().find((round) => round.status === "finished" && round.scores.some(hasEffectiveScore));
  const startedAtText = activeRound?.startedAt || liveState.currentMatchStartedAt;
  const startedMs = parseClockToMs(startedAtText);
  const elapsedSec = Number.isFinite(startedMs)
    ? Math.max(0, Math.floor((nowMs - startedMs) / 1000))
    : 0;
  const hasOfficialCountdown = liveState.hasOfficialCountdown;
  const remainingSec = hasOfficialCountdown
    ? Math.max(0, Math.floor(liveState.countdown))
    : Math.max(0, MATCH_DURATION_SEC - elapsedSec);
  const progressBase = hasOfficialCountdown
    ? Math.max(remainingSec, elapsedSec, 1)
    : MATCH_DURATION_SEC;
  const progress = hasOfficialCountdown
    ? Math.min(100, Math.max(0, ((progressBase - remainingSec) / progressBase) * 100))
    : Math.min(100, Math.max(0, (elapsedSec / MATCH_DURATION_SEC) * 100));
  const modeText = liveState.isPkActive
    ? "PK"
    : liveState.isLinkmic
      ? "连麦"
      : liveState.matchStatus === "finished"
        ? (activeRound?.modeLabel || latestFinished?.modeLabel || liveState.modeLabel || "已结束")
        : liveState.modeLabel || "正常";
  const showTimer = liveState.isPkActive || liveState.isLinkmic || liveState.matchStatus === "running" || hasOfficialCountdown;
  const finalRound = liveState.matchStatus === "finished"
    ? (activeRound?.status === "finished" ? activeRound : latestFinished)
    : null;
  const finalScores = finalRound ? rankedScores(finalRound.scores.filter(hasEffectiveScore)) : [];
  const winnerName = finalRound?.winnerName || (finalScores[0] ? (displayScoreName(finalScores[0]) || finalScores[0].anchorId) : "");

  return (
    <div className="h-full overflow-auto p-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-3">
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={liveState.isPkActive ? "default" : liveState.isLinkmic ? "outline" : "secondary"}>
                    {modeText}
                  </Badge>
                  <Badge variant={running ? "default" : "secondary"}>{running ? "采集中" : "未开始"}</Badge>
                  {liveState.matchStatus === "finished" && <Badge variant="default">最终分已锁定</Badge>}
                  {liveState.phase && <Badge variant="outline">阶段 {liveState.phase}</Badge>}
                  <Badge variant="outline">已完成 {finishedRounds.length} 场</Badge>
                </div>
                <div className="truncate text-base font-black" title={roomInfo.title || "未识别直播间"}>
                  {roomInfo.title || "等待房间信息"}
                </div>
                <div className="text-xs font-semibold text-muted-foreground">
                  {roomInfo.ownerNickname ? `本房主播 ${roomInfo.ownerNickname}` : "本房主播待识别"}
                </div>
              </div>
              <div className="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-right">
                <div className="text-[11px] font-semibold text-muted-foreground">主播 ID</div>
                <div className="mt-0.5 font-mono text-sm font-black tabular-nums" title={hostId || "-"}>
                  {hostId || "-"}
                </div>
                {roomInfo.ownerDouyinId && roomInfo.ownerDouyinId !== hostId && (
                  <div className="mt-1 text-[11px] font-semibold text-muted-foreground" title={roomInfo.ownerDouyinId}>
                    抖音号 {roomInfo.ownerDouyinId}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">当前形态</div>
                <div className="mt-1 text-sm font-black">{modeText}</div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">参与方</div>
                <div className="mt-1 text-sm font-black tabular-nums">
                  {liveState.participantCount || visibleScores.length || 0}
                  {liveState.isPkActive || activeRound?.mode === "pk" ? " 方" : " 人"}
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">已进行</div>
                <div className="mt-1 text-sm font-black tabular-nums">
                  {showTimer && Number.isFinite(startedMs) ? formatElapsed(elapsedSec) : "--:--"}
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">
                  {hasOfficialCountdown ? (remainingSec > 0 ? "官方倒计时" : "倒计时") : "剩余约"}
                </div>
                <div className="mt-1 text-sm font-black tabular-nums">
                  {!showTimer && liveState.matchStatus !== "finished"
                    ? "--:--"
                    : hasOfficialCountdown
                      ? (remainingSec > 0 ? countdownText(remainingSec) : "已结束")
                      : formatElapsed(remainingSec)}
                </div>
              </div>
            </div>

            {showTimer && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                  <span>场次进度</span>
                  <span className="tabular-nums">{Math.round(progress)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-border/60">
                  <div
                    className={cn("h-full rounded-full", liveState.isPkActive ? "bg-primary" : "bg-chart-2")}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {finishedRounds.length > 0 && (
            <div className="rounded-lg border border-border/70 bg-background/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-black">多场最终分总表</div>
                <div className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                  已锁定 {finishedRounds.length} 场
                </div>
              </div>
              <div className="mt-2 space-y-2">
                {finishedRounds.slice(0, 12).map((round) => {
                  const top = rankedScores(round.scores).slice(0, 3);
                  return (
                    <div key={`board-${round.round}-${round.battleId}`} className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[11px] font-black">
                          第 {round.round} 场 · {round.modeLabel || "PK"} · 胜 {round.winnerName || "-"}
                        </div>
                        <div className="text-[10px] font-semibold text-muted-foreground">
                          {round.startedAt || "--:--"}{round.endedAt ? ` → ${round.endedAt}` : ""}
                        </div>
                      </div>
                      <div className="mt-1 truncate text-[11px] font-semibold tabular-nums text-muted-foreground" title={top.map((s) => `${displayScoreName(s) || s.anchorId} ${s.score}`).join(" / ")}>
                        {top.map((s) => `${displayScoreName(s) || compactId(preferredAnchorId(s, roomInfo))} ${scorePointText(s)}`).join(" / ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {finalScores.length > 0 && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-black">最近一场最终比分</div>
                <div className="text-[11px] font-semibold text-muted-foreground">
                  第 {finalRound?.round} 场 · {finalRound?.modeLabel || "PK"} · 胜者 {winnerName || "-"}
                </div>
              </div>
              <div className="mt-2 space-y-1.5">
                {finalScores.map((score, index) => {
                  const anchorId = preferredAnchorId(score, roomInfo);
                  const isHost = hostIds.includes(score.anchorId) || hostIds.includes(anchorId);
                  const isWinner = Boolean(finalRound?.winnerId) && (finalRound?.winnerId === score.anchorId || finalRound?.winnerId === anchorId);
                  return (
                    <div key={`final-${score.anchorId}-${index}`} className="grid grid-cols-[48px_minmax(0,1fr)_140px_100px] items-center gap-2 text-xs">
                      <div className="font-black tabular-nums text-muted-foreground">#{index + 1}</div>
                      <div className="min-w-0 truncate font-bold" title={displayScoreName(score) || anchorId}>
                        {displayScoreName(score) || compactId(anchorId) || `第${index + 1}方`}
                        {isHost ? " · 本房" : ""}
                        {isWinner ? " · 胜" : ""}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground" title={anchorId}>{anchorId || "-"}</div>
                      <div className="text-right text-sm font-black tabular-nums">{scorePointText(score)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border/70 bg-background/50">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
              <div className="text-xs font-black">{liveState.matchStatus === "finished" ? "最终/实时比分" : "实时比分"}</div>
              <div className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                {visibleScores.length} 方
              </div>
            </div>
            {visibleScores.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 text-center">
                <Swords className="size-6 text-muted-foreground" />
                <div className="text-sm font-semibold">暂无分数</div>
                <div className="text-xs text-muted-foreground">
                  进入连麦或 PK 后自动记分；结束后写入场次账本，日志截断也不会丢最终分
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                <div className="grid grid-cols-[48px_minmax(0,1fr)_140px_100px] gap-2 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                  <div>排名</div>
                  <div>主播</div>
                  <div>主播 ID</div>
                  <div className="text-right">分数</div>
                </div>
                {visibleScores.map((score, index) => {
                  const anchorId = preferredAnchorId(score, roomInfo);
                  const isHost = hostIds.includes(score.anchorId) || hostIds.includes(anchorId);
                  return (
                    <div
                      key={`${score.anchorId}-${index}`}
                      className="grid grid-cols-[48px_minmax(0,1fr)_140px_100px] items-center gap-2 px-3 py-2.5 text-xs"
                    >
                      <div className="font-black tabular-nums text-muted-foreground">#{index + 1}</div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-bold" title={displayScoreName(score) || anchorId}>
                            {displayScoreName(score) || compactId(anchorId) || `第${index + 1}方`}
                          </span>
                          {isHost && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">本房</Badge>}
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border/60">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              score.score > 0 && score.score === leaderScore ? "bg-primary" : "bg-muted-foreground/45"
                            )}
                            style={{
                              width: `${leaderScore > 0 ? Math.max(4, Math.min(100, (score.score / leaderScore) * 100)) : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground" title={anchorId}>
                        {anchorId || "-"}
                      </div>
                      <div className="text-right text-sm font-black tabular-nums">{scorePointText(score)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-background/50">
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
            <div className="text-xs font-black">场次账本</div>
            <div className="text-[11px] font-semibold tabular-nums text-muted-foreground">
              已完成 {finishedRounds.length} 场
            </div>
          </div>
          {finishedRounds.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 text-center">
              <BarChart3 className="size-6 text-muted-foreground" />
              <div className="text-sm font-semibold">
                {liveState.isPkActive || liveState.isLinkmic ? "等待当前 PK / 连麦结束" : "还没有完整场次"}
              </div>
              <div className="text-xs text-muted-foreground">
                结束并锁定最终分后显示回合
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {finishedRounds.map((round) => (
                <div key={`${round.round}-${round.battleId}`} className="px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={round.mode === "pk" ? "default" : round.mode === "linkmic" ? "outline" : "secondary"}>
                        第 {round.round} 场 · {round.modeLabel || "未知"}
                      </Badge>
                      <Badge variant={round.status === "finished" ? "default" : "secondary"}>
                        {round.status === "finished" ? "最终分" : "进行中"}
                      </Badge>
                      {round.phase && (
                        <span className="text-[11px] font-semibold text-muted-foreground">阶段 {round.phase}</span>
                      )}
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {round.startedAt || "--:--"}
                        {round.endedAt ? ` → ${round.endedAt}` : " · 进行中"}
                      </span>
                    </div>
                    <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                      {round.scores.length} 方
                    </span>
                  </div>
                  {round.status === "finished" && round.winnerName && (
                    <div className="mt-1 text-[11px] font-semibold text-muted-foreground">
                      胜者 {round.winnerName}
                    </div>
                  )}
                  <div className="mt-2 space-y-1.5">
                    {round.scores.map((score, index) => {
                      const anchorId = preferredAnchorId(score, roomInfo);
                      const isWinner = round.winnerId === score.anchorId || round.winnerId === anchorId;
                      return (
                        <div
                          key={`${round.round}-${score.anchorId}`}
                          className="grid grid-cols-[minmax(0,1fr)_120px_88px] items-center gap-2 text-xs"
                        >
                          <div className="truncate font-semibold" title={displayScoreName(score) || anchorId}>
                            #{index + 1} {displayScoreName(score) || compactId(anchorId) || "未知主播"}
                            {isWinner ? " · 胜" : ""}
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground" title={anchorId}>
                            {compactId(anchorId)}
                          </div>
                          <div className="text-right font-black tabular-nums">{scorePointText(score)}</div>
                        </div>
                      );
                    })}
                  </div>
                  {round.battleId && (
                    <div className="mt-2 truncate text-[10px] font-semibold text-muted-foreground" title={round.battleId}>
                      battle {compactId(round.battleId)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PkRoundsDialog({
  open,
  onClose,
  rounds,
  roomInfo,
}: {
  open: boolean;
  onClose: () => void;
  rounds: MonitorRoundRow[];
  roomInfo?: MonitorRoomInfo;
}) {
  if (!open) return null;
  const visibleRounds = rounds
    .map((round) => ({
      ...round,
      scores: round.scores.filter((score) => score.score > 0 || scoreNumber(score.scoreText) > 0),
    }))
    .filter((round) => round.status === "finished" && round.scores.length > 0);
  return (
    <div
      className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pk-rounds-title"
        className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 id="pk-rounds-title" className="truncate text-base font-black">
              分数场次汇总
            </h3>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              本次监控共 {visibleRounds.length} 场 PK / 连麦
            </p>
          </div>
          <Button size="icon-sm" variant="outline" onClick={onClose} title="关闭">
            <X />
          </Button>
        </div>

        <div className="min-h-0 overflow-auto p-4">
          {visibleRounds.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center">
              <Swords className="size-6 text-muted-foreground" />
              <div className="text-sm font-semibold">暂无场次</div>
              <div className="text-xs text-muted-foreground">开始监控后，分数快照会自动汇总到这里</div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visibleRounds.map((round) => (
                <div key={`${round.round}-${round.battleId}`} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/35 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">第 {round.round} 场 · {round.modeLabel || "未知"}</Badge>
                      <Badge variant={round.status === "finished" ? "default" : "outline"}>
                        {round.status === "finished" ? "最终分" : "进行中"}
                      </Badge>
                      <span className="text-xs font-semibold text-muted-foreground">
                        battle {compactId(round.battleId)}
                      </span>
                    </div>
                    <span className="text-xs font-black tabular-nums">
                      {round.winnerName ? `胜者 ${round.winnerName} · ` : ""}{round.scores.length} 位主播
                    </span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] border-b border-border bg-background/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                    <div>主播 ID</div>
                    <div className="text-right">分数</div>
                  </div>
                  {round.scores.map((score) => {
                    const anchorId = preferredAnchorId(score, roomInfo);
                    return (
                      <div
                        key={`${round.round}-${score.anchorId}`}
                        className="grid grid-cols-[minmax(0,1fr)_120px] border-b border-border/60 px-3 py-2 text-xs last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-bold" title={anchorId}>
                            {anchorId || "-"}
                          </div>
                          {displayScoreName(score) && (
                            <div className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground" title={displayScoreName(score)}>
                              {displayScoreName(score)}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-sm font-black tabular-nums">
                          {scorePointText(score)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-background/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className="flex size-6 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="mt-1 truncate text-base font-black tabular-nums">{value || 0}</div>
    </div>
  );
}
