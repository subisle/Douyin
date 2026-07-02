"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Settings, ChevronDown, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatWave, formatDuration } from "./format";
import { exportDailyReportPoster } from "./export-daily-report";
import { exportElementAsImage } from "./export-image";
import { PosterCard } from "./poster-export";
import { DataTableImageExport } from "./data-table-image-export";
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
  const [showImageExport, setShowImageExport] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);

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
    if (!report || exporting || rows.length === 0) return;
    setExporting(true);
    try {
      await exportDailyReportPoster({
        rows,
        date,
        gender,
        visibleCols,
      });
    } catch (e) {
      console.error("海报导出失败", e);
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
              {/* 导出图片 */}
              <button
                onClick={() => setShowImageExport(true)}
                disabled={!report || rows.length === 0}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
              >
                <Download className="size-4" />
                导出图片
              </button>
              {/* 导出海报 */}
              <button
                onClick={handleExport}
                disabled={exporting || !report || rows.length === 0}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
              >
                <Download className="size-4" />
                {exporting ? "导出中…" : "导出海报"}
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
            <div
              className="relative space-y-3 overflow-hidden rounded-2xl border-2 p-4"
              style={{
                background: "radial-gradient(circle at 50% 18%, #0a0f1c 0%, #020617 62%, #000 100%)",
                borderColor: "rgba(0, 245, 212, 0.3)",
                color: "#f8fafc",
              }}
            >
              {/* 网格线背景 */}
              <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
                style={{
                  backgroundImage: "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
                  backgroundSize: "28px 28px",
                }}
              />
              {/* 右上光效 */}
              <div className="pointer-events-none absolute right-0 top-0 h-48 w-48"
                style={{ background: "radial-gradient(circle at top right, rgba(0,245,212,0.16), transparent 70%)" }}
              />

              {/* 报告标题 */}
              <div className="relative flex items-center justify-between pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl"
                    style={{ background: "linear-gradient(135deg, rgba(0,245,212,0.18), rgba(0,184,255,0.18))", border: "1px solid rgba(0,245,212,0.32)" }}
                  >
                    <span className="text-base font-bold" style={{ color: "#f8fafc" }}>报</span>
                  </div>
                  <div>
                    <span className="text-xs font-medium" style={{ color: "#00f5d4" }}>
                      {gender === "male" ? "男队" : "女队"} · 每日音浪
                    </span>
                    <h2 className="text-lg font-bold" style={{ color: "#f8fafc", textShadow: "0 0 24px rgba(0,245,212,0.18)" }}>
                      {gender === "male" ? "男主播" : "女主播"}音浪日报
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="rounded-xl px-3 py-1.5 text-center"
                    style={{ background: "rgba(15,37,56,0.82)", border: "1px solid rgba(0,245,212,0.16)" }}
                  >
                    <div className="text-[10px]" style={{ color: "#94a3b8" }}>人数</div>
                    <div className="text-base font-bold" style={{ color: "#f8fafc" }}>{rows.length}</div>
                  </div>
                  <span className="text-sm" style={{ color: "#94a3b8" }}>{date}</span>
                </div>
              </div>

              {/* 表格 */}
              <div className="relative overflow-hidden rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                <table className="w-full text-sm">
                  <thead style={{ background: "rgba(255,255,255,0.03)" }}>
                    <tr>
                      <th className="w-12 px-3 py-2 text-left font-medium" style={{ color: "#94a3b8" }}>序号</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: "#94a3b8" }}>主播</th>
                      {visibleCols.dailyWave && (
                        <th className="px-3 py-2 text-left font-medium" style={{ color: "#94a3b8" }}>当日音浪</th>
                      )}
                      {visibleCols.totalWave && (
                        <th className="px-3 py-2 text-right font-medium" style={{ color: "#94a3b8" }}>累计总音浪</th>
                      )}
                      {visibleCols.duration && (
                        <th className="px-3 py-2 text-left font-medium" style={{ color: "#94a3b8" }}>直播时长</th>
                      )}
                      {visibleCols.tier && (
                        <th className="w-20 px-3 py-2 text-center font-medium" style={{ color: "#94a3b8" }}>等级</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.anchorId}
                        className={cn(
                          !r.isLive && "opacity-50"
                        )}
                        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                      >
                        <td className="px-3 py-2">
                          {r.rank <= 3 ? (
                            <span className={cn(
                              "flex size-6 items-center justify-center rounded-full text-xs font-bold",
                              r.rank === 1 ? "text-amber-400"
                                : r.rank === 2 ? "text-slate-400"
                                : "text-orange-400"
                            )}
                              style={{
                                background: r.rank === 1 ? "rgba(251,191,36,0.15)"
                                  : r.rank === 2 ? "rgba(148,163,184,0.12)"
                                  : "rgba(251,146,60,0.15)",
                              }}
                            >
                              {r.rank}
                            </span>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>{r.rank}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium" style={{ color: "rgba(255,255,255,0.92)" }}>{r.name}</td>
                        {visibleCols.dailyWave && (
                          <td className="px-3 py-2">
                            {r.isLive ? (
                              <div className="flex items-center gap-2">
                                <span className="tabular-nums" style={{ color: "#f8fafc" }}>
                                  {formatWave(r.dailyWave)}
                                </span>
                                {/* 进度条 - 渐变 */}
                                <div className="h-1.5 w-24 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: maxDailyWave > 0
                                        ? `${(r.dailyWave / maxDailyWave) * 100}%`
                                        : "0%",
                                      background: "linear-gradient(90deg, #00f5d4, #00b8ff)",
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs font-bold" style={{ color: "#f43f5e" }}>未开播</span>
                            )}
                          </td>
                        )}
                        {visibleCols.totalWave && (
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: "#94a3b8" }}>
                            {formatWave(r.totalWave)}
                          </td>
                        )}
                        {visibleCols.duration && (
                          <td className="px-3 py-2 tabular-nums" style={{ color: "#94a3b8" }}>
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
                              <Badge
                                className="border-0"
                                style={{
                                  background: r.tier.charAt(0) === "A" ? "rgba(16,185,129,0.18)"
                                    : r.tier.charAt(0) === "B" ? "rgba(56,189,248,0.18)"
                                    : r.tier.charAt(0) === "C" ? "rgba(251,191,36,0.18)"
                                    : r.tier.charAt(0) === "D" ? "rgba(244,63,94,0.18)"
                                    : "rgba(255,255,255,0.06)",
                                  color: r.tier.charAt(0) === "A" ? "#34d399"
                                    : r.tier.charAt(0) === "B" ? "#38bdf8"
                                    : r.tier.charAt(0) === "C" ? "#fbbf24"
                                    : r.tier.charAt(0) === "D" ? "#f43f5e"
                                    : "#94a3b8",
                                }}
                              >
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
              <div className="relative flex items-center justify-between pt-3 text-sm" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-2" style={{ color: "#94a3b8" }}>
                  <span>{gender === "male" ? "男主播" : "女主播"} {report.summary.total} 人</span>
                  <span>·</span>
                  <span>导出日期 {date}</span>
                </div>
                {report.summary.notLiveCount > 0 && (
                  <div className="flex items-center gap-2" style={{ color: "#f43f5e" }}>
                    <span>未开播 {report.summary.notLiveCount} 人</span>
                    <span style={{ color: "#94a3b8" }}>
                      {report.summary.notLiveNames.join("、")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 海报组件（隐藏渲染，仅用于导出） */}
      {report && rows.length > 0 && (
        <div
          style={{
            position: "fixed",
            left: -9999,
            top: 0,
            zIndex: -1,
            pointerEvents: "none",
          }}
        >
          <PosterCard ref={posterRef} report={report} />
        </div>
      )}

      {/* 图片导出弹窗 */}
      {showImageExport && report && rows.length > 0 && (
        <DataTableImageExport
          report={report}
          gender={gender}
          onClose={() => setShowImageExport(false)}
        />
      )}
    </div>
  );
}
