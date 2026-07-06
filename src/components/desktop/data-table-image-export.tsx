"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Image as ImageIcon, FileSpreadsheet } from "lucide-react";
import type { DailyReportData, DailyReportRow } from "@/types/electron";
import { formatWave } from "./format";
import { downloadCanvasAsPng } from "./export-image";
import { formatDailyWaveLabel, formatMonthNotLiveDaysLabel } from "./draw-report-canvas";

/* ────────────────── 工具函数 ────────────────── */

function formatDurationText(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}时${m}分` : `${h}时`;
  }
  return `${minutes}分`;
}

function truncateCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(`${t}...`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t ? `${t}...` : text;
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text) return [];
  const lines: string[] = [];
  let current = "";
  const pushSeg = (seg: string) => {
    let chunk = "";
    for (const ch of seg) {
      const next = chunk + ch;
      if (ctx.measureText(next).width > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  };
  text.split("、").forEach((seg) => {
    const next = current ? `${current}、${seg}` : seg;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      return;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    if (ctx.measureText(seg).width <= maxWidth) {
      current = seg;
      return;
    }
    pushSeg(seg);
  });
  if (current) lines.push(current);
  return lines;
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

/* ────────────────── 列定义 ────────────────── */

type ColumnKey = "rank" | "name" | "notLiveDays" | "dailyWave" | "totalWave" | "duration" | "master" | "tier";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  minWidth: number;
  flex: number;
  align: "left" | "center" | "right";
  getText: (row: DailyReportRow, index: number) => string;
}

/* ────────────────── 组件 Props ────────────────── */

interface DataTableImageExportProps {
  report: DailyReportData;
  gender: "male" | "female";
  onClose: () => void;
}

/* ────────────────── 组件 ────────────────── */

export function DataTableImageExport({
  report,
  gender,
  onClose,
}: DataTableImageExportProps) {
  const [exporting, setExporting] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [showWave, setShowWave] = useState(true);
  const [showTotalWave, setShowTotalWave] = useState(true);
  const [showTier, setShowTier] = useState(true);
  const [showDuration, setShowDuration] = useState(false);
  const [showNotLiveDays, setShowNotLiveDays] = useState(true);
  const [showMaster, setShowMaster] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const date = report.date;
  const rows = report.rows;
  const notLiveDaysLabel = formatMonthNotLiveDaysLabel(date);
  const dailyWaveLabel = formatDailyWaveLabel(date);

  // 标题
  useEffect(() => {
    const genderText = gender === "male" ? "男" : "女";
    setCustomTitle(`${genderText}主播数据统计`);
  }, [gender]);

  /* ── 构建列布局 ── */
  const buildColumns = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number, availableWidth: number, fitToWidth = true) => {
      const defs: ColumnDef[] = [
        {
          key: "rank",
          label: "序号",
          minWidth: 58,
          flex: 0.08,
          align: "center",
          getText: (_, i) => String(i + 1),
        },
        {
          key: "name",
          label: "主播姓名",
          minWidth: 104,
          flex: 0.12,
          align: "left",
          getText: (r) => r.name,
        },
        {
          key: "notLiveDays",
          label: notLiveDaysLabel,
          minWidth: 30,
          flex: 0,
          align: "center",
          getText: (r) => String(r.notLiveDays ?? 0),
        },
        {
          key: "dailyWave",
          label: dailyWaveLabel,
          minWidth: 112,
          flex: 0.35,
          align: "right",
          getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播"),
        },
        {
          key: "totalWave",
          label: "累计总音浪",
          minWidth: 146,
          flex: 1.6,
          align: "right",
          getText: (r) => formatWave(r.totalWave),
        },
        {
          key: "duration",
          label: "有效时长",
          minWidth: 94,
          flex: 0.7,
          align: "center",
          getText: (r) =>
            r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—",
        },
        {
          key: "master",
          label: "师傅",
          minWidth: 96,
          flex: 1.2,
          align: "left",
          getText: (r) => r.masterName || "—",
        },
        {
          key: "tier",
          label: "等级",
          minWidth: 72,
          flex: 0.35,
          align: "center",
          getText: (r) => r.tier || "",
        },
      ];

      const visible = defs.filter((d) => {
        if (d.key === "dailyWave") return showWave;
        if (d.key === "totalWave") return showTotalWave;
        if (d.key === "tier") return showTier;
        if (d.key === "duration") return showDuration;
        if (d.key === "notLiveDays") return showNotLiveDays;
        if (d.key === "master") return showMaster;
        return true;
      });

      ctx.save();
      let widths = visible.map((col) => {
        ctx.font = `bold ${14 * scale}px sans-serif`;
        const headerW = ctx.measureText(col.label).width;
        ctx.font = `${14 * scale}px sans-serif`;
        const sampleW = rows.reduce((max, r, i) => {
          return Math.max(max, ctx.measureText(col.getText(r, i)).width);
        }, 0);
        if (col.key === "notLiveDays") {
          return Math.max(col.minWidth * scale, headerW + 10 * scale, sampleW + 14 * scale);
        }
        return Math.max(col.minWidth * scale, headerW + 28 * scale, sampleW + 36 * scale);
      });
      ctx.restore();

      const totalW = widths.reduce((s, w) => s + w, 0);
      if (fitToWidth && totalW < availableWidth) {
        const extra = availableWidth - totalW;
        const totalFlex = visible.reduce((s, c) => s + c.flex, 0) || 1;
        widths = widths.map((w, i) => w + extra * (visible[i].flex / totalFlex));
      } else if (fitToWidth && totalW > availableWidth) {
        const ratio = availableWidth / totalW;
        widths = widths.map((w) => w * ratio);
      }

      let x = 0;
      return visible.map((col, i) => {
        const layout = { ...col, x, width: widths[i] };
        x += widths[i];
        return layout;
      });
    },
    [dailyWaveLabel, notLiveDaysLabel, rows, showWave, showTotalWave, showTier, showDuration, showNotLiveDays, showMaster]
  );

  /* ── Canvas 绘制 ── */
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scale = 2;
    const parts = date.split("-");
    const year = parseInt(parts[0]) || 2026;
    const month = parseInt(parts[1]) || 1;
    const day = parseInt(parts[2]) || 1;
    const formattedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const titleText = `${customTitle} ${formattedDate}`;
    const genderText = gender === "male" ? "男" : "女";
    const tablePaddingX = 20 * scale;
    const headerHeight = 54 * scale;
    const tableHeaderHeight = 32 * scale;
    const rowHeight = 38 * scale;
    const inactiveStreamers = rows.filter((r) => !r.isLive);
    const hasInactive = inactiveStreamers.length > 0;

    ctx.font = `bold ${22 * scale}px sans-serif`;
    const titleW = ctx.measureText(titleText).width;
    const estCols = buildColumns(ctx, scale, 0, false);
    const estW = estCols.reduce((s, c) => s + c.width, 0);
    const containerW = Math.max(
      520 * scale,
      Math.min(980 * scale, Math.max(titleW + 100 * scale, estW + tablePaddingX * 2))
    );

    ctx.font = `${11 * scale}px sans-serif`;
    const inactiveLines = hasInactive
      ? wrapCanvasText(
          ctx,
          inactiveStreamers.map((r) => r.name).join("、"),
          containerW / 2 - 40 * scale
        )
      : [];
    const footerHeight = hasInactive
      ? Math.max(96 * scale, (70 + inactiveLines.length * 18) * scale)
      : 64 * scale;

    const cols = buildColumns(ctx, scale, containerW - tablePaddingX * 2);
    const totalH = headerHeight + tableHeaderHeight + rowHeight * rows.length + footerHeight;

    canvas.width = containerW;
    canvas.height = totalH;

    // 背景
    ctx.fillStyle = "#F8FAFC";
    ctx.fillRect(0, 0, containerW, totalH);

    let y = 0;

    // 标题栏
    ctx.fillStyle = "#1E293B";
    ctx.fillRect(0, y, containerW, headerHeight);
    ctx.fillStyle = "#F8FAFC";
    ctx.font = `bold ${22 * scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(titleText, containerW / 2, y + headerHeight / 2);
    y += headerHeight;

    // 表头
    ctx.fillStyle = "#E2E8F0";
    ctx.fillRect(0, y, containerW, tableHeaderHeight);
    ctx.fillStyle = "#475569";
    ctx.font = `bold ${13 * scale}px sans-serif`;
    cols.forEach((col) => {
      const drawX = tablePaddingX + col.x;
      if (col.align === "left") {
        ctx.textAlign = "left";
        ctx.fillText(col.label, drawX + 8 * scale, y + tableHeaderHeight / 2);
      } else if (col.align === "right") {
        ctx.textAlign = "right";
        ctx.fillText(col.label, drawX + col.width - 12 * scale, y + tableHeaderHeight / 2);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(col.label, drawX + col.width / 2, y + tableHeaderHeight / 2);
      }
    });
    y += tableHeaderHeight;

    // 数据行
    const maxWave = rows.filter((r) => r.isLive).length > 0
      ? Math.max(...rows.filter((r) => r.isLive).map((r) => r.dailyWave))
      : 1;

    rows.forEach((row, index) => {
      const rank = index + 1;
      const isTop3 = rank <= 3;
      const isInactive = !row.isLive;

      ctx.fillStyle =
        rank === 1 ? "#FEF3C7" :
        rank === 2 ? "#F8FAFC" :
        rank === 3 ? "#FFEDD5" :
        index % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
      ctx.fillRect(0, y, containerW, rowHeight);

      ctx.strokeStyle = "#E2E8F0";
      ctx.lineWidth = 0.5 * scale;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(containerW, y);
      ctx.stroke();

      cols.forEach((col) => {
        const drawX = tablePaddingX + col.x;
        const cy = y + rowHeight / 2;

        if (col.key === "rank") {
          ctx.textAlign = "center";
          ctx.fillStyle = "#334155";
          if (isTop3) {
            ctx.font = `${20 * scale}px sans-serif`;
            ctx.fillText(rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉", drawX + col.width / 2, cy);
          } else {
            ctx.font = `italic bold ${15 * scale}px serif`;
            ctx.fillText(String(rank).padStart(2, "0"), drawX + col.width / 2, cy);
          }
        } else if (col.key === "name") {
          ctx.textAlign = "left";
          ctx.fillStyle = "#0F172A";
          ctx.font = `${15 * scale}px sans-serif`;
          const text = truncateCanvasText(ctx, row.name, col.width - 16 * scale);
          ctx.fillText(text, drawX + 8 * scale, cy);
        } else if (col.key === "dailyWave") {
          if (!isInactive) {
            const barW = Math.max(((col.width - 48 * scale) * row.dailyWave) / maxWave, 24 * scale);
            const barH = 18 * scale;
            const barTop = y + (rowHeight - barH) / 2;
            const barLeft = drawX + 10 * scale;
            ctx.fillStyle = "#DBEAFE";
            ctx.beginPath();
            drawRoundRect(ctx, barLeft, barTop, col.width - 24 * scale, barH, 6 * scale);
            ctx.fill();
            ctx.fillStyle = "#60A5FA";
            ctx.beginPath();
            drawRoundRect(ctx, barLeft, barTop, Math.min(barW, col.width - 24 * scale), barH, 6 * scale);
            ctx.fill();
          }
          ctx.textAlign = "right";
          ctx.font = `${14 * scale}px monospace`;
          ctx.fillStyle = isInactive ? "#DC2626" : "#1E293B";
          ctx.fillText(isInactive ? "未开播" : formatWave(row.dailyWave), drawX + col.width - 12 * scale, cy);
        } else if (col.key === "totalWave") {
          ctx.textAlign = "right";
          ctx.font = `${14 * scale}px monospace`;
          ctx.fillStyle = "#475569";
          ctx.fillText(formatWave(row.totalWave), drawX + col.width - 12 * scale, cy);
        } else if (col.key === "tier") {
          if (row.tier) {
            const bw = Math.min(col.width - 20 * scale, 66 * scale);
            const bh = 20 * scale;
            const bl = drawX + (col.width - bw) / 2;
            const bt = cy - bh / 2;
            const tierLetter = (row.tier.charAt(0) || 'D').toUpperCase();
            const tierColorMap: Record<string, { bg: string; text: string }> = {
              A: { bg: 'rgba(52, 211, 153, 0.18)', text: '#10b981' },
              B: { bg: 'rgba(56, 189, 248, 0.18)', text: '#0284c7' },
              C: { bg: 'rgba(251, 191, 36, 0.18)', text: '#d97706' },
              D: { bg: 'rgba(244, 63, 94, 0.18)', text: '#e11d48' },
            };
            const tc = tierColorMap[tierLetter] || tierColorMap.D;
            ctx.fillStyle = tc.bg;
            ctx.beginPath();
            drawRoundRect(ctx, bl, bt, bw, bh, 8 * scale);
            ctx.fill();
            ctx.fillStyle = tc.text;
            ctx.font = `bold ${11 * scale}px sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(row.tier, drawX + col.width / 2, cy + 1 * scale);
          }
        } else if (col.key === "duration") {
          ctx.textAlign = "center";
          ctx.fillStyle = "#7C3AED";
          ctx.font = `${13 * scale}px sans-serif`;
          const dText = row.dailyDuration > 0
            ? formatDurationText(row.dailyDuration)
            : "—";
          ctx.fillText(dText, drawX + col.width / 2, cy);
        } else if (col.key === "notLiveDays") {
          ctx.textAlign = "center";
          ctx.fillStyle = (row.notLiveDays ?? 0) > 0 ? "#B91C1C" : "#15803D";
          ctx.font = `bold ${13 * scale}px sans-serif`;
          ctx.fillText(String(row.notLiveDays ?? 0), drawX + col.width / 2, cy);
        } else if (col.key === "master") {
          ctx.textAlign = "left";
          ctx.fillStyle = "#64748B";
          ctx.font = `${13 * scale}px sans-serif`;
          const text = truncateCanvasText(ctx, row.masterName || "—", col.width - 24 * scale);
          ctx.fillText(text, drawX + 12 * scale, cy);
        }
      });

      y += rowHeight;
    });

    // 底部
    ctx.fillStyle = "#E2E8F0";
    ctx.fillRect(0, y, containerW, footerHeight);
    ctx.fillStyle = "#334155";
    ctx.textAlign = "left";
    ctx.font = `bold ${18 * scale}px sans-serif`;
    ctx.fillText(`${genderText}主播 ${rows.length} 人`, tablePaddingX, y + 26 * scale);
    ctx.font = `${12 * scale}px sans-serif`;
    ctx.fillStyle = "#64748B";
    ctx.fillText(`数据日期 ${formattedDate}`, tablePaddingX, y + 50 * scale);

    if (hasInactive) {
      ctx.fillStyle = "#DC2626";
      ctx.font = `bold ${14 * scale}px sans-serif`;
      ctx.fillText(`未开播人数 ${inactiveStreamers.length} 人`, containerW / 2, y + 26 * scale);
      ctx.font = `${11 * scale}px sans-serif`;
      ctx.fillStyle = "#7F1D1D";
      ctx.textBaseline = "top";
      inactiveLines.forEach((line, i) => {
        ctx.fillText(line, containerW / 2, y + (44 + i * 16) * scale);
      });
      ctx.textBaseline = "middle";
    }
  }, [rows, date, gender, customTitle, buildColumns]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  /* ── 导出图片 ── */
  const handleExport = async () => {
    if (exporting) return;
    const genderText = gender === "male" ? "男" : "女";
    const filename = `${date}_${genderText}_${rows.length}人.png`;

    const canvas = canvasRef.current;
    if (!canvas) return;
    setExporting(true);
    try {
      await downloadCanvasAsPng(canvas, filename, drawCanvas);
      onClose();
    } catch (err) {
      console.error("Export error:", err);
      alert("导出失败: " + String(err));
    } finally {
      setExporting(false);
    }
  };

  /* ── 导出 CSV ── */
  const handleExportCSV = async () => {
    if (rows.length === 0) return;
    setExporting(true);
    try {
      const headers = ["排名", "主播ID", "主播姓名"];
      if (showNotLiveDays) headers.push(notLiveDaysLabel);
      if (showWave) headers.push(dailyWaveLabel);
      if (showTotalWave) headers.push("累计总音浪");
      if (showDuration) headers.push("有效时长(分钟)");
      if (showMaster) headers.push("师傅");
      if (showTier) headers.push("等级");
      headers.push("日期");

      const csvRows = rows.map((r, i) => {
        const row = [i + 1, r.anchorId, r.name];
        if (showNotLiveDays) row.push(r.notLiveDays ?? 0);
        if (showWave) row.push(r.isLive ? r.dailyWave : 0);
        if (showTotalWave) row.push(r.totalWave);
        if (showDuration) row.push(r.dailyDuration > 0 ? r.dailyDuration : 0);
        if (showMaster) row.push(r.masterName || "");
        if (showTier) row.push(r.tier || "");
        row.push(date);
        return row;
      });

      const csv = [headers, ...csvRows]
        .map((r) => r.map((c) => `"${c}"`).join(","))
        .join("\n");

      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const genderText = gender === "male" ? "男" : "女";
      link.download = `${date}_${genderText}_音浪数据_${rows.length}人.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV export error:", err);
      alert("导出失败: " + String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/50 py-4">
      <div className="flex max-h-[95vh] w-[900px] flex-col rounded-xl border border-border bg-card">
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">导出图片</h3>
          <button onClick={onClose} className="text-muted-foreground transition-colors hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-auto p-4">
          {/* 设置区 */}
          <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap gap-4">
              {/* 标题 */}
              <div className="min-w-[300px] flex-1">
                <label className="mb-2 block text-sm text-muted-foreground">标题设置</label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="自定义标题（日期自动添加）"
                  className="w-full rounded border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary"
                />
              </div>

              {/* 可选列 */}
              <div>
                <label className="mb-2 block text-sm text-muted-foreground">可选列</label>
                <div className="flex flex-wrap gap-2">
                  <label className="flex cursor-pointer items-center gap-1 text-sm">
                    <input type="checkbox" checked={showWave} onChange={(e) => setShowWave(e.target.checked)} className="accent-primary" />
                    {dailyWaveLabel}
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-sm">
                    <input type="checkbox" checked={showTotalWave} onChange={(e) => setShowTotalWave(e.target.checked)} className="accent-primary" />
                    累计总音浪
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-sm">
                    <input type="checkbox" checked={showTier} onChange={(e) => setShowTier(e.target.checked)} className="accent-primary" />
                    等级
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-sm">
                    <input type="checkbox" checked={showDuration} onChange={(e) => setShowDuration(e.target.checked)} className="accent-primary" />
                    有效时长
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-sm">
                    <input type="checkbox" checked={showNotLiveDays} onChange={(e) => setShowNotLiveDays(e.target.checked)} className="accent-primary" />
                    未播天数
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-sm">
                    <input type="checkbox" checked={showMaster} onChange={(e) => setShowMaster(e.target.checked)} className="accent-primary" />
                    师傅
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* 预览 */}
          <div className="flex justify-center overflow-auto">
            <canvas
              ref={canvasRef}
              style={{ maxWidth: "100%", height: "auto", display: "block" }}
            />
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex shrink-0 gap-3 border-t border-border px-6 py-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-muted-foreground transition-colors hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={handleExportCSV}
            disabled={exporting || rows.length === 0}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-secondary px-4 py-2 font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
          >
            <FileSpreadsheet className="size-4" />
            {exporting ? "导出中…" : "导出 CSV"}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || rows.length === 0}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <ImageIcon className="size-4" />
            {exporting ? "导出中…" : "导出图片"}
          </button>
        </div>
      </div>
    </div>
  );
}
