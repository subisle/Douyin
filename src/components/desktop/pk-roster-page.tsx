"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  GripVertical,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Upload,
  X,
} from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import type {
  BuildPkGroupsGroup,
  BuildPkGroupsResult,
  IpcResult,
  PkGroupMode,
  PkMember,
  PkRosterData,
  PkScoreField,
} from "@/types/electron";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "./states";
import { formatWave } from "./format";
import { elementToPngDataUrl, downloadDataUrlAsFile } from "./export-image";
import {
  DEFAULT_PK_GROUP_SIZE,
  PRESET_BATTLE_FIRST_START,
  PRESET_BATTLE_STEP_MINUTES,
  PRESET_ROSTER_TEXT,
  attachScheduleToGroups,
  buildBattleGroupsResultFromNameGroups,
  buildPresetBattleGroupsResult,
  clearSavedGroupsLayout,
  groupsToNameGroups,
  loadRosterText,
  loadSavedGroupsLayout,
  normalizeFirstStart,
  normalizeGroupSize,
  normalizeStepMinutes,
  resolveRosterNames,
  saveGroupsLayout,
  saveRosterText,
} from "./pk-roster-config";
import {
  formatGapViolation,
  validateGroupsGap,
} from "../../../shared/pk-group-constraints.js";

type ScoreDisplay = "total" | "latest";
type UiGroup = BuildPkGroupsGroup & { key: string };
type DragPerson = { groupKey: string; personId: number | null; name: string };

const MODE_OPTIONS: { key: PkGroupMode; label: string }[] = [
  { key: "preset", label: "内置" },
  { key: "high_to_low", label: "顺序" },
  { key: "balanced", label: "均衡" },
  { key: "score_capable", label: "能出分" },
];

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function memberScore(m: { wave?: number; latestWave?: number }, display: ScoreDisplay) {
  if (display === "latest") return Number(m.latestWave || 0);
  return Number(m.wave || 0);
}

function personRowKey(groupKey: string, m: { personId?: number | null; name?: string; index?: number }) {
  return `${groupKey}:${m.personId ?? m.name ?? ""}:${m.index ?? 0}`;
}

function cloneGroups(groups: UiGroup[]): UiGroup[] {
  return groups.map((g) => ({
    ...g,
    members: g.members.map((m) => ({ ...m })),
  }));
}

function relabelGroups(groups: UiGroup[], scoreDisplay: ScoreDisplay): UiGroup[] {
  return groups.map((g, i) => {
    const strengths = g.members
      .map((m) => memberScore(m, scoreDisplay))
      .sort((a, b) => b - a);
    const top4 = strengths.slice(0, 4).reduce((s, n) => s + n, 0);
    const average =
      g.members.length > 0
        ? g.members.reduce((s, m) => s + memberScore(m, scoreDisplay), 0) / g.members.length
        : 0;
    return {
      ...g,
      key: `g-${i + 1}`,
      order: i + 1,
      label: `第${i + 1}组`,
      count: g.members.length,
      top4: Math.round(top4),
      average: Math.round(average),
      scheduleLabel: g.startTime ? `${g.startTime} 开始连麦` : g.scheduleLabel,
      members: g.members.map((m, idx) => ({
        ...m,
        index: idx + 1,
        strength: Math.round(memberScore(m, scoreDisplay)),
      })),
    };
  });
}

function toUiGroups(result: BuildPkGroupsResult): UiGroup[] {
  return (result.groups || []).map((g, i) => ({
    ...g,
    key: `g-${i + 1}`,
  }));
}

function attachScheduleTimes(
  groups: UiGroup[],
  firstStart: string,
  stepMinutes: number
): UiGroup[] {
  return attachScheduleToGroups(groups, { firstStart, stepMinutes });
}

export function PkRosterPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const [mode, setMode] = useState<PkGroupMode>("preset");
  const [scoreDisplay, setScoreDisplay] = useState<ScoreDisplay>("total");
  const [firstStart, setFirstStart] = useState(() =>
    normalizeFirstStart(loadSavedGroupsLayout()?.firstStart || PRESET_BATTLE_FIRST_START)
  );
  const [stepMinutes, setStepMinutes] = useState(() =>
    normalizeStepMinutes(loadSavedGroupsLayout()?.stepMinutes ?? PRESET_BATTLE_STEP_MINUTES)
  );
  const [groupSize, setGroupSize] = useState(() =>
    normalizeGroupSize(loadSavedGroupsLayout()?.groupSize ?? DEFAULT_PK_GROUP_SIZE)
  );
  const [includeText, setIncludeText] = useState(() => loadRosterText());
  const [rawMales, setRawMales] = useState<PkMember[]>([]);
  const [groups, setGroups] = useState<UiGroup[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importDraft, setImportDraft] = useState("");
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(() => loadSavedGroupsLayout()?.savedAt || null);
  const [dragOverGroupKey, setDragOverGroupKey] = useState<string | null>(null);
  const [dragOverPersonKey, setDragOverPersonKey] = useState<string | null>(null);
  const [draggingPersonKey, setDraggingPersonKey] = useState<string | null>(null);
  const [draggingGroupKey, setDraggingGroupKey] = useState<string | null>(null);

  const undoStack = useRef<UiGroup[][]>([]);
  const exportRef = useRef<HTMLDivElement>(null);
  const dragPerson = useRef<DragPerson | null>(null);
  const dragGroupKeyRef = useRef<string | null>(null);

  const scoreField: PkScoreField = scoreDisplay === "latest" ? "latestWave" : "wave";

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const pushUndo = useCallback((snapshot: UiGroup[]) => {
    undoStack.current.push(snapshot);
    if (undoStack.current.length > 20) undoStack.current.shift();
  }, []);

  const clearDragVisual = useCallback(() => {
    setDragOverGroupKey(null);
    setDragOverPersonKey(null);
    setDraggingPersonKey(null);
    setDraggingGroupKey(null);
    dragPerson.current = null;
    dragGroupKeyRef.current = null;
  }, []);

  const persistGroups = useCallback(
    (nextGroups: UiGroup[], opts?: { silent?: boolean }) => {
      const nameGroups = groupsToNameGroups(nextGroups);
      const saved = saveGroupsLayout({
        nameGroups,
        period,
        mode,
        scoreDisplay,
        firstStart,
        stepMinutes,
        groupSize,
      });
      if (saved) {
        setSavedAt(saved.savedAt);
        setDirty(false);
        if (!opts?.silent) showToast("分组已保存");
        return true;
      }
      if (!opts?.silent) showToast("保存失败：分组为空");
      return false;
    },
    [firstStart, groupSize, mode, period, scoreDisplay, showToast, stepMinutes]
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setGroups(prev);
    setDirty(true);
    clearDragVisual();
  }, [clearDragVisual]);

  const resolution = useMemo(
    () => resolveRosterNames(rawMales, includeText),
    [rawMales, includeText]
  );

  const eligible = useMemo(() => {
    if (!resolution.names.length) return [] as PkMember[];
    return rawMales.filter((m) => resolution.ids.has(m.personId));
  }, [rawMales, resolution]);

  const memberPool = useMemo(() => {
    // 内置/已保存布局允许用全量男团补齐占位，优先 eligible
    if (!rawMales.length) return [] as PkMember[];
    if (!eligible.length) return rawMales;
    const seen = new Set(eligible.map((m) => m.personId));
    return [...eligible, ...rawMales.filter((m) => !seen.has(m.personId))];
  }, [eligible, rawMales]);

  const loadRoster = useCallback(async () => {
    const api = getDataApi();
    if (!api?.getPkRoster) {
      setError("getPkRoster 不可用");
      setLoadingRoster(false);
      return;
    }
    setLoadingRoster(true);
    setError(null);
    try {
      const res: IpcResult<PkRosterData> = await api.getPkRoster(period, DEFAULT_PK_GROUP_SIZE);
      if (!res.success) {
        setError(res.error || "拉取名单失败");
        setRawMales([]);
        return;
      }
      setRawMales(res.data?.males || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRawMales([]);
    } finally {
      setLoadingRoster(false);
    }
  }, [period]);

  const applyBuiltResult = useCallback(
    (built: BuildPkGroupsResult) => {
      const stamped = attachScheduleTimes(toUiGroups(built), firstStart, stepMinutes);
      setGroups(relabelGroups(stamped, scoreDisplay));
      undoStack.current = [];
      let warn = built.warning || "";
      if (resolution.unmatchedNames.length) {
        const miss = `未匹配 ${resolution.unmatchedNames.length} 人：${resolution.unmatchedNames
          .slice(0, 6)
          .join("、")}${resolution.unmatchedNames.length > 6 ? "…" : ""}`;
        warn = warn ? `${warn}；${miss}` : miss;
      }
      setWarning(warn || null);
    },
    [firstStart, resolution.unmatchedNames, scoreDisplay, stepMinutes]
  );

  const rebuildGroups = useCallback(
    async (opts?: { clearSaved?: boolean; preferSaved?: boolean }) => {
      const api = getDataApi();
      if (mode !== "preset" && !api?.buildPkGroups) {
        setError("buildPkGroups 不可用");
        return;
      }
      if (!resolution.names.length) {
        setGroups([]);
        setWarning("请先导入参赛名单");
        return;
      }
      if (mode !== "preset" && !eligible.length) {
        setGroups([]);
        setWarning(
          resolution.unmatchedNames.length
            ? `名单无人命中。未匹配：${resolution.unmatchedNames.slice(0, 8).join("、")}`
            : "名单无人命中"
        );
        return;
      }

      if (opts?.clearSaved) {
        clearSavedGroupsLayout();
        setSavedAt(null);
        setDirty(false);
      }

      const preferSaved = opts?.preferSaved !== false && !opts?.clearSaved;
      if (preferSaved) {
        const saved = loadSavedGroupsLayout();
        if (saved?.nameGroups?.length) {
          const built = buildBattleGroupsResultFromNameGroups(saved.nameGroups, memberPool, {
            scoreField: scoreField === "latestWave" ? "latestWave" : "wave",
            mode,
            modeLabel: "已保存分组",
            source: "已保存拖拽分组",
            firstStart,
            stepMinutes,
            notes: [
              "来自本地保存的拖拽分组",
              saved.savedAt ? `保存于 ${new Date(saved.savedAt).toLocaleString("zh-CN")}` : "",
            ].filter(Boolean),
          });
          applyBuiltResult(built);
          setSavedAt(saved.savedAt || null);
          setDirty(false);
          return;
        }
      }

      setBuilding(true);
      setError(null);
      setWarning(null);
      try {
        if (mode === "preset") {
          const built = buildPresetBattleGroupsResult(memberPool, {
            scoreField: scoreField === "latestWave" ? "latestWave" : "wave",
            firstStart,
            stepMinutes,
          });
          applyBuiltResult(built);
          setDirty(false);
          return;
        }
        if (!api?.buildPkGroups) {
          setError("buildPkGroups 不可用");
          setGroups([]);
          return;
        }
        const res: IpcResult<BuildPkGroupsResult> = await api.buildPkGroups({
          members: eligible.map((m) => ({
            personId: m.personId,
            name: m.name,
            wave: m.wave,
            latestWave: m.latestWave,
            trimmedAvg: m.trimmedAvg,
            gender: m.gender,
            anchorId: m.anchorId,
          })),
          mode,
          groupSize,
          scoreField,
          firstStart,
          stepMinutes,
        });
        if (!res.success) {
          setError(res.error || "分组失败");
          setGroups([]);
          return;
        }
        if (!res.data) {
          setError("分组结果为空");
          setGroups([]);
          return;
        }
        applyBuiltResult(res.data);
        setDirty(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setGroups([]);
      } finally {
        setBuilding(false);
      }
    },
    [
      applyBuiltResult,
      eligible,
      firstStart,
      groupSize,
      memberPool,
      mode,
      resolution.names.length,
      resolution.unmatchedNames,
      scoreField,
      stepMinutes,
    ]
  );

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  // 名单/模式/口径变化后自动分组（优先本地已保存布局）
  useEffect(() => {
    if (loadingRoster) return;
    void rebuildGroups({ preferSaved: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingRoster, includeText, period, mode, scoreDisplay]);

  // 每组人数变化：非内置模式重新分组；内置模式忽略
  useEffect(() => {
    if (loadingRoster) return;
    if (mode === "preset") return;
    void rebuildGroups({ preferSaved: false, clearSaved: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSize]);

  // 连麦开始/间隔变更：只重算各组时间，不打散人员
  useEffect(() => {
    setGroups((prev) => {
      if (!prev.length) return prev;
      return relabelGroups(attachScheduleTimes(prev, firstStart, stepMinutes), scoreDisplay);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstStart, stepMinutes]);

  const applyGroupsIfValid = useCallback(
    (next: UiGroup[], failMessagePrefix: string, opts?: { autosave?: boolean }) => {
      const scheduled = attachScheduleTimes(next, firstStart, stepMinutes);
      const normalized = relabelGroups(scheduled, scoreDisplay);
      const check = validateGroupsGap(normalized);
      if (!check.ok) {
        showToast(`${failMessagePrefix}：${formatGapViolation(check.violations[0])}`);
        return false;
      }
      pushUndo(cloneGroups(groups));
      setGroups(normalized);
      setDirty(true);
      if (opts?.autosave !== false) {
        // 拖拽后自动保存
        persistGroups(normalized, { silent: true });
        showToast("已调整并保存");
      }
      return true;
    },
    [firstStart, groups, persistGroups, pushUndo, scoreDisplay, showToast, stepMinutes]
  );

  const swapPersons = useCallback(
    (a: DragPerson, b: DragPerson) => {
      if (a.groupKey === b.groupKey && a.name === b.name && a.personId === b.personId) return;
      const next = cloneGroups(groups);
      const ga = next.find((g) => g.key === a.groupKey);
      const gb = next.find((g) => g.key === b.groupKey);
      if (!ga || !gb) return;
      const ia = ga.members.findIndex(
        (m) => (a.personId != null && m.personId === a.personId) || m.name === a.name
      );
      const ib = gb.members.findIndex(
        (m) => (b.personId != null && m.personId === b.personId) || m.name === b.name
      );
      if (ia < 0 || ib < 0) return;
      const tmp = ga.members[ia];
      ga.members[ia] = gb.members[ib];
      gb.members[ib] = tmp;
      applyGroupsIfValid(next, "无法交换");
    },
    [groups, applyGroupsIfValid]
  );

  /** 拖到组板块（非具体人）时：移入目标组末尾；目标已满则与最后一人对调 */
  const movePersonToGroup = useCallback(
    (from: DragPerson, toGroupKey: string) => {
      if (from.groupKey === toGroupKey) return;
      const next = cloneGroups(groups);
      const ga = next.find((g) => g.key === from.groupKey);
      const gb = next.find((g) => g.key === toGroupKey);
      if (!ga || !gb) return;
      const ia = ga.members.findIndex(
        (m) => (from.personId != null && m.personId === from.personId) || m.name === from.name
      );
      if (ia < 0) return;
      const [picked] = ga.members.splice(ia, 1);
      if (gb.members.length >= groupSize) {
        const displaced = gb.members.pop();
        if (displaced) ga.members.push(displaced);
      }
      gb.members.push(picked);
      applyGroupsIfValid(next, "无法移动");
    },
    [applyGroupsIfValid, groupSize, groups]
  );

  const reorderGroup = useCallback(
    (fromKey: string, toKey: string) => {
      if (fromKey === toKey) return;
      const next = cloneGroups(groups);
      const from = next.findIndex((g) => g.key === fromKey);
      const to = next.findIndex((g) => g.key === toKey);
      if (from < 0 || to < 0) return;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      applyGroupsIfValid(next, "无法调整顺序");
    },
    [groups, applyGroupsIfValid]
  );

  const openImport = () => {
    setImportDraft(includeText);
    setImportOpen(true);
  };

  const confirmImport = () => {
    const text = importDraft.trim() ? importDraft : PRESET_ROSTER_TEXT;
    setIncludeText(text);
    saveRosterText(text);
    setImportOpen(false);
  };

  const handleSave = () => {
    if (!groups.length) {
      showToast("没有可保存的分组");
      return;
    }
    persistGroups(groups);
  };

  const handleReset = () => {
    void rebuildGroups({ clearSaved: true, preferSaved: false });
    showToast(mode === "preset" ? "已恢复内置分组" : "已重新分组");
  };

  const handleExport = async () => {
    if (!exportRef.current || !groups.length) return;
    setExporting(true);
    try {
      const dataUrl = await elementToPngDataUrl(exportRef.current, {
        backgroundColor: "#FFF7FB",
        pixelRatio: 2,
      });
      await downloadDataUrlAsFile(
        dataUrl,
        `星嗨艺创_分组_${MODE_OPTIONS.find((m) => m.key === mode)?.label || mode}_${period}.png`
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  if (loadingRoster) return <LoadingState label="加载 PK 名单…" />;
  if (error && !rawMales.length) {
    return <ErrorState message={error} onRetry={() => void loadRoster()} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">PK 分组</h1>
          <p className="text-xs text-muted-foreground">
            拖人员互换 / 拖到组板块移动 · 拖组标题调序 · 调整后自动保存
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-8 w-[150px]"
          />
          <Button size="sm" variant="outline" onClick={openImport}>
            <Upload className="mr-1 size-3.5" />
            导入名单
          </Button>
          <div className="flex rounded-md border p-0.5">
            {MODE_OPTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setMode(item.key)}
                className={`rounded px-2.5 py-1 text-xs ${
                  mode === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border p-0.5">
            {([{ key: "total", label: "总分" }, { key: "latest", label: "最新" }] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setScoreDisplay(item.key)}
                className={`rounded px-2.5 py-1 text-xs ${
                  scoreDisplay === item.key
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground">
            <span className="shrink-0">开始</span>
            <Input
              type="time"
              value={firstStart}
              onChange={(e) => setFirstStart(normalizeFirstStart(e.target.value || firstStart))}
              className="h-6 w-[108px] border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              title="连麦开始时间"
            />
          </label>
          <label className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground">
            <span className="shrink-0">间隔</span>
            <Input
              type="number"
              min={1}
              max={180}
              value={stepMinutes}
              onChange={(e) => setStepMinutes(normalizeStepMinutes(e.target.value, stepMinutes))}
              className="h-6 w-14 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              title="组间连麦间隔（分钟）"
            />
            <span className="shrink-0">分</span>
          </label>
          <label className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground">
            <span className="shrink-0">每组</span>
            <Input
              type="number"
              min={2}
              max={20}
              value={groupSize}
              onChange={(e) => setGroupSize(normalizeGroupSize(e.target.value, groupSize))}
              className="h-6 w-12 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              title="每组人数（非内置模式生效）"
              disabled={mode === "preset"}
            />
            <span className="shrink-0">人</span>
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void rebuildGroups({ preferSaved: true })}
            disabled={building}
          >
            {building ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <RefreshCw className="mr-1 size-3.5" />}
            刷新
          </Button>
          <Button size="sm" variant="outline" onClick={handleReset} disabled={building}>
            <RotateCcw className="mr-1 size-3.5" />
            重置
          </Button>
          <Button size="sm" variant="ghost" onClick={undo} title="撤销上一次拖拽">
            撤销
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!groups.length} title="保存当前分组">
            <Save className="mr-1 size-3.5" />
            保存分组
          </Button>
          <Button size="sm" onClick={() => void handleExport()} disabled={!groups.length || exporting}>
            {exporting ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Download className="mr-1 size-3.5" />}
            导出
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">名单 {resolution.names.length}</Badge>
        <Badge variant="secondary">命中 {eligible.length}</Badge>
        <Badge variant="secondary">组数 {groups.length}</Badge>
        <Badge variant="secondary">
          连麦 {firstStart} · 间隔 {stepMinutes} 分
          {mode !== "preset" ? ` · 每组 ${groupSize}` : ""}
        </Badge>
        {dirty ? (
          <Badge variant="outline" className="border-amber-400 text-amber-700">
            未保存更改
          </Badge>
        ) : savedAt ? (
          <Badge variant="outline">已保存 {new Date(savedAt).toLocaleString("zh-CN")}</Badge>
        ) : null}
        {building && (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            分组中…
          </span>
        )}
        {dragOverGroupKey && (
          <Badge className="bg-violet-600 text-white hover:bg-violet-600">
            目标：{groups.find((g) => g.key === dragOverGroupKey)?.label || dragOverGroupKey}
          </Badge>
        )}
      </div>

      {warning && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {warning}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {toast && <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">{toast}</div>}

      {!groups.length && !building ? (
        <EmptyState label="还没有分组 — 导入名单或点刷新" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const isGroupTarget = dragOverGroupKey === group.key;
            const isGroupDragging = draggingGroupKey === group.key;
            return (
              <Card
                key={group.key}
                className={`overflow-hidden transition-all ${
                  isGroupTarget
                    ? "border-violet-500 ring-2 ring-violet-400/70 shadow-lg shadow-violet-500/10 scale-[1.01]"
                    : isGroupDragging
                      ? "opacity-60 border-dashed"
                      : ""
                }`}
                onDragOver={(e) => {
                  if (dragPerson.current || dragGroupKeyRef.current) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = dragPerson.current ? "move" : "move";
                  }
                  if (dragPerson.current || dragGroupKeyRef.current) {
                    setDragOverGroupKey(group.key);
                  }
                }}
                onDragEnter={(e) => {
                  if (dragPerson.current || dragGroupKeyRef.current) {
                    e.preventDefault();
                    setDragOverGroupKey(group.key);
                  }
                }}
                onDragLeave={(e) => {
                  const related = e.relatedTarget as Node | null;
                  if (related && e.currentTarget.contains(related)) return;
                  setDragOverGroupKey((cur) => (cur === group.key ? null : cur));
                  setDragOverPersonKey(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromGroup = dragGroupKeyRef.current;
                  const fromPerson = dragPerson.current;
                  // 组序拖放
                  if (fromGroup) {
                    dragGroupKeyRef.current = null;
                    clearDragVisual();
                    reorderGroup(fromGroup, group.key);
                    return;
                  }
                  // 人拖到板块（未落到具体人）
                  if (fromPerson) {
                    dragPerson.current = null;
                    clearDragVisual();
                    movePersonToGroup(fromPerson, group.key);
                  }
                }}
              >
                <CardHeader
                  className={`space-y-1 border-b py-3 transition-colors ${
                    isGroupTarget ? "bg-violet-50 dark:bg-violet-950/30" : "bg-muted/30"
                  }`}
                >
                  <CardTitle
                    className="flex cursor-grab items-center gap-2 text-sm active:cursor-grabbing"
                    draggable
                    onDragStart={(e) => {
                      dragGroupKeyRef.current = group.key;
                      setDraggingGroupKey(group.key);
                      e.dataTransfer.effectAllowed = "move";
                      try {
                        e.dataTransfer.setData("text/plain", `group:${group.key}`);
                      } catch {
                        /* ignore */
                      }
                    }}
                    onDragEnd={() => {
                      clearDragVisual();
                    }}
                  >
                    <GripVertical className="size-3.5 text-muted-foreground" />
                    <span>{group.label}</span>
                    {group.scheduleLabel && (
                      <span className="font-normal text-muted-foreground">· {group.scheduleLabel}</span>
                    )}
                    {typeof group.top4 === "number" && group.top4 > 0 && (
                      <span className="font-normal text-muted-foreground">· T4 {formatWave(group.top4)}</span>
                    )}
                    <span className="ml-auto font-normal text-muted-foreground">{group.count} 人</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y">
                    {group.members.map((m) => {
                      const rowKey = personRowKey(group.key, m);
                      const isOver = dragOverPersonKey === rowKey;
                      const isDragging = draggingPersonKey === rowKey;
                      return (
                        <li
                          key={rowKey}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            dragPerson.current = {
                              groupKey: group.key,
                              personId: m.personId,
                              name: m.name,
                            };
                            setDraggingPersonKey(rowKey);
                            setDragOverGroupKey(group.key);
                            e.dataTransfer.effectAllowed = "move";
                            try {
                              e.dataTransfer.setData("text/plain", `person:${m.name}`);
                            } catch {
                              /* ignore */
                            }
                          }}
                          onDragEnd={() => {
                            clearDragVisual();
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverGroupKey(group.key);
                            setDragOverPersonKey(rowKey);
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverGroupKey(group.key);
                            setDragOverPersonKey(rowKey);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const from = dragPerson.current;
                            clearDragVisual();
                            if (!from) return;
                            swapPersons(from, {
                              groupKey: group.key,
                              personId: m.personId,
                              name: m.name,
                            });
                          }}
                          className={`flex cursor-grab items-center justify-between gap-2 px-3 py-2 text-sm transition-colors active:cursor-grabbing ${
                            isDragging
                              ? "opacity-40 bg-muted/60"
                              : isOver
                                ? "bg-violet-100 dark:bg-violet-900/40 ring-1 ring-inset ring-violet-400"
                                : "hover:bg-muted/40"
                          }`}
                        >
                          <span className="truncate font-medium">{m.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatWave(memberScore(m, scoreDisplay))}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="pointer-events-none fixed left-[-10000px] top-0">
        <div
          ref={exportRef}
          className="w-[980px] p-10 text-slate-900"
          style={{
            fontFamily:
              "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",
            background:
              "linear-gradient(135deg, #FFF7FB 0%, #F5F0FF 32%, #ECFEFF 68%, #FFF7ED 100%)",
          }}
        >
          <div
            className="mb-5 overflow-hidden rounded-[26px] px-6 py-5 text-white shadow-lg"
            style={{
              background:
                "linear-gradient(120deg, #FF2D95 0%, #A855F7 42%, #6366F1 78%, #06B6D4 100%)",
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex size-11 items-center justify-center rounded-full border border-white/50 bg-white/20 text-lg font-black">
                  星
                </div>
                <div>
                  <div className="text-[11px] font-extrabold tracking-[0.18em] text-white/90">
                    XINGHAI YICHUANG · PK GROUP
                  </div>
                  <div className="mt-1 text-[32px] font-black leading-none tracking-tight">
                    星嗨艺创
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white/90">
                    {period} · {MODE_OPTIONS.find((m) => m.key === mode)?.label} · 共{" "}
                    {eligible.length} 人 · {groups.length} 组 · {firstStart} 起 / 间隔 {stepMinutes}{" "}
                    分
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex h-[52px] w-[88px] flex-col items-center justify-center rounded-2xl border border-white/30 bg-white/15">
                  <div className="text-xl font-black">{groups.length}</div>
                  <div className="text-[11px] font-bold">组</div>
                </div>
                <div className="flex h-[52px] w-[88px] flex-col items-center justify-center rounded-2xl bg-white text-violet-600 shadow-sm">
                  <div className="text-xl font-black">{eligible.length}</div>
                  <div className="text-[11px] font-extrabold text-fuchsia-500">人</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {groups.map((group, gi) => {
              const accents = [
                { main: "#FF2D95", soft: "#FFE4F3", deep: "#BE185D" },
                { main: "#7C3AED", soft: "#EDE9FE", deep: "#5B21B6" },
                { main: "#06B6D4", soft: "#CFFAFE", deep: "#0E7490" },
                { main: "#F59E0B", soft: "#FEF3C7", deep: "#B45309" },
                { main: "#22C55E", soft: "#DCFCE7", deep: "#15803D" },
                { main: "#F43F5E", soft: "#FFE4E6", deep: "#BE123C" },
                { main: "#3B82F6", soft: "#DBEAFE", deep: "#1D4ED8" },
                { main: "#A855F7", soft: "#F3E8FF", deep: "#7E22CE" },
              ];
              const accent = accents[gi % accents.length];
              return (
                <div
                  key={`ex-${group.key}`}
                  className="overflow-hidden rounded-[20px] border bg-white shadow-md"
                  style={{ borderColor: `${accent.main}40` }}
                >
                  <div className="h-1.5" style={{ background: accent.main }} />
                  <div className="p-3.5">
                    <div
                      className="mb-3 flex items-center gap-2 rounded-2xl px-3 py-2.5"
                      style={{ background: accent.soft, color: accent.deep }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-black leading-none">{group.label}</div>
                        <div className="mt-1 text-[11px] font-bold opacity-80">
                          {[group.startTime || group.scheduleLabel, `${group.count}人`]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {group.members.map((m) => (
                        <div
                          key={`ex-${group.key}-${m.index}-${m.name}`}
                          className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm"
                          style={{ background: `${accent.soft}99` }}
                        >
                          <span
                            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-extrabold"
                            style={{ color: accent.deep, border: `1px solid ${accent.main}55` }}
                          >
                            {m.index}
                          </span>
                          <span className="truncate font-bold text-slate-900">{m.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 text-center text-[11px] font-semibold text-violet-400/90">
            星嗨艺创 · 分组导出
          </div>
        </div>
      </div>

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <div className="font-semibold">导入名单</div>
                <div className="text-xs text-muted-foreground">换行 / 逗号分隔；支持编号前缀</div>
              </div>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="rounded p-1 hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-3 overflow-auto p-4">
              <textarea
                value={importDraft}
                onChange={(e) => setImportDraft(e.target.value)}
                rows={16}
                className="w-full rounded-md border bg-background p-3 font-mono text-xs leading-5"
                placeholder="每行一个名字"
              />
              {(() => {
                const preview = resolveRosterNames(rawMales, importDraft || PRESET_ROSTER_TEXT);
                return (
                  <div className="text-xs text-muted-foreground">
                    将匹配 {preview.matchedNames.length}/{preview.names.length}
                    {preview.unmatchedNames.length > 0 && (
                      <span className="text-amber-700 dark:text-amber-300">
                        {" "}
                        · 未匹配：{preview.unmatchedNames.slice(0, 8).join("、")}
                        {preview.unmatchedNames.length > 8 ? "…" : ""}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="flex flex-wrap gap-2 border-t px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => setImportDraft(PRESET_ROSTER_TEXT)}>
                填入默认白名单
              </Button>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)}>
                  取消
                </Button>
                <Button size="sm" onClick={confirmImport}>
                  确认导入
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
