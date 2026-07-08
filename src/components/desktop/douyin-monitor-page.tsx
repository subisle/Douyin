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
type MonitorFilter = "all" | MonitorLogType | "user";

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
  score: number;
  scoreText: string;
  scoreRelative: boolean;
  multiPkTeamScore: number;
  source: string;
}

interface MonitorRoundRow {
  round: number;
  battleId: string;
  scores: MonitorScoreRow[];
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
  phase: string;
  scores: MonitorScoreRow[];
  rounds: MonitorRoundRow[];
  updatedAt: string;
}

const FILTERS: { key: MonitorFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "gift", label: "礼物" },
  { key: "chat", label: "弹幕" },
  { key: "member", label: "进/离" },
  { key: "event", label: "事件" },
  { key: "user", label: "用户" },
];
const USER_CACHE_STORAGE_KEY = "douyin-monitor-user-cache-v1";

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

function giftLabelFromPayload(payload: Record<string, unknown>) {
  const giftName = safeText(payload.giftName) || safeText(payload.giftId);
  if (!giftName) return "";
  const count = giftCountFromPayload(payload);
  return `${giftName} x${count}`;
}

function giftCountFromPayload(payload: Record<string, unknown>) {
  return Math.max(1, safeNumber(payload.count));
}

function mergeGiftNames(...lists: string[][]) {
  const totals = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      const text = safeText(item);
      if (!text) continue;
      const match = text.match(/^(.*?)\s*x(\d+)$/i);
      const name = (match?.[1] || text).trim();
      const count = match?.[2] ? Number(match[2]) || 1 : 1;
      totals.set(name, (totals.get(name) || 0) + count);
    }
  }
  return Array.from(totals.entries()).map(([name, count]) => `${name} x${count}`);
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
    gifts: type === "gift" ? giftCountFromPayload(payload) : 0,
    giftNames: type === "gift" ? [giftLabelFromPayload(payload)].filter(Boolean) : [],
    members: type === "member" ? 1 : 0,
    fanTicket,
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
    if (Boolean(a.douyinId) !== Boolean(b.douyinId)) return a.douyinId ? -1 : 1;
    if (a.hasStrongIdentity !== b.hasStrongIdentity) return a.hasStrongIdentity ? -1 : 1;
    const timeDelta = new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
    if (timeDelta) return timeDelta;
    return b.fanTicket - a.fanTicket;
  });
}

function sameCachedUsers(left: MonitorUserRow[], right: MonitorUserRow[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function collectUsersFromLog(row: MonitorLogRow) {
  const payload = row.payload as Record<string, unknown>;
  const users: MonitorUserRow[] = [];
  const push = (item: unknown, type = row.type) => {
    if (!item || typeof item !== "object") return;
    const user = userFromPayload(item as Record<string, unknown>, type, row.at);
    if (user) users.push(user);
  };

  if (row.type === "gift") {
    push(payload, "gift");
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
  if (payload.cacheHit) parts.push("缓存命中");
  if (payload.isMystery) parts.push(`神秘人${payload.mysteryMan ? `L${payload.mysteryMan}` : ""}`);
  if (payload.displayName && payload.realName && payload.displayName !== payload.realName) {
    parts.push(`${payload.displayName} -> ${payload.realName}`);
  }
  if (payload.uniqueId) parts.push(`抖音号:${payload.uniqueId}`);
  if (payload.wealthLevel || payload.consumeLevel) {
    parts.push(`财富等级:${payload.wealthLevel || payload.consumeLevel}`);
  }
  if (payload.payScore) parts.push(`付费分:${payload.payScore}`);
  if (payload.totalRechargeDiamondCount) parts.push(`充值钻石:${payload.totalRechargeDiamondCount}`);
  if (payload.fanTicketCount) parts.push(`粉丝票:${payload.fanTicketCount}`);
  if (payload.ipLocation) parts.push(`IP:${payload.ipLocation}`);
  if (payload.followerCount) parts.push(`粉丝:${payload.followerCount}`);
  return parts.join(" / ");
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
  let phase = "";
  let updatedAt = "";

  const ensureRound = (battleId: string, forceNew = false) => {
    const nextBattleId = battleId || currentBattleId || `round-${round || 1}`;
    const isSameBattle = battleId && sameBattleId(battleId, currentBattleId);
    if (forceNew || round === 0 || (battleId && currentBattleId && !isSameBattle)) {
      round = round + 1;
      currentBattleId = nextBattleId;
      scores.clear();
      rounds.push({ round, battleId: nextBattleId, scores: [] });
    } else if (battleId) {
      currentBattleId = preferBattleId(currentBattleId, battleId);
      if (round > 0) rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], battleId: currentBattleId };
    }
  };

  const snapshotRound = () => {
    if (round === 0) return;
    rounds[rounds.length - 1] = {
      round,
      battleId: currentBattleId,
      scores: Array.from(scores.values()),
    };
  };

  const applyScores = (nextScores: MonitorScoreRow[], replace: boolean) => {
    if (nextScores.length === 0) return;
    if (replace) scores.clear();
    nextScores.forEach((score) => scores.set(score.anchorId, score));
    participantCount = Math.max(participantCount, scores.size);
    snapshotRound();
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
        }
        phase = safeText(payload.battlePhase) || phase;
        updatedAt = row.at || updatedAt;
      }

      if (eventType === "room-info") {
        rememberRoomOwner(payload);
      }

      if (eventType === "pk-battle" || eventType === "pk-score-snapshot") {
        const battleId = safeText(payload.battleId);
        ensureRound(battleId, Boolean(battleId && currentBattleId && !sameBattleId(battleId, currentBattleId)));
        const nextScores = scoreRowsFromEvent(payload as LivePkEventPayload, eventType);
        applyScores(nextScores, true);
      } else if (eventType === "linkmic-score") {
        const nextScores = scoreRowsFromEvent(payload as LivePkEventPayload, eventType);
        applyScores(nextScores, false);
      }
    }

    if (row.type === "rank") {
      if (isAnchorScoreRankPayload(payload)) {
        ensureRound(safeText(payload.battleId));
        const nextScores = Array.isArray(payload.ranks)
          ? dedupeScoreRows(payload.ranks.map((rank) => scoreFromPayload(rank, "interaction-score")).filter(Boolean) as MonitorScoreRow[])
          : [];
        applyScores(nextScores, false);
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

  return {
    mode,
    modeLabel,
    isPkActive,
    isLinkmic,
    participantCount,
    battleId: currentBattleId,
    channelId,
    countdown,
    phase,
    scores: currentScores,
    rounds,
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
    const rmb = safeNumber(gift.diamondCount) * safeNumber(gift.count) / 10;
    return [
      `${row.name}${identity} 送出 ${gift.giftName || "礼物"} x${gift.count || 1}`,
      rmb ? moneyText(rmb) : "",
      gift.fanTicket ? `音浪 ${compactNumber(gift.fanTicket)}` : "",
    ].filter(Boolean).join(" · ");
  }
  if (row.type === "chat") {
    const chat = payload as unknown as LivePkChatPayload;
    return `${row.name}${identity}: ${chat.content || row.detail}`;
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

export function DouyinMonitorPage() {
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
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [busy, setBusy] = useState(false);
  const [liveScores, setLiveScores] = useState<MonitorScoreRow[]>([]);
  const liveScoresRef = useRef<MonitorScoreRow[]>([]);
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
    ].slice(0, 800));
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
      if (next.status !== "running") {
        clearLiveScores();
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
      const giftDetail = [
        identityDetail(payload),
        `${payload.giftName || payload.giftId || "礼物"} x${payload.count}`,
        payload.giftKind ? `类型 ${payload.giftKind}` : "",
        payload.giftType ? `礼物类型 ${payload.giftType}` : "",
        payload.giftScene ? `场景 ${payload.giftScene}` : "",
        payload.diamondCount ? `单价 ${payload.diamondCount}` : "",
        payload.baseScore ? `基础 ${payload.baseScore}` : "",
        `实际 ${payload.fanTicket || 0}`,
        payload.bonusScore ? `加成 +${payload.bonusScore}` : "",
        payload.roomFanTicketCount ? `房间累计 ${payload.roomFanTicketCount}` : "",
        payload.giftDescribe || "",
      ].filter(Boolean).join(" / ");
      appendRows([{
        at: formatTime(payload.at),
        type: "gift",
        label: "礼物",
        name: monitorName(payload),
        userId: payload.uniqueId || "",
        value: String(payload.fanTicket || ""),
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
        detail: [identityDetail(payload), payload.content].filter(Boolean).join(" / "),
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
        detail: [identityDetail(payload), actionLabel !== "进场" ? actionLabel : ""].filter(Boolean).join(" / "),
        payload,
      }]);
    }) ?? (() => undefined);
    const offRank = api.onLivePkRank?.((payload: LivePkRankPayload) => {
      const nextScores = scoreRowsFromRankPayload(payload);
      commitLiveScores((current) => mergeScoreRows(current, nextScores, true));
    }) ?? (() => undefined);
    const offEvent = api.onLivePkEvent?.((payload: LivePkEventPayload) => {
      syncLiveCountdown(payload);
      if (payload.eventType === "pk-battle" || payload.eventType === "pk-score-snapshot") {
        if (Object.prototype.hasOwnProperty.call(payload, "isPkActive") && !safeBoolean(payload.isPkActive)) {
          clearLiveScores();
          clearLiveCountdown();
        } else {
          commitLiveScores((current) => mergeScoreRows(current, scoreRowsFromEvent(payload, payload.eventType), true));
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
  }, [appendRows, clearLiveCountdown, clearLiveScores, commitLiveScores, syncLiveCountdown]);

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
    const api = getDataApi();
    void api?.readLivePkCookie?.().then((result) => {
      if (!result.success || !result.data.saved || !result.data.cookie) return;
      setCookie(result.data.cookie);
      setCookieSaved(true);
      setCookieUpdatedAt(result.data.updatedAt || null);
      setMessage("已加载本机保存的 Cookie");
    });
  }, []);

  useEffect(() => {
    return () => {
      void getDataApi()?.stopLivePkMonitor?.();
    };
  }, []);

  const currentLogUsers = useMemo(() => {
    const users: MonitorUserRow[] = [];
    const profileUsers: MonitorUserRow[] = [];
    const anchorIds = new Set<string>();
    let currentRoom: MonitorRoomAppearance | null = null;
    for (const row of logs.slice().reverse()) {
      const payload = row.payload as Record<string, unknown>;
      if (row.type === "event" && payload.eventType === "room-info") {
        currentRoom = roomAppearanceFromPayload(payload, liveRoomUrl);
        collectAnchorIdsFromRoomInfoPayload(payload).forEach((id) => anchorIds.add(id));
      }
      for (const user of collectUsersFromLog(row)) {
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
    return liveCountdownMs > 0
      ? { ...next, countdown: liveCountdownMs / 1000 }
      : next;
  }, [liveCountdownMs, liveScores, logs]);

  const stats = useMemo(() => {
    const giftRows = logs.filter((row) => row.type === "gift");
    const eventRows = logs.filter((row) => row.type === "event");
    const online = eventRows.find((row) => {
      const payload = row.payload as LivePkEventPayload;
      return payload.eventType === "room-stats" || payload.eventType === "room-user-seq";
    });
    const roomFanTicket = giftRows.reduce((max, row) => {
      const payload = row.payload as LivePkGiftPayload;
      return Math.max(max, Number(payload.roomFanTicketCount || 0));
    }, 0);
    return {
      total: logs.length,
      gifts: giftRows.reduce((total, row) => total + giftCountFromPayload(row.payload as Record<string, unknown>), 0),
      chats: logs.filter((row) => row.type === "chat").length,
      members: logs.filter((row) => row.type === "member").length,
      events: eventRows.length,
      users: userRows.length,
      fanTicket: roomFanTicket,
      online: roomInfo.onlineText || online?.value || "",
    };
  }, [logs, roomInfo.onlineText, userRows.length]);

  const filteredLogs = useMemo(
    () => logs.filter((row) => filter === "all" || (filter !== "user" && row.type === filter)),
    [filter, logs]
  );

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
    setBusy(true);
    const result = await api?.stopLivePkMonitor?.();
    setBusy(false);
    if (result?.success) setStatus(result.data);
    if (result?.success) {
      clearLiveScores();
      clearLiveCountdown();
    }
    setPreviewOpen(false);
    setEmbeddedState({ embedded: false, liveRoomUrl: "" });
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
      row.detail,
    ]);
    const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");
    downloadText(`抖音直播监控_${Date.now()}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
  };

  const exportJson = () => {
    downloadText(
      `抖音直播监控_${Date.now()}.json`,
      JSON.stringify(logs.slice().reverse(), null, 2),
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
      ...user,
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

  const running = status.status === "running";

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
              onClick={() => setLogs([])}
              disabled={logs.length === 0}
              title="清空日志"
            >
              <Eraser />
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
          <LiveStateStrip liveState={liveState} />
        </aside>

        <main className="flex min-h-0 flex-col gap-3">
          <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(8.25rem,1fr))] gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
            <StatCard icon={Activity} label="总事件" value={stats.total} />
            <StatCard icon={Gift} label="礼物" value={stats.gifts} />
            <StatCard icon={MessageSquareText} label="弹幕" value={stats.chats} />
            <StatCard icon={Users} label="用户" value={stats.users} />
            <StatCard icon={BarChart3} label="音浪" value={compactNumber(stats.fanTicket)} />
            <StatCard icon={Users} label="进/离" value={stats.members} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/25 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <MessageSquareText className="size-4 text-muted-foreground" />
                <span className="text-xs font-black">事件流</span>
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{filteredLogs.length} 条</span>
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
}: {
  liveState: MonitorLiveState;
}) {
  const [showRounds, setShowRounds] = useState(false);
  const latestRound = liveState.rounds[liveState.rounds.length - 1];
  const currentScore = currentScoreSummary(liveState.scores);
  const visibleScores = [...liveState.scores]
    .sort((a, b) => b.score - a.score)
    .slice(0, 9);
  const leaderScore = visibleScores.reduce((max, score) => Math.max(max, score.score), 0);
  const pkRounds = liveState.rounds
    .map((round) => ({ ...round, scores: round.scores.filter(hasEffectiveScore) }))
    .filter((round) => round.scores.length > 0);
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
          <div className="mt-3 rounded-md border border-border/60 bg-background/60 px-3 py-2" title={currentScore}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-muted-foreground">主播分数</div>
              <div className="text-[11px] font-black tabular-nums text-muted-foreground">{visibleScores.length} 方</div>
            </div>
            {visibleScores.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {visibleScores.map((score, index) => (
                  <div key={score.anchorId || index} className="grid grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)_4rem] items-center gap-2">
                    <div className="truncate text-[11px] font-semibold text-muted-foreground" title={displayScoreName(score) || score.anchorId}>
                      {displayScoreName(score) || compactId(score.anchorId) || `第${index + 1}方`}
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
            <span className="text-xs font-semibold text-muted-foreground">PK 分数回合</span>
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {pkRounds.length} 场
            </Badge>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {pkRounds.length === 0 ? (
              <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 text-center">
                <Swords className="size-5 text-muted-foreground" />
                <div className="text-xs font-semibold text-muted-foreground">暂无 PK 回合</div>
              </div>
            ) : (
              <div className="space-y-2">
                {pkRounds.slice().reverse().slice(0, 8).map((round) => (
                  <button
                    key={`${round.round}-${round.battleId}`}
                    type="button"
                    onClick={() => setShowRounds(true)}
                    className="w-full rounded-md border border-border/70 bg-background/60 px-2.5 py-2 text-left transition hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    title={scoreSummary(round.scores)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black">第 {round.round} 场</span>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{round.scores.length} 方</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {roundScoreSummary(round)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowRounds(true)}
            disabled={pkRounds.length === 0}
            className="shrink-0 border-t border-border/60 px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground transition hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            title={pkRounds.map((round) => `第${round.round}轮 ${scoreSummary(round.scores)}`).join(" | ")}
          >
            {latestRound ? `最新 第${latestRound.round}场 · ${roundScoreSummary(latestRound)}` : "开始监控后自动汇总 PK 分数"}
          </button>
        </div>
      </div>
      <PkRoundsDialog
        open={showRounds}
        onClose={() => setShowRounds(false)}
        rounds={pkRounds}
      />
    </>
  );
}

function PkRoundsDialog({
  open,
  onClose,
  rounds,
}: {
  open: boolean;
  onClose: () => void;
  rounds: MonitorRoundRow[];
}) {
  if (!open) return null;
  const visibleRounds = rounds
    .map((round) => ({
      ...round,
      scores: round.scores.filter((score) => score.score > 0 || scoreNumber(score.scoreText) > 0),
    }))
    .filter((round) => round.scores.length > 0);
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
              PK 场次汇总
            </h3>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              本次监控共 {visibleRounds.length} 场 PK
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
              <div className="text-sm font-semibold">暂无 PK 场次</div>
              <div className="text-xs text-muted-foreground">开始监控后，PK 分数快照会自动汇总到这里</div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visibleRounds.map((round) => (
                <div key={`${round.round}-${round.battleId}`} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/35 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">第 {round.round} 场</Badge>
                      <span className="text-xs font-semibold text-muted-foreground">
                        battle {compactId(round.battleId)}
                      </span>
                    </div>
                    <span className="text-xs font-black tabular-nums">{round.scores.length} 位主播</span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] border-b border-border bg-background/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                    <div>主播 ID</div>
                    <div className="text-right">分数</div>
                  </div>
                  {round.scores.map((score) => (
                    <div
                      key={`${round.round}-${score.anchorId}`}
                      className="grid grid-cols-[minmax(0,1fr)_120px] border-b border-border/60 px-3 py-2 text-xs last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-bold" title={score.anchorId}>
                          {score.anchorId || "-"}
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
                  ))}
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
