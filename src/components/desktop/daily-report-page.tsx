"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Settings, ChevronDown, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatWave, formatDuration } from "./format";
import { exportElementAsImage } from "./export-image";
import type { TierRule, DailyReportData } from "@/types/electron";
import { LoadingState, ErrorState, EmptyState } from "./states";

type GenderView = "male" | "female";

type ColumnKey = "dailyWave" | "totalWave" | "duration" | "tier";

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "dailyWave", label: "每日音浪" },
  { key: "totalWave", label: "总音浪" },
  { key: "duration", label: "直播时长" },
  { key: "tier", label: "等级" },
];

const DEFAULT_COLS: Record<ColumnKey, boolean> = {
  dailyWave: true,
  totalWave: true,
  duration: true,
  tier: true,
};

/** 按等级首字母返回颜色块样式 */
function tierColorClass(tier: string): string {
  const c = tier.charAt(0).toUpperCase();
  switch (c) {
    case "A": return "bg-emerald-500 text-white hover:bg-emerald-500";
    case "B": return "bg-sky-500 text-white hover:bg-sky-500";
    case "C": return "bg-amber-500 text-white hover:bg-amber-500";
    case "D": return "bg-rose-500 text-white hover:bg-rose-500";
    default: return "bg-muted text-muted-foreground hover:bg-muted";
  }
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DailyReportPage() {
  const [date, setDate] = useState(todayStr());
  const [gender, setGender] = useState<GenderView>("female");
  const [report, setReport] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // 等级设置
  const [tiers, setTiers] = useState<TierRule[]>([]);
  const [editingTiers, setEditingTiers] = useState<TierRule[] | null>(null);
  const [savingTiers, setSavingTiers] = useState(false);
  const [showTierSettings, setShowTierSettings] = useState(false);

  // 字段显隐
  const [visibleCols, setVisibleCols] = useState<Record<ColumnKey, boolean>>(DEFAULT_COLS);
  const [showColSettings, setShowColSettings] = useState(false);

  // 导出
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const fetchReport = useCallback(async (d: string, g: string) => {
    const api = window.electronAPI;
    if (!api) {
      setUnavailable(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDailyWaveReport(d, g);
      if (res.success) {
        setReport(res.data);
      } else {
        setError(res.error || "加载失败");
        setReport(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTiers = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    const res = await api.getTierRules();
    if (res.success) {
      setTiers(res.data);
    }
  }, []);

  useEffect(() => {
    fetchReport(date, gender);
  }, [date, gender, fetchReport]);

  useEffect(() => {
    fetchTiers();
  }, [fetchTiers]);

  const handleExport = async () => {
    if (!reportRef.current || exporting) return;
    setExporting(true);
    try {
      await exportElementAsImage(reportRef.current, `每日报告-${date}-${gender === "male" ? "男队" : "女队"}.png`);
    } catch (e) {
      console.error("导出失败", e);
    } finally {
      setExporting(false);
    }
  };

  const startEditTiers = () => {
    setEditingTiers(tiers.map((t) => ({ ...t })));
    setShowTierSettings(true);
  };

  const saveTiers = async () => {
    if (!editingTiers) return;
    const api = window.electronAPI;
    if (!api) return;
    setSavingTiers(true);
    try {
      const res = await api.saveTierRules(
        editingTiers.map((t) => ({ label: t.label, minWave: t.minWave }))
      );
      if (res.success) {
        await fetchTiers();
        setShowTierSettings(false);
        setEditingTiers(null);
        // 刷新报告以更新等级
        fetchReport(date, gender);
      }
    } catch (e) {
      console.error("保存等级失败", e);
    } finally {
      setSavingTiers(false);
    }
  };

  if (unavailable) {
    return (
      <Card>
        <CardContent>
          <p className="py-16 text-center text-sm text-muted-foreground">
            请用桌面端打开查看每日报告。
          </p>
        </CardContent>
      </Card>
    );
  }

  const rows = report?.rows || [];
  const maxDailyWave = rows.length > 0 ? Math.max(...rows.map((r) => r.dailyWave)) : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              <CardTitle className="text-base">每日报告</CardTitle>
              {report && (
                <Badge variant="secondary">
                  {gender === "male" ? "男队" : "女队"} {report.summary.total} 人
                </Badge>
              )}
            </div>
            <div className="app-no-drag flex items-center gap-2">
              {/* 性别切换 */}
              <div className="inline-flex rounded-full border border-border bg-card p-1">
                {(["female", "male"] as GenderView[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGender(g)}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                      gender === g
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {g === "male" ? "男队" : "女队"}
                  </button>
                ))}
              </div>
              {/* 日期选择 */}
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {/* 导出 */}
              <button
                onClick={handleExport}
                disabled={exporting || !report || rows.length === 0}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
              >
                <Download className="size-4" />
                {exporting ? "导出中…" : "导出图片"}
              </button>
              {/* 等级设置 */}
              <button
                onClick={() => (showTierSettings ? setShowTierSettings(false) : startEditTiers())}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                <Settings className="size-4" />
                等级设置
              </button>
              {/* 字段显隐 */}
              <button
                onClick={() => setShowColSettings(!showColSettings)}
                className={cn(
                  "app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent",
                  showColSettings && "ring-2 ring-primary/40"
                )}
              >
                <ChevronDown className="size-4" />
                字段
              </button>
            </div>
          </div>
        </CardHeader>

        {/* 字段显隐面板 */}
        {showColSettings && (
          <div className="border-b border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground">显示字段：</span>
              <span className="text-xs text-muted-foreground">序号 · 姓名（固定）</span>
              {COLUMNS.map((col) => (
                <label
                  key={col.key}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={visibleCols[col.key]}
                    onChange={(e) =>
                      setVisibleCols({ ...visibleCols, [col.key]: e.target.checked })
                    }
                    className="accent-primary"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 等级设置面板 */}
        {showTierSettings && editingTiers && (
          <div className="border-b border-border bg-muted/30 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">等级规则（按累计音浪阈值自动分级）</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowTierSettings(false); setEditingTiers(null); }}
                  className="rounded-lg border border-border px-3 py-1 text-sm hover:bg-accent"
                >
                  取消
                </button>
                <button
                  onClick={saveTiers}
                  disabled={savingTiers}
                  className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="size-3.5" />
                  {savingTiers ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {editingTiers.map((t, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
                  <input
                    value={t.label}
                    onChange={(e) => {
                      const next = [...editingTiers];
                      next[i] = { ...t, label: e.target.value };
                      setEditingTiers(next);
                    }}
                    className="w-16 rounded border border-border bg-background px-2 py-1 text-sm outline-none"
                    placeholder="标签"
                  />
                  <span className="text-xs text-muted-foreground">≥</span>
                  <input
                    type="number"
                    value={t.minWave}
                    onChange={(e) => {
                      const next = [...editingTiers];
                      next[i] = { ...t, minWave: Number(e.target.value) || 0 };
                      setEditingTiers(next);
                    }}
                    className="w-24 rounded border border-border bg-background px-2 py-1 text-sm outline-none"
                    placeholder="累计音浪"
                  />
                  <button
                    onClick={() => {
                      const next = editingTiers.filter((_, idx) => idx !== i);
                      setEditingTiers(next);
                    }}
                    className="text-xs text-destructive hover:underline"
                  >
                    删除
                  </button>
                </div>
              ))}
              <button
                onClick={() => setEditingTiers([...editingTiers, { id: 0, label: "", minWave: 0, sortOrder: 0 }])}
                className="flex items-center justify-center rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                + 新增等级
              </button>
            </div>
          </div>
        )}

        <CardContent>
          {loading ? (
            <LoadingState label="加载每日报告…" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => fetchReport(date, gender)} />
          ) : !report || rows.length === 0 ? (
            <EmptyState label={`该日期无${gender === "male" ? "男" : "女"}队数据`} />
          ) : (
            <div ref={reportRef} className="space-y-3">
              {/* 报告标题 */}
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-lg font-bold text-foreground">
                  {gender === "male" ? "男主播" : "女主播"}音浪日报
                </h2>
                <span className="text-sm text-muted-foreground">{date}</span>
              </div>

              {/* 表格 */}
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="w-12 px-3 py-2 text-left font-medium text-muted-foreground">序号</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">主播</th>
                      {visibleCols.dailyWave && (
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">当日音浪</th>
                      )}
                      {visibleCols.totalWave && (
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">累计总音浪</th>
                      )}
                      {visibleCols.duration && (
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">直播时长</th>
                      )}
                      {visibleCols.tier && (
                        <th className="w-20 px-3 py-2 text-center font-medium text-muted-foreground">等级</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.anchorId}
                        className={cn(
                          "border-t border-border hover:bg-muted/30",
                          !r.isLive && "opacity-60"
                        )}
                      >
                        <td className="px-3 py-2">
                          {r.rank <= 3 ? (
                            <span className={cn(
                              "flex size-6 items-center justify-center rounded-full text-xs font-bold",
                              r.rank === 1 ? "bg-amber-400/20 text-amber-600"
                                : r.rank === 2 ? "bg-slate-400/20 text-slate-500"
                                : "bg-orange-400/20 text-orange-600"
                            )}>
                              {r.rank}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{r.rank}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        {visibleCols.dailyWave && (
                          <td className="px-3 py-2">
                            {r.isLive ? (
                              <div className="flex items-center gap-2">
                                <span className="tabular-nums text-foreground">
                                  {formatWave(r.dailyWave)}
                                </span>
                                {/* 进度条 */}
                                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary"
                                    style={{
                                      width: maxDailyWave > 0
                                        ? `${(r.dailyWave / maxDailyWave) * 100}%`
                                        : "0%",
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-destructive">未开播</span>
                            )}
                          </td>
                        )}
                        {visibleCols.totalWave && (
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {formatWave(r.totalWave)}
                          </td>
                        )}
                        {visibleCols.duration && (
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {r.isLive && r.dailyDuration > 0
                              ? formatDuration(r.dailyDuration)
                              : r.isLive
                                ? "0分钟"
                                : "—"}
                          </td>
                        )}
                        {visibleCols.tier && (
                          <td className="px-3 py-2 text-center">
                            {r.tier && (
                              <Badge className={tierColorClass(r.tier)}>
                                {r.tier}
                              </Badge>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 底部摘要 */}
              <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{gender === "male" ? "男主播" : "女主播"} {report.summary.total} 人</span>
                  <span>·</span>
                  <span>导出日期 {date}</span>
                </div>
                {report.summary.notLiveCount > 0 && (
                  <div className="flex items-center gap-2 text-destructive">
                    <span>未开播 {report.summary.notLiveCount} 人</span>
                    <span className="text-muted-foreground">
                      {report.summary.notLiveNames.join("、")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
