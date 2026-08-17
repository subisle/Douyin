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

function formatDailyDurationText(minutes: number): string {
  return minutes > 0 ? formatDurationText(minutes) : "—";
}

export function formatMonthNotLiveDaysLabel(date: string): string {
  const month = Number(date.split("-")[1]);
  return Number.isFinite(month) && month >= 1 && month <= 12 ? `${month}月未播天数` : "本月未播天数";
}

export function formatDailyWaveLabel(date: string): string {
  const day = Number(date.split("-")[2]);
  return Number.isFinite(day) && day >= 1 && day <= 31 ? `${day}日音浪` : "日音浪";
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
  // 等级不在发送日报默认字段里；桌面可手动勾选
  { key: "tier",      label: "等级",      defaultVisible: false },
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

function getColumnDefinitions(profile: ColumnProfile = "classic", notLiveDaysLabel = "未播天数", dailyWaveLabel = "日音浪"): ColumnDef[] {
  if (profile === "apple") {
    return [
      { key: "rank",      label: "排名",           minWidth: 66,  flex: 0.05, align: "center", getText: (r, i) => `${i + 1}${r.rankDelta ? r.rankDelta : ""}` },
      { key: "name",      label: "主播姓名",       minWidth: 88,  flex: 0.04, align: "left",   getText: (r) => r.name },
      { key: "notLiveDays", label: notLiveDaysLabel, minWidth: 28,  flex: 0, align: "center", getText: (r) => String(r.notLiveDays ?? 0) },
      { key: "dailyWave", label: dailyWaveLabel,   minWidth: 168, flex: 0.7, align: "right",  getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播") },
      { key: "totalWave", label: "累计总音浪",     minWidth: 120, flex: 0.4, align: "right",  getText: (r) => formatWave(r.totalWave) },
      { key: "duration",  label: "当月时长",       minWidth: 86,  flex: 0.25, align: "center", getText: (r) => formatDailyDurationText(r.totalDuration) },
      { key: "master",    label: "师傅",           minWidth: 92,  flex: 0.4, align: "left",   getText: (r) => r.masterName || "—" },
      { key: "tier",      label: "等级",           minWidth: 64,  flex: 0.15, align: "center", getText: (r) => r.tier || "" },
    ];
  }
  return [
    { key: "rank",      label: "排名",           minWidth: 66,  flex: 0.08, align: "center", getText: (r, i) => `${i + 1}${r.rankDelta ? r.rankDelta : ""}` },
    { key: "name",      label: "主播姓名",       minWidth: 104, flex: 0.12, align: "left",   getText: (r) => r.name },
    { key: "notLiveDays", label: notLiveDaysLabel, minWidth: 30,  flex: 0, align: "center", getText: (r) => String(r.notLiveDays ?? 0) },
    { key: "dailyWave", label: dailyWaveLabel,   minWidth: 160, flex: 0.55, align: "right",  getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播") },
    { key: "totalWave", label: "累计总音浪",     minWidth: 130, flex: 1.2, align: "right",  getText: (r) => formatWave(r.totalWave) },
    { key: "duration",  label: "当月时长",       minWidth: 94,  flex: 0.7, align: "center", getText: (r) => formatDailyDurationText(r.totalDuration) },
    { key: "master",    label: "师傅",           minWidth: 96,  flex: 1.2, align: "left",   getText: (r) => r.masterName || "—" },
    { key: "tier",      label: "等级",           minWidth: 72,  flex: 0.35, align: "center", getText: (r) => r.tier || "" },
  ];
}

function getVisibleColumnDefinitions(visibleColumns: ColumnKey[], profile: ColumnProfile = "classic", notLiveDaysLabel = "未播天数", dailyWaveLabel = "日音浪"): ColumnDef[] {
  const allDefs = getColumnDefinitions(profile, notLiveDaysLabel, dailyWaveLabel);
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
  notLiveDaysLabel = "未播天数",
  dailyWaveLabel = "日音浪"
): number {
  const defs = getVisibleColumnDefinitions(visibleColumns, profile, notLiveDaysLabel, dailyWaveLabel);
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
  notLiveDaysLabel = "未播天数",
  dailyWaveLabel = "日音浪"
): (ColumnDef & { x: number; width: number })[] {
  const defs = getVisibleColumnDefinitions(visibleColumns, profile, notLiveDaysLabel, dailyWaveLabel);
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
  /** 分页时全局排名起点（0-based），第 2 页从中段继续而不是从 1 */
  rankOffset?: number;
  /** 当前页码（1-based），仅 pageCount>1 时显示在标题 */
  pageIndex?: number;
  /** 总页数 */
  pageCount?: number;
  /**
   * 全量行（分页时传入完整名单）。
   * 用于全局 maxWave、未开播统计；不传则退回当前 rows。
   */
  statsRows?: DailyReportRow[];
  /** 是否绘制未开播页脚；默认仅末页或未分页时绘制 */
  showInactiveFooter?: boolean;
  /** 标题后不追加日期（用于月度等整月口径的标题） */
  hideDateInTitle?: boolean;
}

/** 超过该人数且允许拆页时，导出拆成上下两张 */
export const DAILY_REPORT_EXPORT_SPLIT_THRESHOLD = 30;

export type DailyReportExportPage = {
  rows: DailyReportRow[];
  rankOffset: number;
  pageIndex: number;
  pageCount: number;
};

/**
 * 将日报名单拆成导出页。超过阈值时固定拆成 2 页（约一半一半）。
 * 预览仍可用全量 rows；仅导出走分页。
 */
function resolveSplitOption(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function splitDailyReportRowsForExport(
  rows: DailyReportRow[],
  options?: { threshold?: number; maxPages?: number }
): DailyReportExportPage[] {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const threshold = Math.max(1, resolveSplitOption(options?.threshold, DAILY_REPORT_EXPORT_SPLIT_THRESHOLD));
  const maxPages = Math.max(1, Math.min(2, resolveSplitOption(options?.maxPages, 2)));
  if (list.length <= threshold || maxPages < 2) {
    return [{ rows: list, rankOffset: 0, pageIndex: 1, pageCount: 1 }];
  }
  const mid = Math.ceil(list.length / 2);
  return [
    { rows: list.slice(0, mid), rankOffset: 0, pageIndex: 1, pageCount: 2 },
    { rows: list.slice(mid), rankOffset: mid, pageIndex: 2, pageCount: 2 },
  ];
}

export function formatDailyReportPageSuffix(pageIndex?: number, pageCount?: number): string {
  const total = Number(pageCount) || 0;
  const page = Number(pageIndex) || 0;
  if (total <= 1 || page <= 0) return "";
  return `（${page}/${total}）`;
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
    rankOffset = 0,
    pageIndex = 1,
    pageCount = 1,
    statsRows,
    hideDateInTitle = false,
  } = opts;

  const parts = date.split("-");
  const year  = parseInt(parts[0]) || 2026;
  const month = parseInt(parts[1]) || 1;
  const day   = parseInt(parts[2]) || 1;
  const formattedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const genderText = gender === "male" ? "男" : "女";
  // 未传自定义标题时按性别默认：男团星嗨 / 女队薇笑（与软件配置一致）
  const titleBase = customTitle.trim()
    || (gender === "female" ? "薇笑传媒主播数据统计" : "星嗨艺创主播数据统计");
  const pageSuffix = formatDailyReportPageSuffix(pageIndex, pageCount);
  const titleText = hideDateInTitle
    ? `${titleBase}${pageSuffix ? ` ${pageSuffix}` : ""}`
    : `${titleBase} ${formattedDate}${pageSuffix ? ` ${pageSuffix}` : ""}`;
  const notLiveDaysLabel = formatMonthNotLiveDaysLabel(date);
  const dailyWaveLabel = formatDailyWaveLabel(date);
  const tablePaddingX = 20 * scale;
  const headerHeight = 54 * scale;
  const tableHeaderHeight = 32 * scale;
  const rowHeight = 38 * scale;
  const allRows = statsRows && statsRows.length ? statsRows : rows;
  const inactiveStreamers = allRows.filter((r) => !r.isLive);
  const notLivePeopleCount = notLiveCount ?? inactiveStreamers.length;
  const showInactiveFooter =
    opts.showInactiveFooter ?? (pageCount <= 1 || pageIndex >= pageCount);
  const hasInactive = showInactiveFooter && inactiveStreamers.length > 0;
  const liveRows = allRows.filter((r) => r.isLive);

  ctx.font = `bold ${22 * scale}px sans-serif`;
  const titleW = ctx.measureText(titleText).width;
  const naturalColumnsWidth = measureNaturalColumnsWidth(ctx, scale, rows, visibleColumns, columnWidths, "classic", notLiveDaysLabel, dailyWaveLabel);
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

  const cols = buildColumns(ctx, scale, containerW - tablePaddingX * 2, rows, visibleColumns, columnWidths, "classic", notLiveDaysLabel, dailyWaveLabel);
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
    // 表头列名统一居中
    ctx.textAlign = "center";
    ctx.fillText(col.label, drawX + col.width / 2, y + tableHeaderHeight / 2);
  });
  y += tableHeaderHeight;

  const maxWave = liveRows.length > 0
    ? Math.max(...liveRows.map((r) => r.dailyWave))
    : 1;
  const safeMaxWave = maxWave > 0 ? maxWave : 1;
  // 时长进度条基准：全量行中当月时长最大值（分页时两页比例一致）
  const maxDuration = allRows.reduce((m, r) => Math.max(m, Number(r.totalDuration) || 0), 0);
  const safeMaxDuration = maxDuration > 0 ? maxDuration : 1;

  rows.forEach((row, index) => {
    const rank = rankOffset + index + 1;
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
        const padX = 8 * scale;
        const barH = 22 * scale;
        const barLeft = drawX + padX;
        const barTrackW = Math.max(48 * scale, col.width - padX * 2);
        const barTop = cy - barH / 2;
        if (isInactive) {
          ctx.fillStyle = "#FEE2E2";
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, barTrackW, barH, barH / 2);
          ctx.fill();
          ctx.fillStyle = "#DC2626";
          ctx.font = `bold ${13 * scale}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("未开播", barLeft + barTrackW / 2, cy);
        } else {
          const waveText = formatWave(row.dailyWave);
          const fillW = Math.max(
            0,
            Math.min(barTrackW, (barTrackW * row.dailyWave) / safeMaxWave)
          );
          ctx.fillStyle = "#DBEAFE";
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, barTrackW, barH, barH / 2);
          ctx.fill();
          if (fillW > 0) {
            ctx.fillStyle = "#60A5FA";
            ctx.beginPath();
            drawRoundRect(ctx, barLeft, barTop, Math.max(fillW, barH), barH, barH / 2);
            ctx.fill();
          }
          // 数字画在进度条内居中
          ctx.font = `bold ${13 * scale}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = fillW / Math.max(barTrackW, 1) > 0.52 ? "#FFFFFF" : "#1E3A8A";
          ctx.fillText(truncateCanvasText(ctx, waveText, barTrackW - 12 * scale), barLeft + barTrackW / 2, cy);
        }
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
        const padX = 8 * scale;
        const barH = 22 * scale;
        const barLeft = drawX + padX;
        const barTrackW = Math.max(48 * scale, col.width - padX * 2);
        const barTop = cy - barH / 2;
        const dur = Number(row.totalDuration) || 0;
        if (dur <= 0) {
          ctx.fillStyle = "#F1F5F9";
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, barTrackW, barH, barH / 2);
          ctx.fill();
          ctx.fillStyle = "#94A3B8";
          ctx.font = `bold ${13 * scale}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("—", barLeft + barTrackW / 2, cy);
        } else {
          const durText = formatDailyDurationText(dur);
          const fillW = Math.max(0, Math.min(barTrackW, (barTrackW * dur) / safeMaxDuration));
          ctx.fillStyle = "#EDE9FE";
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, barTrackW, barH, barH / 2);
          ctx.fill();
          if (fillW > 0) {
            ctx.fillStyle = "#A78BFA";
            ctx.beginPath();
            drawRoundRect(ctx, barLeft, barTop, Math.max(fillW, barH), barH, barH / 2);
            ctx.fill();
          }
          ctx.font = `bold ${13 * scale}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = fillW / Math.max(barTrackW, 1) > 0.52 ? "#FFFFFF" : "#5B21B6";
          ctx.fillText(truncateCanvasText(ctx, durText, barTrackW - 12 * scale), barLeft + barTrackW / 2, cy);
        }
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
  const totalCount = allRows.length;
  const pageCountLabel =
    pageCount > 1 ? `本页 ${rows.length} 人 · 共 ${totalCount} 人` : `${genderText}主播 ${totalCount} 人`;
  const summaryText = `${pageCountLabel} · 未开播人数 ${notLivePeopleCount} 人 · 未开播天数 ${notLiveDays} 天`;
  ctx.fillText(truncateCanvasText(ctx, summaryText, containerW - tablePaddingX * 2), tablePaddingX, y + 26 * scale);
  ctx.font = `${12 * scale}px sans-serif`;
  ctx.fillStyle = "#64748B";
  ctx.fillText(`数据日期 ${formattedDate}`, tablePaddingX, y + 50 * scale);

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

function drawAppleInlineWaveBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  text: string,
  scale: number,
  font: string,
  color: string,
  trackColor = "#EAF3FF",
  trackBorder = "#D6E8FF"
) {
  const radius = h / 2;
  const fillW = Math.max(0, Math.min(w, w * ratio));

  ctx.fillStyle = trackColor;
  ctx.beginPath();
  drawRoundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  ctx.strokeStyle = trackBorder;
  ctx.lineWidth = 1 * scale;
  ctx.beginPath();
  drawRoundRect(ctx, x, y, w, h, radius);
  ctx.stroke();

  if (fillW > 0) {
    ctx.fillStyle = color;
    ctx.beginPath();
    drawRoundRect(ctx, x, y, Math.max(fillW, h), h, radius);
    ctx.fill();
  }

  ctx.font = `800 ${Math.max(10, 12 * scale)}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = fillW / Math.max(w, 1) > 0.52 ? "#FFFFFF" : "#1D4ED8";
  ctx.fillText(truncateCanvasText(ctx, text, w - 12 * scale), x + w / 2, y + h / 2 + 0.5 * scale);
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
    rankOffset = 0,
    pageIndex = 1,
    pageCount = 1,
    statsRows,
  } = opts;
  const font = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", sans-serif';
  const mono = '"SF Mono", "Menlo", "Consolas", monospace';
  // 未传自定义标题时按性别默认：男团星嗨 / 女队薇笑（不按样式反推）
  const titleBaseRaw = customTitle.trim()
    || (gender === "female" ? "薇笑传媒主播数据统计" : "星嗨艺创主播数据统计");
  const pageSuffix = formatDailyReportPageSuffix(pageIndex, pageCount);
  const titleBase = pageSuffix ? `${titleBaseRaw} ${pageSuffix}` : titleBaseRaw;
  const genderText = gender === "male" ? "男团" : "女队";
  const notLiveDaysLabel = formatMonthNotLiveDaysLabel(date);
  const dailyWaveLabel = formatDailyWaveLabel(date);
  const allRows = statsRows && statsRows.length ? statsRows : rows;
  const liveRows = allRows.filter((r) => r.isLive);
  const inactiveRows = allRows.filter((r) => !r.isLive);
  const notLivePeopleCount = notLiveCount ?? inactiveRows.length;
  const showInactiveFooter =
    opts.showInactiveFooter ?? (pageCount <= 1 || pageIndex >= pageCount);
  const maxWave = liveRows.length > 0 ? Math.max(...liveRows.map((r) => r.dailyWave)) : 1;
  // 时长进度条基准：全量行中当月时长最大值（分页时两页比例一致）
  const maxDuration = allRows.reduce((m, r) => Math.max(m, Number(r.totalDuration) || 0), 0);

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
  const footerH =
    footerTextGap +
    footerTextH +
    (showInactiveFooter && inactiveRows.length > 0 ? warnGap + warnH : 0);

  const activeColumnCount = getVisibleColumnDefinitions(
    visibleColumns,
    "apple",
    notLiveDaysLabel,
    dailyWaveLabel
  ).length;
  const denseColumns = activeColumnCount >= 7;
  const densityBreathingRoom = Math.max(0, activeColumnCount - 5) * 18 * scale;
  const naturalColumnsWidth = measureNaturalColumnsWidth(ctx, scale, rows, visibleColumns, columnWidths, "apple", notLiveDaysLabel, dailyWaveLabel);
  const canvasW = Math.max(
    560 * scale,
    Math.min(2200 * scale, naturalColumnsWidth + densityBreathingRoom + pagePad * 2 + cardPad * 2)
  );
  const cardX = pagePad;
  const cardY = pagePad;
  const cardW = canvasW - pagePad * 2;
  const tableW = cardW - cardPad * 2;
  const cols = buildColumns(ctx, scale, tableW, rows, visibleColumns, columnWidths, "apple", notLiveDaysLabel, dailyWaveLabel);
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
  const purple = "#8B5CF6";
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
    // 表头列名统一居中
    ctx.textAlign = "center";
    ctx.fillText(col.label, drawX + col.width / 2, y + tableHeaderH / 2);
  });
  y += tableHeaderH + rowGap;

  rows.forEach((row, index) => {
    const rank = rankOffset + index + 1;
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
        const padX = 8 * scale;
        const barX = drawX + padX;
        const barW = Math.max(48 * scale, col.width - padX * 2);
        const barH = denseColumns ? 20 * scale : 22 * scale;
        if (isInactive) {
          ctx.fillStyle = "#FEE4E2";
          ctx.beginPath();
          drawRoundRect(ctx, barX, cy - barH / 2, barW, barH, barH / 2);
          ctx.fill();
          ctx.fillStyle = "#D92D20";
          ctx.font = `700 ${13 * scale}px ${font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("未开播", barX + barW / 2, cy);
        } else {
          // 数字画在进度条内居中；条占满整列
          drawAppleInlineWaveBar(
            ctx,
            barX,
            cy - barH / 2,
            barW,
            barH,
            row.dailyWave / Math.max(maxWave, 1),
            formatWave(row.dailyWave),
            scale,
            mono,
            blue
          );
        }
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
        const padX = 8 * scale;
        const barX = drawX + padX;
        const barW = Math.max(48 * scale, col.width - padX * 2);
        const barH = denseColumns ? 20 * scale : 22 * scale;
        const dur = Number(row.totalDuration) || 0;
        if (dur <= 0) {
          drawAppleInlineWaveBar(
            ctx,
            barX,
            cy - barH / 2,
            barW,
            barH,
            0,
            "-",
            scale,
            mono,
            purple,
            "#F1F1F3",
            "#E4E4E7"
          );
        } else {
          drawAppleInlineWaveBar(
            ctx,
            barX,
            cy - barH / 2,
            barW,
            barH,
            dur / Math.max(maxDuration, 1),
            formatDurationText(dur),
            scale,
            mono,
            purple,
            "#F3F0FF",
            "#E5E0FF"
          );
        }
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
  const totalCount = allRows.length;
  const peopleLabel =
    pageCount > 1 ? `本页 ${rows.length}/${totalCount} 人` : `${genderText} ${totalCount} 人`;
  ctx.fillText(`数据日期 ${formatAppleDate(date)} · ${peopleLabel}`, tableX + 8 * scale, y);
  ctx.textAlign = "right";
  ctx.fillText(`未开播人数 ${notLivePeopleCount} 人 · 未开播天数 ${notLiveDays} 天`, tableX + tableW - 8 * scale, y);
  ctx.textAlign = "center";
  ctx.fillStyle = "#98A2B3";
  ctx.font = `700 ${12 * scale}px ${font}`;
  ctx.fillText("内部数据 · 请勿外传", tableX + tableW / 2, y);

  if (showInactiveFooter && inactiveRows.length > 0) {
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
