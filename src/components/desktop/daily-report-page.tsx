"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  CalendarDays,
  Clock,
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
  splitDailyReportRowsForExport,
  ALL_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  type ColumnKey,
  type ColumnWidths,
  type ReportCanvasStyle,
} from "./draw-report-canvas";
import {
  COLUMN_WIDTHS_STORAGE_KEY,
  COLUMNS_STORAGE_KEY,
  COLUMNS_STORAGE_VERSION,
  COLUMNS_STORAGE_VERSION_KEY,
  DEFAULT_REPORT_STYLES,
  DEFAULT_REPORT_TITLE,
  DEFAULT_REPORT_TITLE_FEMALE,
  DEFAULT_REPORT_TITLE_MALE,
  EXPORT_SPLIT_STORAGE_KEY,
  loadColumnWidths,
  loadReportStyles,
  loadReportTitles,
  loadVisibleColumns,
  REPORT_SORT_STORAGE_KEY,
  REPORT_STYLES_STORAGE_KEY,
  REPORT_STYLES_STORAGE_VERSION,
  REPORT_STYLES_STORAGE_VERSION_KEY,
  REPORT_TITLES_STORAGE_KEY,
  type ReportGender,
} from "./daily-report-prefs";
import { downloadCsv } from "./csv";
import { downloadCanvasAsPng } from "./export-image";
import type { TierRule, DailyReportData, MonthlyReportData } from "@/types/electron";
import { LoadingState, ErrorState, EmptyState } from "./states";
import {
  businessDateStr,
  resolveDailyReportDefaultDate,
  resolveMonthlyReportMonth,
} from "../../../shared/business-date.js";

type GenderView = ReportGender;
type ExportKind = "image" | "report" | "duration" | "durationImage";
type ReportViewMode = "daily" | "monthly";
type ReportSortBy = "wave" | "duration";

// 时长精简图固定四列：序号 / 姓名 / 未播天数 / 当月时长
const DURATION_IMAGE_COLUMNS: ColumnKey[] = ["rank", "name", "notLiveDays", "duration"];

function sanitizeColumnWidth(value: unknown): number | null {
  const width = Number(value);
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.min(800, Math.max(20, Math.round(width)));
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
  // 初始为空，挂载后优先填「最近有音浪数据的日期」
  const [date, setDate] = useState("");
  const [dateReady, setDateReady] = useState(false);
  const [gender, setGender] = useState<GenderView>("male");
  const [report, setReport] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // 月度报告：月份（默认最近有时长快照的月份）
  const [viewMode, setViewMode] = useState<ReportViewMode>("daily");
  const [month, setMonth] = useState("");
  const [monthReady, setMonthReady] = useState(false);
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReportData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

  // 等级设置
  const [tiers, setTiers] = useState<TierRule[]>([]);
  const [editingTiers, setEditingTiers] = useState<TierRule[] | null>(null);
  const [savingTiers, setSavingTiers] = useState(false);
  const [showTierSettings, setShowTierSettings] = useState(false);

  // 字段设置
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    if (typeof window === "undefined") return DEFAULT_VISIBLE_COLUMNS;
    return loadVisibleColumns();
  });
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({});
  const [reportStyles, setReportStyles] = useState<Record<GenderView, ReportCanvasStyle>>(DEFAULT_REPORT_STYLES);
  const [reportTitles, setReportTitles] = useState<Record<GenderView, string>>({
    male: DEFAULT_REPORT_TITLE_MALE,
    female: DEFAULT_REPORT_TITLE_FEMALE,
  });
  const [titleDraft, setTitleDraft] = useState(DEFAULT_REPORT_TITLE_MALE);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // 导出
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 导出图片分割方式：true=拆成两张，false=一张完整长图
  const [exportImageSplit, setExportImageSplit] = useState(true);
  // 报告排序方式：wave=按音浪（默认），duration=按时长
  const [sortBy, setSortBy] = useState<ReportSortBy>("wave");
  // 导出设置弹窗（草稿值，点「保存」才生效）
  const [showExportSettings, setShowExportSettings] = useState(false);
  const [sortDraft, setSortDraft] = useState<ReportSortBy>("wave");
  const [splitDraft, setSplitDraft] = useState(true);

  // 初始化读取 localStorage
  useEffect(() => {
    setVisibleColumns(loadVisibleColumns());
    setColumnWidths(loadColumnWidths());
    setReportStyles(loadReportStyles());
    try {
      setExportImageSplit(localStorage.getItem(EXPORT_SPLIT_STORAGE_KEY) !== "0");
      setSortBy(localStorage.getItem(REPORT_SORT_STORAGE_KEY) === "duration" ? "duration" : "wave");
    } catch {
      // ignore
    }
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
    try {
      localStorage.setItem(EXPORT_SPLIT_STORAGE_KEY, exportImageSplit ? "1" : "0");
      localStorage.setItem(REPORT_SORT_STORAGE_KEY, sortBy);
    } catch {
      // ignore
    }
  }, [exportImageSplit, hydrated, sortBy]);

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

  const openExportSettings = () => {
    setSortDraft(sortBy);
    setSplitDraft(exportImageSplit);
    setShowExportSettings(true);
  };

  const saveExportSettings = () => {
    setSortBy(sortDraft);
    setExportImageSplit(splitDraft);
    setShowExportSettings(false);
  };

  const rows = useMemo(() => report?.rows ?? [], [report?.rows]);
  const monthlyRows = useMemo(() => monthlyReport?.rows ?? [], [monthlyReport?.rows]);
  // 月度报告不展示「日音浪」列（当月数据无日维度）
  const activeColumns = useMemo(
    () => (viewMode === "monthly" ? visibleColumns.filter((k) => k !== "dailyWave") : visibleColumns),
    [viewMode, visibleColumns]
  );
  const activeRows = viewMode === "monthly" ? monthlyRows : rows;
  // 排序：音浪（默认，后端已按音浪降序）/ 时长（按当月时长降序重排）
  const sortedRows = useMemo(() => {
    if (sortBy === "wave") return activeRows;
    return [...activeRows].sort((a, b) => b.totalDuration - a.totalDuration);
  }, [activeRows, sortBy]);
  const activeSummary = viewMode === "monthly" ? monthlyReport?.summary : report?.summary;
  const currentReportTitle = reportTitles[gender] || DEFAULT_REPORT_TITLE;
  const reportStyle = reportStyles[gender];
  const dailyWaveLabel = formatDailyWaveLabel(date);
  const activeDateLabel = viewMode === "monthly" ? month : date;
  const durationTitleMonth = Number(month.slice(5));
  const durationReportTitle = `${gender === "male" ? "男" : "女"}主播${Number.isFinite(durationTitleMonth) ? durationTitleMonth : ""}月数据统计`;

  // 时长精简图：序号 / 姓名 / 未播天数 / 当月时长
  const drawDurationReport = useCallback(
    (
      canvas: HTMLCanvasElement,
      page?: {
        rows: typeof activeRows;
        rankOffset?: number;
        pageIndex?: number;
        pageCount?: number;
      }
    ) => {
      const pageRows = page?.rows ?? sortedRows;
      const options = {
        date: activeDateLabel,
        rows: pageRows,
        gender,
        customTitle: durationReportTitle,
        subtitle: `Monthly Duration • ${month}`,
        hideDateInTitle: true,
        notLiveCount: activeSummary?.notLiveCount ?? 0,
        notLiveDays: activeSummary?.notLiveDays ?? 0,
        scale: 2,
        visibleColumns: DURATION_IMAGE_COLUMNS,
        columnWidths: {},
        rankOffset: page?.rankOffset ?? 0,
        pageIndex: page?.pageIndex ?? 1,
        pageCount: page?.pageCount ?? 1,
        statsRows: sortedRows,
      };
      if (reportStyle === "apple") {
        drawAppleReportToCanvas(canvas, options);
        return;
      }
      drawReportToCanvas(canvas, options);
    },
    [
      activeDateLabel,
      sortedRows,
      activeSummary?.notLiveCount,
      activeSummary?.notLiveDays,
      durationReportTitle,
      gender,
      month,
      reportStyle,
    ]
  );

  const drawSelectedReport = useCallback(
    (
      canvas: HTMLCanvasElement,
      page?: {
        rows: typeof activeRows;
        rankOffset?: number;
        pageIndex?: number;
        pageCount?: number;
      }
    ) => {
      const pageRows = page?.rows ?? sortedRows;
      const options = {
        date: activeDateLabel,
        rows: pageRows,
        gender,
        customTitle: currentReportTitle,
        subtitle: viewMode === "monthly" ? `Monthly Report • ${month}` : `Data Report • ${date}`,
        notLiveCount: activeSummary?.notLiveCount ?? 0,
        notLiveDays: activeSummary?.notLiveDays ?? 0,
        scale: 2,
        visibleColumns: activeColumns,
        columnWidths,
        rankOffset: page?.rankOffset ?? 0,
        pageIndex: page?.pageIndex ?? 1,
        pageCount: page?.pageCount ?? 1,
        statsRows: sortedRows,
      };
      if (reportStyle === "apple") {
        drawAppleReportToCanvas(canvas, options);
        return;
      }
      drawReportToCanvas(canvas, options);
    },
    [
      activeColumns,
      activeDateLabel,
      sortedRows,
      activeSummary?.notLiveCount,
      activeSummary?.notLiveDays,
      columnWidths,
      currentReportTitle,
      date,
      gender,
      month,
      reportStyle,
      viewMode,
    ]
  );

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
    const api = getDataApi();
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

  const fetchMonthlyReport = useCallback(async (m: string, g: string) => {
    const api = getDataApi();
    if (!api) {
      setUnavailable(true);
      return;
    }
    setMonthlyLoading(true);
    setMonthlyError(null);
    try {
      const res = await api.getMonthlyReport(m, g);
      if (res.success) {
        setMonthlyReport(res.data);
      } else {
        setMonthlyError(res.error || "加载失败");
        setMonthlyReport(null);
      }
    } catch (e) {
      setMonthlyError(e instanceof Error ? e.message : String(e));
      setMonthlyReport(null);
    } finally {
      setMonthlyLoading(false);
    }
  }, []);

  const fetchTiers = useCallback(async () => {
    const api = getDataApi();
    if (!api) return;
    const res = await api.getTierRules();
    if (res.success) {
      setTiers(res.data);
    }
  }, []);

  // 默认日期：库里最近有音浪数据的那天；没有则用昨天（业务日）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = getDataApi();
      if (!api) {
        if (!cancelled) {
          setDate(businessDateStr());
          setDateReady(true);
        }
        return;
      }
      try {
        const res = await api.getDashboardSummary();
        if (cancelled) return;
        const summary = res.success ? res.data : {};
        setDate(resolveDailyReportDefaultDate(summary));
        setMonth(resolveMonthlyReportMonth(summary));
      } catch {
        if (!cancelled) {
          const fallback = businessDateStr();
          setDate(fallback);
          setMonth(fallback.slice(0, 7));
        }
      } finally {
        if (!cancelled) {
          setDateReady(true);
          setMonthReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dateReady || !date) return;
    fetchReport(date, gender);
  }, [date, gender, dateReady, fetchReport]);

  useEffect(() => {
    if (!monthReady || !month) return;
    fetchMonthlyReport(month, gender);
  }, [month, gender, monthReady, fetchMonthlyReport]);

  useEffect(() => {
    fetchTiers();
  }, [fetchTiers]);

  // 绘制 Canvas 预览
  useEffect(() => {
    if (!activeRows.length || !canvasRef.current) return;
    drawSelectedReport(canvasRef.current);
  }, [drawSelectedReport, activeRows.length]);

  const handleExportImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas || exporting || activeRows.length === 0) return;
    setExporting("image");
    try {
      const genderText = gender === "male" ? "男" : "女";
      const styleText = reportStyle === "apple" ? "样式二" : "样式一";
      // 分割：按开关「两张」强制拆成两张 /「一张」导出完整长图（预览始终完整一页）
      const pages = splitDailyReportRowsForExport(sortedRows, {
        maxPages: exportImageSplit ? 2 : 1,
      });
      for (const page of pages) {
        const pageTag =
          page.pageCount > 1 ? `_${page.pageIndex}of${page.pageCount}` : "";
        const filename = viewMode === "monthly"
          ? `${month}_月度报告_${genderText}_${styleText}_${activeRows.length}人${pageTag}.png`
          : `${date}_${genderText}_${styleText}_${activeRows.length}人${pageTag}.png`;
        await downloadCanvasAsPng(canvas, filename, () => {
          drawSelectedReport(canvas, page);
        });
        // 连续多次下载时稍等，避免部分浏览器吞掉第二次 click
        if (pages.length > 1) {
          await new Promise((r) => window.setTimeout(r, 350));
        }
      }
      // 导出后恢复完整预览
      drawSelectedReport(canvas);
    } catch (e) {
      console.error("导出图片失败", e);
      alert("导出失败: " + String(e));
    } finally {
      setExporting(null);
    }
  };

  // 时长精简图：序号 / 姓名 / 未播天数 / 当月时长，标题「x主播x月数据统计」
  const handleExportDurationImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas || exporting || activeRows.length === 0) return;
    setExporting("durationImage");
    try {
      const genderText = gender === "male" ? "男" : "女";
      const pages = splitDailyReportRowsForExport(sortedRows, {
        maxPages: exportImageSplit ? 2 : 1,
      });
      for (const page of pages) {
        const pageTag =
          page.pageCount > 1 ? `_${page.pageIndex}of${page.pageCount}` : "";
        const filename = `${month}_${genderText}_时长统计图_${activeRows.length}人${pageTag}.png`;
        await downloadCanvasAsPng(canvas, filename, () => {
          drawDurationReport(canvas, page);
        });
        if (pages.length > 1) {
          await new Promise((r) => window.setTimeout(r, 350));
        }
      }
      // 导出后恢复主图预览
      drawSelectedReport(canvas);
    } catch (e) {
      console.error("导出时长图片失败", e);
      alert("导出失败: " + String(e));
    } finally {
      setExporting(null);
    }
  };

  const handleExportCSV = async () => {
    if (activeRows.length === 0 || exporting) return;
    setExporting("report");
    try {
      const headers = viewMode === "monthly"
        ? [
            "排名",
            "主播ID",
            "主播姓名",
            formatMonthNotLiveDaysLabel(month),
            "当月总音浪",
            "当月时长(分钟)",
            "师傅",
            "等级",
            "月份",
          ]
        : [
            "排名",
            "上期排名",
            "排名变化",
            "主播ID",
            "主播姓名",
            formatMonthNotLiveDaysLabel(date),
            dailyWaveLabel,
            "累计总音浪",
            "当月时长(分钟)",
            "师傅",
            "等级",
            "日期",
          ];
      const csvRows = viewMode === "monthly"
        ? sortedRows.map((r, i) => [
            i + 1,
            r.anchorId,
            r.name,
            r.notLiveDays ?? 0,
            r.totalWave,
            r.totalDuration > 0 ? r.totalDuration : 0,
            r.masterName || "",
            r.tier || "",
            month,
          ])
        : sortedRows.map((r, i) => [
            i + 1,
            r.previousRank || "",
            formatRankDelta(r.rankDelta),
            r.anchorId,
            r.name,
            r.notLiveDays ?? 0,
            r.isLive ? r.dailyWave : 0,
            r.totalWave,
            r.totalDuration > 0 ? r.totalDuration : 0,
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
      const prefix = viewMode === "monthly" ? `${month}_月度` : `${date}_`;
      a.download = `${prefix}${genderText}_音浪数据_${activeRows.length}人.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("导出CSV失败", e);
      alert("导出失败: " + String(e));
    } finally {
      setExporting(null);
    }
  };

  const handleExportDurationCSV = () => {
    if (activeRows.length === 0 || exporting) return;
    setExporting("duration");
    try {
      const data = sortedRows.map((row, index) => ({
        排名: index + 1,
         主播ID: row.anchorId,
         主播姓名: row.name,
         日期: activeDateLabel,
        "当月时长(分钟)": row.totalDuration > 0 ? row.totalDuration : 0,
      }));
      const genderText = gender === "male" ? "男" : "女";
      downloadCsv(data, `${activeDateLabel}_${genderText}_时长数据_${activeRows.length}人.csv`);
    } catch (e) {
      console.error("导出时长CSV失败", e);
      alert("导出失败: " + String(e));
    } finally {
      setExporting(null);
    }
  };

  const startEditTiers = () => {
    setEditingTiers(tiers.map((t) => ({ ...t })));
    setShowTierSettings(true);
  };

  const saveTiers = async () => {
    if (!editingTiers) return;
    const api = getDataApi();
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
        fetchMonthlyReport(month, gender);
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
              <CardTitle className="text-base">
                {viewMode === "monthly" ? "月度报告" : "每日报告"}
              </CardTitle>
              <div className="flex rounded-md border">
                <button
                  type="button"
                  onClick={() => setViewMode("daily")}
                  className={cn(
                    "px-2 py-1 text-xs",
                    viewMode === "daily"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  每日
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("monthly")}
                  className={cn(
                    "px-2 py-1 text-xs",
                    viewMode === "monthly"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  月度
                </button>
              </div>
              {activeSummary && (
                <>
                  <Badge variant="secondary">
                    {gender === "male" ? "男团" : "女队"} {activeSummary.total} 人
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      activeSummary.notLiveCount > 0
                        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300"
                        : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
                    )}
                  >
                    未开播人数 {activeSummary.notLiveCount} 人
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      activeSummary.notLiveDays > 0
                        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300"
                        : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
                    )}
                  >
                    未开播天数 {activeSummary.notLiveDays} 天
                  </Badge>
                  {viewMode === "daily" && report?.summary.previousDate && (
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
              {/* 日期/月份选择 */}
              <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card/90 px-3 shadow-xs">
                <CalendarDays className="size-4 text-muted-foreground" />
                {viewMode === "monthly" ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-muted-foreground">月份</span>
                    <Input
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="h-8 w-36 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-muted-foreground">日期</span>
                    <Input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="h-8 w-36 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                    />
                  </div>
                )}
                <span className="h-4 w-px bg-border" />
                <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                  报告 {viewMode === "monthly" ? month : date}
                </span>
                {/* 导出设置：排序方式 / 图片分割 */}
                <button
                  onClick={openExportSettings}
                  className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent"
                >
                  <Settings className="size-4" />
                  导出设置
                </button>
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
                disabled={exporting !== null || !activeSummary || activeRows.length === 0}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
              >
                <Download className="size-4" />
                {exporting === "image" ? "导出中…" : "导出图片"}
              </button>
              {/* 导出时长精简图（仅月度模式） */}
              {viewMode === "monthly" && (
                <button
                  onClick={handleExportDurationImage}
                  disabled={exporting !== null || !activeSummary || activeRows.length === 0}
                  className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                >
                  <Clock className="size-4" />
                  {exporting === "durationImage" ? "导出中…" : "导出时长图"}
                </button>
              )}
              {/* 导出 CSV */}
              <button
                onClick={handleExportCSV}
                disabled={exporting !== null || !activeSummary || activeRows.length === 0}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
              >
                <FileSpreadsheet className="size-4" />
                {exporting === "report" ? "导出中…" : "导出 CSV"}
              </button>
              {/* 单独导出时长 CSV */}
              <button
                onClick={handleExportDurationCSV}
                disabled={exporting !== null || !activeSummary || activeRows.length === 0}
                className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
              >
                <Clock className="size-4" />
                {exporting === "duration" ? "导出中…" : "导出时长"}
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

        {/* 导出设置弹窗 */}
        {showExportSettings && (
          <div
            className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onClick={() => setShowExportSettings(false)}
          >
            <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <Card className="border border-border shadow-2xl">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">导出设置</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">报告排序方式</p>
                    <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card p-0.5">
                      <button
                        onClick={() => setSortDraft("wave")}
                        className={cn(
                          "flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
                          sortDraft === "wave"
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        按音浪
                      </button>
                      <button
                        onClick={() => setSortDraft("duration")}
                        className={cn(
                          "flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
                          sortDraft === "duration"
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        按时长
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      影响表格预览与全部导出（图片 / 时长图 / CSV）
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">导出图片分割</p>
                    <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card p-0.5">
                      <button
                        onClick={() => setSplitDraft(true)}
                        className={cn(
                          "flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
                          splitDraft
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        两张
                      </button>
                      <button
                        onClick={() => setSplitDraft(false)}
                        className={cn(
                          "flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
                          !splitDraft
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        一张
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      两张：超过 30 人拆成上下两张，人数不够仍导出一张；一张：完整长图
                    </p>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setShowExportSettings(false)}
                      className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium transition hover:bg-accent"
                    >
                      取消
                    </button>
                    <button
                      onClick={saveExportSettings}
                      className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                    >
                      保存
                    </button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

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
                        disabled={viewMode === "monthly" && col.key === "dailyWave"}
                        className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
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
              {viewMode === "monthly" && " 月度报告不展示「日音浪」列。"}
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
          {viewMode === "monthly" ? (
            monthlyLoading ? (
              <LoadingState label="加载月度报告…" />
            ) : monthlyError ? (
              <ErrorState message={monthlyError} onRetry={() => fetchMonthlyReport(month, gender)} />
            ) : !monthlyReport || monthlyRows.length === 0 ? (
              <EmptyState label={`该月份无${gender === "male" ? "男" : "女"}队数据`} />
            ) : (
              <div className="flex justify-center">
                <canvas
                  ref={canvasRef}
                  style={{ maxWidth: "100%", height: "auto", border: "1px solid var(--border)", borderRadius: "4px" }}
                />
              </div>
            )
          ) : loading ? (
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
