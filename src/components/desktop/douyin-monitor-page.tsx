"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Download,
  Eraser,
  Gift,
  MessageSquareText,
  Play,
  Square,
  Users,
} from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  IpcResult,
  LivePkChatPayload,
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

interface MonitorUserRow {
  key: string;
  nickname: string;
  displayName: string;
  realName: string;
  douyinId: string;
  userId: string;
  secUid: string;
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
  members: number;
  fanTicket: number;
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
  { key: "member", label: "进场" },
  { key: "rank", label: "分数" },
  { key: "event", label: "事件" },
  { key: "user", label: "用户" },
  { key: "status", label: "状态" },
];

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

function compactId(value: string) {
  if (!value) return "-";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function moneyText(value: number) {
  return `¥${value.toFixed(2)}`;
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

function scoreFromPayload(value: unknown): MonitorScoreRow | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const anchorId =
    safeText(payload.anchorId) ||
    safeText(payload.anchorID) ||
    safeText(payload.userId) ||
    safeText(payload.userID) ||
    safeText(payload.openId);
  if (!anchorId || anchorId === "0") return null;
  const name =
    safeText(payload.realName) ||
    safeText(payload.displayName) ||
    safeText(payload.nickname) ||
    safeText(payload.anchorName);
  const scoreText =
    safeText(payload.scoreText) ||
    safeText(payload.score_str) ||
    safeText(payload.multiPkTeamScoreText);
  const score = scoreNumber(payload.score) || scoreNumber(scoreText) || scoreNumber(payload.multiPkTeamScore);
  return {
    anchorId,
    name,
    score,
    scoreText: scoreText || compactNumber(score),
  };
}

function scoreSummary(scores: MonitorScoreRow[], limit = 4) {
  if (scores.length === 0) return "暂无";
  return scores
    .slice(0, limit)
    .map((score) => `${score.name || compactId(score.anchorId)} ${score.scoreText || compactNumber(score.score)}`)
    .join(" / ");
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

function userKey(payload: Partial<MonitorUserRow> & {
  uniqueId?: string;
}) {
  return (
    payload.userId ||
    payload.secUid ||
    payload.uniqueId ||
    payload.douyinId ||
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
  douyinId?: string;
}) {
  const userId = String(payload.userId || "").trim();
  return Boolean(
    payload.secUid ||
    payload.uniqueId ||
    payload.douyinId ||
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
  })) {
    return "礼物消息";
  }
  if (safeText(payload.uniqueId)) return "抖音号字段";
  if (safeText(payload.secUid)) return "sec_uid";
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
  const key = userKey({ userId, secUid, douyinId, realName, nickname, displayName });
  if (!key || key === "未知") return null;
  const fanTicket = Number(payload.fanTicket || 0);
  const strongIdentity =
    payload.hasStrongIdentity === true || hasStrongIdentity({ userId, secUid, douyinId });
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
    gifts: type === "gift" ? 1 : 0,
    members: type === "member" ? 1 : 0,
    fanTicket,
  };
}

function mergeUserRow(previous: MonitorUserRow | undefined, next: MonitorUserRow) {
  if (!previous) return next;
  const prefer = (a: string, b: string) => a || b;
  return {
    ...previous,
    nickname: prefer(next.nickname !== "未知" ? next.nickname : "", previous.nickname) || "未知",
    displayName: prefer(next.displayName, previous.displayName),
    realName: prefer(next.realName, previous.realName),
    douyinId: prefer(next.douyinId, previous.douyinId),
    userId: prefer(next.userId, previous.userId),
    secUid: prefer(next.secUid, previous.secUid),
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
    lastType: next.lastType || previous.lastType,
    chats: previous.chats + next.chats,
    gifts: previous.gifts + next.gifts,
    members: previous.members + next.members,
    fanTicket: previous.fanTicket + next.fanTicket,
  };
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
    return users.filter((user) => user.hasStrongIdentity);
  }

  push(payload);
  push(payload.rank, "rank");
  push(payload.fromUser, "event");
  push(payload.toUser, "event");
  if (Array.isArray(payload.ranks)) payload.ranks.forEach((item) => push(item, "rank"));
  if (Array.isArray(payload.seats)) payload.seats.forEach((item) => push(item, "event"));
  return users.filter((user) => user.hasStrongIdentity);
}

function identityDetail(payload: {
  displayName?: string;
  realName?: string;
  userId?: string;
  secUid?: string;
  uniqueId?: string;
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
  if (payload.userId) parts.push(`user_id:${payload.userId}`);
  if (payload.secUid) parts.push(`sec:${payload.secUid.slice(0, 12)}...`);
  if (payload.userLevel) parts.push(`用户等级:${payload.userLevel}`);
  if (payload.wealthLevel || payload.consumeLevel || payload.honorLevel) {
    parts.push(`财富/荣誉:${payload.wealthLevel || payload.consumeLevel || payload.honorLevel}`);
  }
  if (payload.fansClubLevel || payload.badgeLevel) parts.push(`粉丝团:${payload.fansClubLevel || payload.badgeLevel}`);
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
    "live-mode": "直播形态",
    "pk-battle": "PK状态",
    "pk-score-snapshot": "PK分数",
    "room-info": "房间信息",
    "gift-catalog": "礼物目录",
    "audience-rank": "观众榜",
    "wish-list": "心愿单",
    "interaction-info": "互动配置",
  };
  return labels[eventType] || eventType || "事件";
}

function eventValue(payload: LivePkEventPayload) {
  const likeCount = safeNumber(payload.likeCount);
  const paidCount = safeNumber(payload.paidCount);
  const scores = Array.isArray(payload.scores) ? payload.scores as Record<string, unknown>[] : [];
  if (payload.eventType === "live-mode") return safeText(payload.liveModeLabel) || safeText(payload.liveMode);
  if ((payload.eventType === "pk-battle" || payload.eventType === "pk-score-snapshot") && scores.length > 0) {
    return scores.map((score) => safeText(score.scoreText) || String(safeNumber(score.score))).join(" : ");
  }
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
  const scores = Array.isArray(payload.scores) ? payload.scores as Record<string, unknown>[] : [];
  const participants = Array.isArray(payload.participants) ? payload.participants as Record<string, unknown>[] : [];
  const scoreText = scores
    .map((score) => {
      const name = safeText(score.realName) || safeText(score.displayName) || safeText(score.nickname) || safeText(score.anchorId);
      const id = safeText(score.anchorId) || safeText(score.userId);
      const value = safeText(score.scoreText) || String(safeNumber(score.score));
      return [name, id ? `(${id})` : "", value].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" / ");
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
              payload.participantCount ? `${safeText(payload.participantCount)}人` : "",
              payload.battlePhase ? `阶段 ${safeText(payload.battlePhase)}` : "",
              payload.battleStatus !== undefined ? `状态 ${safeText(payload.battleStatus)}` : "",
              participantText,
            ].filter(Boolean).join(" / ")
        : payload.eventType === "pk-battle"
          ? [
              payload.isPkActive ? "PK中" : "非PK中",
              payload.participantCount ? `${safeText(payload.participantCount)}方` : "",
              scoreText,
              payload.battlePhase ? `阶段 ${safeText(payload.battlePhase)}` : "",
              payload.duration ? `${safeText(payload.duration)}秒` : "",
              safeText(payload.battleId),
            ].filter(Boolean).join(" / ")
        : payload.eventType === "pk-score-snapshot"
          ? [
              payload.isPkActive ? "PK中" : "非PK中",
              payload.participantCount ? `${safeText(payload.participantCount)}方` : "",
              payload.pkCountDown !== undefined ? `倒计时 ${safeText(payload.pkCountDown)}秒` : "",
              scoreText,
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
                  payload.hotScore ? `热度分 ${payload.hotScore}` : "",
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

function buildLiveState(logs: MonitorLogRow[]): MonitorLiveState {
  const scores = new Map<string, MonitorScoreRow>();
  const rounds: MonitorRoundRow[] = [];
  let round = 0;
  let currentBattleId = "";
  let mode = "unknown";
  let modeLabel = "未知";
  let isPkActive = false;
  let isLinkmic = false;
  let participantCount = 0;
  let channelId = "";
  let countdown = 0;
  let phase = "";
  let updatedAt = "";

  const ensureRound = (battleId: string, forceNew = false) => {
    const nextBattleId = battleId || currentBattleId || `round-${round || 1}`;
    if (forceNew || round === 0 || (battleId && battleId !== currentBattleId)) {
      round = round + 1;
      currentBattleId = nextBattleId;
      scores.clear();
      rounds.push({ round, battleId: nextBattleId, scores: [] });
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

  for (const row of logs.slice().reverse()) {
    const payload = row.payload as Record<string, unknown>;
    if (row.type === "event") {
      const eventType = safeText(payload.eventType);
      if (eventType === "room-info" || eventType === "live-mode" || eventType === "pk-battle" || eventType === "pk-score-snapshot") {
        const nextMode = safeText(payload.liveMode);
        if (nextMode) mode = nextMode;
        modeLabel = safeText(payload.liveModeLabel) || eventLabel(eventType);
        isPkActive = safeBoolean(payload.isPkActive) || mode === "pk" || isPkActive;
        isLinkmic = mode === "linkmic" || mode === "pk" || isPkActive || isLinkmic;
        participantCount = Math.max(participantCount, safeNumber(payload.participantCount));
        channelId = safeText(payload.channelId) || channelId;
        countdown = Math.max(0, safeNumber(payload.pkCountDown) || countdown);
        phase = safeText(payload.battlePhase) || phase;
        updatedAt = row.at || updatedAt;
      }

      if (eventType === "pk-battle" || eventType === "pk-score-snapshot") {
        const battleId = safeText(payload.battleId);
        ensureRound(battleId, Boolean(battleId && battleId !== currentBattleId));
        const nextScores = Array.isArray(payload.scores)
          ? payload.scores.map(scoreFromPayload).filter(Boolean) as MonitorScoreRow[]
          : [];
        if (nextScores.length > 0) {
          scores.clear();
          nextScores.forEach((score) => scores.set(score.anchorId, score));
          snapshotRound();
        }
      }
    }

    if (row.type === "rank") {
      const rankScore = scoreFromPayload(payload.rank || payload);
      if (rankScore) {
        ensureRound(safeText(payload.battleId));
        scores.set(rankScore.anchorId, rankScore);
        participantCount = Math.max(participantCount, scores.size);
        updatedAt = row.at || updatedAt;
        snapshotRound();
      }
    }
  }

  const currentScores = Array.from(scores.values());
  participantCount = Math.max(participantCount, currentScores.length);
  if (isPkActive) modeLabel = "PK";
  else if (isLinkmic) modeLabel = modeLabel === "未知" ? "连麦" : modeLabel;
  else if (mode === "single") modeLabel = "单人";

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

function compactLogDetail(row: MonitorLogRow, liveState: MonitorLiveState) {
  const payload = row.payload as Record<string, unknown>;
  if (row.type === "gift") {
    const gift = payload as unknown as LivePkGiftPayload;
    const rmb = safeNumber(gift.diamondCount) * safeNumber(gift.count) / 10;
    return [
      `${row.name} 送出 ${gift.giftName || "礼物"} x${gift.count || 1}`,
      rmb ? moneyText(rmb) : "",
      gift.fanTicket ? `音浪 ${compactNumber(gift.fanTicket)}` : "",
      liveState.scores.length ? `分数 ${scoreSummary(liveState.scores, 2)}` : "",
    ].filter(Boolean).join(" · ");
  }
  if (row.type === "chat") {
    const chat = payload as unknown as LivePkChatPayload;
    return [
      `${row.name}: ${chat.content || row.detail}`,
      liveState.scores.length ? `分数 ${scoreSummary(liveState.scores, 2)}` : "",
    ].filter(Boolean).join(" · ");
  }
  if (row.type === "rank") {
    const rank = (payload.rank || payload) as Record<string, unknown>;
    const score = scoreFromPayload(rank);
    return score
      ? `主播ID ${compactId(score.anchorId)} · ${score.name || "主播"} · 分数 ${score.scoreText || compactNumber(score.score)}`
      : row.detail;
  }
  if (row.type === "event") {
    const eventType = safeText(payload.eventType);
    if (eventType === "live-mode") {
      return `${safeText(payload.liveModeLabel) || liveState.modeLabel} · PK ${safeBoolean(payload.isPkActive) ? "是" : "否"} · 连麦 ${liveState.isLinkmic ? "是" : "否"} · ${safeNumber(payload.participantCount) || liveState.participantCount}人`;
    }
    if (eventType === "pk-battle" || eventType === "pk-score-snapshot") {
      const eventScores = Array.isArray(payload.scores)
        ? payload.scores.map(scoreFromPayload).filter(Boolean) as MonitorScoreRow[]
        : liveState.scores;
      return `PK ${safeBoolean(payload.isPkActive) ? "进行中" : "未开始"} · ${safeNumber(payload.participantCount) || eventScores.length}人 · ${scoreSummary(eventScores)}`;
    }
  }
  return row.detail;
}

export function DouyinMonitorPage() {
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
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [busy, setBusy] = useState(false);
  const [cookieSaved, setCookieSaved] = useState(false);
  const [cookieUpdatedAt, setCookieUpdatedAt] = useState<string | null>(null);

  const appendRows = useCallback((rows: Omit<MonitorLogRow, "id">[]) => {
    if (rows.length === 0) return;
    setLogs((prev) => [
      ...rows.map((row) => ({ ...row, id: makeId(row.type) })),
      ...prev,
    ].slice(0, 2000));
  }, []);

  useEffect(() => {
    const api = getDataApi();
    if (!api) return;
    const offStatus = api.onLivePkStatus((next) => {
      setStatus(next);
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
        userId: payload.uniqueId || payload.userId || payload.secUid || "",
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
        userId: payload.uniqueId || payload.userId || payload.secUid || "",
        value: "",
        detail: [identityDetail(payload), payload.content].filter(Boolean).join(" / "),
        payload,
      }]);
    }) ?? (() => undefined);
    const offMember = api.onLivePkMember?.((payload: LivePkMemberPayload) => {
      appendRows([{
        at: formatTime(payload.at),
        type: "member",
        label: "进场",
        name: monitorName(payload),
        userId: payload.uniqueId || payload.userId || payload.secUid || "",
        value: payload.memberCount ? String(payload.memberCount) : "",
        detail: identityDetail(payload),
        payload,
      }]);
    }) ?? (() => undefined);
    const offRank = api.onLivePkRank?.((payload: LivePkRankPayload) => {
      const rows = payload.ranks.slice(0, 20).map((rank) => ({
        at: formatTime(payload.at),
        type: "rank" as const,
        label: "分数",
        name: monitorName(rank),
        userId: rank.uniqueId || rank.userId || rank.secUid || "",
        value: String(rank.score || ""),
        detail: [
          payload.rankSource || rank.rankSource ? `来源 ${payload.rankSource || rank.rankSource}` : "",
          rank.rank ? `第${rank.rank}` : "",
          identityDetail(rank),
          rank.scoreText,
        ].filter(Boolean).join(" / "),
        payload: { ...payload, rank },
      }));
      appendRows(rows);
    }) ?? (() => undefined);
    const offEvent = api.onLivePkEvent?.((payload: LivePkEventPayload) => {
      appendRows([{
        at: formatTime(payload.at),
        type: "event",
        label: eventLabel(payload.eventType),
        name: payload.uniqueId || payload.userId || payload.secUid
          ? monitorName(payload)
          : eventLabel(payload.eventType),
        userId: payload.uniqueId || payload.userId || payload.secUid || "",
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
    };
  }, [appendRows]);

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

  const userRows = useMemo(() => {
    const merged = new Map<string, MonitorUserRow>();
    const aliases = new Map<string, string>();
    const keysFor = (user: MonitorUserRow) => [
      user.key,
      user.userId,
      user.secUid,
      user.douyinId,
      user.realName,
      user.nickname,
      user.displayName,
    ].filter(Boolean);
    for (const row of logs.slice().reverse()) {
      for (const user of collectUsersFromLog(row)) {
        const aliasKeys = keysFor(user);
        const existingKey = aliasKeys.map((key) => aliases.get(key)).find(Boolean);
        const canonicalKey = existingKey || user.secUid || user.userId || user.douyinId || user.key;
        const mergedUser = mergeUserRow(merged.get(canonicalKey), { ...user, key: canonicalKey });
        merged.set(canonicalKey, mergedUser);
        for (const key of keysFor(mergedUser)) aliases.set(key, canonicalKey);
      }
    }
    return Array.from(merged.values()).sort((a, b) => {
      if (a.hasStrongIdentity !== b.hasStrongIdentity) return a.hasStrongIdentity ? -1 : 1;
      const timeDelta = new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
      if (timeDelta) return timeDelta;
      return b.fanTicket - a.fanTicket;
    });
  }, [logs]);

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

  const liveState = useMemo(() => buildLiveState(logs), [logs]);

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
      gifts: giftRows.length,
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
    setBusy(true);
    setMessage("正在隐藏采集直播间连接");
    const cookieText = cookie.trim();
    const result: IpcResult<LivePkMonitorStatus> = await api.startLivePkMonitorFromUrl({
      liveRoomUrl,
      cookie: cookieText,
    });
    setBusy(false);
    if (!result.success) {
      setMessage(result.error || "启动失败");
      return;
    }
    setStatus(result.data);
  };

  const stopMonitor = async () => {
    const api = getDataApi();
    setBusy(true);
    const result = await api?.stopLivePkMonitor?.();
    setBusy(false);
    if (result?.success) setStatus(result.data);
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

  const exportCsv = () => {
    const header = ["时间", "类型", "昵称", "用户ID", "数值", "详情"];
    const rows = logs.slice().reverse().map((row) => [
      row.at,
      row.label,
      row.name,
      row.userId,
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
      "昵称",
      "脱敏昵称",
      "抖音ID",
      "用户ID",
      "sec_uid",
      "用户等级",
      "财富等级",
      "粉丝团等级",
      "荣誉等级",
      "徽章等级",
      "付费分",
      "粉丝票",
      "充值钻石",
      "IP",
      "粉丝数",
      "是否真实ID",
      "身份来源",
      "是否神秘/脱敏",
      "是否缓存命中",
      "弹幕",
      "礼物",
      "进场",
      "音浪",
      "最近时间",
      "最近类型",
    ];
    const rows = userRows.map((user) => [
      user.realName || user.nickname,
      user.displayName,
      user.douyinId,
      user.userId,
      user.secUid,
      user.userLevel,
      user.wealthLevel || user.consumeLevel,
      user.fansClubLevel,
      user.honorLevel,
      user.badgeLevel,
      user.payScore,
      user.fanTicketCount,
      user.totalRechargeDiamondCount,
      user.ipLocation,
      user.followerCount,
      user.hasStrongIdentity ? "是" : "否",
      user.identitySource,
      user.isMystery ? "是" : "否",
      user.cacheHit ? "是" : "否",
      user.chats,
      user.gifts,
      user.members,
      user.fanTicket,
      user.lastAt,
      user.lastType,
    ]);
    const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");
    downloadText(`抖音直播用户_${Date.now()}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
  };

  const exportUsersJson = () => {
    downloadText(
      `抖音直播用户_${Date.now()}.json`,
      JSON.stringify(userRows, null, 2),
      "application/json;charset=utf-8"
    );
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[620px] flex-col gap-4">
      <section className="shrink-0 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black tracking-normal">抖音直播监控</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={status.status === "running" ? "default" : "secondary"}>
                {status.status}
              </Badge>
              {stats.online && <Badge variant="outline">在线 {stats.online}</Badge>}
              {message && <span className="text-xs font-semibold text-muted-foreground">{message}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={startMonitor} disabled={busy || status.status === "running"}>
              <Play className="size-4" />
              开始
            </Button>
            <Button size="sm" variant="outline" onClick={stopMonitor} disabled={busy}>
              <Square className="size-4" />
              停止
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={logs.length === 0}>
              <Download className="size-4" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={exportJson} disabled={logs.length === 0}>
              <Download className="size-4" />
              JSON
            </Button>
            <Button size="sm" variant="outline" onClick={exportUsersCsv} disabled={userRows.length === 0}>
              <Download className="size-4" />
              用户CSV
            </Button>
            <Button size="sm" variant="outline" onClick={exportUsersJson} disabled={userRows.length === 0}>
              <Download className="size-4" />
              用户JSON
            </Button>
            <Button size="icon" variant="outline" onClick={() => setLogs([])} disabled={logs.length === 0} title="清空">
              <Eraser className="size-4" />
            </Button>
          </div>
        </div>
        <LiveStateStrip liveState={liveState} stats={stats} />
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(340px,0.52fr)_minmax(0,1.48fr)] gap-4">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="grid shrink-0 gap-2">
            <Input
              value={liveRoomUrl}
              onChange={(event) => setLiveRoomUrl(event.target.value)}
              placeholder="直播间地址：https://live.douyin.com/...（不要填 Cookie）"
              className="h-10 bg-background"
            />
          </div>
          <textarea
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            placeholder="Cookie"
            className="h-20 shrink-0 resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
          />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={saveCookie}>
              保存 Cookie
            </Button>
            <Button size="sm" variant="outline" onClick={clearCookie} disabled={!cookieSaved && !cookie}>
              清除 Cookie
            </Button>
            <span className="text-xs font-semibold text-muted-foreground">
              {cookieSaved
                ? `已保存${cookieUpdatedAt ? ` ${new Date(cookieUpdatedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}`
                : "未保存"}
            </span>
          </div>
          <div className="shrink-0 overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
              采集状态
            </div>
            <div className="space-y-2 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">运行状态</span>
                <Badge variant={status.status === "running" ? "default" : "secondary"}>
                  {status.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">用户缓存</span>
                <span className="font-semibold tabular-nums">{status.cachedUsers || 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">昵称缓存</span>
                <span className="font-semibold tabular-nums">{status.cachedDisplayNames || 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">礼物缓存</span>
                <span className="font-semibold tabular-nums">{status.cachedGifts || 0}</span>
              </div>
              {status.startedAt && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">开始时间</span>
                  <span className="font-semibold">{formatTime(status.startedAt)}</span>
                </div>
              )}
              {status.lastError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
                  {status.lastError}
                </div>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
              直播间信息
            </div>
            <div className="space-y-2 overflow-auto p-3 text-sm">
              <InfoRow label="房间标题" value={roomInfo.title || "-"} />
              <InfoRow label="房间 ID" value={roomInfo.roomId || status.roomId || "-"} />
              <InfoRow label="主播昵称" value={roomInfo.ownerNickname || "-"} />
              <InfoRow label="主播 ID" value={roomInfo.ownerUserId || "-"} />
              <InfoRow label="抖音号" value={roomInfo.ownerDouyinId || "未返回"} />
              <InfoRow label="抖音号来源" value={roomInfo.ownerDouyinIdSource || "-"} />
              <InfoRow label="web_rid" value={roomInfo.ownerWebRid || "-"} />
              <InfoRow label="sec_uid" value={roomInfo.ownerSecUid || "-"} wrap />
              <InfoRow label="在线" value={roomInfo.onlineText || stats.online || "-"} />
              <InfoRow label="本场点赞" value={roomInfo.likeCount || "-"} />
              <InfoRow label="直播间音浪" value={stats.fanTicket || "等待服务端累计字段"} />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="grid shrink-0 grid-cols-6 gap-2">
            <StatCard icon={Activity} label="事件" value={stats.total} />
            <StatCard icon={Gift} label="礼物" value={stats.gifts} />
            <StatCard icon={MessageSquareText} label="弹幕" value={stats.chats} />
            <StatCard icon={Users} label="用户" value={stats.users} />
            <StatCard icon={BarChart3} label="服务端音浪" value={stats.fanTicket} />
            <StatCard icon={Users} label="进场" value={stats.members} />
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  filter === item.key
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
            {filter === "user" ? (
              <div className="grid min-w-[980px] grid-cols-[150px_130px_210px_82px_82px_100px_110px_minmax(120px,1fr)] border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                <div>昵称</div>
                <div>抖音号</div>
                <div>用户ID / sec_uid</div>
                <div>等级</div>
                <div>财富</div>
                <div>互动</div>
                <div>音浪</div>
                <div>最近</div>
              </div>
            ) : (
              <div className="grid grid-cols-[72px_56px_minmax(100px,0.6fr)_minmax(0,2fr)] border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                <div>时间</div>
                <div>类型</div>
                <div>昵称</div>
                <div>内容</div>
              </div>
            )}
            <div className="h-full overflow-auto pb-10">
              {filter === "user" ? (
                userRows.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    暂无真实身份用户，等待礼物/榜单/弹幕下发 user_id、sec_uid 或抖音号
                  </div>
                ) : (
                  userRows.map((user) => (
                    <div
                      key={user.key}
                      className="grid min-w-[980px] grid-cols-[150px_130px_210px_82px_82px_100px_110px_minmax(120px,1fr)] border-b border-border/70 px-3 py-2 text-xs"
                    >
                      <div className="break-words font-semibold" title={user.realName || user.nickname}>
                        {user.realName || user.nickname}
                        {user.isMystery && <span className="ml-1 text-[10px] text-muted-foreground">脱敏</span>}
                      </div>
                      <div className="break-words text-muted-foreground" title={user.douyinId}>
                        {user.douyinId || "-"}
                      </div>
                      <div className="break-all text-[10px] text-muted-foreground" title={`${user.secUid || ""} ${user.userId || ""}`}>
                        {compactId(user.userId || user.secUid)}
                      </div>
                      <div className="tabular-nums">{user.userLevel || "-"}</div>
                      <div className="tabular-nums">{user.wealthLevel || user.consumeLevel || "-"}</div>
                      <div className="space-y-0.5 tabular-nums">
                        <div>弹幕 {user.chats}</div>
                        <div>礼物 {user.gifts}</div>
                        <div>进场 {user.members}</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="tabular-nums">本场 {compactNumber(user.fanTicket)}</div>
                        <div className="tabular-nums text-muted-foreground">累计 {compactNumber(user.fanTicketCount)}</div>
                      </div>
                      <div className="space-y-0.5 text-muted-foreground">
                        <div className="tabular-nums">{user.lastAt || "-"}</div>
                        <div>{user.hasStrongIdentity ? "真实ID" : "未确认"} · {user.lastType}</div>
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
                    className="grid grid-cols-[72px_56px_minmax(100px,0.6fr)_minmax(0,2fr)] gap-0 border-b border-border/70 px-3 py-2 text-xs"
                  >
                    <div className="text-muted-foreground">{row.at}</div>
                    <div><Badge variant="outline" className="h-5 px-1.5 text-[10px]">{row.label}</Badge></div>
                    <div className="truncate font-semibold">{row.name}</div>
                    <div className="truncate text-muted-foreground" title={compactLogDetail(row, liveState)}>
                      {compactLogDetail(row, liveState)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function LiveStateStrip({
  liveState,
  stats,
}: {
  liveState: MonitorLiveState;
  stats: {
    total: number;
    gifts: number;
    chats: number;
    members: number;
    events: number;
    users: number;
    fanTicket: number;
    online: string;
  };
}) {
  const latestRound = liveState.rounds[liveState.rounds.length - 1];
  return (
    <div className="mt-3 grid gap-2 md:grid-cols-[1.1fr_1.5fr_1.4fr]">
      <div className="rounded-lg border border-border bg-background px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-muted-foreground">直播形态</span>
          <Badge variant={liveState.isPkActive ? "default" : liveState.isLinkmic ? "outline" : "secondary"}>
            {liveState.isPkActive ? "PK中" : liveState.isLinkmic ? "连麦" : liveState.modeLabel}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
          <span>PK {liveState.isPkActive ? "是" : "否"}</span>
          <span>连麦 {liveState.isLinkmic ? "是" : "否"}</span>
          <span>{liveState.participantCount || 0} 人</span>
          {liveState.countdown > 0 && <span>倒计时 {liveState.countdown}s</span>}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background px-3 py-2">
        <div className="text-xs font-semibold text-muted-foreground">当前分数</div>
        <div className="mt-1 truncate text-sm font-black" title={scoreSummary(liveState.scores)}>
          {scoreSummary(liveState.scores)}
        </div>
        <div className="mt-1 truncate text-[11px] font-semibold text-muted-foreground">
          battle {compactId(liveState.battleId)} · channel {compactId(liveState.channelId)}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-muted-foreground">历史轮次</span>
          <span className="text-xs font-black tabular-nums">{liveState.rounds.length} 轮</span>
        </div>
        <div className="mt-1 truncate text-sm font-semibold" title={liveState.rounds.map((round) => `第${round.round}轮 ${scoreSummary(round.scores)}`).join(" | ")}>
          {latestRound ? `第${latestRound.round}轮 ${scoreSummary(latestRound.scores)}` : "暂无"}
        </div>
        <div className="mt-1 text-[11px] font-semibold text-muted-foreground">
          礼物 {stats.gifts} · 弹幕 {stats.chats} · 用户 {stats.users} · 音浪 {compactNumber(stats.fanTicket)}
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
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="mt-2 truncate text-lg font-black tabular-nums">{value || 0}</div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  wrap = false,
}: {
  label: string;
  value: React.ReactNode;
  wrap?: boolean;
}) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold ${wrap ? "break-all" : "truncate"}`} title={String(value ?? "")}>
        {value}
      </span>
    </div>
  );
}
