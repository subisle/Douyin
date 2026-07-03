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

// ── 弥散光背景（4个 radial-gradient） ──
const BG_COLORS = [
  { pos: [0.8, 0.0], color: "hsla(189,100%,75%,0.5)" },
  { pos: [0.0, 0.5], color: "hsla(340,100%,86%,0.6)" },
  { pos: [0.8, 1.0], color: "hsla(245,100%,82%,0.6)" },
  { pos: [0.0, 0.0], color: "hsla(263,100%,86%,0.6)" },
];

// ── 玻璃卡片 ──
const C = {
  bgBase: "#dfecfb",
  glassBg: "rgba(255, 255, 255, 0.85)",
  glassBorder: "rgba(255, 255, 255, 0.5)",

  textMain: "#1e293b",
  textSub: "#64748b",
  textDanger: "#ef4444",
  separator: "rgba(0, 0, 0, 0.06)",

  // 表头底色（透明 — 玻璃）
  thBg: "rgba(255, 255, 255, 0.2)",

  // 前3名徽章
  top1Grad: ["#f6d365", "#fda085"] as [string, string],
  top2Grad: ["#e2e8f0", "#94a3b8"] as [string, string],
  top3Grad: ["#fbc2eb", "#a6c1ee"] as [string, string],
  topNormalBg: "rgba(0,0,0,0.04)",
  topNormalText: "#64748b",

  // 进度条
  barGrad: ["#667eea", "#764ba2"] as [string, string],
  barTrack: "rgba(0,0,0,0.04)",
  barText: "#ffffff",

  // 趋势色
  trendUp: "#10b981",
  trendDown: "#ef4444",
  trendFlat: "#cbd5e1",

  // 等级（按首字母分色）
  levelA: { grad: ["#FF9A9E", "#FECFEF"] as [string, string], text: "#B91C1C" },
  levelB: { grad: ["#a18cd1", "#fbc2eb"] as [string, string], text: "#ffffff" },
  levelC: { grad: ["#84fab0", "#8fd3f4"] as [string, string], text: "#065F46" },
  levelD: { grad: ["#e0c3fc", "#8ec5fc"] as [string, string], text: "#3730A3" },

  // 行底色（前三名极微弱高亮）
  top1RowBg: "rgba(246, 211, 101, 0.05)",
  top2RowBg: "rgba(148, 163, 184, 0.05)",
  top3RowBg: "rgba(251, 194, 235, 0.05)",

  // 底部
  footerBg: "rgba(255, 255, 255, 0.4)",
  footerTitle: "#1e293b",
  footerSub: "#64748b",
  footerInactive: "#ef4444",
};

function getLevelStyle(level: string): { grad: [string, string]; text: string } {
  if (!level) return C.levelD as { grad: [string, string]; text: string };
  const ch = level.charAt(0).toUpperCase();
  if (ch === "A") return C.levelA as { grad: [string, string]; text: string };
  if (ch === "B") return C.levelB as { grad: [string, string]; text: string };
  if (ch === "C") return C.levelC as { grad: [string, string]; text: string };
  return C.levelD as { grad: [string, string]; text: string };
}

/* ────────────────── 列定义 ────────────────── */

export type ColumnKey = "rank" | "name" | "dailyWave" | "totalWave" | "tier" | "duration" | "master";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  minWidth: number;
  flex: number;
  align: "left" | "center" | "right";
  getText: (row: DailyReportRow, index: number) => string;
}

export const ALL_COLUMNS: { key: ColumnKey; label: string; defaultVisible: boolean }[] = [
  { key: "rank", label: "排名趋势", defaultVisible: true },
  { key: "name", label: "主播姓名", defaultVisible: true },
  { key: "dailyWave", label: "当日音浪", defaultVisible: true },
  { key: "totalWave", label: "累计总音浪", defaultVisible: true },
  { key: "tier", label: "等级", defaultVisible: true },
  { key: "duration", label: "有效时长", defaultVisible: true },
  { key: "master", label: "师傅", defaultVisible: true },
];

export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ALL_COLUMNS.map((c) => c.key);

function buildColumns(
  ctx: CanvasRenderingContext2D,
  scale: number,
  cardWidth: number,
  date: string,
  rows: DailyReportRow[],
  visibleColumns: ColumnKey[]
): (ColumnDef & { x: number; width: number })[] {
  const parts = date.split("-");
  const day = parseInt(parts[2] || "1", 10) || 1;

  const allDefs: ColumnDef[] = [
    { key: "rank", label: "排名趋势", minWidth: 130, flex: 1.2, align: "center", getText: (_, i) => String(i + 1) },
    { key: "name", label: "主播姓名", minWidth: 110, flex: 1.0, align: "left", getText: (r) => r.name },
    { key: "dailyWave", label: `${day}号音浪`, minWidth: 220, flex: 2.5, align: "center", getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播") },
    { key: "totalWave", label: "累计总音浪", minWidth: 130, flex: 1.2, align: "center", getText: (r) => formatWave(r.totalWave) },
    { key: "tier", label: "等级", minWidth: 100, flex: 0.9, align: "center", getText: (r) => r.tier || "" },
    { key: "duration", label: "有效时长", minWidth: 100, flex: 1.0, align: "center", getText: (r) => r.isLive && r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—" },
    { key: "master", label: "师傅", minWidth: 90, flex: 0.9, align: "center", getText: (r) => r.masterName || "—" },
  ];

  const defs = allDefs.filter((c) => visibleColumns.includes(c.key));
  if (defs.length === 0) defs.push(allDefs[0]);

  ctx.save();
  let widths = defs.map((col) => {
    ctx.font = `700 ${14 * scale}px sans-serif`;
    const headerW = ctx.measureText(col.label).width;
    ctx.font = `600 ${16 * scale}px sans-serif`;
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

  const result: (ColumnDef & { x: number; width: number })[] = [];
  let x = 0;
  for (let i = 0; i < defs.length; i++) {
    result.push({ ...defs[i], x, width: widths[i] });
    x += widths[i];
  }
  return result;
}

/* ────────────────── 主绘制函数 ────────────────── */

export interface DrawReportOptions {
  date: string;
  rows: DailyReportRow[];
  gender: "male" | "female";
  customTitle?: string;
  scale?: number;
  /** 需要展示的列（默认全部） */
  visibleColumns?: ColumnKey[];
  /** 各主播的升降趋势（rank 差，正=上升名次，0=不变，负=下降） */
  trends?: Record<string, number>;
  /** 标题副标题（"Data Report • 2026-07-01"） */
  subtitle?: string;
}

export function drawReportToCanvas(
  canvas: HTMLCanvasElement,
  opts: DrawReportOptions
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { date, rows, gender, customTitle = "", scale = 2, visibleColumns = DEFAULT_VISIBLE_COLUMNS, trends = {}, subtitle } = opts;

  const parts = date.split("-");
  const year = parseInt(parts[0]) || 2026;
  const month = parseInt(parts[1]) || 1;
  const day = parseInt(parts[2]) || 1;
  const formattedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const genderText = gender === "male" ? "男" : "女";
  const titleText = customTitle || "薇笑传媒主播数据统计";
  const subtitleText = subtitle || `Data Report • ${formattedDate}`;

  // ── 尺寸 ──
  const cardW = 950 * scale;
  const margin = 30 * scale; // 留出空间给弥散光
  const cornerRadius = 28 * scale;
  const containerW = cardW + margin * 2;

  const headerHeight = 100 * scale;     // 35 + 25 padding
  const tableHeaderHeight = 54 * scale;  // 18*2 padding
  const rowHeight = 60 * scale;          // 18*2 padding
  const footerHeightBase = 100 * scale;

  const inactiveStreamers = rows.filter((r) => !r.isLive);
  const hasInactive = inactiveStreamers.length > 0;

  ctx.font = `${14 * scale}px sans-serif`;
  const inactiveLines = hasInactive
    ? wrapCanvasText(ctx, inactiveStreamers.map((r) => r.name).join("、"), cardW * 0.3)
    : [];
  const footerHeight = hasInactive
    ? Math.max(footerHeightBase, (60 + inactiveLines.length * 20) * scale)
    : footerHeightBase;

  const cols = buildColumns(ctx, scale, cardW, date, rows, visibleColumns);

  const totalH = margin + headerHeight + tableHeaderHeight + rowHeight * rows.length + footerHeight + margin;

  canvas.width = containerW;
  canvas.height = totalH;

  // ══════ 弥散光背景 ══════
  ctx.fillStyle = C.bgBase;
  ctx.fillRect(0, 0, containerW, totalH);

  // 4 个 radial-gradient 弥散光
  BG_COLORS.forEach(({ pos, color }) => {
    const cx = pos[0] * containerW;
    const cy = pos[1] * totalH;
    const radius = Math.max(containerW, totalH) * 0.7;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, color.replace(/[\d.]+\)$/, "0)"));
    grad.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, containerW, totalH);
  });

  // ══════ 玻璃卡片 ══════
  const cardX = margin;
  const cardY = margin;
  const cardH = totalH - margin * 2;

  ctx.save();
  // 阴影 + inset 高光
  ctx.shadowColor = "rgba(0, 0, 0, 0.15)";
  ctx.shadowBlur = 50 * scale;
  ctx.shadowOffsetY = 25 * scale;
  ctx.fillStyle = C.glassBg;
  ctx.beginPath();
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cornerRadius);
  ctx.fill();
  ctx.restore();

  // 玻璃边框
  ctx.strokeStyle = C.glassBorder;
  ctx.lineWidth = 1 * scale;
  ctx.beginPath();
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cornerRadius);
  ctx.stroke();

  // 裁剪到卡片内部
  ctx.save();
  ctx.beginPath();
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cornerRadius);
  ctx.clip();

  let y = cardY;

  // ══════ 头部 ══════
  // 头部：透明渐变覆盖在玻璃上
  const headerGrad = ctx.createLinearGradient(cardX, y, cardX + cardW, y);
  headerGrad.addColorStop(0, "rgba(255,255,255,0.4)");
  headerGrad.addColorStop(1, "rgba(255,255,255,0.1)");
  ctx.fillStyle = headerGrad;
  ctx.fillRect(cardX, y, cardW, headerHeight);

  // 头部底部分隔
  ctx.strokeStyle = C.separator;
  ctx.lineWidth = 1 * scale;
  ctx.beginPath();
  ctx.moveTo(cardX, y + headerHeight);
  ctx.lineTo(cardX + cardW, y + headerHeight);
  ctx.stroke();

  // 标题渐变
  ctx.font = `800 ${28 * scale}px "PingFang SC", -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const titleY = y + 35 * scale;

  // 渐变文字
  const titleGrad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
  titleGrad.addColorStop(0, "#1e1b4b");
  titleGrad.addColorStop(0.5, "#4338ca");
  titleGrad.addColorStop(1, "#be185d");
  ctx.fillStyle = titleGrad;
  ctx.fillText(titleText, cardX + cardW / 2, titleY);

  // 副标题
  ctx.fillStyle = C.textSub;
  ctx.font = `500 ${14 * scale}px "PingFang SC", -apple-system, sans-serif`;
  ctx.fillText(subtitleText, cardX + cardW / 2, titleY + 28 * scale);

  y += headerHeight;

  // ══════ 表头 ══════
  ctx.fillStyle = C.thBg;
  ctx.fillRect(cardX, y, cardW, tableHeaderHeight);

  // 表头底分隔
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(cardX, y + tableHeaderHeight);
  ctx.lineTo(cardX + cardW, y + tableHeaderHeight);
  ctx.stroke();

  ctx.fillStyle = C.textSub;
  ctx.font = `700 ${14 * scale}px "PingFang SC", -apple-system, sans-serif`;
  ctx.textBaseline = "middle";
  cols.forEach((col) => {
    const drawX = cardX + col.x;
    if (col.align === "left") {
      ctx.textAlign = "left";
      ctx.fillText(col.label, drawX + 18 * scale, y + tableHeaderHeight / 2);
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

    // 行底色（前3名极微弱高亮）
    let rowBg: string | null = null;
    if (rank === 1) rowBg = C.top1RowBg;
    else if (rank === 2) rowBg = C.top2RowBg;
    else if (rank === 3) rowBg = C.top3RowBg;
    if (rowBg) {
      ctx.fillStyle = rowBg;
      ctx.fillRect(cardX, y, cardW, rowHeight);
    }

    // 行底分隔线
    ctx.strokeStyle = C.separator;
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
        // 排名徽章 + 趋势
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const badgeSize = 32 * scale;
        const badgeX = drawX + (col.width - badgeSize) / 2 - (trends[row.anchorId] !== undefined ? 16 * scale : 0);
        const badgeY = cy - badgeSize / 2;

        let grad: [string, string], textColor: string;
        if (rank === 1) { grad = C.top1Grad; textColor = "#ffffff"; }
        else if (rank === 2) { grad = C.top2Grad; textColor = "#ffffff"; }
        else if (rank === 3) { grad = C.top3Grad; textColor = "#ffffff"; }
        else { grad = [C.topNormalBg, C.topNormalBg]; textColor = C.topNormalText; }

        // 徽章阴影
        ctx.save();
        if (isTop3) {
          ctx.shadowColor = "rgba(0, 0, 0, 0.1)";
          ctx.shadowBlur = 10 * scale;
          ctx.shadowOffsetY = 4 * scale;
        }
        const gradStops = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeSize, badgeY + badgeSize);
        gradStops.addColorStop(0, grad[0]);
        gradStops.addColorStop(1, grad[1]);
        ctx.fillStyle = gradStops;
        ctx.beginPath();
        drawRoundRect(ctx, badgeX, badgeY, badgeSize, badgeSize, 0);
        ctx.fill();
        ctx.restore();

        // 排名数字
        ctx.fillStyle = textColor;
        ctx.font = `800 ${14 * scale}px "PingFang SC", -apple-system, sans-serif`;
        const rankStr = rank < 10 ? `0${rank}` : String(rank);
        ctx.fillText(rankStr, badgeX + badgeSize / 2, cy);

        // 趋势指示
        const trend = trends[row.anchorId];
        if (trend !== undefined) {
          const trendX = badgeX + badgeSize + 12 * scale;
          ctx.font = `700 ${12 * scale}px "PingFang SC", -apple-system, sans-serif`;
          ctx.textAlign = "left";
          if (trend > 0) {
            ctx.fillStyle = C.trendUp;
            ctx.fillText(`↑${trend}`, trendX, cy);
          } else if (trend < 0) {
            ctx.fillStyle = C.trendDown;
            ctx.fillText(`↓${Math.abs(trend)}`, trendX, cy);
          } else {
            ctx.fillStyle = C.trendFlat;
            ctx.fillText("-", trendX + 4 * scale, cy);
          }
        }
      } else if (col.key === "name") {
        ctx.textAlign = "left";
        ctx.fillStyle = C.textMain;
        ctx.font = `600 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
        const text = truncateCanvasText(ctx, row.name, col.width - 40 * scale);
        ctx.fillText(text, drawX + 18 * scale, cy);
      } else if (col.key === "dailyWave") {
        if (isInactive) {
          ctx.textAlign = "center";
          ctx.fillStyle = C.textDanger;
          ctx.font = `700 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
          ctx.fillText("未开播", drawX + col.width / 2, cy);
        } else {
          // 进度条
          const barW = col.width - 40 * scale;
          const barH = 32 * scale;
          const barLeft = drawX + 20 * scale;
          const barTop = cy - barH / 2;
          const fillPercent = (row.dailyWave / maxWave) * 0.85;
          const fillW = Math.max(barW * fillPercent, 30 * scale);

          // 轨道
          ctx.fillStyle = C.barTrack;
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, barW, barH, 0);
          ctx.fill();

          // 进度条
          const barGrad = ctx.createLinearGradient(barLeft, 0, barLeft + fillW, 0);
          barGrad.addColorStop(0, C.barGrad[0]);
          barGrad.addColorStop(1, C.barGrad[1]);
          ctx.fillStyle = barGrad;
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, fillW, barH, 0);
          ctx.fill();

          // 文字（用白色 + 阴影确保在深浅背景下都可见）
          ctx.fillStyle = "#ffffff";
          ctx.font = `700 ${14 * scale}px "PingFang SC", -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
          ctx.shadowBlur = 3 * scale;
          ctx.fillText(formatWave(row.dailyWave), drawX + col.width / 2, cy);
          ctx.restore();
        }
      } else if (col.key === "totalWave") {
        ctx.textAlign = "center";
        ctx.font = `600 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
        ctx.fillStyle = C.textSub;
        ctx.fillText(formatWave(row.totalWave), drawX + col.width / 2, cy);
      } else if (col.key === "tier") {
        if (row.tier) {
          const ls = getLevelStyle(row.tier);
          ctx.font = `800 ${14 * scale}px "PingFang SC", -apple-system, sans-serif`;
          const textW = ctx.measureText(row.tier).width;
          const padX = 14 * scale;
          const bw = textW + padX * 2;
          const bh = 32 * scale;
          const bl = drawX + (col.width - bw) / 2;
          const bt = cy - bh / 2;

          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0.1)";
          ctx.shadowBlur = 10 * scale;
          ctx.shadowOffsetY = 4 * scale;

          const lvlGrad = ctx.createLinearGradient(bl, bt, bl + bw, bt + bh);
          lvlGrad.addColorStop(0, ls.grad[0]);
          lvlGrad.addColorStop(1, ls.grad[1]);
          ctx.fillStyle = lvlGrad;
          ctx.beginPath();
          drawRoundRect(ctx, bl, bt, bw, bh, 0);
          ctx.fill();
          ctx.restore();

          ctx.fillStyle = ls.text;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(row.tier, drawX + col.width / 2, cy);
        }
      } else if (col.key === "duration") {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const dText = row.isLive && row.dailyDuration > 0
          ? formatDurationText(row.dailyDuration)
          : "—";
        ctx.fillStyle = row.isLive && row.dailyDuration > 0 ? C.textMain : C.textSub;
        ctx.font = `600 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
        ctx.fillText(dText, drawX + col.width / 2, cy);
      } else if (col.key === "master") {
        ctx.textAlign = "center";
        ctx.fillStyle = C.textSub;
        ctx.font = `600 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
        const text = truncateCanvasText(ctx, row.masterName || "—", col.width - 20 * scale);
        ctx.fillText(text, drawX + col.width / 2, cy);
      }
    });

    y += rowHeight;
  });

  // ══════ 底部 ══════
  const footerGrad = ctx.createLinearGradient(cardX, y, cardX + cardW, y + footerHeight);
  footerGrad.addColorStop(0, "rgba(255, 255, 255, 0.4)");
  footerGrad.addColorStop(1, "rgba(255, 255, 255, 0.2)");
  ctx.fillStyle = footerGrad;
  ctx.fillRect(cardX, y, cardW, footerHeight);

  ctx.strokeStyle = C.separator;
  ctx.lineWidth = 1 * scale;
  ctx.beginPath();
  ctx.moveTo(cardX, y);
  ctx.lineTo(cardX + cardW, y);
  ctx.stroke();

  const footerPadX = 32 * scale;

  // 左栏：人数 + 导出日期
  ctx.fillStyle = C.footerTitle;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${18 * scale}px "PingFang SC", -apple-system, sans-serif`;
  ctx.fillText(`${genderText}主播 ${rows.length} 人`, cardX + footerPadX, y + 38 * scale);

  ctx.font = `600 ${13 * scale}px "PingFang SC", -apple-system, sans-serif`;
  ctx.fillStyle = C.footerSub;
  ctx.fillText(`导出日期 ${formattedDate}`, cardX + footerPadX, y + 62 * scale);

  // 中栏：未开播
  if (hasInactive) {
    const centerX = cardX + cardW / 2;
    ctx.fillStyle = C.footerInactive;
    ctx.textAlign = "center";
    ctx.font = `800 ${18 * scale}px "PingFang SC", -apple-system, sans-serif`;
    ctx.fillText(`未开播 ${inactiveStreamers.length} 人`, centerX, y + 38 * scale);

    ctx.font = `600 ${13 * scale}px "PingFang SC", -apple-system, sans-serif`;
    ctx.fillStyle = C.footerInactive;
    ctx.textBaseline = "top";
    inactiveLines.forEach((line, i) => {
      ctx.fillText(line, centerX, y + (54 + i * 20) * scale);
    });
    ctx.textBaseline = "alphabetic";
  }

  // 右栏：占位 100px
  const rightX = cardX + cardW - footerPadX - 100 * scale;

  ctx.restore();
}
