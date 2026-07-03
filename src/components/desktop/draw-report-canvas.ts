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
    { key: "rank", label: "序号", minWidth: 72, flex: 0.7, align: "center", getText: (_, i) => String(i + 1) },
    { key: "name", label: "主播姓名", minWidth: 150, flex: 1.6, align: "left", getText: (r) => r.name },
    { key: "dailyWave", label: `${day}号音浪`, minWidth: 180, flex: 2.1, align: "right", getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播") },
    { key: "totalWave", label: "累计总音浪", minWidth: 160, flex: 1.5, align: "right", getText: (r) => formatWave(r.totalWave) },
    { key: "tier", label: "等级", minWidth: 96, flex: 1, align: "center", getText: (r) => r.tier || "" },
    { key: "duration", label: "有效时长", minWidth: 130, flex: 1.3, align: "center", getText: (r) => r.isLive && r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—" },
    { key: "master", label: "师傅", minWidth: 100, flex: 1.1, align: "left", getText: (r) => r.masterName || "—" },
  ];

  ctx.save();
  let widths = defs.map((col) => {
    ctx.font = `bold ${14 * scale}px sans-serif`;
    const headerW = ctx.measureText(col.label).width;
    ctx.font = `${14 * scale}px sans-serif`;
    const sampleW = rows.slice(0, 12).reduce((max, r, i) => Math.max(max, ctx.measureText(col.getText(r, i)).width), 0);
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
  return defs.map((col, i) => ({ ...col, x, width: widths[i] }));
}

/* ═══════════════════════════════════════════════════════════════
 *  配色规范 — 深紫蓝主色 + 淡薰衣草表头 + 暖白卡片
 * ═══════════════════════════════════════════════════════════════ */

const C = {
  // 外背景
  bg: "#F0EEF8",
  // 卡片底
  cardBg: "#FFFFFF",

  // ── 头部 ──
  // 深紫蓝色渐变
  titleGradStart: "#1E1B4B",   // 深邃
  titleGradEnd: "#312E81",     // 略浅
  // 装饰条 — 亮紫色
  decoColor: "#A78BFA",

  // ── 表头 ──
  // 极浅淡紫色/薰衣草色
  headerBg: "#EDE9FE",
  headerBorder: "#C4B5FD",
  // 深紫蓝色文字
  headerText: "#3730A3",

  // ── 数据行 ──
  // 斑马纹
  rowOdd: "#FFFFFF",
  rowEven: "#F8F7FC",
  rowBorder: "#E9E7F4",

  // 前3名行底色
  rank1Bg: "#FEF9C3",   // 浅黄
  rank2Bg: "#F1F5F9",   // 极浅蓝灰
  rank3Bg: "#FFEDD5",   // 浅橙

  // 前3名左侧竖线 — 粗壮
  rank1Stripe: "#F59E0B",   // 亮橙金
  rank2Stripe: "#475569",   // 深蓝灰
  rank3Stripe: "#C2410C",   // 深橙土黄

  // 前3名圆形徽章
  medal1GradStart: "#F59E0B",
  medal1GradEnd: "#FBBF24",
  medal2GradStart: "#475569",
  medal2GradEnd: "#64748B",
  medal3GradStart: "#C2410C",
  medal3GradEnd: "#EA580C",

  // 常规序号 — 深紫色
  rankNormalText: "#7C3AED",

  // ── 文字 ──
  nameText: "#1F2937",      // 深灰/炭黑
  nameTopText: "#1F2937",   // 前3名姓名也用炭黑
  waveText: "#1F2937",      // 正常音浪数字
  waveInactive: "#DC2626",  // 未开播 — 醒目红色
  totalWaveText: "#4B5563", // 累计总音浪 — 深灰
  masterText: "#4B5563",    // 师傅 — 深灰
  // 占位符 — 深紫色
  placeholderText: "#6D28D9",

  // ── 音浪进度条 ──
  waveTrackBg: "#E9E7F4",
  waveBarGradStart: "#6366F1",
  waveBarGradEnd: "#A78BFA",

  // ── 底部 ──
  footerBg: "#EDE9FE",       // 淡薰衣草（与表头呼应）
  footerBorder: "#C4B5FD",
  footerTitle: "#1E1B4B",
  footerMeta: "#6B7280",
  footerInactive: "#DC2626",
  footerInactiveText: "#991B1B",
};

// 等级徽章 — 胶囊勋章
const TIER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  A: { bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.35)", text: "#059669" },
  B: { bg: "rgba(79, 70, 229, 0.12)", border: "rgba(79, 70, 229, 0.35)", text: "#4338CA" },
  C: { bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.35)", text: "#B45309" },
  D: { bg: "rgba(239, 68, 68, 0.10)", border: "rgba(239, 68, 68, 0.30)", text: "#B91C1C" },
};

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
  const titleText = customTitle || `${genderText}主播数据统计`;
  const subtitleText = formattedDate;

  const margin = 16 * scale;
  const tablePaddingX = 24 * scale;
  const headerHeight = 64 * scale;
  const tableHeaderHeight = 36 * scale;
  const rowHeight = 42 * scale;
  const footerHeightBase = 72 * scale;
  const inactiveStreamers = rows.filter((r) => !r.isLive);
  const hasInactive = inactiveStreamers.length > 0;
  const cornerRadius = 16 * scale;
  const stripeW = 5 * scale; // 前3名左侧粗竖线

  // 计算容器宽度
  ctx.font = `bold ${24 * scale}px sans-serif`;
  const titleW = ctx.measureText(titleText).width;
  const estCols = buildColumns(ctx, scale, 760 * scale, date, rows);
  const estW = estCols.reduce((s, c) => s + c.width, 0);
  const containerW = Math.max(
    680 * scale,
    Math.min(1000 * scale, Math.max(titleW + 120 * scale, estW + tablePaddingX * 2))
  );

  ctx.font = `${11 * scale}px sans-serif`;
  const inactiveLines = hasInactive
    ? wrapCanvasText(ctx, inactiveStreamers.map((r) => r.name).join("、"), containerW / 2 - 48 * scale)
    : [];
  const footerHeight = hasInactive
    ? Math.max(footerHeightBase, (56 + inactiveLines.length * 18) * scale + 24 * scale)
    : footerHeightBase;

  const cols = buildColumns(ctx, scale, containerW - tablePaddingX * 2 - margin * 2, date, rows);
  const innerW = containerW - margin * 2;
  const totalH = margin + headerHeight + tableHeaderHeight + rowHeight * rows.length + footerHeight + margin;

  canvas.width = containerW;
  canvas.height = totalH;

  // ── 外背景 ──
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, containerW, totalH);

  // ── 卡片外框 ──
  const cardX = margin;
  const cardY = margin;
  const cardW = innerW;
  const cardH = totalH - margin * 2;

  ctx.save();
  ctx.shadowColor = "rgba(30, 27, 75, 0.08)";
  ctx.shadowBlur = 12 * scale;
  ctx.shadowOffsetY = 4 * scale;
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

  // ══════ 头部区域 ══════
  // 深紫蓝色渐变背景
  const titleGrad = ctx.createLinearGradient(0, y, 0, y + headerHeight);
  titleGrad.addColorStop(0, C.titleGradStart);
  titleGrad.addColorStop(1, C.titleGradEnd);
  ctx.fillStyle = titleGrad;
  ctx.fillRect(cardX, y, cardW, headerHeight);

  // 左侧粗壮亮紫色竖线
  ctx.fillStyle = C.decoColor;
  const decoX = cardX + tablePaddingX;
  const decoH = headerHeight * 0.5;
  ctx.fillRect(decoX, y + (headerHeight - decoH) / 2, stripeW, decoH);

  // 主标题 — 纯白色，大字号，粗体
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${24 * scale}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(titleText, decoX + stripeW + 14 * scale, y + headerHeight * 0.36);

  // 副标题日期 — 浅灰色，小字号
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.font = `${13 * scale}px sans-serif`;
  ctx.fillText(subtitleText, decoX + stripeW + 14 * scale, y + headerHeight * 0.68);

  // 右上角半透明深色胶囊标签
  ctx.font = `bold ${13 * scale}px sans-serif`;
  const countText = `共 ${rows.length} 人`;
  const countW = ctx.measureText(countText).width + 28 * scale;
  const countH = 28 * scale;
  const countX = cardX + cardW - tablePaddingX - countW;
  const countY = y + (headerHeight - countH) / 2;
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.beginPath();
  drawRoundRect(ctx, countX, countY, countW, countH, countH / 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.textAlign = "center";
  ctx.fillText(countText, countX + countW / 2, countY + countH / 2);

  y += headerHeight;

  // ══════ 表头 ══════
  // 极浅淡紫色背景
  ctx.fillStyle = C.headerBg;
  ctx.fillRect(cardX, y, cardW, tableHeaderHeight);
  // 底部强调线
  ctx.fillStyle = C.headerBorder;
  ctx.fillRect(cardX, y + tableHeaderHeight - 2 * scale, cardW, 2 * scale);

  // 深紫蓝色粗体文字
  ctx.fillStyle = C.headerText;
  ctx.font = `bold ${13 * scale}px sans-serif`;
  ctx.textBaseline = "middle";
  cols.forEach((col) => {
    const drawX = cardX + tablePaddingX + col.x;
    if (col.align === "left") {
      ctx.textAlign = "left";
      ctx.fillText(col.label, drawX + 10 * scale, y + tableHeaderHeight / 2);
    } else if (col.align === "right") {
      ctx.textAlign = "right";
      ctx.fillText(col.label, drawX + col.width - 10 * scale, y + tableHeaderHeight / 2);
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

    // ── 行背景 ──
    let rowBg: string;
    if (rank === 1) rowBg = C.rank1Bg;        // 浅黄
    else if (rank === 2) rowBg = C.rank2Bg;    // 极浅蓝灰
    else if (rank === 3) rowBg = C.rank3Bg;    // 浅橙
    else rowBg = index % 2 === 0 ? C.rowOdd : C.rowEven;  // 斑马纹

    ctx.fillStyle = rowBg;
    ctx.fillRect(cardX, y, cardW, rowHeight);

    // 行分隔线
    ctx.strokeStyle = C.rowBorder;
    ctx.lineWidth = 0.5 * scale;
    ctx.beginPath();
    ctx.moveTo(cardX, y);
    ctx.lineTo(cardX + cardW, y);
    ctx.stroke();

    // ── 前3名左侧粗壮竖线 ──
    if (isTop3) {
      let stripeColor: string;
      if (rank === 1) stripeColor = C.rank1Stripe;
      else if (rank === 2) stripeColor = C.rank2Stripe;
      else stripeColor = C.rank3Stripe;
      ctx.fillStyle = stripeColor;
      ctx.fillRect(cardX, y, stripeW, rowHeight);
    }

    // ── 各列绘制 ──
    cols.forEach((col) => {
      const drawX = cardX + tablePaddingX + col.x;
      const cy = y + rowHeight / 2;

      if (col.key === "rank") {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (isTop3) {
          // 实心渐变圆形徽章
          let gradStart: string, gradEnd: string;
          if (rank === 1) { gradStart = C.medal1GradStart; gradEnd = C.medal1GradEnd; }
          else if (rank === 2) { gradStart = C.medal2GradStart; gradEnd = C.medal2GradEnd; }
          else { gradStart = C.medal3GradStart; gradEnd = C.medal3GradEnd; }

          const medalSize = 28 * scale;
          const mx = drawX + (col.width - medalSize) / 2;

          const medalGrad = ctx.createLinearGradient(mx, cy - medalSize / 2, mx, cy + medalSize / 2);
          medalGrad.addColorStop(0, gradStart);
          medalGrad.addColorStop(1, gradEnd);
          ctx.fillStyle = medalGrad;
          ctx.beginPath();
          ctx.arc(mx + medalSize / 2, cy, medalSize / 2, 0, Math.PI * 2);
          ctx.fill();

          // 白色数字
          ctx.fillStyle = "#FFFFFF";
          ctx.font = `bold ${14 * scale}px sans-serif`;
          ctx.fillText(String(rank), drawX + col.width / 2, cy + 1 * scale);
        } else {
          // 常规行 — 浅灰色两位数，无圆形背景
          ctx.fillStyle = "#9CA3AF";
          ctx.font = `bold ${14 * scale}px sans-serif`;
          ctx.fillText(String(rank).padStart(2, "0"), drawX + col.width / 2, cy);
        }
      } else if (col.key === "name") {
        // 深灰/炭黑色
        ctx.textAlign = "left";
        ctx.fillStyle = C.nameText;
        ctx.font = `${isTop3 ? "bold " : ""}${15 * scale}px sans-serif`;
        const text = truncateCanvasText(ctx, row.name, col.width - 24 * scale);
        ctx.fillText(text, drawX + 10 * scale, cy);
      } else if (col.key === "dailyWave") {
        if (!isInactive) {
          // 进度条
          const barAreaW = col.width - 28 * scale;
          const barH = 16 * scale;
          const barTop = cy - barH / 2;
          const barLeft = drawX + 8 * scale;

          ctx.fillStyle = C.waveTrackBg;
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, barAreaW, barH, barH / 2);
          ctx.fill();

          const barW = Math.max((barAreaW * row.dailyWave) / maxWave, 20 * scale);
          const barGrad = ctx.createLinearGradient(barLeft, 0, barLeft + barW, 0);
          barGrad.addColorStop(0, C.waveBarGradStart);
          barGrad.addColorStop(1, C.waveBarGradEnd);
          ctx.fillStyle = barGrad;
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, Math.min(barW, barAreaW), barH, barH / 2);
          ctx.fill();
        }
        // 未开播 — 全部红色加粗
        ctx.textAlign = "right";
        ctx.font = `bold ${14 * scale}px monospace`;
        ctx.fillStyle = isInactive ? C.waveInactive : C.waveText;
        ctx.fillText(isInactive ? "未开播" : formatWave(row.dailyWave), drawX + col.width - 10 * scale, cy);
      } else if (col.key === "totalWave") {
        // 深灰色
        ctx.textAlign = "right";
        ctx.font = `${14 * scale}px monospace`;
        ctx.fillStyle = C.totalWaveText;
        ctx.fillText(formatWave(row.totalWave), drawX + col.width - 10 * scale, cy);
      } else if (col.key === "tier") {
        if (row.tier) {
          // 胶囊勋章
          const bw = Math.min(col.width - 16 * scale, 60 * scale);
          const bh = 24 * scale;
          const bl = drawX + (col.width - bw) / 2;
          const bt = cy - bh / 2;
          const tierLetter = (row.tier.charAt(0) || "D").toUpperCase();
          const tc = TIER_COLORS[tierLetter] || TIER_COLORS.D;

          ctx.fillStyle = tc.bg;
          ctx.beginPath();
          drawRoundRect(ctx, bl, bt, bw, bh, bh / 2);
          ctx.fill();

          ctx.strokeStyle = tc.border;
          ctx.lineWidth = 1 * scale;
          ctx.beginPath();
          drawRoundRect(ctx, bl, bt, bw, bh, bh / 2);
          ctx.stroke();

          ctx.fillStyle = tc.text;
          ctx.font = `bold ${13 * scale}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(row.tier, drawX + col.width / 2, cy + 1 * scale);
        }
      } else if (col.key === "duration") {
        // 空数据 — 深紫色 "—"
        ctx.textAlign = "center";
        const dText = row.isLive && row.dailyDuration > 0
          ? formatDurationText(row.dailyDuration)
          : "—";
        ctx.fillStyle = row.isLive && row.dailyDuration > 0 ? C.placeholderText : C.placeholderText;
        ctx.font = `${13 * scale}px sans-serif`;
        ctx.fillText(dText, drawX + col.width / 2, cy);
      } else if (col.key === "master") {
        // 深灰色
        ctx.textAlign = "left";
        ctx.fillStyle = C.masterText;
        ctx.font = `${13 * scale}px sans-serif`;
        const text = truncateCanvasText(ctx, row.masterName || "—", col.width - 24 * scale);
        ctx.fillText(text, drawX + 10 * scale, cy);
      }
    });

    y += rowHeight;
  });

  // ══════ 底部 ══════
  // 淡薰衣草底色（与表头呼应）
  ctx.fillStyle = C.footerBg;
  ctx.fillRect(cardX, y, cardW, footerHeight);
  ctx.fillStyle = C.footerBorder;
  ctx.fillRect(cardX, y, cardW, 1.5 * scale);

  // 左侧：人数
  ctx.fillStyle = C.footerTitle;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${16 * scale}px sans-serif`;
  ctx.fillText(`${genderText}主播 ${rows.length} 人`, cardX + tablePaddingX, y + 28 * scale);

  ctx.font = `${11 * scale}px sans-serif`;
  ctx.fillStyle = C.footerMeta;
  ctx.fillText(`导出日期 ${formattedDate}`, cardX + tablePaddingX, y + 50 * scale);

  // 右侧：未开播
  if (hasInactive) {
    const rightX = cardX + cardW / 2;

    ctx.fillStyle = C.footerInactive;
    ctx.font = `bold ${13 * scale}px sans-serif`;
    ctx.fillText(`未开播 ${inactiveStreamers.length} 人`, rightX, y + 24 * scale);

    ctx.font = `${11 * scale}px sans-serif`;
    ctx.fillStyle = C.footerInactiveText;
    ctx.textBaseline = "top";
    inactiveLines.forEach((line, i) => {
      ctx.fillText(line, rightX, y + (42 + i * 16) * scale);
    });
    ctx.textBaseline = "middle";
  }

  ctx.restore();
}
