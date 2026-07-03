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
  const radius = Math.min(r, w / 2, h / 2);
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  配色 — 严格对照 HTML 模板 CSS 变量
 * ═══════════════════════════════════════════════════════════════ */

const C = {
  bg: "#F4F6F9",
  cardBg: "#FFFFFF",
  headerBg: "#272D3E",
  thBg: "#EAF1FA",
  thText: "#555555",
  borderColor: "#F0F0F0",
  top1Bg: "#FFFBF0",
  top2Bg: "#F4F7FC",
  top3Bg: "#FDF5EC",
  medal1Start: "#FFD700",
  medal1End: "#FBC02D",
  medal2Start: "#E0E0E0",
  medal2End: "#B0BEC5",
  medal3Start: "#FFBCA8",
  medal3End: "#E68A70",
  barBg: "#74A8FB",
  badgeBg: "#E3F0FF",
  badgeText: "#2F88FF",
  textMain: "#333333",
  textSub: "#777777",
  textDanger: "#D35555",
  totalWaveText: "#666666",
  masterText: "#777777",
  placeholderText: "#2F88FF",
  footerBg: "#FAFBFC",
  footerTitle: "#333333",
  footerMeta: "#777777",
  footerInactive: "#D35555",
};

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
  cardWidth: number,
  date: string,
  rows: DailyReportRow[],
  showDuration: boolean,
  showMaster: boolean
): (ColumnDef & { x: number; width: number })[] {
  const parts = date.split("-");
  const day = parseInt(parts[2] || "1", 10) || 1;

  const defs: ColumnDef[] = [
    { key: "rank", label: "序号", minWidth: 80, flex: 0.8, align: "center", getText: (_, i) => String(i + 1) },
    { key: "name", label: "主播姓名", minWidth: 120, flex: 1.5, align: "left", getText: (r) => r.name },
    { key: "dailyWave", label: `${day}号音浪`, minWidth: 200, flex: 3.0, align: "center", getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播") },
    { key: "totalWave", label: "累计总音浪", minWidth: 130, flex: 1.8, align: "center", getText: (r) => formatWave(r.totalWave) },
    { key: "tier", label: "等级", minWidth: 80, flex: 1.0, align: "center", getText: (r) => r.tier || "" },
  ];

  if (showDuration) {
    defs.push({ key: "duration", label: "有效时长", minWidth: 100, flex: 1.2, align: "center", getText: (r) => r.isLive && r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—" });
  }
  if (showMaster) {
    defs.push({ key: "master", label: "师傅", minWidth: 80, flex: 1.0, align: "center", getText: (r) => r.masterName || "—" });
  }

  ctx.save();
  let widths = defs.map((col) => {
    ctx.font = `600 ${15 * scale}px sans-serif`;
    const headerW = ctx.measureText(col.label).width;
    ctx.font = `${15 * scale}px sans-serif`;
    const sampleW = rows.slice(0, 12).reduce((max, r, i) => Math.max(max, ctx.measureText(col.getText(r, i)).width), 0);
    return Math.max(col.minWidth * scale, headerW + 30 * scale, sampleW + 36 * scale);
  });
  ctx.restore();

  const totalW = widths.reduce((s, w) => s + w, 0);
  if (totalW < cardWidth) {
    const extra = cardWidth - totalW;
    const totalFlex = defs.reduce((s, c) => s + c.flex, 0) || 1;
    widths = widths.map((w, i) => w + extra * (defs[i].flex / totalFlex));
  } else if (totalW > cardWidth) {
    const ratio = cardWidth / totalW;
    widths = widths.map((w) => w * ratio);
  }

  let x = 0;
  return defs.map((col, i) => ({ ...col, x, width: widths[i] }));
}

/* ────────────────── 主绘制函数 ────────────────── */

export interface DrawReportOptions {
  date: string;
  rows: DailyReportRow[];
  gender: "male" | "female";
  customTitle?: string;
  scale?: number;
  showDuration?: boolean;
  showMaster?: boolean;
}

export function drawReportToCanvas(
  canvas: HTMLCanvasElement,
  opts: DrawReportOptions
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { date, rows, gender, customTitle = "", scale = 2, showDuration = false, showMaster = false } = opts;

  const parts = date.split("-");
  const year = parseInt(parts[0]) || 2026;
  const month = parseInt(parts[1]) || 1;
  const day = parseInt(parts[2]) || 1;
  const formattedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const genderText = gender === "male" ? "男" : "女";
  const titleText = `${customTitle || `${genderText}主播数据统计`} ${formattedDate}`;

  // ── 固定卡片宽度 900px (对照 HTML max-width: 900px) ──
  const cardW = 900 * scale;
  const margin = 20 * scale;
  const cornerRadius = 12 * scale;
  const containerW = cardW + margin * 2;

  const headerHeight = 68 * scale;
  const tableHeaderHeight = 48 * scale;
  const rowHeight = 46 * scale;
  const footerHeightBase = 80 * scale;

  const inactiveStreamers = rows.filter((r) => !r.isLive);
  const hasInactive = inactiveStreamers.length > 0;

  ctx.font = `${14 * scale}px sans-serif`;
  const inactiveLines = hasInactive
    ? wrapCanvasText(ctx, inactiveStreamers.map((r) => r.name).join("、"), cardW * 0.3)
    : [];
  const footerHeight = hasInactive
    ? Math.max(footerHeightBase, (60 + inactiveLines.length * 20) * scale)
    : footerHeightBase;

  // 一次性计算列宽，传入卡片实际宽度
  const cols = buildColumns(ctx, scale, cardW, date, rows, showDuration, showMaster);

  const totalH = margin + headerHeight + tableHeaderHeight + rowHeight * rows.length + footerHeight + margin;

  canvas.width = containerW;
  canvas.height = totalH;

  // ── 外背景 ──
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, containerW, totalH);

  // ── 卡片 ──
  const cardX = margin;
  const cardY = margin;
  const cardH = totalH - margin * 2;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.08)";
  ctx.shadowBlur = 30 * scale;
  ctx.shadowOffsetY = 10 * scale;
  ctx.fillStyle = C.cardBg;
  ctx.beginPath();
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cornerRadius);
  ctx.fill();
  ctx.restore();

  // 裁剪到卡片内部
  ctx.save();
  ctx.beginPath();
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cornerRadius);
  ctx.clip();

  let y = cardY;

  // ══════ 头部 ══════
  ctx.fillStyle = C.headerBg;
  ctx.fillRect(cardX, y, cardW, headerHeight);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${26 * scale}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(titleText, cardX + cardW / 2, y + headerHeight / 2);

  y += headerHeight;

  // ══════ 表头 ══════
  ctx.fillStyle = C.thBg;
  ctx.fillRect(cardX, y, cardW, tableHeaderHeight);

  ctx.fillStyle = C.thText;
  ctx.font = `600 ${15 * scale}px sans-serif`;
  ctx.textBaseline = "middle";
  cols.forEach((col) => {
    // col.x 是相对于卡片左边缘的偏移
    const drawX = cardX + col.x;
    if (col.align === "left") {
      ctx.textAlign = "left";
      ctx.fillText(col.label, drawX + 20 * scale, y + tableHeaderHeight / 2);
    } else if (col.align === "right") {
      ctx.textAlign = "right";
      ctx.fillText(col.label, drawX + col.width - 12 * scale, y + tableHeaderHeight / 2);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(col.label, drawX + col.width / 2, y + tableHeaderHeight / 2);
    }
  });
  y += tableHeaderHeight;

  // ══════ 数据行 ══════
  const maxWave = rows.filter((r) => r.isLive).length > 0
    ? Math.max(...rows.filter((r) => r.isLive).map((r) => r.dailyWave))
    : 1;

  rows.forEach((row, index) => {
    const rank = index + 1;
    const isTop3 = rank <= 3;
    const isInactive = !row.isLive;

    // 行背景
    let rowBg: string;
    if (rank === 1) rowBg = C.top1Bg;
    else if (rank === 2) rowBg = C.top2Bg;
    else if (rank === 3) rowBg = C.top3Bg;
    else rowBg = C.cardBg;

    ctx.fillStyle = rowBg;
    ctx.fillRect(cardX, y, cardW, rowHeight);

    // 行底分隔线
    ctx.strokeStyle = C.borderColor;
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.moveTo(cardX, y + rowHeight);
    ctx.lineTo(cardX + cardW, y + rowHeight);
    ctx.stroke();

    // 各列
    cols.forEach((col) => {
      const drawX = cardX + col.x;
      const cy = y + rowHeight / 2;

      if (col.key === "rank") {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (isTop3) {
          let gradStart: string, gradEnd: string;
          if (rank === 1) { gradStart = C.medal1Start; gradEnd = C.medal1End; }
          else if (rank === 2) { gradStart = C.medal2Start; gradEnd = C.medal2End; }
          else { gradStart = C.medal3Start; gradEnd = C.medal3End; }

          const badgeSize = 26 * scale;
          const bx = drawX + (col.width - badgeSize) / 2;

          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
          ctx.shadowBlur = 6 * scale;
          ctx.shadowOffsetY = 2 * scale;

          const medalGrad = ctx.createLinearGradient(bx, cy - badgeSize / 2, bx + badgeSize, cy + badgeSize / 2);
          medalGrad.addColorStop(0, gradStart);
          medalGrad.addColorStop(1, gradEnd);
          ctx.fillStyle = medalGrad;
          ctx.beginPath();
          ctx.arc(bx + badgeSize / 2, cy, badgeSize / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          ctx.fillStyle = "#FFFFFF";
          ctx.font = `bold ${13 * scale}px sans-serif`;
          ctx.fillText(String(rank), drawX + col.width / 2, cy + 1 * scale);
        } else {
          ctx.fillStyle = C.textSub;
          ctx.font = `italic ${16 * scale}px Georgia, serif`;
          const rankStr = rank < 10 ? `0${rank}` : String(rank);
          ctx.fillText(rankStr, drawX + col.width / 2, cy);
        }
      } else if (col.key === "name") {
        ctx.textAlign = "left";
        ctx.fillStyle = C.textMain;
        ctx.font = `${15 * scale}px sans-serif`;
        const text = truncateCanvasText(ctx, row.name, col.width - 40 * scale);
        ctx.fillText(text, drawX + 20 * scale, cy);
      } else if (col.key === "dailyWave") {
        if (isInactive) {
          ctx.textAlign = "center";
          ctx.fillStyle = C.textDanger;
          ctx.font = `${15 * scale}px sans-serif`;
          ctx.fillText("未开播", drawX + col.width / 2, cy);
        } else {
          const barW = col.width - 40 * scale;
          const barH = 28 * scale;
          const barLeft = drawX + 20 * scale;
          const barTop = cy - barH / 2;
          const fillPercent = (row.dailyWave / maxWave) * 0.85;
          const fillW = Math.max(barW * fillPercent, 30 * scale);

          // 进度条填充
          ctx.fillStyle = C.barBg;
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, fillW, barH, barH / 2);
          ctx.fill();

          // 文字居中于整个列
          ctx.fillStyle = "#444444";
          ctx.font = `500 ${14 * scale}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(formatWave(row.dailyWave), drawX + col.width / 2, cy);
        }
      } else if (col.key === "totalWave") {
        ctx.textAlign = "center";
        ctx.font = `${15 * scale}px sans-serif`;
        ctx.fillStyle = C.totalWaveText;
        ctx.fillText(formatWave(row.totalWave), drawX + col.width / 2, cy);
      } else if (col.key === "tier") {
        if (row.tier) {
          ctx.font = `600 ${13 * scale}px sans-serif`;
          const textW = ctx.measureText(row.tier).width;
          const padX = 14 * scale;
          const bw = textW + padX * 2;
          const bh = 28 * scale;
          const bl = drawX + (col.width - bw) / 2;
          const bt = cy - bh / 2;

          ctx.fillStyle = C.badgeBg;
          ctx.beginPath();
          drawRoundRect(ctx, bl, bt, bw, bh, bh / 2);
          ctx.fill();

          ctx.fillStyle = C.badgeText;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(row.tier, drawX + col.width / 2, cy + 1 * scale);
        }
      } else if (col.key === "duration") {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const dText = row.isLive && row.dailyDuration > 0
          ? formatDurationText(row.dailyDuration)
          : "—";
        ctx.fillStyle = row.isLive && row.dailyDuration > 0 ? C.textMain : C.placeholderText;
        ctx.font = `${15 * scale}px sans-serif`;
        ctx.fillText(dText, drawX + col.width / 2, cy);
      } else if (col.key === "master") {
        ctx.textAlign = "center";
        ctx.fillStyle = C.masterText;
        ctx.font = `${15 * scale}px sans-serif`;
        const text = truncateCanvasText(ctx, row.masterName || "—", col.width - 20 * scale);
        ctx.fillText(text, drawX + col.width / 2, cy);
      }
    });

    y += rowHeight;
  });

  // ══════ 底部 ══════
  ctx.fillStyle = C.footerBg;
  ctx.fillRect(cardX, y, cardW, footerHeight);

  const footerPadX = 30 * scale;
  const colW = cardW / 3;

  // 左栏
  ctx.fillStyle = C.footerTitle;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${20 * scale}px sans-serif`;
  ctx.fillText(`${genderText}主播 ${rows.length} 人`, cardX + footerPadX, y + 30 * scale);

  ctx.font = `${13 * scale}px sans-serif`;
  ctx.fillStyle = C.footerMeta;
  ctx.fillText(`导出日期 ${formattedDate}`, cardX + footerPadX, y + 56 * scale);

  // 中栏：未开播
  if (hasInactive) {
    const centerX = cardX + colW + colW / 2;

    ctx.fillStyle = C.footerInactive;
    ctx.font = `bold ${18 * scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(`未开播 ${inactiveStreamers.length} 人`, centerX, y + 30 * scale);

    ctx.font = `${14 * scale}px sans-serif`;
    ctx.fillStyle = C.footerInactive;
    ctx.textBaseline = "top";
    inactiveLines.forEach((line, i) => {
      ctx.fillText(line, centerX, y + (50 + i * 20) * scale);
    });
    ctx.textBaseline = "middle";
  }

  ctx.restore();
}
