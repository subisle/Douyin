"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Download,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DailyReportData } from "@/types/electron";
import { BrowserModeState, EmptyState, ErrorState, LoadingState } from "./states";
import {
  POSTER_BOARD_TEMPLATES,
  type PosterBoardTemplate,
} from "./poster-board-layout";
import {
  ensurePosterBoardFont,
  exportPosterBoardFromStage,
} from "./poster-board-export";
import { PosterBoardStage } from "./poster-board-stage";

// 业务日默认昨天：今天 22 → 21
function businessDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TOP_RANKS = [1, 2, 3] as const;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

export function PosterBoardPage() {
  const [date, setDate] = useState(businessDateStr());
  const [templateId, setTemplateId] = useState(POSTER_BOARD_TEMPLATES[0]?.id || "male-1-40");
  const [report, setReport] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [avatarsByRank, setAvatarsByRank] = useState<Record<number, string>>({});
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const unavailable = typeof window !== "undefined" && !getDataApi();
  const template = useMemo(
    () => POSTER_BOARD_TEMPLATES.find((t) => t.id === templateId) || POSTER_BOARD_TEMPLATES[0],
    [templateId]
  );

  const rows = useMemo(() => report?.rows || [], [report]);
  const sliceRows = useMemo(() => {
    if (!template) return [];
    return rows.filter((r) => r.rank >= template.rankStart && r.rank <= template.rankEnd);
  }, [rows, template]);

  const filledCount = sliceRows.length;
  const capacity = template ? template.rankEnd - template.rankStart + 1 : 0;
  const supportsAvatar = Boolean(template?.avatarSlots?.length);

  const fetchReport = useCallback(async (d: string) => {
    const api = getDataApi();
    if (!api) return;
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api.getDailyWaveReport(d, "male");
      if (!res.success) throw new Error(res.error || "加载失败");
      setReport(res.data);
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (unavailable) return;
    fetchReport(date);
  }, [date, fetchReport, unavailable]);

  useEffect(() => {
    void ensurePosterBoardFont();
  }, []);

  const onPickAvatar = async (rank: number, file?: File | null) => {
    if (!file) return;
    if (!/^image\/(png|webp)$/i.test(file.type) && !/\.png$/i.test(file.name)) {
      setError("头像请使用透明 PNG（或 WEBP）");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAvatarsByRank((prev) => ({ ...prev, [rank]: dataUrl }));
      setMsg(`已设置 Top${rank} 透明头像`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const clearAvatar = (rank: number) => {
    setAvatarsByRank((prev) => {
      const next = { ...prev };
      delete next[rank];
      return next;
    });
  };

    const findExportStage = (id: string) => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-poster-stage="${id}"][data-poster-export="1"]`)
    );
    return nodes[0] || null;
  };

  const handleExportOne = async (target: PosterBoardTemplate) => {
    setExporting(true);
    setError(null);
    setMsg(null);
    try {
      await ensurePosterBoardFont();
      const stage = findExportStage(target.id);
      if (!stage) throw new Error("未找到导出舞台，请刷新页面后重试");
      const filename = `${date}_男团海报_${target.rankStart}-${target.rankEnd}.png`;
      await exportPosterBoardFromStage(stage, filename, { pixelRatio: 2 });
      setMsg(`已导出 ${filename}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

    const handleExportAll = async () => {
    setExporting(true);
    setError(null);
    setMsg(null);
    try {
      await ensurePosterBoardFont();
      // 导出所有已挂载的舞台（当前页同时挂载全部模板的隐藏舞台）
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>('[data-poster-export="1"]')
      );
      if (nodes.length === 0) throw new Error("未找到海报舞台");
      for (const node of nodes) {
        const id = node.getAttribute("data-poster-stage") || "poster";
        const meta = POSTER_BOARD_TEMPLATES.find((x) => x.id === id);
        const filename = `${date}_男团海报_${meta ? `${meta.rankStart}-${meta.rankEnd}` : id}.png`;
        await exportPosterBoardFromStage(node, filename, { pixelRatio: 2 });
      }
      setMsg(`已导出 ${nodes.length} 张男团海报`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  if (unavailable) {
    return (
      <Card>
        <CardContent className="pt-6">
          <BrowserModeState />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">海报导出</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            SVG 基线定位 · 对齐 PSD transform · 105 Heavy
          </p>
        </div>
        <Badge variant="outline" className="font-mono text-[11px]">
          DOM · 105 Heavy
        </Badge>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CalendarDays className="size-3.5" />
                报告日期
              </span>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-44"
              />
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">模板</span>
              <div className="inline-flex rounded-lg border border-border bg-card p-1">
                {POSTER_BOARD_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      templateId === t.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchReport(date)}
              disabled={loading || exporting}
              className="gap-1.5"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              刷新数据
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => template && handleExportOne(template)}
              disabled={!template || exporting || loading || rows.length === 0}
              className="gap-1.5"
            >
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              导出当前
            </Button>
            <Button
              size="sm"
              onClick={handleExportAll}
              disabled={exporting || loading || rows.length === 0}
              className="gap-1.5"
            >
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
              导出两张
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/70 py-3">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span>{template?.label || "预览"}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {template ? `${template.width}×${template.height}` : ""} · DOM 预览 / 导出 2x
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center bg-[#0b1020] p-4">
            {loading ? (
              <div className="py-20">
                <LoadingState />
              </div>
            ) : error && !report ? (
              <div className="py-16">
                <ErrorState message={error} />
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16">
                <EmptyState label="暂无男团数据，先导入对应日期的音浪数据" />
              </div>
            ) : (
              <>
                <div className="max-h-[72vh] w-full overflow-auto">
                  <div className="mx-auto w-fit rounded-md shadow-2xl">
                    {template && (
                      <PosterBoardStage
                        template={template}
                        rows={rows}
                        avatarsByRank={avatarsByRank}
                        stageRef={stageRef}
                        previewScale={Math.min(1, 520 / template.width)}
                      />
                    )}
                  </div>
                </div>
                {/* 隐藏舞台：供“导出两张”直接截取全部模板 */}
                <div
                  aria-hidden
                  style={{
                    position: "fixed",
                    left: -10000,
                    top: 0,
                    opacity: 0,
                    pointerEvents: "none",
                    zIndex: -1,
                  }}
                >
                  {POSTER_BOARD_TEMPLATES.map((t) => (
                    <PosterBoardStage
                      key={`export-${t.id}`}
                      template={t}
                      rows={rows}
                      avatarsByRank={avatarsByRank}
                      previewScale={1}
                    />
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Top 头像（透明 PNG）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!supportsAvatar ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  当前模板无 Top 头像位（41-90 仅名单）。
                </p>
              ) : (
                TOP_RANKS.map((rank) => {
                  const name = rows.find((r) => r.rank === rank)?.name || "—";
                  const preview = avatarsByRank[rank];
                  return (
                    <div
                      key={rank}
                      className="flex items-center gap-3 rounded-lg border border-border/70 p-2.5"
                    >
                      <div className="relative size-14 shrink-0 overflow-hidden rounded-md border border-dashed border-border bg-muted/40">
                        {preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={preview} alt={`Top${rank}`} className="size-full object-cover" />
                        ) : (
                          <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                            PNG
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">Top{rank} · {name}</div>
                        <div className="text-[11px] text-muted-foreground">透明底 PNG / WEBP</div>
                        <div className="mt-1.5 flex gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => fileInputRefs.current[rank]?.click()}
                          >
                            <Upload className="size-3.5" />
                            上传
                          </Button>
                          {preview && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => clearAvatar(rank)}
                            >
                              <X className="size-3.5" />
                              清除
                            </Button>
                          )}
                        </div>
                        <input
                          ref={(el) => {
                            fileInputRefs.current[rank] = el;
                          }}
                          type="file"
                          accept="image/png,image/webp,.png,.webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            void onPickAvatar(rank, file);
                            e.currentTarget.value = "";
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">填充情况</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">当前模板名额</span>
                <span className="font-semibold">{capacity}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">命中排名</span>
                <span className="font-semibold">{filledCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">总男团人数</span>
                <span className="font-semibold">{rows.length}</span>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                不用 canvas 画字：底板 + SVG 文本（PSD matrix 基线）+ html-to-image 导出。头像透明 PNG。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">当前位次</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[36vh] space-y-1 overflow-y-auto pr-1">
              {sliceRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">该段排名暂无主播</p>
              ) : (
                sliceRows.map((row) => (
                  <div
                    key={`${row.rank}-${row.anchorId}-${row.name}`}
                    className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-1.5 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">#{row.rank}</span>
                    <span className="font-medium">{row.name}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {msg && (
            <Card className="border-chart-2/40">
              <CardContent className="flex items-center gap-2 py-3 text-sm text-chart-2">
                {msg}
              </CardContent>
            </Card>
          )}
          {error && (
            <Card className="border-destructive/40">
              <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                {error}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
