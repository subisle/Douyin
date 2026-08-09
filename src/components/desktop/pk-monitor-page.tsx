"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, Trophy, Download } from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  IpcResult,
  LivePkEventPayload,
  LivePkMonitorStatus,
  PkMember,
  PkRosterData,
} from "@/types/electron";
import {
  MIN_AUTO_PK_SCORE,
  STAGE_TABS,
  applyScoresToGroup,
  importGroupStageFromActiveLayout,
  importGroupStageFromBuiltIn,
  isGroupFullyScored,
  isStageFullyScored,
  listPkGroupPresetsForMonitor,
  loadTournamentState,
  nextPkGroupKey,
  resolvePkWriteGroupKey,
  resolveSequentialPkGroupKey,
  saveTournamentState,
  setMemberScore,
  settleActiveStage,
  stageSummary,
  type StageGroup,
  type StageKey,
  type TournamentState,
} from "./pk-tournament-store";

interface ScoreRow {
  anchorId: string;
  name: string;
  uniqueId: string;
  score: number;
  scoreText: string;
}

const IDLE_STATUS: LivePkMonitorStatus = {
  status: "idle",
  startedAt: null,
  lastError: null,
  lastRankAt: null,
};

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

function scoreNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
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

function countdownText(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function statusLabel(status: LivePkMonitorStatus["status"]) {
  switch (status) {
    case "connecting":
      return "连接中";
    case "running":
      return "运行中";
    case "error":
      return "错误";
    case "closed":
      return "已关闭";
    default:
      return "空闲";
  }
}

function scoreFromPayload(value: unknown): ScoreRow | null {
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
    safeText(payload.anchorName) ||
    "未知";
  const teamScoreText = safeText(payload.multiPkTeamScoreText);
  const teamScore = scoreNumber(payload.multiPkTeamScore) || scoreNumber(teamScoreText);
  const baseScoreText = safeText(payload.scoreText) || safeText(payload.score_str);
  const baseScore =
    scoreNumber(payload.score) || scoreNumber(payload.hotScore) || scoreNumber(baseScoreText);
  const score = teamScore || baseScore;
  const scoreText =
    teamScoreText || (teamScore ? compactNumber(teamScore) : baseScoreText) || compactNumber(score);
  return {
    anchorId,
    name,
    uniqueId: safeText(payload.uniqueId) || safeText(payload.douyinId),
    score,
    scoreText,
  };
}

function scoreRowsFromEvent(payload: LivePkEventPayload): ScoreRow[] {
  if (Array.isArray(payload.scores)) {
    return payload.scores
      .map((row) => scoreFromPayload(row))
      .filter((row): row is ScoreRow => Boolean(row));
  }
  const single = scoreFromPayload(payload);
  return single ? [single] : [];
}

function rankedScores(rows: ScoreRow[]) {
  return [...rows].sort((a, b) => b.score - a.score || a.anchorId.localeCompare(b.anchorId));
}

function sameScores(a: ScoreRow[], b: ScoreRow[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].anchorId !== b[i].anchorId ||
      a[i].name !== b[i].name ||
      a[i].score !== b[i].score ||
      a[i].scoreText !== b[i].scoreText
    ) {
      return false;
    }
  }
  return true;
}

function mergeScores(current: ScoreRow[], next: ScoreRow[], replace: boolean) {
  if (next.length === 0) return current;
  if (replace) return rankedScores(next);
  const map = new Map(current.map((row) => [row.anchorId, row]));
  for (const row of next) map.set(row.anchorId, row);
  return rankedScores(Array.from(map.values()));
}

function modeBadgeText(opts: {
  isPkActive: boolean;
  isLinkmic: boolean;
  modeLabel: string;
  mode: string;
}) {
  if (opts.isPkActive || opts.mode === "pk") return "PK 中";
  if (opts.isLinkmic || opts.mode === "linkmic") return "连麦";
  if (opts.modeLabel) return opts.modeLabel;
  if (opts.mode === "single") return "单人";
  return "未识别";
}

function groupStatusLabel(status: StageGroup["status"]) {
  switch (status) {
    case "live":
      return "监控中";
    case "scored":
      return "已记分";
    case "settled":
      return "已结算";
    default:
      return "待赛";
  }
}

export function PkMonitorPage({ active = true }: { active?: boolean }) {
  const [liveRoomUrl, setLiveRoomUrl] = useState("");
  const [status, setStatus] = useState<LivePkMonitorStatus>(IDLE_STATUS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const scoresRef = useRef<ScoreRow[]>([]);
  const [mode, setMode] = useState("");
  const [modeLabel, setModeLabel] = useState("");
  const [isPkActive, setIsPkActive] = useState(false);
  const [isLinkmic, setIsLinkmic] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [ownerNickname, setOwnerNickname] = useState("");
  const [roomTitle, setRoomTitle] = useState("");
  const [countdownMs, setCountdownMs] = useState(0);
  const countdownEndAtRef = useRef<number | null>(null);
  const countdownSourceMsRef = useRef<number | null>(null);
  const cookieRef = useRef("");

  const [tournament, setTournament] = useState<TournamentState>(() =>
    createClientTournament()
  );
  const tournamentRef = useRef(tournament);
  tournamentRef.current = tournament;
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>("");
  const [rosterMembers, setRosterMembers] = useState<PkMember[]>([]);
  /** PK 分组多存档：先选再导入/监控 */
  const [pkPresets, setPkPresets] = useState(() =>
    typeof window === "undefined" ? [] : listPkGroupPresetsForMonitor()
  );
  const [importPresetId, setImportPresetId] = useState<string>("");
  const lastAutoWriteAtRef = useRef(0);
  const lastAutoWriteSigRef = useRef("");
  const autoSettleLockRef = useRef(false);
  /** 当前顺序 PK 绑定的 battleId；结束时推进下一组 */
  const activeBattleIdRef = useRef("");
  const activeGroupKeyRef = useRef("");
  const pkWasActiveRef = useRef(false);
  /** 用户是否正在手动浏览历史组；true 时写分不抢左侧选中 */
  const userBrowsingRef = useRef(false);
  const [liveWriteGroupKey, setLiveWriteGroupKey] = useState("");

  const refreshPkPresets = useCallback(() => {
    if (typeof window === "undefined") return;
    const list = listPkGroupPresetsForMonitor();
    setPkPresets(list);
    setImportPresetId((cur) => {
      if (cur && list.some((p) => p.id === cur)) return cur;
      const active = list.find((p) => p.active);
      return active?.id || list[0]?.id || "";
    });
  }, []);

  const activeStage = tournament.activeStage;
  const stageState = tournament.stages[activeStage];
  const selectedGroup =
    stageState.groups.find((g) => g.key === selectedGroupKey) ||
    stageState.groups[0] ||
    null;

  useEffect(() => {
    if (!selectedGroupKey && stageState.groups[0]) {
      setSelectedGroupKey(stageState.groups[0].key);
    } else if (
      selectedGroupKey &&
      stageState.groups.length &&
      !stageState.groups.some((g) => g.key === selectedGroupKey)
    ) {
      setSelectedGroupKey(stageState.groups[0]?.key || "");
    }
  }, [selectedGroupKey, stageState.groups]);

  useEffect(() => {
    if (!active) return;
    refreshPkPresets();
  }, [active, refreshPkPresets]);

  const commitScores = useCallback((updater: (current: ScoreRow[]) => ScoreRow[]) => {
    const next = updater(scoresRef.current);
    if (next === scoresRef.current || sameScores(scoresRef.current, next)) return;
    scoresRef.current = next;
    setScores(next);
  }, []);

  const clearCountdown = useCallback(() => {
    countdownEndAtRef.current = null;
    countdownSourceMsRef.current = null;
    setCountdownMs(0);
  }, []);

  const syncCountdown = useCallback(
    (payload: LivePkEventPayload) => {
      if (payload.pkCountDown === undefined) return;
      const nextMs = Math.max(0, safeNumber(payload.pkCountDown) * 1000);
      if (
        nextMs <= 0 ||
        (Object.prototype.hasOwnProperty.call(payload, "isPkActive") &&
          !safeBoolean(payload.isPkActive))
      ) {
        clearCountdown();
        return;
      }
      const now = performance.now();
      const currentMs =
        countdownEndAtRef.current === null
          ? 0
          : Math.max(0, countdownEndAtRef.current - now);
      if (countdownSourceMsRef.current === nextMs && currentMs > 0) return;
      countdownSourceMsRef.current = nextMs;
      countdownEndAtRef.current = now + nextMs;
      setCountdownMs(nextMs);
    },
    [clearCountdown]
  );

  const resetBoard = useCallback(() => {
    scoresRef.current = [];
    setScores([]);
    setMode("");
    setModeLabel("");
    setIsPkActive(false);
    setIsLinkmic(false);
    setParticipantCount(0);
    setOwnerNickname("");
    setRoomTitle("");
    activeBattleIdRef.current = "";
    // 保留 activeGroupKeyRef：一场直播多场 PK 跨 start 不回退组
    pkWasActiveRef.current = false;
    clearCountdown();
  }, [clearCountdown]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const endAt = countdownEndAtRef.current;
      if (endAt === null) return;
      const nextMs = Math.max(0, endAt - performance.now());
      setCountdownMs((current) => (Math.abs(current - nextMs) < 40 ? current : nextMs));
      if (nextMs <= 0) {
        countdownEndAtRef.current = null;
        countdownSourceMsRef.current = null;
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const api = getDataApi();
    void api?.readLivePkCookie?.().then((result) => {
      if (!result.success || !result.data.saved || !result.data.cookie) return;
      cookieRef.current = result.data.cookie;
    });
  }, []);

  useEffect(() => {
    const api = getDataApi();
    if (!api?.getPkRoster) return;
    void api.getPkRoster().then((result: IpcResult<PkRosterData>) => {
      if (!result.success || !result.data) return;
      setRosterMembers([...(result.data.males || []), ...(result.data.females || [])]);
    });
  }, []);

  /**
   * 只记 PK 分（pk-battle / pk-score-snapshot）→ 当前组。
   * 小组赛按组序连麦；打错 PK / 组间对调时在线身份改写到识别组。
   * 连麦分永不写入赛程；PK 分 ≥ MIN_AUTO_PK_SCORE 才落分。
   */
  const syncLiveScoresToStage = useCallback(
    (
      rows: ScoreRow[],
      opts?: {
        force?: boolean;
        battleId?: string;
        battlePhase?: string;
        isPkActive?: boolean;
        pkEnded?: boolean;
      }
    ) => {
      if (!rows.length && !opts?.pkEnded) return;
      const state = tournamentRef.current;
      const stageKey = state.activeStage;
      const stage = state.stages[stageKey];
      if (!stage.groups.length || stage.settled || stageKey === "finals") return;

      const liveRows = rows.map((r) => ({
        name: r.name,
        anchorId: r.anchorId,
        uniqueId: r.uniqueId,
        douyinNo: r.uniqueId,
      }));
      const preferred = activeGroupKeyRef.current || selectedGroupKey;
      const sequentialKey = resolveSequentialPkGroupKey(stage, preferred);
      const groupKey =
        resolvePkWriteGroupKey(stage, liveRows, preferred) ||
        sequentialKey ||
        stage.groups[0]?.key ||
        "";
      if (!groupKey) return;
      // 写分目标组可因「打错 PK」跳到识别组；顺序推进仍以 sequential 为准
      // 浏览与写分分离：用户点左侧历史组时不抢选中，可边监控边回看分数
      setLiveWriteGroupKey(groupKey);
      if (!userBrowsingRef.current && groupKey !== selectedGroupKey) {
        setSelectedGroupKey(groupKey);
      }
      // 仅当仍落在顺序组时推进 active；错绑到别组不抢顺序游标
      if (!sequentialKey || groupKey === sequentialKey) {
        activeGroupKeyRef.current = groupKey;
      }

      // 只记真正 PK 分：≥200 才写入；连麦事件根本不进本函数
      const inputs = rows
        .filter(
          (r) =>
            Number.isFinite(r.score) &&
            r.score >= MIN_AUTO_PK_SCORE
        )
        .map((r) => ({
          name: r.name,
          anchorId: r.anchorId,
          uniqueId: r.uniqueId,
          douyinNo: r.uniqueId,
          score: r.score,
        }));

      let next = state;
      if (inputs.length) {
        const sig = `${groupKey}|${inputs
          .map((r) => `${r.anchorId || r.uniqueId || r.name}:${r.score}`)
          .sort()
          .join("|")}`;
        const now = Date.now();
        if (
          !opts?.force &&
          !opts?.pkEnded &&
          sig === lastAutoWriteSigRef.current &&
          now - lastAutoWriteAtRef.current < 800
        ) {
          return;
        }
        lastAutoWriteSigRef.current = sig;
        lastAutoWriteAtRef.current = now;

        // 只写当前目标组（组序主路径 · 打错 PK 在线改写），不整阶段散射
        next = applyScoresToGroup(state, stageKey, groupKey, inputs, { manual: false });
        tournamentRef.current = next;
        setTournament(next);

        const group = next.stages[stageKey].groups.find((g) => g.key === groupKey);
        const groupScored = group ? group.members.filter((m) => m.score != null).length : 0;
        const groupTotal = group?.members.length || 0;
        const summaryNow = stageSummary(next.stages[stageKey]);
        const wrongPk =
          sequentialKey && groupKey !== sequentialKey ? " · 打错PK已改写" : "";
        setMessage(
          `只记 PK(≥${MIN_AUTO_PK_SCORE}) · 写分 ${group?.label || groupKey} ${groupScored}/${groupTotal} · 阶段 ${summaryNow.scored}/${summaryNow.members}（组序 · 连麦不记${wrongPk}）`
        );
      }

      const battleId = safeText(opts?.battleId);
      if (battleId) activeBattleIdRef.current = battleId;

      const phase = safeText(opts?.battlePhase).toLowerCase();
      const pkEnded =
        Boolean(opts?.pkEnded) ||
        phase === "finished" ||
        phase === "punish" ||
        (opts?.isPkActive === false && pkWasActiveRef.current);

      if (opts?.isPkActive === true) pkWasActiveRef.current = true;
      if (opts?.isPkActive === false) pkWasActiveRef.current = false;

      // PK 结束：仅当写在顺序当前组且记满 → 推进下一组；整阶段满 → 自动结算
      // 打错 PK 写到别组时不推进顺序游标（主持仍按组序走）
      if (pkEnded) {
        const curStage = next.stages[stageKey];
        const orderKey = sequentialKey || activeGroupKeyRef.current || groupKey;
        const curGroup = curStage.groups.find((g) => g.key === orderKey);
        const wroteOnOrder = !sequentialKey || groupKey === sequentialKey;
        if (wroteOnOrder && curGroup && isGroupFullyScored(curGroup)) {
          const nxtKey = nextPkGroupKey(curStage, orderKey);
          if (nxtKey) {
            activeGroupKeyRef.current = nxtKey;
            activeBattleIdRef.current = "";
            setLiveWriteGroupKey(nxtKey);
            // 仅跟随时才切 UI；浏览历史组时不打断
            if (!userBrowsingRef.current) setSelectedGroupKey(nxtKey);
            const nxtGroup = curStage.groups.find((g) => g.key === nxtKey);
            setMessage(
              `PK 结束 · ${curGroup.label} 锁定 → 下一组 ${nxtGroup?.label || nxtKey}（组序推进）`
            );
          }
        }

        if (
          !autoSettleLockRef.current &&
          isStageFullyScored(next.stages[stageKey])
        ) {
          autoSettleLockRef.current = true;
          const settled = settleActiveStage(next);
          tournamentRef.current = settled.state;
          setTournament(settled.state);
          const nextStage = settled.state.activeStage;
          const firstKey = settled.state.stages[nextStage].groups[0]?.key || "";
          activeGroupKeyRef.current = firstKey;
          setSelectedGroupKey(firstKey);
          setMessage(`自动结算 · ${settled.message}`);
          window.setTimeout(() => {
            autoSettleLockRef.current = false;
          }, 1500);
        }
      } else if (
        !autoSettleLockRef.current &&
        isStageFullyScored(next.stages[stageKey])
      ) {
        autoSettleLockRef.current = true;
        const settled = settleActiveStage(next);
        tournamentRef.current = settled.state;
        setTournament(settled.state);
        const nextStage = settled.state.activeStage;
        const firstKey = settled.state.stages[nextStage].groups[0]?.key || "";
        activeGroupKeyRef.current = firstKey;
        setSelectedGroupKey(firstKey);
        setMessage(`自动结算 · ${settled.message}`);
        window.setTimeout(() => {
          autoSettleLockRef.current = false;
        }, 1500);
      }
    },
    [selectedGroupKey]
  );

  useEffect(() => {
    const api = getDataApi();
    if (!api) return;

    const offStatus = api.onLivePkStatus((next) => {
      setStatus(next);
      if (next.status !== "running") clearCountdown();
      if (next.lastError) setMessage(next.lastError);
    });

    const offCapture =
      api.onLivePkCaptureStatus?.((next) => {
        if (next) setMessage(next);
      }) ?? (() => undefined);

    const offError =
      api.onLivePkError?.((next) => {
        if (next) setMessage(next);
      }) ?? (() => undefined);

    const offEvent =
      api.onLivePkEvent?.((payload: LivePkEventPayload) => {
        const eventType = safeText(payload.eventType);
        if (
          eventType !== "room-info" &&
          eventType !== "live-mode" &&
          eventType !== "pk-battle" &&
          eventType !== "pk-score-snapshot" &&
          eventType !== "linkmic-score"
        ) {
          return;
        }

        syncCountdown(payload);

        if (eventType === "room-info") {
          const nickname =
            safeText(payload.ownerNickname) ||
            safeText(payload.nickname) ||
            safeText(payload.displayName) ||
            safeText(payload.realName);
          if (nickname) setOwnerNickname(nickname);
          const title = safeText(payload.title) || safeText(payload.roomTitle);
          if (title) setRoomTitle(title);
        }

        if (
          eventType === "live-mode" ||
          eventType === "pk-battle" ||
          eventType === "pk-score-snapshot" ||
          eventType === "linkmic-score"
        ) {
          const nextMode = safeText(payload.liveMode);
          const hasPkActive = Object.prototype.hasOwnProperty.call(payload, "isPkActive");
          const nextPk = hasPkActive ? safeBoolean(payload.isPkActive) : nextMode === "pk";
          if (nextMode) setMode(nextMode);
          if (nextMode || hasPkActive) {
            const pk = nextPk || nextMode === "pk";
            setIsPkActive(pk);
            setIsLinkmic(!pk && (nextMode === "linkmic" || safeBoolean(payload.isLinkmic)));
          }
          const label = safeText(payload.liveModeLabel);
          if (label) setModeLabel(label);
          if (payload.participantCount !== undefined) {
            setParticipantCount(safeNumber(payload.participantCount));
          }
        }

        // 只记 PK 分：pk-battle / pk-score-snapshot 写入赛程；
        // linkmic-score 仅用于模式徽章，永不写入小组赛（连麦分不计入）
        if (eventType === "pk-battle" || eventType === "pk-score-snapshot") {
          const nextScores = scoreRowsFromEvent(payload);
          const battleId = safeText(payload.battleId);
          const battlePhase = safeText(payload.battlePhase);
          const hasPkActive = Object.prototype.hasOwnProperty.call(payload, "isPkActive");
          const pkActive = hasPkActive ? safeBoolean(payload.isPkActive) : undefined;
          const phaseLower = battlePhase.toLowerCase();
          const pkEnded =
            phaseLower === "finished" ||
            phaseLower === "punish" ||
            (pkActive === false && pkWasActiveRef.current);

          if (nextScores.length > 0) {
            const merged = mergeScores(scoresRef.current, nextScores, true);
            commitScores(() => merged);
            syncLiveScoresToStage(merged, {
              battleId,
              battlePhase,
              isPkActive: pkActive,
              pkEnded,
            });
            if (payload.participantCount === undefined) {
              setParticipantCount((count) => Math.max(count, nextScores.length));
            }
          } else if (pkEnded) {
            // 无新分但 PK 已结束 → 仍尝试锁定并推进下一组
            syncLiveScoresToStage(scoresRef.current, {
              battleId,
              battlePhase,
              isPkActive: pkActive,
              pkEnded: true,
            });
          }
        }
      }) ?? (() => undefined);

    void api.getLivePkMonitorStatus?.().then((result) => {
      if (result.success) setStatus(result.data);
    });

    return () => {
      offStatus();
      offCapture();
      offError();
      offEvent();
    };
  }, [clearCountdown, commitScores, syncCountdown, syncLiveScoresToStage]);

  const startMonitor = async () => {
    const api = getDataApi();
    if (!api?.startLivePkMonitorFromUrl) {
      setMessage("当前环境不支持直播监控");
      return;
    }
    const url = liveRoomUrl.trim();
    if (/sessionid=|uid_tt=|sid_tt=|ttwid=/.test(url)) {
      setMessage("请填写直播间地址（https://live.douyin.com/...），Cookie 已在后台静默读取");
      return;
    }
    if (!url) {
      setMessage("请填写直播间地址");
      return;
    }
    resetBoard();
    setBusy(true);
    setMessage("正在协议进房…");
    const result: IpcResult<LivePkMonitorStatus> = await api.startLivePkMonitorFromUrl({
      liveRoomUrl: url,
      cookie: cookieRef.current,
    });
    setBusy(false);
    if (!result.success) {
      setMessage(result.error || "启动失败");
      return;
    }
    setStatus(result.data);
    setMessage(result.data.status === "running" ? "已连接" : statusLabel(result.data.status));
  };

  const stopMonitor = async () => {
    const api = getDataApi();
    if (!api?.stopLivePkMonitor) return;
    setBusy(true);
    const result = await api.stopLivePkMonitor();
    setBusy(false);
    clearCountdown();
    if (!result.success) {
      setMessage(result.error || "停止失败");
      return;
    }
    setStatus(result.data);
    setMessage("已停止");
  };

  /** 默认：内置锁定 8 组 → 小组赛（赛程真源）；可选从 PK 分组多存档选择导入 */
  const handleImportBuiltIn = () => {
    const result = importGroupStageFromBuiltIn({
      membersMeta: rosterMembers,
      state: tournament,
      savePreset: true,
      makeActive: true,
    });
    if (!result.state) {
      setMessage(result.message);
      return;
    }
    setTournament(result.state);
    const firstKey = result.state.stages.group.groups[0]?.key || "";
    userBrowsingRef.current = false;
    activeGroupKeyRef.current = firstKey;
    setLiveWriteGroupKey(firstKey);
    setSelectedGroupKey(firstKey);
    setMessage(result.message);
    refreshPkPresets();
  };

  /** 从所选 PK 分组存档导入（多存档先选再监控；中间对调后在分组页改完再选） */
  const handleImportGroup = () => {
    refreshPkPresets();
    const result = importGroupStageFromActiveLayout({
      membersMeta: rosterMembers,
      state: tournament,
      presetId: importPresetId || undefined,
    });
    if (!result.state) {
      setMessage(result.message);
      return;
    }
    setTournament(result.state);
    const firstKey = result.state.stages.group.groups[0]?.key || "";
    userBrowsingRef.current = false;
    activeGroupKeyRef.current = firstKey;
    setLiveWriteGroupKey(firstKey);
    setSelectedGroupKey(firstKey);
    setMessage(result.message);
  };

  const handleStageTab = (key: StageKey) => {
    const next = saveTournamentState({ ...tournament, activeStage: key });
    setTournament(next);
    userBrowsingRef.current = false;
    const firstKey = next.stages[key].groups[0]?.key || "";
    setLiveWriteGroupKey(firstKey);
    setSelectedGroupKey(firstKey);
  };

  const handleMemberScoreChange = (memberKey: string, raw: string) => {
    if (!selectedGroup) return;
    const trimmed = raw.trim();
    const score = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && !Number.isFinite(score)) return;
    const next = setMemberScore(
      tournament,
      activeStage,
      selectedGroup.key,
      memberKey,
      score,
      true
    );
    setTournament(next);
  };

  const ranked = useMemo(() => rankedScores(scores), [scores]);
  /** 实时榜只展示前 N 名，避免占满屏 */
  const LIVE_BOARD_LIMIT = 6;
  const liveBoard = useMemo(
    () => ranked.slice(0, LIVE_BOARD_LIMIT),
    [ranked]
  );
  const leaderScore = ranked.reduce((max, row) => Math.max(max, row.score), 0) || 1;
  const running = status.status === "running" || status.status === "connecting";
  const modeText = modeBadgeText({ isPkActive, isLinkmic, modeLabel, mode });
  const partyCount = participantCount || ranked.length;
  const countdownSec = countdownMs / 1000;
  const summary = stageSummary(stageState);
  const liveWriteGroup =
    stageState.groups.find((g) => g.key === liveWriteGroupKey) || null;
  const browsingHistory =
    Boolean(selectedGroup) &&
    Boolean(liveWriteGroupKey) &&
    selectedGroupKey !== liveWriteGroupKey;

  return (
    <div className={cn("space-y-4", !active && "hidden")}>
      {/* 单房 URL */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={liveRoomUrl}
          onChange={(event) => setLiveRoomUrl(event.target.value)}
          placeholder="直播间 URL，例如 https://live.douyin.com/xxxx"
          className="h-10 flex-1"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy) void startMonitor();
          }}
        />
        <div className="flex gap-2">
          <Button
            className="h-10 min-w-20"
            disabled={busy || running}
            onClick={() => void startMonitor()}
          >
            <Play className="size-4" />
            开始
          </Button>
          <Button
            variant="outline"
            className="h-10 min-w-20"
            disabled={busy || status.status === "idle"}
            onClick={() => void stopMonitor()}
          >
            <Square className="size-4" />
            停止
          </Button>
          <Button
            variant="secondary"
            className="h-10"
            onClick={handleImportBuiltIn}
            title="导入内置锁定分组（58 人 8 组，每组 7–8）作为小组赛，并写入 PK 分组·小组赛"
          >
            <Download className="size-4" />
            导入内置小组赛
          </Button>
          <select
            className="h-10 min-w-[10rem] rounded-md border border-border/70 bg-background px-2 text-sm"
            value={importPresetId}
            onChange={(event) => setImportPresetId(event.target.value)}
            onFocus={refreshPkPresets}
            title="PK 分组有多套存档：先选再导入监控；组间对调后在分组页改完再选"
          >
            {pkPresets.length === 0 ? (
              <option value="">无 PK 分组存档</option>
            ) : (
              pkPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.active ? " · 激活" : ""} · {p.groupCount}组/{p.memberCount}人
                </option>
              ))
            )}
          </select>
          <Button
            variant="outline"
            className="h-10"
            onClick={handleImportGroup}
            disabled={!importPresetId && pkPresets.length === 0}
            title="导入所选 PK 分组存档为小组赛（选择一次再开始监控）"
          >
            导入所选分组
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={cn(
            "inline-block size-2 rounded-full",
            status.status === "running"
              ? "bg-emerald-500"
              : status.status === "connecting"
                ? "bg-amber-400"
                : status.status === "error"
                  ? "bg-destructive"
                  : "bg-muted-foreground/40"
          )}
        />
        <span className="font-medium">{statusLabel(status.status)}</span>
        <Badge variant={isPkActive ? "default" : isLinkmic ? "outline" : "secondary"}>
          {modeText}
        </Badge>
        {partyCount > 0 && (
          <span className="text-muted-foreground">
            {partyCount} {isPkActive || mode === "pk" ? "方" : "人"}
            {countdownSec > 0 ? ` · 倒计时 ${countdownText(countdownSec)}` : ""}
          </span>
        )}
        {(ownerNickname || roomTitle) && (
          <span className="ml-auto truncate text-muted-foreground" title={roomTitle || ownerNickname}>
            {ownerNickname ? `本房 ${ownerNickname}` : roomTitle}
          </span>
        )}
      </div>

      {/* 四阶段 */}
      <div className="rounded-xl border border-border/70 bg-card/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Trophy className="size-4 text-primary" />
          <span className="text-sm font-semibold">赛程记分</span>
          <span className="text-xs text-muted-foreground">
            {summary.groups} 组 · 已记 {summary.scored}/{summary.members}
            {summary.settled ? " · 已结算" : ""}
            {tournament.sourcePresetName ? ` · 来源 ${tournament.sourcePresetName}` : ""}
            {" · "}
            只记 PK 分(≥{MIN_AUTO_PK_SCORE}) · 连麦不记
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STAGE_TABS.map((tab) => {
            const s = stageSummary(tournament.stages[tab.key]);
            const on = activeStage === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleStageTab(tab.key)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted/40"
                )}
              >
                {tab.label}
                <span className="ml-1 tabular-nums opacity-70">
                  {s.groups ? `${s.groups}组` : "—"}
                  {s.settled ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>

        {stageState.groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
            {activeStage === "group"
              ? "导入分组后开始。监控中可点左侧回看历史组分数；写分不打断浏览"
              : "完成本阶段前序结算后自动生成"}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)]">
            <div className="space-y-1 max-h-[22rem] overflow-auto pr-1">
              {stageState.groups.map((group) => {
                const scored = group.members.filter((m) => m.score != null).length;
                const maxScore = group.members.reduce(
                  (m, row) => Math.max(m, Number(row.score) || 0),
                  0
                );
                const on = selectedGroup?.key === group.key;
                const isLive = liveWriteGroupKey === group.key;
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => {
                      // 点左侧 = 浏览该组（含历史分）；不跟写分目标绑定
                      userBrowsingRef.current = true;
                      setSelectedGroupKey(group.key);
                    }}
                    className={cn(
                      "w-full rounded-md border px-2.5 py-1.5 text-left transition-colors",
                      on
                        ? "border-primary bg-primary/5"
                        : "border-border/50 hover:bg-muted/30",
                      isLive && !on && "border-emerald-500/40"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-semibold truncate">
                        {group.label}
                        {isLive ? (
                          <span className="ml-1 text-[10px] font-normal text-emerald-600">
                            写分
                          </span>
                        ) : null}
                      </span>
                      <Badge variant="secondary" className="text-[10px] shrink-0 px-1.5">
                        {groupStatusLabel(group.status)}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {scored}/{group.members.length}
                      {maxScore > 0 ? ` · 高 ${compactNumber(maxScore)}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-lg border border-border/50 overflow-hidden min-w-0">
              {selectedGroup ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5 text-[11px]">
                    <span className="font-semibold">{selectedGroup.label}</span>
                    {browsingHistory ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        回看历史 · 写分仍在 {liveWriteGroup?.label || "当前组"}
                      </span>
                    ) : liveWriteGroupKey === selectedGroup.key ? (
                      <span className="text-emerald-600">正在写分此组</span>
                    ) : null}
                    {browsingHistory ? (
                      <button
                        type="button"
                        className="ml-auto text-primary underline-offset-2 hover:underline"
                        onClick={() => {
                          userBrowsingRef.current = false;
                          if (liveWriteGroupKey) setSelectedGroupKey(liveWriteGroupKey);
                        }}
                      >
                        回到写分组
                      </button>
                    ) : (
                      <span className="ml-auto text-muted-foreground">
                        点左侧可回看其它组
                      </span>
                    )}
                  </div>
                  <div className="max-h-[22rem] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground backdrop-blur">
                        <tr>
                          <th className="px-2.5 py-1.5 text-left font-medium w-8">#</th>
                          <th className="px-2.5 py-1.5 text-left font-medium">成员</th>
                          <th className="px-2.5 py-1.5 text-right font-medium w-28">音浪</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...selectedGroup.members]
                          .sort((a, b) => {
                            const as = a.score == null ? -1 : a.score;
                            const bs = b.score == null ? -1 : b.score;
                            if (as !== bs) return bs - as;
                            return a.memberKey.localeCompare(b.memberKey, "zh");
                          })
                          .map((member, index) => (
                            <tr
                              key={member.memberKey}
                              className="border-t border-border/40"
                            >
                              <td className="px-2.5 py-1 text-muted-foreground tabular-nums text-xs">
                                {index + 1}
                              </td>
                              <td className="px-2.5 py-1">
                                <div
                                  className="font-medium truncate text-sm leading-tight"
                                  title={member.name}
                                >
                                  {member.name}
                                  {member.manual ? (
                                    <span className="ml-1 text-[10px] text-muted-foreground">
                                      手改
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-2.5 py-1 text-right">
                                <Input
                                  className="h-7 w-24 ml-auto text-right tabular-nums text-xs"
                                  inputMode="numeric"
                                  placeholder="—"
                                  value={
                                    member.score == null ? "" : String(member.score)
                                  }
                                  disabled={stageState.settled}
                                  onChange={(e) =>
                                    handleMemberScoreChange(
                                      member.memberKey,
                                      e.target.value
                                    )
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  选择左侧一组
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* 单房实时榜 · 压缩：顶栏+前6名，不占满屏 */}
      <div className="rounded-xl border border-border/70 bg-card/40 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2 text-xs">
          <span className="font-semibold">实时音浪</span>
          {partyCount > 0 ? (
            <span className="text-muted-foreground tabular-nums">
              {partyCount}
              {isPkActive || mode === "pk" ? "方" : "人"}
              {countdownSec > 0 ? ` · ${countdownText(countdownSec)}` : ""}
            </span>
          ) : null}
          <span className="ml-auto text-muted-foreground truncate">
            PK≥{MIN_AUTO_PK_SCORE} · 连麦不记
            {ranked.length > LIVE_BOARD_LIMIT
              ? ` · 前${LIVE_BOARD_LIMIT}/${ranked.length}`
              : ""}
          </span>
        </div>
        {ranked.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/50 px-3 py-3 text-center text-xs text-muted-foreground">
            {running ? "等待快照…" : "开始后显示"}
          </div>
        ) : (
          <div className="space-y-1">
            {liveBoard.map((row, index) => {
              const width = Math.max(4, Math.round((row.score / leaderScore) * 100));
              return (
                <div
                  key={`${row.anchorId}-${index}`}
                  className="grid grid-cols-[20px_minmax(0,1fr)_56px] items-center gap-2"
                >
                  <div className="text-center text-[11px] font-bold tabular-nums text-muted-foreground">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex items-center gap-2">
                    <span
                      className="truncate text-xs font-medium min-w-0 flex-1"
                      title={row.name}
                    >
                      {row.name || row.uniqueId || row.anchorId}
                    </span>
                    <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:w-24">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-300",
                          index === 0 ? "bg-primary" : "bg-muted-foreground/35"
                        )}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right text-xs font-bold tabular-nums">
                    {compactNumber(row.score)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="min-h-5 text-xs text-muted-foreground">
        {message ||
          (status.lastError
            ? status.lastError
            : "选分组 → 开始 → 只记 PK(≥200) · 连麦不记 → 组序主路径 · 打错PK改写 → 全员有分自动结算 · 分仅本机")}
      </div>
    </div>
  );
}

function createClientTournament(): TournamentState {
  if (typeof window === "undefined") {
    return {
      version: 1,
      rules: {
        groupSize: 8,
        groupTop: 4,
        groupReviveTail: 4,
        promoTarget: 8,
        idealPromoPool: 48,
        reviveTarget: null,
        sevenPersonSplit: "4-3",
      },
      stages: {
        group: { groups: [], settled: false, advanceKeys: [] },
        revive: { groups: [], settled: false, advanceKeys: [] },
        promo: { groups: [], settled: false, advanceKeys: [] },
        finals: { groups: [], settled: false, advanceKeys: [] },
      },
      activeStage: "group",
      updatedAt: new Date().toISOString(),
    };
  }
  return loadTournamentState();
}
