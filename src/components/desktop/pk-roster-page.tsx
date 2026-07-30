"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  GripVertical,
  Loader2,
  RefreshCw,
  RotateCcw,
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
  buildPresetBattleGroupsResult,
  loadRosterText,
  resolveRosterNames,
  saveRosterText,
} from "./pk-roster-config";
import {
  formatGapViolation,
  validateGroupsGap,
} from "../../../shared/pk-group-constraints.js";

type ScoreDisplay = "total" | "latest";
type UiGroup = BuildPkGroupsGroup & { key: string };

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

function cloneGroups(groups: UiGroup[]): UiGroup[] {
  return groups.map((g) => ({
    ...g,
    members: g.members.map((m) => ({ ...m })),
  }));
}

function relabelGroups(groups: UiGroup[]): UiGroup[] {
  return groups.map((g, i) => ({
    ...g,
    order: i + 1,
    label: `第${i + 1}组`,
  }));
}

function toUiGroups(result: BuildPkGroupsResult): UiGroup[] {
  return (result.groups || []).map((g, i) => ({
    ...g,
    key: `g-${i + 1}-${g.members[0]?.personId ?? g.members[0]?.name ?? i}`,
  }));
}

export function PkRosterPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const [mode, setMode] = useState<PkGroupMode>("preset");
  const [scoreDisplay, setScoreDisplay] = useState<ScoreDisplay>("total");
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

  const undoStack = useRef<UiGroup[][]>([]);
  const exportRef = useRef<HTMLDivElement>(null);
  const dragPerson = useRef<{ groupKey: string; personId: number | null; name: string } | null>(null);
  const dragGroupKey = useRef<string | null>(null);

  const scoreField: PkScoreField = scoreDisplay === "latest" ? "latestWave" : "wave";

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const pushUndo = useCallback((snapshot: UiGroup[]) => {
    undoStack.current.push(snapshot);
    if (undoStack.current.length > 20) undoStack.current.shift();
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) setGroups(prev);
  }, []);

  const resolution = useMemo(
    () => resolveRosterNames(rawMales, includeText),
    [rawMales, includeText]
  );

  const eligible = useMemo(() => {
    if (!resolution.names.length) return [] as PkMember[];
    return rawMales.filter((m) => resolution.ids.has(m.personId));
  }, [rawMales, resolution]);

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

  const rebuildGroups = useCallback(async () => {
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
    // 内置模式允许用名单名占位（库中未命中也按结构展示）
    if (mode !== "preset" && !eligible.length) {
      setGroups([]);
      setWarning(
        resolution.unmatchedNames.length
          ? `名单无人命中。未匹配：${resolution.unmatchedNames.slice(0, 8).join("、")}`
          : "名单无人命中"
      );
      return;
    }

    setBuilding(true);
    setError(null);
    setWarning(null);
    try {
      if (mode === "preset") {
        const built = buildPresetBattleGroupsResult(eligible, {
          scoreField: scoreField === "latestWave" ? "latestWave" : "wave",
        });
        setGroups(toUiGroups(built));
        undoStack.current = [];
        let warn = built.warning || "";
        if (resolution.unmatchedNames.length) {
          const miss = `未匹配 ${resolution.unmatchedNames.length} 人：${resolution.unmatchedNames.slice(0, 6).join("、")}${resolution.unmatchedNames.length > 6 ? "…" : ""}`;
          warn = warn ? `${warn}；${miss}` : miss;
        }
        setWarning(warn || null);
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
        groupSize: DEFAULT_PK_GROUP_SIZE,
        scoreField,
        firstStart: PRESET_BATTLE_FIRST_START,
        stepMinutes: mode === "preset" ? PRESET_BATTLE_STEP_MINUTES : 5,
      });
      if (!res.success) {
        setError(res.error || "分组失败");
        setGroups([]);
        return;
      }
      const built = res.data;
      if (!built?.ok) {
        setError(built?.error || "分组失败");
        setGroups([]);
        return;
      }
      setGroups(toUiGroups(built));
      undoStack.current = [];
      let warn = built.warning || "";
      if (resolution.unmatchedNames.length) {
        const miss = `未匹配 ${resolution.unmatchedNames.length} 人：${resolution.unmatchedNames.slice(0, 6).join("、")}${resolution.unmatchedNames.length > 6 ? "…" : ""}`;
        warn = warn ? `${warn}；${miss}` : miss;
      }
      setWarning(warn || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGroups([]);
    } finally {
      setBuilding(false);
    }
  }, [eligible, mode, scoreField, resolution]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    if (loadingRoster) return;
    void rebuildGroups();
  }, [loadingRoster, rebuildGroups]);

  const applyGroupsIfValid = useCallback(
    (next: UiGroup[], failMessagePrefix: string) => {
      const check = validateGroupsGap(next);
      if (!check.ok) {
        showToast(`${failMessagePrefix}：${formatGapViolation(check.violations[0])}`);
        return false;
      }
      pushUndo(cloneGroups(groups));
      setGroups(relabelGroups(next));
      return true;
    },
    [groups, pushUndo, showToast]
  );

  const swapPersons = useCallback(
    (
      a: { groupKey: string; personId: number | null; name: string },
      b: { groupKey: string; personId: number | null; name: string }
    ) => {
      if (a.groupKey === b.groupKey && a.name === b.name) return;
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

  const handleExport = async () => {
    if (!exportRef.current || !groups.length) return;
    setExporting(true);
    try {
      const dataUrl = await elementToPngDataUrl(exportRef.current, {
        backgroundColor: "#f8fafc",
        pixelRatio: 2,
      });
      await downloadDataUrlAsFile(
        dataUrl,
        `PK分组_${MODE_OPTIONS.find((m) => m.key === mode)?.label || mode}_${period}.png`
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
          <p className="text-xs text-muted-foreground">男团 · 内置锁定 / 引擎三模式 · 人拖互换 / 组序拖改</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-8 w-[150px]" />
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
          <Button size="sm" variant="outline" onClick={() => void rebuildGroups()} disabled={building}>
            {building ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <RefreshCw className="mr-1 size-3.5" />}
            重新分组
          </Button>
          <Button size="sm" variant="ghost" onClick={undo} title="撤销上一次拖拽">
            <RotateCcw className="size-3.5" />
          </Button>
          <Button size="sm" onClick={() => void handleExport()} disabled={!groups.length || exporting}>
            <Download className="mr-1 size-3.5" />
            导出
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">名单 {resolution.names.length}</Badge>
        <Badge variant="secondary">命中 {eligible.length}</Badge>
        <Badge variant="secondary">组数 {groups.length}</Badge>
        {building && (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            分组中…
          </span>
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
        <EmptyState label="还没有分组 — 导入名单或点重新分组" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card
              key={group.key}
              className="overflow-hidden"
              onDragOver={(e) => {
                if (dragGroupKey.current) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragGroupKey.current;
                dragGroupKey.current = null;
                if (from) reorderGroup(from, group.key);
              }}
            >
              <CardHeader className="space-y-1 border-b bg-muted/30 py-3">
                <CardTitle
                  className="flex cursor-grab items-center gap-2 text-sm active:cursor-grabbing"
                  draggable
                  onDragStart={() => {
                    dragGroupKey.current = group.key;
                  }}
                  onDragEnd={() => {
                    dragGroupKey.current = null;
                  }}
                >
                  <GripVertical className="size-3.5 text-muted-foreground" />
                  <span>{group.label}</span>
                  {group.scheduleLabel && (
                    <span className="font-normal text-muted-foreground">· {group.scheduleLabel}</span>
                  )}
                  <span className="ml-auto font-normal text-muted-foreground">{group.count} 人</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {group.members.map((m) => (
                    <li
                      key={`${group.key}-${m.personId ?? m.name}-${m.index}`}
                      draggable
                      onDragStart={() => {
                        dragPerson.current = {
                          groupKey: group.key,
                          personId: m.personId,
                          name: m.name,
                        };
                      }}
                      onDragEnd={() => {
                        dragPerson.current = null;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const from = dragPerson.current;
                        dragPerson.current = null;
                        if (!from) return;
                        swapPersons(from, {
                          groupKey: group.key,
                          personId: m.personId,
                          name: m.name,
                        });
                      }}
                      className="flex cursor-grab items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/40 active:cursor-grabbing"
                    >
                      <span className="truncate font-medium">{m.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatWave(memberScore(m, scoreDisplay))}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="pointer-events-none fixed left-[-10000px] top-0">
        <div ref={exportRef} className="w-[960px] bg-slate-50 p-6 text-slate-900" style={{ fontFamily: "system-ui, sans-serif" }}>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <div className="text-2xl font-bold">PK 分组</div>
              <div className="mt-1 text-sm text-slate-500">
                {period} · {MODE_OPTIONS.find((m) => m.key === mode)?.label} · {scoreDisplay === "latest" ? "最新日音浪" : "月总分"}
              </div>
            </div>
            <div className="text-sm text-slate-500">
              {eligible.length} 人 · {groups.length} 组
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {groups.map((group) => (
              <div key={`ex-${group.key}`} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                  <span>
                    {group.label}
                    {group.startTime ? ` · ${group.startTime}` : ""}
                  </span>
                  <span className="font-normal text-slate-500">{group.count}人</span>
                </div>
                <div className="space-y-1">
                  {group.members.map((m) => (
                    <div key={`ex-${group.key}-${m.index}-${m.name}`} className="flex justify-between text-sm">
                      <span>{m.name}</span>
                      <span className="tabular-nums text-slate-500">{formatWave(memberScore(m, scoreDisplay))}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
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
              <button type="button" onClick={() => setImportOpen(false)} className="rounded p-1 hover:bg-muted">
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
