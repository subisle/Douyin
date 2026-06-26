"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Waves, Clock, Flag, Sparkles, RefreshCw, Download } from "lucide-react";
import { formatWave, formatDuration, formatNumber } from "./format";
import type { FlagGroup } from "@/types/electron";
import { LoadingState, ErrorState, EmptyState } from "./states";
import { exportElementAsImage } from "./export-image";

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function FlowingFlagCard() {
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [groups, setGroups] = useState<FlagGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [exporting, setExporting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const fetchGroups = useCallback(async (p: string) => {
    const api = window.electronAPI;
    if (!api) {
      setUnavailable(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getFlagGroups(p);
      if (res.success) {
        setGroups(res.data);
      } else {
        setError(res.error || "加载失败");
        setGroups([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups(period);
  }, [period, fetchGroups]);

  const onSettle = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    setSettling(true);
    setError(null);
    try {
      const res = await api.settleFlagScores(period);
      if (res.success) {
        await fetchGroups(period);
      } else {
        setError(res.error || "结算失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettling(false);
    }
  }, [period, fetchGroups]);

  const handleExport = async () => {
    if (!contentRef.current || exporting) return;
    setExporting(true);
    try {
      await exportElementAsImage(contentRef.current, `流动红旗-${period}.png`);
    } catch (e) {
      console.error("导出失败", e);
    } finally {
      setExporting(false);
    }
  };

  const winner = groups.find((g) => g.isWinner) || null;

  if (unavailable) {
    return (
      <Card>
        <CardContent>
          <p className="py-16 text-center text-sm text-muted-foreground">
            请用桌面端打开查看流动红旗数据。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Flag className="size-5 text-primary" />
              <CardTitle className="text-base">流动红旗</CardTitle>
              {winner && (
                <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
                  <Sparkles className="mr-1 size-3" />
                  本月得主：{winner.masterName}
                </Badge>
              )}
            </div>
            <div className="app-no-drag flex items-center gap-2">
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={onSettle}
                disabled={settling}
                className="app-no-drag flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                <RefreshCw className={`size-4 ${settling ? "animate-spin" : ""}`} />
                {settling ? "结算中…" : "结算本月"}
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || groups.length === 0}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
              >
                <Download className="size-4" />
                {exporting ? "导出中…" : "导出图片"}
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div ref={contentRef}>
          {loading ? (
            <LoadingState label="加载流动红旗数据…" />
          ) : error ? (
            <ErrorState
              message={error}
              onRetry={() => fetchGroups(period)}
            />
          ) : groups.length === 0 ? (
            <EmptyState label="本月尚未结算，点击「结算本月」生成分组排名" />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {groups.map((g, i) => (
                <div
                  key={g.masterId}
                  className={`relative overflow-hidden rounded-xl border p-4 transition ${
                    g.isWinner
                      ? "border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/10"
                      : "border-border bg-card hover:bg-accent/30"
                  }`}
                >
                  {g.isWinner && (
                    <div className="absolute right-0 top-0 flex items-center gap-1 rounded-bl-xl bg-amber-400/90 px-2.5 py-1 text-xs font-bold text-amber-950">
                      🚩 红旗
                    </div>
                  )}
                  {/* 排名 */}
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${
                        i === 0
                          ? "bg-amber-400/20 text-amber-600"
                          : i === 1
                            ? "bg-slate-400/20 text-slate-500"
                            : i === 2
                              ? "bg-orange-400/20 text-orange-600"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="text-base font-semibold text-foreground">
                      {g.masterName}
                    </span>
                    <Badge variant="outline" className="ml-auto">
                      <Users className="mr-1 size-3" />
                      {g.memberCount} 徒弟
                    </Badge>
                  </div>
                  {/* 分数 */}
                  <div className="mb-3">
                    <span className="text-xs text-muted-foreground">本月分数</span>
                    <p className="text-2xl font-bold text-primary">
                      {formatNumber(g.score)}
                    </p>
                  </div>
                  {/* 音浪 / 时长 */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Waves className="size-3.5 text-primary" />
                      <span>均音浪 {formatWave(g.avgWave)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="size-3.5 text-chart-2" />
                      <span>均时长 {formatDuration(g.avgDuration)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
