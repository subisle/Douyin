"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  CalendarDays,
  Columns3,
  Download,
  FileSpreadsheet,
  FileText,
  Mars,
  Palette,
  RotateCcw,
  Save,
  Settings,
  Venus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  drawAppleReportToCanvas,
  drawReportToCanvas,
  formatDailyWaveLabel,
  formatMonthNotLiveDaysLabel,
  ALL_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  type ColumnKey,
  type ColumnWidths,
  type ReportCanvasStyle,
} from "./draw-report-canvas";
import { downloadCanvasAsPng } from "./export-image";
import type { TierRule, DailyReportData } from "@/types/electron";
import { LoadingState, ErrorState, EmptyState } from "./states";

type GenderView = "male" | "female";

const DEFAULT_REPORT_TITLE = "薇笑传媒主播数据统计";
const COLUMNS_STORAGE_KEY = "daily-report-visible-columns";
const COLUMNS_STORAGE_VERSION_KEY = "daily-report-visible-columns-version";
const COLUMNS_STORAGE_VERSION = "3";
const COLUMN_WIDTHS_STORAGE_KEY = "daily-report-column-widths";
const REPORT_STYLES_STORAGE_KEY = "daily-report-canvas-styles";
const REPORT_STYLES_STORAGE_VERSION_KEY = "daily-report-canvas-styles-version";
const REPORT_STYLES_STORAGE_VERSION = "2";
const REPORT_TITLES_STORAGE_KEY = "daily-report-custom-titles";
const DEFAULT_REPORT_STYLES: Record<GenderView, ReportCanvasStyle> = {
  male: "apple",
  female: "classic",
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadVisibleColumns(): ColumnKey[] {
  if (typeof window === "undefined") return DEFAULT_VISIBLE_COLUMNS;
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLUMNS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((k): k is ColumnKey => ALL_COLUMNS.some((c) => c.key === k));
      if (localStorage.getItem(COLUMNS_STORAGE_VERSION_KEY) !== COLUMNS_STORAGE_VERSION) {
        const migrated = new Set<ColumnKey>(valid.filter((k) => k !== "duration" && k !== "master"));
        for (const key of DEFAULT_VISIBLE_COLUMNS) migrated.add(key);
        return ALL_COLUMNS.map((c) => c.key).filter((key) => migrated.has(key));
      }
      // 至少保留一个
      if (valid.length > 0) return valid;
    }
  } catch {
    // ignore
  }
  return DEFAULT_VISIBLE_COLUMNS;
}

function sanitizeColumnWidth(value: unknown): number | null {
  const width = Number(value);
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.min(800, Math.max(20, Math.round(width)));
}

function loadColumnWidths(): ColumnWidths {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const widths: ColumnWidths = {};
    for (const col of ALL_COLUMNS) {
      const width = sanitizeColumnWidth((parsed as Record<string, unknown>)[col.key]);
      if (width !== null) widths[col.key] = width;
    }
    return widths;
  } catch {
    return {};
  }
}

function isReportCanvasStyle(value: unknown): value is ReportCanvasStyle {
  return value === "classic" || value === "apple";
}

function loadReportStyles(): Record<GenderView, ReportCanvasStyle> {
  if (typeof window === "undefined") return DEFAULT_REPORT_STYLES;
  try {
    if (localStorage.getItem(REPORT_STYLES_STORAGE_VERSION_KEY) !== REPORT_STYLES_STORAGE_VERSION) {
      return DEFAULT_REPORT_STYLES;
    }
    const parsed = JSON.parse(localStorage.getItem(REPORT_STYLES_STORAGE_KEY) || "{}");
    return {
      male: isReportCanvasStyle(parsed.male) ? parsed.male : DEFAULT_REPORT_STYLES.male,
      female: isReportCanvasStyle(parsed.female) ? parsed.female : DEFAULT_REPORT_STYLES.female,
    };
  } catch {
    return DEFAULT_REPORT_STYLES;
  }
}

function loadReportTitles(): Record<GenderView, string> {
  const defaults = { male: DEFAULT_REPORT_TITLE, female: DEFAULT_REPORT_TITLE };
  if (typeof window === "undefined") return defaults;
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORT_TITLES_STORAGE_KEY) || "{}");
    return {
      male: typeof parsed.male === "string" && parsed.male.trim() ? parsed.male.trim() : defaults.male,
      female: typeof parsed.female === "string" && parsed.female.trim() ? parsed.female.trim() : defaults.female,
    };
  } catch {
    return defaults;
  }
}

function formatRankDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined) return "";
  if (delta > 0) return `上升${delta}`;
  if (delta < 0) return `下降${Math.abs(delta)}`;
  return "";
}

function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function DailyReportPage() {
  const [date, setDate] = useState(todayStr());
  const [gender, setGender] = useState<GenderView>("male");
  const [report, setReport] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // 等级设置
  const [tiers, setTiers] = useState<TierRule[]>([]);
  const [editingTiers, setEditingTiers] = useState<TierRule[] | null>(null);
  const [savingTiers, setSavingTiers] = useState(false);
  const [showTierSettings, setShowTierSettings] = useState(false);

  // 字段设置
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({});
  const [reportStyles, setReportStyles] = useState<Record<GenderView, ReportCanvasStyle>>(DEFAULT_REPORT_STYLES);
  const [reportTitles, setReportTitles] = useState<Record<GenderView, string>>({
    male: DEFAULT_REPORT_TITLE,
    female: DEFAULT_REPORT_TITLE,
  });
  const [titleDraft, setTitleDraft] = useState(DEFAULT_REPORT_TITLE);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // 导出
  const [exporting, setExporting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 初始化读取 localStorage
  useEffect(() => {
    setVisibleColumns(loadVisibleColumns());
    setColumnWidths(loadColumnWidths());
    setReportStyles(loadReportStyles());
    const titles = loadReportTitles();
    setReportTitles(titles);
    setTitleDraft(titles.male);
    setHydrated(true);
  }, []);

  // 持久化
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
      localStorage.setItem(COLUMNS_STORAGE_VERSION_KEY, COLUMNS_STORAGE_VERSION);
    } catch {
      // ignore
    }
  }, [visibleColumns, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
      // ignore
    }
  }, [columnWidths, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(REPORT_STYLES_STORAGE_KEY, JSON.stringify(reportStyles));
      localStorage.setItem(REPORT_STYLES_STORAGE_VERSION_KEY, REPORT_STYLES_STORAGE_VERSION);
    } catch {
      // ignore
    }
  }, [reportStyles, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setTitleDraft(reportTitles[gender]);
  }, [gender, hydrated, reportTitles]);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev; // 至少保留一个
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  const resetColumns = () => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
  };

  const updateColumnWidth = (key: ColumnKey, value: string) => {
    setColumnWidths((prev) => {
      const next = { ...prev };
      const width = sanitizeColumnWidth(value);
      if (width === null) {
        delete next[key];
      } else {
        next[key] = width;
      }
      return next;
    });
  };

  const resetColumnWidths = () => {
    setColumnWidths({});
  };

  const rows = useMemo(() => report?.rows ?? [], [report?.rows]);
  const currentReportTitle = reportTitles[gender] || DEFAULT_REPORT_TITLE;
  const reportStyle = reportStyles[gender];
  const dailyWaveLabel = formatDailyWaveLabel(date);

  const drawSelectedReport = useCallback((canvas: HTMLCanvasElement) => {
    const options = {
      date,
      rows,
      gender,
      customTitle: currentReportTitle,
      subtitle: `Data Report • ${date}`,
      notLiveCount: report?.summary.notLiveCount ?? 0,
      notLiveDays: report?.summary.notLiveDays ?? 0,
      scale: 2,
      visibleColumns,
      columnWidths,
    };
    if (reportStyle === "apple") {
      drawAppleReportToCanvas(canvas, options);
      return;
    }
    drawReportToCanvas(canvas, options);
  }, [columnWidths, currentReportTitle, date, gender, report?.summary.notLiveCount, report?.summary.notLiveDays, reportStyle, rows, visibleColumns]);

  const saveCurrentTitle = () => {
    const title = titleDraft.trim() || DEFAULT_REPORT_TITLE;
    const next = { ...reportTitles, [gender]: title };
    setReportTitles(next);
    setTitleDraft(title);
    try {
      localStorage.setItem(REPORT_TITLES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

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

  // 绘制 Canvas 预览
  useEffect(() => {
    if (!report || rows.length === 0 || !canvasRef.current) return;
    drawSelectedReport(canvasRef.current);
  }, [drawSelectedReport, report, rows.length]);

  const handleExportImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas || exporting || rows.length === 0) return;
    setExporting(true);
    try {
      const genderText = gender === "male" ? "男" : "女";
      const styleText = reportStyle === "apple" ? "样式二" : "样式一";
      await downloadCanvasAsPng(canvas, `${date}_${genderText}_${styleText}_${rows.length}人.png`, () => {
        drawSelectedReport(canvas);
      });
    } catch (e) {
      console.error("导出图片失败", e);
      alert("导出失败: " + String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleExportCSV = async () => {
    if (rows.length === 0 || exporting) return;
    setExporting(true);
    try {
      const headers = [
        "排名",
        "上期排名",
        "排名变化",
        "主播ID",
        "主播姓名",
        formatMonthNotLiveDaysLabel(date),
        dailyWaveLabel,
        "累计总音浪",
        "有效时长(分钟)",
        "师傅",
        "等级",
        "日期",
      ];
      const csvRows = rows.map((r, i) => [
        i + 1,
        r.previousRank || "",
        formatRankDelta(r.rankDelta),
        r.anchorId,
        r.name,
        r.notLiveDays ?? 0,
        r.isLive ? r.dailyWave : 0,
        r.totalWave,
        r.isLive ? r.dailyDuration : 0,
        r.masterName || "",
        r.tier || "",
        date,
      ]);
      const csv = [headers, ...csvRows]
        .map((r) => r.map(escapeCsvCell).join(","))
        .join("\n");

      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const genderText = gender === "male" ? "男" : "女";
      a.download = `${date}_${genderText}_音浪数据_${rows.length}人.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("导出CSV失败", e);
      alert("导出失败: " + String(e));
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              <CardTitle className="text-base">每日报告</CardTitle>
              {report && (
                <>
                  <Badge variant="secondary">
                    {gender === "male" ? "男团" : "女队"} {report.summary.total} 人
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      report.summary.notLiveCount > 0
                        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300"
                        : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
                    )}
                  >
                    未开播人数 {report.summary.notLiveCount} 人
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      report.summary.notLiveDays > 0
                        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300"
                        : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
                    )}
                  >
                    未开播天数 {report.summary.notLiveDays} 天
                  </Badge>
                  {report.summary.previousDate && (
                    <Badge variant="outline">
                      对比 {report.summary.previousDate}
                    </Badge>
                  )}
                </>
              )}
            </div>
            <div className="app-no-drag flex flex-wrap items-center justify-end gap-2">
              {/* 性别切换 */}
              <div className="flex h-10 items-center rounded-xl border border-border bg-card/90 p-1 shadow-xs">
                <span className="px-2 text-[11px] font-semibold text-muted-foreground">队伍</span>
                {(["female", "male"] as GenderView[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGender(g)}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-all",
                      gender === g
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {g === "male" ? <Mars className="size-3.5" /> : <Venus className="size-3.5" />}
                    {g === "male" ? "男团" : "女队"}
                  </button>
                ))}
              </div>
              {/* 图片样式 */}
              <div className="flex h-10 items-center rounded-xl border border-border bg-card/90 p-1 shadow-xs">
                <span className="flex items-center gap-1 px-2 text-[11px] font-semibold text-muted-foreground">
                  <Palette className="size-3.5" />
                  图片
                </span>
                {([
                  ["classic", "样式一"],
                  ["apple", "样式二"],
                ] as const).map(([style, label]) => (
                  <button
                    key={style}
                    onClick={() => setReportStyles((prev) => ({ ...prev, [gender]: style }))}
                    className={cn(
                      "h-8 rounded-lg px-3 text-sm font-semibold transition-all",
                      reportStyle === style
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                    title={style === "apple" ? "Apple 浅色导出样式" : "旧版浅色导出样式"}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* 日期选择 */}
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-10 w-44 rounded-xl bg-card/90 pr-3 pl-9 shadow-xs"
                />
              </div>
              {/* 标题设置 */}
              <div className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveCurrentTitle();
                  }}
                  className="w-48 bg-transparent px-1 py-1 text-sm outline-none"
                  placeholder={`${gender === "male" ? "男团" : "女队"}标题`}
                  title={`${gender === "male" ? "男团" : "女队"}导出标题`}
                />
                <button
                  onClick={saveCurrentTitle}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  title="保存当前队伍标题"
                >
                  保存
                </button>
              </div>
              {/* 导出图片 */}
              <button
                onClick={handleExportImage}
                disabled={exporting || !report || rows.length === 0}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
              >
                <Download className="size-4" />
                {exporting ? "导出中…" : "导出图片"}
              </button>
              {/* 导出 CSV */}
              <button
                onClick={handleExportCSV}
                disabled={exporting || !report || rows.length === 0}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
              >
                <FileSpreadsheet className="size-4" />
                导出 CSV
              </button>
              {/* 字段设置 */}
              <button
                onClick={() => setShowColumnSettings((s) => !s)}
                className={cn(
                  "app-no-drag flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition",
                  showColumnSettings
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-accent"
                )}
              >
                <Columns3 className="size-4" />
                字段设置
              </button>
              {/* 等级设置 */}
              <button
                onClick={() => (showTierSettings ? setShowTierSettings(false) : startEditTiers())}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                <Settings className="size-4" />
                等级设置
              </button>
            </div>
          </div>
        </CardHeader>

        {/* 字段设置面板 */}
        {showColumnSettings && (
          <div className="border-b border-border bg-muted/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">报告字段和列宽（实时生效）</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={resetColumns}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-sm hover:bg-accent"
                >
                  <RotateCcw className="size-3.5" />
                  恢复默认
                </button>
                <button
                  onClick={resetColumnWidths}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-sm hover:bg-accent"
                >
                  <RotateCcw className="size-3.5" />
                  重置列宽
                </button>
                <button
                  onClick={() => setShowColumnSettings(false)}
                  className="rounded-lg bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {ALL_COLUMNS.map((col) => {
                const checked = visibleColumns.includes(col.key);
                return (
                  <div
                    key={col.key}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_82px] items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                      checked
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-accent"
                    )}
                  >
                    <label className="flex min-w-0 cursor-pointer items-center gap-2 select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleColumn(col.key)}
                        className="size-4 cursor-pointer accent-primary"
                      />
                      <span className="truncate font-medium">
                        {col.key === "dailyWave" ? dailyWaveLabel : col.label}
                      </span>
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={800}
                      step={5}
                      value={columnWidths[col.key] ?? ""}
                      onChange={(e) => updateColumnWidth(col.key, e.target.value)}
                      disabled={!checked}
                      placeholder="自动"
                      className="h-8 w-full rounded-md border border-border bg-background px-2 text-right text-xs text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-45"
                    />
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              至少保留 1 个字段。列宽留空为自动，单位 px。
            </p>
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
            <div className="flex justify-center">
              <canvas
                ref={canvasRef}
                style={{ maxWidth: "100%", height: "auto", border: "1px solid var(--border)", borderRadius: "4px" }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
