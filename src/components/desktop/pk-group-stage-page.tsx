"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Swords, Trophy } from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { IpcResult, PkMember, PkRosterData } from "@/types/electron";
import {
  STAGE_TABS,
  importGroupStageFromBuiltIn,
  loadTournamentState,
  saveTournamentState,
  setMemberScore,
  settleActiveStage,
  stageSummary,
  type StageKey,
  type TournamentState,
} from "./pk-tournament-store";

function groupStatusLabel(status: string) {
  if (status === "live") return "监控中";
  if (status === "scored") return "已记分";
  if (status === "settled") return "已结算";
  return "待赛";
}

/**
 * 小组赛专页：内置 58 人 8 组为真源，四阶段记分 / 结算。
 * 与 PK 监控共用 `pk-monitor-tournament-v1`。
 */
export function PkGroupStagePage({ active = true, onStageChange }: { active?: boolean; onStageChange?: (stage: 'group' | 'revive' | 'promo' | 'finals') => void }) {
  const [tournament, setTournament] = useState<TournamentState>(() => loadTournamentState());
  const [rosterMembers, setRosterMembers] = useState<PkMember[]>([]);
  const [message, setMessage] = useState<string>("");
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const activeStage = tournament.activeStage || "group";
  const stageState = tournament.stages[activeStage];
  const summary = stageSummary(stageState);
  const selectedGroup =
    stageState.groups.find((g) => g.key === selectedGroupKey) || stageState.groups[0] || null;

  useEffect(() => {
    if (!active) return;
    const next = loadTournamentState();
    setTournament(next);
    const first = next.stages[next.activeStage || "group"].groups[0]?.key || "";
    setSelectedGroupKey(first);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const api = getDataApi();
    if (!api?.getPkRoster) return;
    void api.getPkRoster().then((result: IpcResult<PkRosterData>) => {
      if (!result.success) return;
      const males = result.data?.males || [];
      const females = result.data?.females || [];
      setRosterMembers([...males, ...females]);
    });
  }, [active]);

  useEffect(() => {
    if (!selectedGroupKey && stageState.groups[0]) {
      setSelectedGroupKey(stageState.groups[0].key);
    }
  }, [selectedGroupKey, stageState.groups]);

  const handleLoadBuiltIn = useCallback(() => {
    setBusy(true);
    const result = importGroupStageFromBuiltIn({
      membersMeta: rosterMembers,
      state: tournament,
      savePreset: true,
      makeActive: true,
    });
    setBusy(false);
    if (!result.state) {
      setMessage(result.message);
      return;
    }
    setTournament(result.state);
    setSelectedGroupKey(result.state.stages.group.groups[0]?.key || "");
    setMessage(result.message);
  }, [rosterMembers, tournament]);

  const handleStageTab = useCallback(
    (key: StageKey) => {
      const next = saveTournamentState({ ...tournament, activeStage: key });
      setTournament(next);
      setSelectedGroupKey(next.stages[key].groups[0]?.key || "");
    },
    [tournament]
  );

  const handleMemberScoreChange = useCallback(
    (memberKey: string, raw: string) => {
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
    },
    [activeStage, selectedGroup, tournament]
  );

  const handleSettle = useCallback(() => {
    setBusy(true);
    const result = settleActiveStage(tournament);
    setBusy(false);
    setTournament(result.state);
    setMessage(result.message);
    const stage = result.state.activeStage;
    setSelectedGroupKey(result.state.stages[stage].groups[0]?.key || "");
  }, [tournament]);

  const rankedSelected = useMemo(() => {
    if (!selectedGroup) return [];
    return [...selectedGroup.members].sort((a, b) => {
      const as = a.score == null ? -1 : Number(a.score);
      const bs = b.score == null ? -1 : Number(b.score);
      if (bs !== as) return bs - as;
      return String(a.memberKey).localeCompare(String(b.memberKey), "zh");
    });
  }, [selectedGroup]);

  if (!active) return null;

  const emptyHint =
    activeStage === "group"
      ? "点「加载内置小组赛」载入 58 人 8 组锁定表（每组 7–8 人）"
      : "完成本阶段前序结算后自动生成";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Swords className="size-5 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">小组赛</h1>
            <Badge variant="outline">内置 8 组 · 58 人 · 每组 ≥7</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            赛程真源：内置锁定分组 → 小组赛记分 → 复活赛 → 晋级赛 → 决赛。与 PK 监控共用同一赛程状态。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            className="h-10"
            disabled={busy}
            onClick={handleLoadBuiltIn}
            title="导入 PRESET_BATTLE_GROUPS 并写入 PK 分组·小组赛"
          >
            <Download className="size-4" />
            加载内置小组赛
          </Button>
          <Button
            variant="outline"
            className="h-10"
            disabled={busy}
            onClick={() => {
              const next = loadTournamentState();
              setTournament(next);
              setSelectedGroupKey(next.stages[next.activeStage].groups[0]?.key || "");
              setMessage("已刷新赛程状态");
            }}
          >
            <RefreshCw className="size-4" />
            刷新
          </Button>
        </div>
      </div>

      {message ? (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      ) : null}

      <div className="rounded-xl border border-border/70 bg-card/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Trophy className="size-4 text-primary" />
          <span className="text-sm font-semibold">赛程记分</span>
          <span className="text-xs text-muted-foreground">
            {summary.groups} 组 · 已记 {summary.scored}/{summary.members}
            {summary.settled ? " · 已结算" : ""}
            {tournament.sourcePresetName ? ` · 来源 ${tournament.sourcePresetName}` : ""}
            {tournament.period ? ` · ${tournament.period}` : ""}
          </span>
          <div className="ml-auto">
            <Button
              size="sm"
              disabled={
                busy ||
                !stageState.groups.length ||
                stageState.settled ||
                activeStage === "finals"
              }
              onClick={handleSettle}
            >
              结算本阶段
            </Button>
          </div>
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
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
            {emptyHint}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="max-h-[32rem] space-y-1.5 overflow-auto pr-1">
              {stageState.groups.map((group) => {
                const scored = group.members.filter((m) => m.score != null).length;
                const on = selectedGroup?.key === group.key;
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => setSelectedGroupKey(group.key)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                      on
                        ? "border-primary bg-primary/5"
                        : "border-border/50 hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{group.label}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {groupStatusLabel(group.status)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {group.members.length} 人 · 已记 {scored}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="min-w-0 rounded-lg border border-border/60">
              {selectedGroup ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                    <span className="text-sm font-semibold">{selectedGroup.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {selectedGroup.members.length} 人
                    </span>
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {groupStatusLabel(selectedGroup.status)}
                    </Badge>
                  </div>
                  <div className="max-h-[28rem] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card/95 backdrop-blur">
                        <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">#</th>
                          <th className="px-3 py-2 font-medium">姓名</th>
                          <th className="px-3 py-2 font-medium text-right">本场分</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankedSelected.map((member, index) => (
                          <tr
                            key={member.memberKey}
                            className="border-b border-border/40 last:border-0"
                          >
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {index + 1}
                            </td>
                            <td className="px-3 py-2 font-medium">
                              {member.name}
                              {member.manual ? (
                                <span className="ml-1 text-[10px] text-amber-600">手改</span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Input
                                className="ml-auto h-8 w-28 text-right tabular-nums"
                                inputMode="decimal"
                                placeholder="—"
                                disabled={stageState.settled}
                                value={
                                  member.score == null || !Number.isFinite(Number(member.score))
                                    ? ""
                                    : String(member.score)
                                }
                                onChange={(event) =>
                                  handleMemberScoreChange(member.memberKey, event.target.value)
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
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  选择左侧一组
                </div>
              )}
            </div>
          </div>
        )}

        {activeStage === "group" && tournament.stages.group.advanceKeys?.length ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-3 text-sm">
            <div className="mb-2 font-medium text-emerald-700 dark:text-emerald-400">
              小组赛出线摘要
            </div>
            <div className="text-xs text-muted-foreground">
              直晋 {tournament.stages.group.advanceKeys.length}
              {tournament.stages.group.reviveKeys?.length
                ? ` · 复活池 ${tournament.stages.group.reviveKeys.length}`
                : ""}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
