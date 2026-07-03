import type { DailyReportRow } from "@/types/electron";
import { formatWave } from "./format";

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

type ColumnKey = "rank" | "name" | "dailyWave" | "totalWave" | "tier" | "duration" | "master";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  minWidth: number;
  flex: number;
  align: "left" | "center" | "right";
  getText: (row: DailyReportRow, index: number) => string;
}

function buildColumns(
  ctx: CanvasRenderingContext2D,
  scale: number,
  availableWidth: number,
  date: string,
  rows: DailyReportRow[]
) {
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

  ctx.save();
  let widths = defs.map((col) => {
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
    const totalFlex = defs.reduce((s, c) => s + c.flex, 0) || 1;
    widths = widths.map((w, i) => w + extra * (defs[i].flex / totalFlex));
  } else if (totalW > availableWidth) {
    const ratio = availableWidth / totalW;
    widths = widths.map((w) => w * ratio);
  }

  let x = 0;
  return defs.map((col, i) => {
    const layout = { ...col, x, width: widths[i] };
    x += widths[i];
    return layout;
  });
}

/* ────────────────── 主绘制函数 ────────────────── */

export interface DrawReportOptions {
  date: string;
  rows: DailyReportRow[];
  gender: "male" | "female";
  customTitle?: string;
  scale?: number;
}

export function drawReportToCanvas(
  canvas: HTMLCanvasElement,
  opts: DrawReportOptions
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { date, rows, gender, customTitle = "", scale = 2 } = opts;

  const parts = date.split("-");
  const year = parseInt(parts[0]) || 2026;
  const month = parseInt(parts[1]) || 1;
  const day = parseInt(parts[2]) || 1;
  const formattedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const genderText = gender === "male" ? "男" : "女";
  const titleText = `${customTitle || `${genderText}主播数据统计`} ${formattedDate}`;
  const tablePaddingX = 20 * scale;
  const headerHeight = 54 * scale;
  const tableHeaderHeight = 32 * scale;
  const rowHeight = 38 * scale;
  const inactiveStreamers = rows.filter((r) => !r.isLive);
  const hasInactive = inactiveStreamers.length > 0;

  ctx.font = `bold ${22 * scale}px sans-serif`;
  const titleW = ctx.measureText(titleText).width;
  const estCols = buildColumns(ctx, scale, 760 * scale, date, rows);
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

  const cols = buildColumns(ctx, scale, containerW - tablePaddingX * 2, date, rows);
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
}
