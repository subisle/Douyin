import type { DailyReportRow } from "@/types/electron";
import { formatWave } from "./format";

/* ═══════════════════════════════════════════════════════════════
 *  旧项目浅色 Canvas 表格绘制
 * ═══════════════════════════════════════════════════════════════ */

/* ────────────────── 工具函数 ────────────────── */

function formatDurationText(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}时${m}分` : `${h}时`;
  }
  return `${minutes}分`;
}

export function formatMonthNotLiveDaysLabel(date: string): string {
  const month = Number(date.split("-")[1]);
  return Number.isFinite(month) && month >= 1 && month <= 12 ? `${month}月未播天数` : "本月未播天数";
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

function groupInactiveStreamers(rows: DailyReportRow[]): string {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.masterName?.trim() || "无师傅";
    const list = groups.get(key) ?? [];
    list.push(row.name);
    groups.set(key, list);
  }
  return Array.from(groups.entries())
    .map(([master, names]) => `${master}: ${names.join("、")}`)
    .join("  /  ");
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

function getRankDeltaMeta(delta: number | null | undefined): {
  text: string;
  color: string;
} | null {
  if (delta === null || delta === undefined) return null;
  if (delta > 0) return { text: `↑${delta}`, color: "#16A34A" };
  if (delta < 0) return { text: `↓${Math.abs(delta)}`, color: "#DC2626" };
  return null;
}

/* ────────────────── 列定义 ────────────────── */

export type ColumnKey = "rank" | "name" | "notLiveDays" | "dailyWave" | "totalWave" | "duration" | "master" | "tier";
export type ColumnWidths = Partial<Record<ColumnKey, number>>;
export type ReportCanvasStyle = "classic" | "apple";
type ColumnProfile = "classic" | "apple";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  minWidth: number;
  flex: number;
  align: "left" | "center" | "right";
  getText: (row: DailyReportRow, index: number) => string;
}

export const ALL_COLUMNS: { key: ColumnKey; label: string; defaultVisible: boolean }[] = [
  { key: "rank",      label: "排名",      defaultVisible: true },
  { key: "name",      label: "主播姓名",  defaultVisible: true },
  { key: "notLiveDays", label: "未播天数", defaultVisible: true },
  { key: "dailyWave", label: "日音浪",  defaultVisible: true },
  { key: "totalWave", label: "累计总音浪", defaultVisible: true },
  { key: "duration",  label: "有效时长",  defaultVisible: false },
  { key: "master",    label: "师傅",      defaultVisible: false },
  { key: "tier",      label: "等级",      defaultVisible: true },
];

export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ALL_COLUMNS
  .filter((c) => c.defaultVisible)
  .map((c) => c.key);

const COLUMN_WIDTH_LIMITS: Record<ColumnKey, { min: number; max: number }> = {
  rank: { min: 36, max: 220 },
  name: { min: 48, max: 800 },
  notLiveDays: { min: 20, max: 260 },
  dailyWave: { min: 56, max: 800 },
  totalWave: { min: 64, max: 800 },
  tier: { min: 36, max: 220 },
  duration: { min: 48, max: 420 },
  master: { min: 48, max: 520 },
};

function getManualColumnWidth(key: ColumnKey, columnWidths: ColumnWidths): number | null {
  const value = columnWidths[key];
  if (!Number.isFinite(value) || !value) return null;
  const limit = COLUMN_WIDTH_LIMITS[key];
  return Math.min(limit.max, Math.max(limit.min, Math.round(value)));
}

function getColumnDefinitions(profile: ColumnProfile = "classic", notLiveDaysLabel = "未播天数"): ColumnDef[] {
  if (profile === "apple") {
    return [
      { key: "rank",      label: "排名",           minWidth: 66,  flex: 0.05, align: "center", getText: (r, i) => `${i + 1}${r.rankDelta ? r.rankDelta : ""}` },
      { key: "name",      label: "主播姓名",       minWidth: 88,  flex: 0.04, align: "left",   getText: (r) => r.name },
      { key: "notLiveDays", label: notLiveDaysLabel, minWidth: 28,  flex: 0, align: "center", getText: (r) => String(r.notLiveDays ?? 0) },
      { key: "dailyWave", label: "日音浪",         minWidth: 112, flex: 0.45, align: "right",  getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播") },
      { key: "totalWave", label: "累计总音浪",     minWidth: 134, flex: 0.55, align: "right",  getText: (r) => formatWave(r.totalWave) },
      { key: "duration",  label: "有效时长",       minWidth: 86,  flex: 0.25, align: "center", getText: (r) => r.isLive && r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—" },
      { key: "master",    label: "师傅",           minWidth: 92,  flex: 0.4, align: "left",   getText: (r) => r.masterName || "—" },
      { key: "tier",      label: "等级",           minWidth: 64,  flex: 0.15, align: "center", getText: (r) => r.tier || "" },
    ];
  }
  return [
    { key: "rank",      label: "排名",           minWidth: 66,  flex: 0.08, align: "center", getText: (r, i) => `${i + 1}${r.rankDelta ? r.rankDelta : ""}` },
    { key: "name",      label: "主播姓名",       minWidth: 104, flex: 0.12, align: "left",   getText: (r) => r.name },
    { key: "notLiveDays", label: notLiveDaysLabel, minWidth: 30,  flex: 0, align: "center", getText: (r) => String(r.notLiveDays ?? 0) },
    { key: "dailyWave", label: "日音浪",         minWidth: 112, flex: 0.35, align: "right",  getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播") },
    { key: "totalWave", label: "累计总音浪",     minWidth: 146, flex: 1.6, align: "right",  getText: (r) => formatWave(r.totalWave) },
    { key: "duration",  label: "有效时长",       minWidth: 94,  flex: 0.7, align: "center", getText: (r) => r.isLive && r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—" },
    { key: "master",    label: "师傅",           minWidth: 96,  flex: 1.2, align: "left",   getText: (r) => r.masterName || "—" },
    { key: "tier",      label: "等级",           minWidth: 72,  flex: 0.35, align: "center", getText: (r) => r.tier || "" },
  ];
}

function getVisibleColumnDefinitions(visibleColumns: ColumnKey[], profile: ColumnProfile = "classic", notLiveDaysLabel = "未播天数"): ColumnDef[] {
  const allDefs = getColumnDefinitions(profile, notLiveDaysLabel);
  const defs = allDefs.filter((c) => visibleColumns.includes(c.key));
  return defs.length > 0 ? defs : [allDefs[0]];
}

function measureNaturalColumnWidths(
  ctx: CanvasRenderingContext2D,
  scale: number,
  rows: DailyReportRow[],
  defs: ColumnDef[],
  columnWidths: ColumnWidths = {}
): { widths: number[]; manualFlags: boolean[] } {
  ctx.save();
  const manualFlags: boolean[] = [];
  const widths = defs.map((col) => {
    const manualWidth = getManualColumnWidth(col.key, columnWidths);
    if (manualWidth !== null) {
      manualFlags.push(true);
      return manualWidth * scale;
    }
    manualFlags.push(false);
    ctx.font = `700 ${14 * scale}px sans-serif`;
    const headerW = ctx.measureText(col.label).width;
    ctx.font = `600 ${16 * scale}px sans-serif`;
    const sampleW = rows.reduce((max, r, i) => Math.max(max, ctx.measureText(col.getText(r, i)).width), 0);
    if (col.key === "notLiveDays") {
      return Math.max(col.minWidth * scale, headerW + 10 * scale, sampleW + 14 * scale);
    }
    return Math.max(col.minWidth * scale, headerW + 30 * scale, sampleW + 36 * scale);
  });
  ctx.restore();
  return { widths, manualFlags };
}

function measureNaturalColumnsWidth(
  ctx: CanvasRenderingContext2D,
  scale: number,
  rows: DailyReportRow[],
  visibleColumns: ColumnKey[],
  columnWidths: ColumnWidths = {},
  profile: ColumnProfile = "classic",
  notLiveDaysLabel = "未播天数"
): number {
  const defs = getVisibleColumnDefinitions(visibleColumns, profile, notLiveDaysLabel);
  const { widths } = measureNaturalColumnWidths(ctx, scale, rows, defs, columnWidths);
  return widths.reduce((sum, width) => sum + width, 0);
}

function buildColumns(
  ctx: CanvasRenderingContext2D,
  scale: number,
  cardWidth: number,
  rows: DailyReportRow[],
  visibleColumns: ColumnKey[],
  columnWidths: ColumnWidths = {},
  profile: ColumnProfile = "classic",
  notLiveDaysLabel = "未播天数"
): (ColumnDef & { x: number; width: number })[] {
  const defs = getVisibleColumnDefinitions(visibleColumns, profile, notLiveDaysLabel);
  const measured = measureNaturalColumnWidths(ctx, scale, rows, defs, columnWidths);
  let widths = measured.widths;
  const manualFlags = measured.manualFlags;

  const totalW = widths.reduce((s, w) => s + w, 0);
  if (totalW < cardWidth) {
    const extra = cardWidth - totalW;
    const autoIndexes = defs.map((_, i) => i).filter((i) => !manualFlags[i]);
    const targetIndexes = autoIndexes.length > 0 ? autoIndexes : defs.map((_, i) => i);
    const totalFlex = targetIndexes.reduce((s, i) => s + defs[i].flex, 0) || 1;
    widths = widths.map((w, i) =>
      targetIndexes.includes(i) ? w + extra * (defs[i].flex / totalFlex) : w
    );
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
 *  主绘制函数 — 旧项目浅色自适应表格
 * ═══════════════════════════════════════════════════════════════ */

export interface DrawReportOptions {
  date: string;
  rows: DailyReportRow[];
  gender: "male" | "female";
  customTitle?: string;
  scale?: number;
  visibleColumns?: ColumnKey[];
  columnWidths?: ColumnWidths;
  trends?: Record<string, number>;
  subtitle?: string;
  notLiveCount?: number;
  notLiveDays?: number;
}

export function drawReportToCanvas(
  canvas: HTMLCanvasElement,
  opts: DrawReportOptions
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const {
    date,
    rows,
    gender,
    customTitle = "",
    scale = 2,
    visibleColumns = DEFAULT_VISIBLE_COLUMNS,
    columnWidths = {},
    notLiveCount,
    notLiveDays = 0,
  } = opts;

  const parts = date.split("-");
  const year  = parseInt(parts[0]) || 2026;
  const month = parseInt(parts[1]) || 1;
  const day   = parseInt(parts[2]) || 1;
  const formattedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const genderText = gender === "male" ? "男" : "女";
  const titleBase = customTitle.trim() || "薇笑传媒主播数据统计";
  const titleText = `${titleBase} ${formattedDate}`;
  const notLiveDaysLabel = formatMonthNotLiveDaysLabel(date);
  const tablePaddingX = 20 * scale;
  const headerHeight = 54 * scale;
  const tableHeaderHeight = 32 * scale;
  const rowHeight = 38 * scale;
  const inactiveStreamers = rows.filter((r) => !r.isLive);
  const notLivePeopleCount = notLiveCount ?? inactiveStreamers.length;
  const hasInactive = inactiveStreamers.length > 0;
  const liveRows = rows.filter((r) => r.isLive);

  ctx.font = `bold ${22 * scale}px sans-serif`;
  const titleW = ctx.measureText(titleText).width;
  const naturalColumnsWidth = measureNaturalColumnsWidth(ctx, scale, rows, visibleColumns, columnWidths, "classic", notLiveDaysLabel);
  const containerW = Math.max(
    520 * scale,
    Math.min(1800 * scale, Math.max(titleW + 100 * scale, naturalColumnsWidth + tablePaddingX * 2))
  );

  ctx.font = `${11 * scale}px sans-serif`;
  const inactiveLines = hasInactive
    ? wrapCanvasText(
        ctx,
        groupInactiveStreamers(inactiveStreamers),
        containerW - tablePaddingX * 2 - 32 * scale
      )
    : [];
  const footerHeight = hasInactive
    ? Math.max(118 * scale, (86 + inactiveLines.length * 18) * scale)
    : 64 * scale;

  const cols = buildColumns(ctx, scale, containerW - tablePaddingX * 2, rows, visibleColumns, columnWidths, "classic", notLiveDaysLabel);
  const totalH = headerHeight + tableHeaderHeight + rowHeight * rows.length + footerHeight;

  canvas.width  = containerW;
  canvas.height = totalH;

  ctx.fillStyle = "#F8FAFC";
  ctx.fillRect(0, 0, containerW, totalH);

  let y = 0;

  ctx.fillStyle = "#1E293B";
  ctx.fillRect(0, y, containerW, headerHeight);
  ctx.fillStyle = "#F8FAFC";
  ctx.font = `bold ${22 * scale}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(titleText, containerW / 2, y + headerHeight / 2);
  y += headerHeight;

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

  const maxWave = liveRows.length > 0
    ? Math.max(...liveRows.map((r) => r.dailyWave))
    : 1;
  const safeMaxWave = maxWave > 0 ? maxWave : 1;

  rows.forEach((row, index) => {
    const rank = index + 1;
    const isTop3 = rank <= 3;
    const isInactive = !row.isLive;

    ctx.fillStyle = isInactive ? "#FEF2F2" :
      rank === 1 ? "#FEF3C7" :
      rank === 2 ? "#F8FAFC" :
      rank === 3 ? "#FFEDD5" :
      index % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
    ctx.fillRect(0, y, containerW, rowHeight);

    if (isInactive) {
      ctx.fillStyle = "#DC2626";
      ctx.fillRect(0, y, 4 * scale, rowHeight);
    }

    ctx.strokeStyle = isInactive ? "#FECACA" : "#E2E8F0";
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
        ctx.textBaseline = "middle";
        ctx.fillStyle = isInactive ? "#B91C1C" : "#334155";
        const deltaMeta = getRankDeltaMeta(row.rankDelta);
        const mainX = deltaMeta ? drawX + col.width / 2 - 8 * scale : drawX + col.width / 2;
        if (isTop3) {
          ctx.font = `${20 * scale}px sans-serif`;
          ctx.fillText(rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉", mainX, cy);
        } else {
          ctx.font = `italic bold ${15 * scale}px serif`;
          ctx.fillText(String(rank).padStart(2, "0"), mainX, cy);
        }
        if (deltaMeta) {
          ctx.textAlign = "left";
          ctx.font = `bold ${10 * scale}px sans-serif`;
          ctx.fillStyle = deltaMeta.color;
          ctx.fillText(deltaMeta.text, mainX + 14 * scale, cy + 8 * scale);
        }
      } else if (col.key === "name") {
        ctx.textAlign = "left";
        ctx.fillStyle = isInactive ? "#991B1B" : "#0F172A";
        ctx.font = `${isInactive ? "bold " : ""}${15 * scale}px sans-serif`;
        const text = truncateCanvasText(ctx, row.name, col.width - 16 * scale);
        ctx.fillText(text, drawX + 8 * scale, cy);
      } else if (col.key === "dailyWave") {
        if (!isInactive) {
          const barW = Math.max(((col.width - 48 * scale) * row.dailyWave) / safeMaxWave, 24 * scale);
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
        ctx.textBaseline = "middle";
        ctx.font = `${14 * scale}px monospace`;
        ctx.fillStyle = isInactive ? "#DC2626" : "#1E293B";
        ctx.fillText(isInactive ? "未开播" : formatWave(row.dailyWave), drawX + col.width - 12 * scale, cy);
      } else if (col.key === "totalWave") {
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.font = `${14 * scale}px monospace`;
        ctx.fillStyle = "#475569";
        ctx.fillText(formatWave(row.totalWave), drawX + col.width - 12 * scale, cy);
      } else if (col.key === "tier") {
        if (row.tier) {
          const bw = Math.min(col.width - 20 * scale, 66 * scale);
          const bh = 20 * scale;
          const bl = drawX + (col.width - bw) / 2;
          const bt = cy - bh / 2;
          ctx.fillStyle = "#E0F2FE";
          if (isInactive) ctx.fillStyle = "#FEE2E2";
          ctx.beginPath();
          drawRoundRect(ctx, bl, bt, bw, bh, 8 * scale);
          ctx.fill();
          ctx.fillStyle = isInactive ? "#B91C1C" : "#0369A1";
          ctx.font = `bold ${11 * scale}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(row.tier, drawX + col.width / 2, cy + 1 * scale);
        }
      } else if (col.key === "duration") {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const durationText = row.isLive && row.dailyDuration > 0
          ? formatDurationText(row.dailyDuration)
          : "—";
        ctx.fillStyle = isInactive ? "#B91C1C" : "#7C3AED";
        ctx.font = `${13 * scale}px sans-serif`;
        ctx.fillText(durationText, drawX + col.width / 2, cy);
      } else if (col.key === "notLiveDays") {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = (row.notLiveDays ?? 0) > 0 ? "#B91C1C" : "#15803D";
        ctx.font = `bold ${13 * scale}px sans-serif`;
        ctx.fillText(String(row.notLiveDays ?? 0), drawX + col.width / 2, cy);
      } else if (col.key === "master") {
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isInactive ? "#991B1B" : "#64748B";
        ctx.font = `${13 * scale}px sans-serif`;
        const text = truncateCanvasText(ctx, row.masterName || "—", col.width - 24 * scale);
        ctx.fillText(text, drawX + 12 * scale, cy);
      }
    });

    y += rowHeight;
  });

  ctx.fillStyle = "#E2E8F0";
  ctx.fillRect(0, y, containerW, footerHeight);
  ctx.fillStyle = "#334155";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold ${18 * scale}px sans-serif`;
  const summaryText = `${genderText}主播 ${rows.length} 人 · 未开播人数 ${notLivePeopleCount} 人 · 未开播天数 ${notLiveDays} 天`;
  ctx.fillText(truncateCanvasText(ctx, summaryText, containerW - tablePaddingX * 2), tablePaddingX, y + 26 * scale);
  ctx.font = `${12 * scale}px sans-serif`;
  ctx.fillStyle = "#64748B";
  ctx.fillText(`导出日期 ${formattedDate}`, tablePaddingX, y + 50 * scale);

  if (hasInactive) {
    const warnX = tablePaddingX;
    const warnY = y + 64 * scale;
    const warnW = containerW - tablePaddingX * 2;
    const warnH = footerHeight - 78 * scale;
    ctx.fillStyle = "#FEF2F2";
    ctx.beginPath();
    drawRoundRect(ctx, warnX, warnY, warnW, warnH, 8 * scale);
    ctx.fill();
    ctx.strokeStyle = "#FECACA";
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    drawRoundRect(ctx, warnX, warnY, warnW, warnH, 8 * scale);
    ctx.stroke();

    ctx.fillStyle = "#DC2626";
    ctx.font = `bold ${14 * scale}px sans-serif`;
    ctx.fillText(`未开播人数 ${notLivePeopleCount} 人 · 未开播天数 ${notLiveDays} 天`, warnX + 14 * scale, warnY + 22 * scale);
    ctx.font = `${11 * scale}px sans-serif`;
    ctx.fillStyle = "#7F1D1D";
    ctx.textBaseline = "top";
    inactiveLines.forEach((line, i) => {
      ctx.fillText(line, warnX + 14 * scale, warnY + (40 + i * 16) * scale);
    });
    ctx.textBaseline = "middle";
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  样式二 - Apple 浅色报告
 * ═══════════════════════════════════════════════════════════════ */

function formatAppleDate(date: string): string {
  const parts = date.split("-");
  const year = parseInt(parts[0] || "2026", 10) || 2026;
  const month = parseInt(parts[1] || "1", 10) || 1;
  const day = parseInt(parts[2] || "1", 10) || 1;
  return `${year}年${month}月${day}日`;
}

function appleTierColor(tier: string | null | undefined) {
  const key = (tier || "").charAt(0).toUpperCase();
  if (key === "A") return { bg: "#FFF7E6", border: "#FDBA74", text: "#9A3412" };
  if (key === "B") return { bg: "#EAF3FF", border: "#60A5FA", text: "#1D4ED8" };
  if (key === "C") return { bg: "#ECFDF3", border: "#34D399", text: "#047857" };
  if (key === "D") return { bg: "#F5F3FF", border: "#A78BFA", text: "#6D28D9" };
  return { bg: "#F2F4F7", border: "#EAECF0", text: "#667085" };
}

function drawApplePill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  fill: string,
  stroke: string,
  color: string,
  font: string
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  drawRoundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  drawRoundRect(ctx, x, y, w, h, h / 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
}

export function drawAppleReportToCanvas(
  canvas: HTMLCanvasElement,
  opts: DrawReportOptions
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const {
    date,
    rows,
    gender,
    customTitle = "",
    scale = 2,
    visibleColumns = DEFAULT_VISIBLE_COLUMNS,
    columnWidths = {},
    notLiveCount,
    notLiveDays = 0,
  } = opts;
  const font = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", sans-serif';
  const mono = '"SF Mono", "Menlo", "Consolas", monospace';
  const titleBase = customTitle.trim() || "薇笑传媒主播数据统计";
  const genderText = gender === "male" ? "男队" : "女队";
  const notLiveDaysLabel = formatMonthNotLiveDaysLabel(date);
  const liveRows = rows.filter((r) => r.isLive);
  const inactiveRows = rows.filter((r) => !r.isLive);
  const notLivePeopleCount = notLiveCount ?? inactiveRows.length;
  const maxWave = liveRows.length > 0 ? Math.max(...liveRows.map((r) => r.dailyWave)) : 1;

  const pagePad = 0;
  const cardPad = 0;
  const headerH = 86 * scale;
  const tableHeaderH = 34 * scale;
  const rowH = 48 * scale;
  const rowGap = 6 * scale;
  const footerTextGap = 8 * scale;
  const footerTextH = 18 * scale;
  const warnGap = 20 * scale;
  const warnH = 42 * scale;
  const footerH = footerTextGap + footerTextH + (inactiveRows.length > 0 ? warnGap + warnH : 0);

  const naturalColumnsWidth = measureNaturalColumnsWidth(ctx, scale, rows, visibleColumns, columnWidths, "apple", notLiveDaysLabel);
  const canvasW = Math.max(
    480 * scale,
    Math.min(2000 * scale, naturalColumnsWidth + pagePad * 2 + cardPad * 2)
  );
  const cardX = pagePad;
  const cardY = pagePad;
  const cardW = canvasW - pagePad * 2;
  const tableW = cardW - cardPad * 2;
  const cols = buildColumns(ctx, scale, tableW, rows, visibleColumns, columnWidths, "apple", notLiveDaysLabel);
  const tableRowsH = rows.length * rowH + Math.max(0, rows.length - 1) * rowGap;
  const cardH = headerH + tableHeaderH + rowGap + tableRowsH + footerH + cardPad;
  const canvasH = cardY + cardH + pagePad;

  canvas.width = canvasW;
  canvas.height = canvasH;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.save();
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.rotate(-Math.PI / 10);
  ctx.fillStyle = "rgba(51, 65, 85, 0.055)";
  ctx.font = `900 ${18 * scale}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const watermarkText = "内部数据 · 请勿外传";
  const stepX = 180 * scale;
  const stepY = 76 * scale;
  for (let wy = -canvasH; wy <= canvasH; wy += stepY) {
    for (let wx = -canvasW; wx <= canvasW; wx += stepX) {
      ctx.fillText(watermarkText, wx, wy);
    }
  }
  ctx.restore();

  let y = cardY + cardPad;
  const blue = "#007AFF";
  const centerX = cardX + cardW / 2;
  ctx.fillStyle = "#101828";
  ctx.font = `700 ${25 * scale}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(
    truncateCanvasText(ctx, titleBase, cardW - 24 * scale),
    centerX,
    y + 10 * scale
  );

  ctx.fillStyle = "#475467";
  ctx.font = `500 ${13 * scale}px ${font}`;
  ctx.fillText(formatAppleDate(date), centerX, y + 44 * scale);

  y += headerH - cardPad;

  const tableX = cardX + cardPad;
  const edgeRadius = 0;
  ctx.fillStyle = "#F2F4F7";
  ctx.beginPath();
  drawRoundRect(ctx, tableX, y, tableW, tableHeaderH, edgeRadius);
  ctx.fill();
  ctx.fillStyle = "#667085";
  ctx.font = `700 ${12 * scale}px ${font}`;
  ctx.textBaseline = "middle";
  cols.forEach((col) => {
    const drawX = tableX + col.x;
    if (col.align === "left") {
      ctx.textAlign = "left";
      ctx.fillText(col.label, drawX + 8 * scale, y + tableHeaderH / 2);
    } else if (col.align === "right") {
      ctx.textAlign = "right";
      ctx.fillText(col.label, drawX + col.width - 12 * scale, y + tableHeaderH / 2);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(col.label, drawX + col.width / 2, y + tableHeaderH / 2);
    }
  });
  y += tableHeaderH + rowGap;

  rows.forEach((row, index) => {
    const rank = index + 1;
    const isInactive = !row.isLive;
    const rowFill = isInactive ? "#FFF7F7" : "#FFFFFF";
    ctx.fillStyle = rowFill;
    ctx.beginPath();
    drawRoundRect(ctx, tableX, y, tableW, rowH, edgeRadius);
    ctx.fill();
    ctx.strokeStyle = isInactive ? "#FEE4E2" : "#EAECF0";
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    drawRoundRect(ctx, tableX, y, tableW, rowH, edgeRadius);
    ctx.stroke();
    if (isInactive) {
      ctx.fillStyle = "#F04438";
      ctx.beginPath();
      drawRoundRect(ctx, tableX, y + 8 * scale, 4 * scale, rowH - 16 * scale, 2 * scale);
      ctx.fill();
    }

    cols.forEach((col) => {
      const drawX = tableX + col.x;
      const cy = y + rowH / 2;

      if (col.key === "rank") {
        const chipW = 40 * scale;
        const chipH = 24 * scale;
        const chipX = drawX + (col.width - chipW) / 2;
        const chipY = cy - chipH / 2;
        let chipFill = "#F2F4F7";
        let chipStroke = "#EAECF0";
        let chipText = "#475467";
        if (rank === 1) { chipFill = "#FFFAEB"; chipStroke = "#FEDF89"; chipText = "#B54708"; }
        if (rank === 2) { chipFill = "#F9FAFB"; chipStroke = "#D0D5DD"; chipText = "#475467"; }
        if (rank === 3) { chipFill = "#FFF6ED"; chipStroke = "#FED7AA"; chipText = "#C4320A"; }
        if (isInactive) { chipFill = "#FFF1F2"; chipStroke = "#FFE4E6"; chipText = "#B42318"; }
        drawApplePill(
          ctx,
          chipX,
          chipY,
          chipW,
          chipH,
          String(rank).padStart(2, "0"),
          chipFill,
          chipStroke,
          chipText,
          `700 ${12 * scale}px ${mono}`
        );
        const deltaMeta = getRankDeltaMeta(row.rankDelta);
        if (deltaMeta) {
          ctx.fillStyle = deltaMeta.color;
          ctx.font = `700 ${10 * scale}px ${font}`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(deltaMeta.text, chipX + chipW + 4 * scale, cy);
        }
      } else if (col.key === "name") {
        ctx.fillStyle = isInactive ? "#B42318" : "#101828";
        ctx.font = `700 ${14 * scale}px ${font}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(truncateCanvasText(ctx, row.name, col.width - 16 * scale), drawX + 8 * scale, cy);
      } else if (col.key === "dailyWave") {
        if (isInactive) {
          ctx.fillStyle = "#D92D20";
          ctx.font = `700 ${13 * scale}px ${font}`;
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText("未开播", drawX + col.width - 12 * scale, cy);
          return;
        }
        const barMaxW = Math.max(46 * scale, col.width - 88 * scale);
        const barW = Math.max(18 * scale, Math.min(barMaxW, (row.dailyWave / Math.max(maxWave, 1)) * barMaxW));
        const barX = drawX + 12 * scale;
        const barY = cy - 4 * scale;
        ctx.fillStyle = "#EAF3FF";
        ctx.beginPath();
        drawRoundRect(ctx, barX, barY, barMaxW, 8 * scale, 4 * scale);
        ctx.fill();
        ctx.fillStyle = blue;
        ctx.beginPath();
        drawRoundRect(ctx, barX, barY, barW, 8 * scale, 4 * scale);
        ctx.fill();
        ctx.fillStyle = "#101828";
        ctx.font = `700 ${13 * scale}px ${mono}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(formatWave(row.dailyWave), drawX + col.width - 12 * scale, cy);
      } else if (col.key === "totalWave") {
        ctx.fillStyle = "#475467";
        ctx.font = `600 ${13 * scale}px ${mono}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(formatWave(row.totalWave), drawX + col.width - 12 * scale, cy);
      } else if (col.key === "tier") {
        const tier = row.tier || "-";
        const colors = appleTierColor(row.tier);
        const pillW = Math.min(col.width - 18 * scale, Math.max(42 * scale, ctx.measureText(tier).width + 24 * scale));
        drawApplePill(
          ctx,
          drawX + (col.width - pillW) / 2,
          cy - 12 * scale,
          pillW,
          24 * scale,
          tier,
          colors.bg,
          colors.border,
          colors.text,
          `700 ${11 * scale}px ${font}`
        );
      } else if (col.key === "duration") {
        ctx.fillStyle = isInactive ? "#B42318" : "#344054";
        ctx.font = `600 ${13 * scale}px ${font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(row.isLive && row.dailyDuration > 0 ? formatDurationText(row.dailyDuration) : "-", drawX + col.width / 2, cy);
      } else if (col.key === "notLiveDays") {
        ctx.fillStyle = (row.notLiveDays ?? 0) > 0 ? "#B42318" : "#027A48";
        ctx.font = `700 ${13 * scale}px ${font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(row.notLiveDays ?? 0), drawX + col.width / 2, cy);
      } else if (col.key === "master") {
        ctx.fillStyle = isInactive ? "#B42318" : "#667085";
        ctx.font = `500 ${13 * scale}px ${font}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(truncateCanvasText(ctx, row.masterName || "-", col.width - 24 * scale), drawX + 12 * scale, cy);
      }
    });

    y += rowH + (index === rows.length - 1 ? 0 : rowGap);
  });

  y += footerTextGap;
  ctx.fillStyle = "#667085";
  ctx.font = `600 ${12 * scale}px ${font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`导出日期 ${formatAppleDate(date)} · ${genderText} ${rows.length} 人`, tableX + 8 * scale, y);
  ctx.textAlign = "right";
  ctx.fillText(`未开播人数 ${notLivePeopleCount} 人 · 未开播天数 ${notLiveDays} 天`, tableX + tableW - 8 * scale, y);
  ctx.textAlign = "center";
  ctx.fillStyle = "#98A2B3";
  ctx.font = `700 ${12 * scale}px ${font}`;
  ctx.fillText("内部数据 · 请勿外传", tableX + tableW / 2, y);

  if (inactiveRows.length > 0) {
    const warnY = y + warnGap;
    ctx.fillStyle = "#FFF7F7";
    ctx.beginPath();
    drawRoundRect(ctx, tableX, warnY, tableW, warnH, edgeRadius);
    ctx.fill();
    ctx.strokeStyle = "#FEE4E2";
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    drawRoundRect(ctx, tableX, warnY, tableW, warnH, edgeRadius);
    ctx.stroke();
    ctx.fillStyle = "#B42318";
    ctx.font = `700 ${12 * scale}px ${font}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const inactiveText = inactiveRows.map((r) => r.name).join("、");
    ctx.fillText(
      truncateCanvasText(ctx, `未开播：${inactiveText}`, tableW - 28 * scale),
      tableX + 14 * scale,
      warnY + warnH / 2
    );
  }
}
