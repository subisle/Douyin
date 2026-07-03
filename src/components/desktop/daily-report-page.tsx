"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, FileSpreadsheet, Settings, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatWave } from "./format";
import { drawReportToCanvas } from "./draw-report-canvas";
import type { TierRule, DailyReportData } from "@/types/electron";
import { LoadingState, ErrorState, EmptyState } from "./states";

type GenderView = "male" | "female";

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

  // 导出
  const [exporting, setExporting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rows = report?.rows || [];

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
    const genderText = gender === "male" ? "男" : "女";
    drawReportToCanvas(canvasRef.current, {
      date,
      rows,
      gender: genderText === "男" ? "male" : "female",
      customTitle: `${genderText}主播数据统计`,
      scale: 2,
      showDuration: true,
      showMaster: true,
    });
  }, [report, rows, date, gender]);

  const handleExportImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas || exporting || rows.length === 0) return;
    setExporting(true);
    try {
      const genderText = gender === "male" ? "男" : "女";
      const link = document.createElement("a");
      link.download = `${date}_${genderText}_${rows.length}人.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
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
        "主播ID",
        "主播姓名",
        "当日音浪",
        "累计总音浪",
        "等级",
        "有效时长(分钟)",
        "师傅",
        "日期",
      ];
      const csvRows = rows.map((r, i) => [
        i + 1,
        r.anchorId,
        r.name,
        r.isLive ? r.dailyWave : 0,
        r.totalWave,
        r.tier || "",
        r.isLive ? r.dailyDuration : 0,
        r.masterName || "",
        date,
      ]);
      const csv = [headers, ...csvRows]
        .map((r) => r.map((c) => `"${c}"`).join(","))
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
