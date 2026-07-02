"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Image as ImageIcon, FileSpreadsheet } from "lucide-react";
import type { DailyReportData, DailyReportRow } from "@/types/electron";
import { formatWave } from "./format";
import { exportElementAsImage } from "./export-image";
import DataTableStyle2Template, {
  type DataTableStyle2Row,
} from "./data-table-style2-template";

/* ────────────────── 工具函数 ────────────────── */

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

type ColumnKey = "rank" | "name" | "dailyWave" | "totalWave" | "tier" | "duration" | "master";

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
  const [showDuration, setShowDuration] = useState(true);
  const [showMaster, setShowMaster] = useState(true);
  const [exportStyle, setExportStyle] = useState<"style1" | "style2">(() => {
    if (typeof window === "undefined") return "style1";
    return window.localStorage.getItem("dataTableImageExportStyle") === "style2"
      ? "style2"
      : "style1";
  });

  useEffect(() => {
    window.localStorage.setItem("dataTableImageExportStyle", exportStyle);
  }, [exportStyle]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const style2Ref = useRef<HTMLDivElement>(null);

  const date = report.date;
  const rows = report.rows;

  // 标题
  useEffect(() => {
    const genderText = gender === "male" ? "男" : "女";
    setCustomTitle(`${genderText}主播数据统计`);
  }, [gender]);

  /* ── 构建列布局 ── */
  const buildColumns = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number, availableWidth: number) => {
      const parts = date.split("-");
      const day = parseInt(parts[2] || "1", 10) || 1;

      const defs: ColumnDef[] = [
        {
          key: "rank",
          label: "序号",
          minWidth: 72,
          flex: 0.7,
          align: "center",
          getText: (_, i) => String(i + 1),
        },
        {
          key: "name",
          label: "主播姓名",
          minWidth: 150,
          flex: 1.6,
          align: "left",
          getText: (r) => r.name,
        },
        {
          key: "dailyWave",
          label: `${day}号音浪`,
          minWidth: 180,
          flex: 2.1,
          align: "right",
          getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播"),
        },
        {
          key: "totalWave",
          label: "累计总音浪",
          minWidth: 160,
          flex: 1.5,
          align: "right",
          getText: (r) => formatWave(r.totalWave),
        },
        {
          key: "tier",
          label: "等级",
          minWidth: 96,
          flex: 1,
          align: "center",
          getText: (r) => r.tier || "",
        },
        {
          key: "duration",
          label: "有效时长",
          minWidth: 130,
          flex: 1.3,
          align: "center",
          getText: (r) =>
            r.isLive && r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—",
        },
        {
          key: "master",
          label: "师傅",
          minWidth: 100,
          flex: 1.1,
          align: "left",
          getText: (r) => r.masterName || "—",
        },
      ];

      const visible = defs.filter((d) => {
        if (d.key === "dailyWave") return showWave;
        if (d.key === "totalWave") return showTotalWave;
        if (d.key === "tier") return showTier;
        if (d.key === "duration") return showDuration;
        if (d.key === "master") return showMaster;
        return true;
      });

      ctx.save();
      let widths = visible.map((col) => {
        ctx.font = `bold ${14 * scale}px sans-serif`;
        const headerW = ctx.measureText(col.label).width;
        ctx.font = `${14 * scale}px sans-serif`;
        const sampleW = rows.slice(0, 12).reduce((max, r, i) => {
          return Math.max(max, ctx.measureText(col.getText(r, i)).width);
        }, 0);
        return Math.max(col.minWidth * scale, headerW + 28 * scale, sampleW + 36 * scale);
      });
      ctx.restore();

      const totalW = widths.reduce((s, w) => s + w, 0);
      if (totalW < availableWidth) {
        const extra = availableWidth - totalW;
        const totalFlex = visible.reduce((s, c) => s + c.flex, 0) || 1;
        widths = widths.map((w, i) => w + extra * (visible[i].flex / totalFlex));
      } else if (totalW > availableWidth) {
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
    [date, rows, showWave, showTotalWave, showTier, showDuration, showMaster]
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
    const estCols = buildColumns(ctx, scale, 760 * scale);
    const estW = estCols.reduce((s, c) => s + c.width, 0);
    const containerW = Math.max(
      680 * scale,
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
        ctx.fillText(col.label, drawX + 12 * scale, y + tableHeaderHeight / 2);
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
          const text = truncateCanvasText(ctx, row.name, col.width - 24 * scale);
          ctx.fillText(text, drawX + 12 * scale, cy);
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
          const dText = row.isLive && row.dailyDuration > 0
            ? formatDurationText(row.dailyDuration)
            : "—";
          ctx.fillText(dText, drawX + col.width / 2, cy);
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
    ctx.fillText(`导出日期 ${formattedDate}`, tablePaddingX, y + 50 * scale);

    if (hasInactive) {
      ctx.fillStyle = "#DC2626";
      ctx.font = `bold ${14 * scale}px sans-serif`;
      ctx.fillText(`未开播 ${inactiveStreamers.length} 人`, containerW / 2, y + 26 * scale);
      ctx.font = `${11 * scale}px sans-serif`;
      ctx.fillStyle = "#7F1D1D";
      ctx.textBaseline = "top";
      inactiveLines.forEach((line, i) => {
        ctx.fillText(line, containerW / 2, y + (44 + i * 16) * scale);
      });
      ctx.textBaseline = "middle";
    }
  }, [rows, date, gender, customTitle, showWave, showTotalWave, showTier, showDuration, showMaster, buildColumns]);

  useEffect(() => {
    if (exportStyle === "style1") drawCanvas();
  }, [drawCanvas, exportStyle]);

  /* ── 样式二数据准备 ── */
  const style2Data = useMemo(() => {
    const parts = date.split("-");
    const year = parseInt(parts[0], 10) || 2026;
    const month = parseInt(parts[1], 10) || 1;
    const day = parseInt(parts[2], 10) || 1;
    const formattedDate = `${year}年${month}月${day}日`;
    const genderText = gender === "male" ? "男" : "女";
    const title = customTitle.trim() || `${genderText}主播数据统计`;

    const liveWaves = rows.filter((r) => r.isLive).map((r) => r.dailyWave);
    const maxWave = liveWaves.length > 0 ? Math.max(...liveWaves) : 1;
    const inactiveNames = rows.filter((r) => !r.isLive).map((r) => r.name);
    const totalDailyWave = rows.reduce(
      (sum, r) => sum + (r.isLive ? Math.max(r.dailyWave, 0) : 0),
      0
    );
    const totalWave = rows.reduce((sum, r) => sum + Math.max(r.totalWave, 0), 0);

    const style2Rows: DataTableStyle2Row[] = rows.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      waveText: r.isLive ? formatWave(r.dailyWave) : "未开播",
      waveRatio: r.isLive ? r.dailyWave / maxWave : 0,
      totalWaveText: formatWave(r.totalWave),
      grade: r.tier || "",
      durationText:
        r.isLive && r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—",
    }));

    return {
      title,
      formattedDate,
      genderText,
      totalCount: rows.length,
      inactiveCount: inactiveNames.length,
      totalDailyWaveText: formatWave(totalDailyWave),
      totalWaveText: formatWave(totalWave),
      inactiveNames,
      rows: style2Rows,
    };
  }, [rows, date, gender, customTitle]);

  /* ── 导出图片 ── */
  const handleExport = async () => {
    if (exporting) return;
    const genderText = gender === "male" ? "男" : "女";
    const filename = `${date}_${genderText}_${rows.length}人.png`;

    if (exportStyle === "style2") {
      const node = style2Ref.current;
      if (!node) return;
      setExporting(true);
      try {
        await exportElementAsImage(node, filename, {
          width: 1080,
          height: 1080,
          pixelRatio: 2,
          backgroundColor: "#020617",
        });
        onClose();
      } catch (err) {
        console.error("Export error:", err);
        alert("导出失败: " + String(err));
      } finally {
        setExporting(false);
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    setExporting(true);
    try {
      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();
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
      if (showWave) headers.push("当日音浪");
      if (showTotalWave) headers.push("累计总音浪");
      if (showTier) headers.push("等级");
      if (showDuration) headers.push("有效时长(分钟)");
      if (showMaster) headers.push("师傅");
      headers.push("日期");

      const csvRows = rows.map((r, i) => {
        const row = [i + 1, r.anchorId, r.name];
        if (showWave) row.push(r.isLive ? r.dailyWave : 0);
        if (showTotalWave) row.push(r.totalWave);
        if (showTier) row.push(r.tier || "");
        if (showDuration) row.push(r.isLive ? r.dailyDuration : 0);
        if (showMaster) row.push(r.masterName || "");
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

  const parts = date.split("-");
  const day = parseInt(parts[2]) || 1;

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

              {/* 导出样式 */}
              <div>
                <label className="mb-2 block text-sm text-muted-foreground">导出样式</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setExportStyle("style1")}
                    className={`rounded px-3 py-1 text-sm transition-colors ${
                      exportStyle === "style1"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    样式一
                  </button>
                  <button
                    onClick={() => setExportStyle("style2")}
                    className={`rounded px-3 py-1 text-sm transition-colors ${
                      exportStyle === "style2"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    样式二
                  </button>
                </div>
              </div>

              {/* 可选列 */}
              <div className={exportStyle === "style2" ? "opacity-50 pointer-events-none" : ""}>
                <label className="mb-2 block text-sm text-muted-foreground">可选列</label>
                <div className="flex flex-wrap gap-2">
                  <label className="flex cursor-pointer items-center gap-1 text-sm">
                    <input type="checkbox" checked={showWave} onChange={(e) => setShowWave(e.target.checked)} className="accent-primary" />
                    {day}号音浪
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
                    <input type="checkbox" checked={showMaster} onChange={(e) => setShowMaster(e.target.checked)} className="accent-primary" />
                    师傅
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* 预览 */}
          <div className="flex justify-center overflow-auto">
            {exportStyle === "style2" ? (
              <div
                style={{
                  width: 540,
                  height: 540,
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "#020617",
                }}
              >
                <div
                  style={{
                    width: 1080,
                    height: 1080,
                    transform: "scale(0.5)",
                    transformOrigin: "top left",
                  }}
                >
                  <DataTableStyle2Template {...style2Data} exportMode />
                </div>
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                style={{ maxWidth: "100%", height: "auto", border: "1px solid var(--border)", borderRadius: "4px" }}
              />
            )}
          </div>
        </div>

        {/* 样式二离屏导出节点（1:1 原始尺寸） */}
        {exportStyle === "style2" && (
          <div
            style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }}
            aria-hidden
          >
            <div ref={style2Ref}>
              <DataTableStyle2Template {...style2Data} exportMode />
            </div>
          </div>
        )}

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
