import type { DailyReportRow } from "@/types/electron";
import { formatWave } from "./format";

/* ═══════════════════════════════════════════════════════════════
 *  Kawaii Minimal 糖果色配色系统
 *  Candy Color Palette — 高明度、中饱和度、温暖治愈
 * ═══════════════════════════════════════════════════════════════ */

const K = {
  // ── 主色调 ──
  pink:          "#FFB6D9",
  pinkLight:     "#FFDBE9",
  purple:        "#E6D5FF",
  purpleLight:   "#F5EDFF",
  green:         "#D4F1D4",
  greenLight:    "#E8F8E8",
  yellow:        "#FFF9E6",
  cream:         "#FFF9F5",

  // ── 中性色 ──
  textDark:      "#333333",
  textMedium:    "#666666",
  textLight:     "#999999",
  bgWhite:       "#FFFFFF",
  bgCream:       "#FFF9F5",
  bgGray:        "#F8F9FA",

  // ── 渐变端点 ──
  gradPrimary:   ["#FFB6D9", "#E6D5FF"] as [string, string],
  gradSecondary: ["#FFB6D9", "#D4F1D4"] as [string, string],
  gradRainbow:   ["#FFB6D9", "#E6D5FF", "#D4F1D4"] as [string, string, string],

  // ── 阴影色（粉色调） ──
  shadowPink:    "rgba(255, 182, 217, 0.25)",
  shadowPurple:  "rgba(230, 213, 255, 0.20)",
  shadowGreen:   "rgba(212, 241, 212, 0.15)",

  // ── 圆角 ──
  radiusSm:      16,
  radiusMd:      24,
  radiusLg:      32,
  radiusPill:    9999,

  // ── 特殊色 ──
  danger:        "#FF6B6B",
  dangerLight:   "#FFDBE9",
  separator:     "rgba(255, 182, 217, 0.12)",

  // ── 等级色（糖果色系） ──
  levelA: { grad: ["#FFB6D9", "#FF8FAB"] as [string, string], text: "#FFFFFF" },
  levelB: { grad: ["#E6D5FF", "#C8A2E8"] as [string, string], text: "#FFFFFF" },
  levelC: { grad: ["#D4F1D4", "#8FE38F"] as [string, string], text: "#2D5F2D" },
  levelD: { grad: ["#FFF9E6", "#FFE89A"] as [string, string], text: "#8B6914" },

  // ── 前三名行底色 ──
  top1RowBg: "rgba(255, 182, 217, 0.08)",
  top2RowBg: "rgba(230, 213, 255, 0.08)",
  top3RowBg: "rgba(212, 241, 212, 0.08)",

  // ── 趋势色 ──
  trendUp:   "#10B981",
  trendDown: "#FF6B6B",
  trendFlat: "#CBD5E1",

  // ── 进度条 ──
  barGrad: ["#FFB6D9", "#E6D5FF"] as [string, string],
  barTrack: "rgba(255, 182, 217, 0.08)",
  barText:  "#FFFFFF",
};

function getLevelStyle(level: string): { grad: [string, string]; text: string } {
  if (!level) return K.levelD;
  const ch = level.charAt(0).toUpperCase();
  if (ch === "A") return K.levelA;
  if (ch === "B") return K.levelB;
  if (ch === "C") return K.levelC;
  return K.levelD;
}

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
  text.split("、").forEach((seg) => {
    const next = current ? `${current}、${seg}` : seg;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      return;
    }
    if (current) { lines.push(current); current = ""; }
    if (ctx.measureText(seg).width <= maxWidth) { current = seg; return; }
    let chunk = "";
    for (const ch of seg) {
      const nxt = chunk + ch;
      if (ctx.measureText(nxt).width > maxWidth && chunk) {
        lines.push(chunk); chunk = ch;
      } else { chunk = nxt; }
    }
    current = chunk;
  });
  if (current) lines.push(current);
  return lines;
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
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
 *  可爱奖杯 — 糖果色版
 * ═══════════════════════════════════════════════════════════════ */

function drawTrophy(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  size: number,
  mainColor: string, accentColor: string,
  scale: number
) {
  const s = size;
  const lw = 1.8 * scale;

  ctx.save();
  ctx.translate(cx, cy);

  // ── 柔和阴影 ──
  ctx.shadowColor = K.shadowPink;
  ctx.shadowBlur = 8 * scale;
  ctx.shadowOffsetY = 3 * scale;

  // ── 杯身（贝塞尔曲线） ──
  const cupTopW = s * 0.50;
  const cupMidW = s * 0.40;
  const cupBotW = s * 0.34;
  const cupH    = s * 0.38;
  const cupTop  = -s * 0.12;

  const cupGrad = ctx.createLinearGradient(0, cupTop, 0, cupTop + cupH);
  cupGrad.addColorStop(0, mainColor);
  cupGrad.addColorStop(1, accentColor);
  ctx.fillStyle = cupGrad;

  ctx.beginPath();
  ctx.moveTo(-cupTopW / 2, cupTop);
  ctx.bezierCurveTo(
    -cupTopW / 2 - s * 0.03, cupTop + cupH * 0.25,
    -cupMidW / 2 - s * 0.02, cupTop + cupH * 0.55,
    -cupBotW / 2, cupTop + cupH
  );
  ctx.lineTo(cupBotW / 2, cupTop + cupH);
  ctx.bezierCurveTo(
    cupMidW / 2 + s * 0.02, cupTop + cupH * 0.55,
    cupTopW / 2 + s * 0.03, cupTop + cupH * 0.25,
    cupTopW / 2, cupTop
  );
  ctx.closePath();
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ── 高光 ──
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(-cupTopW / 2 + s * 0.04, cupTop + s * 0.04);
  ctx.bezierCurveTo(
    -cupTopW / 2 + s * 0.02, cupTop + cupH * 0.35,
    -cupBotW / 2 + s * 0.03, cupTop + cupH - s * 0.04,
    -cupBotW / 2 + s * 0.12, cupTop + cupH - s * 0.02
  );
  ctx.lineTo(-cupBotW / 2 + s * 0.08, cupTop + cupH - s * 0.02);
  ctx.bezierCurveTo(
    -cupTopW / 2 + s * 0.05, cupTop + cupH * 0.35,
    -cupTopW / 2 + s * 0.07, cupTop + s * 0.06,
    -cupTopW / 2 + s * 0.09, cupTop + s * 0.03
  );
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // ── 杯口描边 ──
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = lw * 0.7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-cupTopW / 2, cupTop);
  ctx.bezierCurveTo(
    -cupTopW / 2 - s * 0.03, cupTop + cupH * 0.25,
    -cupMidW / 2 - s * 0.02, cupTop + cupH * 0.55,
    -cupBotW / 2, cupTop + cupH
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cupTopW / 2, cupTop);
  ctx.bezierCurveTo(
    cupTopW / 2 + s * 0.03, cupTop + cupH * 0.25,
    cupMidW / 2 + s * 0.02, cupTop + cupH * 0.55,
    cupBotW / 2, cupTop + cupH
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-cupTopW / 2 + s * 0.02, cupTop);
  ctx.lineTo(cupTopW / 2 - s * 0.02, cupTop);
  ctx.stroke();

  // ── 把手 ──
  const handR  = s * 0.15;
  const handCy = cupTop + cupH * 0.38;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(-cupTopW / 2 + s * 0.01, handCy, handR, -Math.PI * 0.55, Math.PI * 0.25, true);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cupTopW / 2 - s * 0.01, handCy, handR, -Math.PI * 0.25, Math.PI * 0.55, true);
  ctx.stroke();

  // ── 底座（两层，大圆角） ──
  const baseTopW = s * 0.46;
  const baseBotW = s * 0.54;
  const baseH    = s * 0.11;
  const baseY    = cupTop + cupH + s * 0.01;

  const baseGrad = ctx.createLinearGradient(0, baseY, 0, baseY + baseH);
  baseGrad.addColorStop(0, mainColor);
  baseGrad.addColorStop(1, accentColor);
  ctx.fillStyle = baseGrad;

  ctx.beginPath();
  drawRoundRect(ctx, -baseTopW / 2, baseY, baseTopW, baseH * 0.5, s * 0.025);
  ctx.fill();
  ctx.beginPath();
  drawRoundRect(ctx, -baseBotW / 2, baseY + baseH * 0.45, baseBotW, baseH * 0.55, s * 0.025);
  ctx.fill();

  ctx.globalAlpha = 0.20;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  drawRoundRect(ctx, -baseTopW / 2 + s * 0.03, baseY + s * 0.01, baseTopW * 0.35, baseH * 0.30, s * 0.01);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = lw * 0.4;
  ctx.beginPath();
  drawRoundRect(ctx, -baseTopW / 2, baseY, baseTopW, baseH * 0.5, s * 0.025);
  ctx.stroke();
  ctx.beginPath();
  drawRoundRect(ctx, -baseBotW / 2, baseY + baseH * 0.45, baseBotW, baseH * 0.55, s * 0.025);
  ctx.stroke();

  // ── 台座 ──
  const pedW = s * 0.30;
  const pedH = s * 0.05;
  const pedY = baseY + baseH + s * 0.01;
  ctx.fillStyle = accentColor;
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  drawRoundRect(ctx, -pedW / 2, pedY, pedW, pedH, s * 0.02);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  ctx.restore();
}

/* ═══════════════════════════════════════════════════════════════
 *  可爱装饰元素
 * ═══════════════════════════════════════════════════════════════ */

// 画一个小星星 ✨
function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  size: number, color: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;

  // 四角星
  const spikes = 4;
  const outerR = size;
  const innerR = size * 0.3;

  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / spikes) * i - Math.PI / 2;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// 画一个圆点装饰
function drawDot(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number, color: string, alpha: number = 0.3
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
  { key: "rank",      label: "排名趋势",  defaultVisible: true },
  { key: "name",      label: "主播姓名",  defaultVisible: true },
  { key: "dailyWave", label: "当日音浪",  defaultVisible: true },
  { key: "totalWave", label: "累计总音浪", defaultVisible: true },
  { key: "tier",      label: "等级",      defaultVisible: true },
  { key: "duration",  label: "有效时长",  defaultVisible: true },
  { key: "master",    label: "师傅",      defaultVisible: true },
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
    { key: "rank",      label: "排名趋势",       minWidth: 130, flex: 1.2, align: "center", getText: (_, i) => String(i + 1) },
    { key: "name",      label: "主播姓名",       minWidth: 110, flex: 1.0, align: "left",   getText: (r) => r.name },
    { key: "dailyWave", label: `${day}号音浪`,    minWidth: 220, flex: 2.5, align: "center", getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播") },
    { key: "totalWave", label: "累计总音浪",     minWidth: 130, flex: 1.2, align: "center", getText: (r) => formatWave(r.totalWave) },
    { key: "tier",      label: "等级",           minWidth: 100, flex: 0.9, align: "center", getText: (r) => r.tier || "" },
    { key: "duration",  label: "有效时长",       minWidth: 100, flex: 1.0, align: "center", getText: (r) => r.isLive && r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—" },
    { key: "master",    label: "师傅",           minWidth: 90,  flex: 0.9, align: "center", getText: (r) => r.masterName || "—" },
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

/* ═══════════════════════════════════════════════════════════════
 *  主绘制函数 — Kawaii Minimal 风格
 * ═══════════════════════════════════════════════════════════════ */

export interface DrawReportOptions {
  date: string;
  rows: DailyReportRow[];
  gender: "male" | "female";
  customTitle?: string;
  scale?: number;
  visibleColumns?: ColumnKey[];
  trends?: Record<string, number>;
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
  const year  = parseInt(parts[0]) || 2026;
  const month = parseInt(parts[1]) || 1;
  const day   = parseInt(parts[2]) || 1;
  const formattedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const genderText  = gender === "male" ? "男" : "女";
  const titleText   = customTitle || "薇笑传媒主播数据统计";
  const subtitleText = subtitle || `Data Report • ${formattedDate}`;

  // ── 尺寸 ──
  const cardW       = 950 * scale;
  const margin      = 30 * scale;
  const cornerRadius = K.radiusLg * scale;  // 32px 超大圆角
  const containerW  = cardW + margin * 2;

  const headerHeight      = 110 * scale;
  const tableHeaderHeight = 54 * scale;
  const rowHeight         = 62 * scale;
  const footerHeightBase  = 110 * scale;

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

  canvas.width  = containerW;
  canvas.height = totalH;

  // ═════════════════════════════════════════════════════════════
  //  1. 背景 — 奶油白 → 淡粉 柔和渐变
  // ═════════════════════════════════════════════════════════════
  const bgGrad = ctx.createLinearGradient(0, 0, 0, totalH);
  bgGrad.addColorStop(0, K.bgWhite);
  bgGrad.addColorStop(0.5, K.bgCream);
  bgGrad.addColorStop(1, K.pinkLight);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, containerW, totalH);

  // 装饰圆点（散落糖果色圆点）
  drawDot(ctx, margin + cardW * 0.05, margin * 0.5, 12 * scale, K.pink, 0.15);
  drawDot(ctx, containerW - margin - cardW * 0.08, margin * 0.6, 8 * scale, K.purple, 0.20);
  drawDot(ctx, margin + cardW * 0.02, totalH - margin * 0.7, 10 * scale, K.green, 0.15);
  drawDot(ctx, containerW - margin - cardW * 0.04, totalH - margin * 0.5, 6 * scale, K.yellow.replace("#", ""), 0.25);
  drawDot(ctx, containerW * 0.5, totalH - margin * 0.3, 5 * scale, K.pink, 0.20);

  // 小星星装饰
  drawStar(ctx, margin * 1.5, margin * 1.8, 8 * scale, K.pink);
  drawStar(ctx, containerW - margin * 1.5, margin * 1.5, 6 * scale, K.purple);
  drawStar(ctx, containerW - margin * 2, totalH - margin * 1.5, 7 * scale, K.green);

  // ═════════════════════════════════════════════════════════════
  //  2. 主卡片 — 纯白 + 超大圆角 + 柔和粉色阴影
  // ═════════════════════════════════════════════════════════════
  const cardX = margin;
  const cardY = margin;
  const cardH = totalH - margin * 2;

  ctx.save();
  ctx.shadowColor = K.shadowPink;
  ctx.shadowBlur = 40 * scale;
  ctx.shadowOffsetY = 12 * scale;
  ctx.fillStyle = K.bgWhite;
  ctx.beginPath();
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cornerRadius);
  ctx.fill();
  ctx.restore();

  // 渐变边框（彩虹色细边）
  ctx.save();
  ctx.beginPath();
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cornerRadius);
  ctx.clip();

  // 顶部彩虹条
  const rainbowGrad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
  rainbowGrad.addColorStop(0,    K.pink);
  rainbowGrad.addColorStop(0.33, K.purple);
  rainbowGrad.addColorStop(0.66, K.green);
  rainbowGrad.addColorStop(1,    K.yellow);
  ctx.fillStyle = rainbowGrad;
  ctx.fillRect(cardX, cardY, cardW, 6 * scale);

  ctx.restore();

  // 裁剪到卡片内部
  ctx.save();
  ctx.beginPath();
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, cornerRadius);
  ctx.clip();

  let y = cardY + 6 * scale;  // 跳过彩虹条

  // ═════════════════════════════════════════════════════════════
  //  3. 头部 — 渐变标题 + 副标题
  // ═════════════════════════════════════════════════════════════
  const headerGrad = ctx.createLinearGradient(cardX, y, cardX + cardW, y);
  headerGrad.addColorStop(0, K.pinkLight);
  headerGrad.addColorStop(0.5, K.purpleLight);
  headerGrad.addColorStop(1, K.greenLight);
  ctx.fillStyle = headerGrad;
  ctx.fillRect(cardX, y, cardW, headerHeight);

  // 头部分隔线（柔和粉色）
  ctx.strokeStyle = K.separator;
  ctx.lineWidth = 1 * scale;
  ctx.beginPath();
  ctx.moveTo(cardX + 20 * scale, y + headerHeight);
  ctx.lineTo(cardX + cardW - 20 * scale, y + headerHeight);
  ctx.stroke();

  // 装饰小圆点（头部内）
  drawDot(ctx, cardX + cardW * 0.15, y + headerHeight * 0.3, 4 * scale, K.pink, 0.4);
  drawDot(ctx, cardX + cardW * 0.85, y + headerHeight * 0.7, 3 * scale, K.purple, 0.4);

  // 主标题 — 粉紫渐变文字
  ctx.font = `800 ${30 * scale}px "PingFang SC", -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const titleY = y + 42 * scale;

  const titleGrad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
  titleGrad.addColorStop(0,    "#FF8FAB");
  titleGrad.addColorStop(0.5,  "#C8A2E8");
  titleGrad.addColorStop(1,    "#8FE38F");
  ctx.fillStyle = titleGrad;
  ctx.save();
  ctx.shadowColor = K.shadowPink;
  ctx.shadowBlur = 6 * scale;
  ctx.shadowOffsetY = 2 * scale;
  ctx.fillText(titleText, cardX + cardW / 2, titleY);
  ctx.restore();

  // 副标题
  ctx.fillStyle = K.textMedium;
  ctx.font = `500 ${14 * scale}px "PingFang SC", -apple-system, sans-serif`;
  ctx.fillText(subtitleText, cardX + cardW / 2, titleY + 30 * scale);

  y += headerHeight;

  // ═════════════════════════════════════════════════════════════
  //  4. 表头 — 薰衣草浅底 + 胶囊标签风格
  // ═════════════════════════════════════════════════════════════
  ctx.fillStyle = K.purpleLight;
  ctx.fillRect(cardX, y, cardW, tableHeaderHeight);

  // 表头底分隔
  ctx.strokeStyle = "rgba(230, 213, 255, 0.3)";
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(cardX, y + tableHeaderHeight);
  ctx.lineTo(cardX + cardW, y + tableHeaderHeight);
  ctx.stroke();

  ctx.fillStyle = K.textMedium;
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

  // ═════════════════════════════════════════════════════════════
  //  5. 数据行
  // ═════════════════════════════════════════════════════════════
  const maxWave = rows.filter((r) => r.isLive).length > 0
    ? Math.max(...rows.filter((r) => r.isLive).map((r) => r.dailyWave))
    : 1;

  rows.forEach((row, index) => {
    const rank = index + 1;
    const isTop3 = rank <= 3;
    const isInactive = !row.isLive;

    // 行底色（前3名糖果色高亮）
    let rowBg: string | null = null;
    if (rank === 1) rowBg = K.top1RowBg;
    else if (rank === 2) rowBg = K.top2RowBg;
    else if (rank === 3) rowBg = K.top3RowBg;
    if (rowBg) {
      ctx.fillStyle = rowBg;
      ctx.fillRect(cardX, y, cardW, rowHeight);
    }

    // 行分隔线（极淡粉色）
    ctx.strokeStyle = K.separator;
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.moveTo(cardX + 20 * scale, y + rowHeight);
    ctx.lineTo(cardX + cardW - 20 * scale, y + rowHeight);
    ctx.stroke();

    // 各列
    cols.forEach((col) => {
      const drawX = cardX + col.x;
      const cy = y + rowHeight / 2;

      if (col.key === "rank") {
        // 排名：前三名奖杯，其余纯文字
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const badgeSize = 34 * scale;
        const badgeX = drawX + (col.width - badgeSize) / 2 - (trends[row.anchorId] !== undefined ? 16 * scale : 0);

        if (isTop3) {
          // 奖杯 — 糖果金/银/铜
          let mainColor: string, accentColor: string;
          if (rank === 1) { mainColor = "#FFD580"; accentColor = "#FFB6D9"; }   // 蜜桃金
          else if (rank === 2) { mainColor = "#E6D5FF"; accentColor = "#C8A2E8"; } // 薰衣草银
          else { mainColor = "#D4F1D4"; accentColor = "#8FE38F"; }                 // 薄荷铜

          drawTrophy(ctx, badgeX + badgeSize / 2, cy, badgeSize, mainColor, accentColor, scale);

          // 奖杯旁小星星
          if (rank === 1) {
            drawStar(ctx, badgeX + badgeSize + 4 * scale, cy - badgeSize * 0.3, 5 * scale, K.pink);
          }
        } else {
          // 纯文字序号
          ctx.fillStyle = K.textLight;
          ctx.font = `700 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
          const rankStr = rank < 10 ? `0${rank}` : String(rank);
          ctx.fillText(rankStr, badgeX + badgeSize / 2, cy);
        }

        // 趋势指示
        const trend = trends[row.anchorId];
        if (trend !== undefined) {
          const trendX = badgeX + badgeSize + 12 * scale;
          ctx.font = `700 ${12 * scale}px "PingFang SC", -apple-system, sans-serif`;
          ctx.textAlign = "left";
          if (trend > 0) {
            ctx.fillStyle = K.trendUp;
            ctx.fillText(`↑${trend}`, trendX, cy);
          } else if (trend < 0) {
            ctx.fillStyle = K.trendDown;
            ctx.fillText(`↓${Math.abs(trend)}`, trendX, cy);
          } else {
            ctx.fillStyle = K.trendFlat;
            ctx.fillText("—", trendX + 4 * scale, cy);
          }
        }
      } else if (col.key === "name") {
        ctx.textAlign = "left";
        ctx.fillStyle = K.textDark;
        ctx.font = `600 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
        const text = truncateCanvasText(ctx, row.name, col.width - 40 * scale);
        ctx.fillText(text, drawX + 18 * scale, cy);
      } else if (col.key === "dailyWave") {
        if (isInactive) {
          // 未开播 — 柔和粉色胶囊
          ctx.textAlign = "center";
          ctx.font = `700 ${14 * scale}px "PingFang SC", -apple-system, sans-serif`;
          const textW = ctx.measureText("未开播").width;
          const padX = 16 * scale;
          const pw = textW + padX * 2;
          const ph = 30 * scale;
          const px = drawX + (col.width - pw) / 2;
          const py = cy - ph / 2;

          ctx.fillStyle = K.pinkLight;
          ctx.beginPath();
          drawRoundRect(ctx, px, py, pw, ph, K.radiusPill * scale);
          ctx.fill();

          ctx.fillStyle = K.danger;
          ctx.textBaseline = "middle";
          ctx.fillText("未开播", drawX + col.width / 2, cy);
        } else {
          // 进度条 — 糖果色渐变 + 大圆角
          const barW = col.width - 40 * scale;
          const barH = 34 * scale;
          const barLeft = drawX + 20 * scale;
          const barTop = cy - barH / 2;
          const fillPercent = (row.dailyWave / maxWave) * 0.85;
          const fillW = Math.max(barW * fillPercent, 30 * scale);
          const barRadius = K.radiusPill * scale;

          // 轨道（极淡粉色）
          ctx.fillStyle = K.barTrack;
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, barW, barH, barRadius);
          ctx.fill();

          // 进度条（粉紫渐变）
          const barGrad = ctx.createLinearGradient(barLeft, 0, barLeft + fillW, 0);
          barGrad.addColorStop(0, K.barGrad[0]);
          barGrad.addColorStop(1, K.barGrad[1]);
          ctx.fillStyle = barGrad;
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, fillW, barH, barRadius);
          ctx.fill();

          // 进度条高光（顶部白色半透明）
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, fillW, barH * 0.4, barRadius);
          ctx.fill();
          ctx.globalAlpha = 1.0;

          // 文字（白色 + 阴影）
          ctx.fillStyle = K.barText;
          ctx.font = `700 ${14 * scale}px "PingFang SC", -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
          ctx.shadowBlur = 3 * scale;
          ctx.fillText(formatWave(row.dailyWave), drawX + col.width / 2, cy);
          ctx.restore();
        }
      } else if (col.key === "totalWave") {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `600 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
        ctx.fillStyle = K.textMedium;
        ctx.fillText(formatWave(row.totalWave), drawX + col.width / 2, cy);
      } else if (col.key === "tier") {
        if (row.tier) {
          const ls = getLevelStyle(row.tier);
          ctx.font = `800 ${14 * scale}px "PingFang SC", -apple-system, sans-serif`;
          const textW = ctx.measureText(row.tier).width;
          const padX = 16 * scale;
          const bw = textW + padX * 2;
          const bh = 32 * scale;
          const bl = drawX + (col.width - bw) / 2;
          const bt = cy - bh / 2;

          // 胶囊形等级标签
          ctx.save();
          ctx.shadowColor = K.shadowPink;
          ctx.shadowBlur = 8 * scale;
          ctx.shadowOffsetY = 3 * scale;

          const lvlGrad = ctx.createLinearGradient(bl, bt, bl + bw, bt + bh);
          lvlGrad.addColorStop(0, ls.grad[0]);
          lvlGrad.addColorStop(1, ls.grad[1]);
          ctx.fillStyle = lvlGrad;
          ctx.beginPath();
          drawRoundRect(ctx, bl, bt, bw, bh, K.radiusPill * scale);
          ctx.fill();
          ctx.restore();

          // 高光
          ctx.globalAlpha = 0.20;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          drawRoundRect(ctx, bl, bt, bw, bh * 0.4, K.radiusPill * scale);
          ctx.fill();
          ctx.globalAlpha = 1.0;

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
        ctx.fillStyle = row.isLive && row.dailyDuration > 0 ? K.textDark : K.textLight;
        ctx.font = `600 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
        ctx.fillText(dText, drawX + col.width / 2, cy);
      } else if (col.key === "master") {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = K.textMedium;
        ctx.font = `600 ${16 * scale}px "PingFang SC", -apple-system, sans-serif`;
        const text = truncateCanvasText(ctx, row.masterName || "—", col.width - 20 * scale);
        ctx.fillText(text, drawX + col.width / 2, cy);
      }
    });

    y += rowHeight;
  });

  // ═════════════════════════════════════════════════════════════
  //  6. 底部 — 柔和渐变 + 统计信息
  // ═════════════════════════════════════════════════════════════
  const footerGrad = ctx.createLinearGradient(cardX, y, cardX + cardW, y + footerHeight);
  footerGrad.addColorStop(0, K.pinkLight);
  footerGrad.addColorStop(0.5, K.purpleLight);
  footerGrad.addColorStop(1, K.greenLight);
  ctx.fillStyle = footerGrad;
  ctx.fillRect(cardX, y, cardW, footerHeight);

  // 顶部分隔
  ctx.strokeStyle = K.separator;
  ctx.lineWidth = 1 * scale;
  ctx.beginPath();
  ctx.moveTo(cardX + 20 * scale, y);
  ctx.lineTo(cardX + cardW - 20 * scale, y);
  ctx.stroke();

  const footerPadX = 32 * scale;

  // 左栏：人数 + 导出日期
  ctx.fillStyle = K.textDark;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${18 * scale}px "PingFang SC", -apple-system, sans-serif`;
  ctx.fillText(`${genderText}主播 ${rows.length} 人`, cardX + footerPadX, y + 38 * scale);

  ctx.font = `500 ${13 * scale}px "PingFang SC", -apple-system, sans-serif`;
  ctx.fillStyle = K.textMedium;
  ctx.fillText(`导出日期 ${formattedDate}`, cardX + footerPadX, y + 62 * scale);

  // 中栏：未开播
  if (hasInactive) {
    const centerX = cardX + cardW / 2;
    ctx.fillStyle = K.danger;
    ctx.textAlign = "center";
    ctx.font = `800 ${18 * scale}px "PingFang SC", -apple-system, sans-serif`;
    ctx.fillText(`未开播 ${inactiveStreamers.length} 人`, centerX, y + 38 * scale);

    ctx.font = `500 ${13 * scale}px "PingFang SC", -apple-system, sans-serif`;
    ctx.fillStyle = K.danger;
    ctx.textBaseline = "top";
    inactiveLines.forEach((line, i) => {
      ctx.fillText(line, centerX, y + (54 + i * 20) * scale);
    });
    ctx.textBaseline = "alphabetic";
  }

  // 右栏：小装饰
  const rightX = cardX + cardW - footerPadX;
  drawStar(ctx, rightX - 10 * scale, y + 35 * scale, 6 * scale, K.pink);
  drawDot(ctx, rightX - 25 * scale, y + 55 * scale, 4 * scale, K.purple, 0.4);
  drawDot(ctx, rightX - 5 * scale, y + 65 * scale, 3 * scale, K.green, 0.4);

  ctx.restore();
}
