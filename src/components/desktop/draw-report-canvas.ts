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
  { key: "rank",      label: "排名",      defaultVisible: true },
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
    { key: "rank",      label: "排名",           minWidth: 88,  flex: 0.8, align: "center", getText: (r, i) => `${i + 1}${r.rankDelta ? r.rankDelta : ""}` },
    { key: "name",      label: "主播姓名",       minWidth: 150, flex: 1.4, align: "left",   getText: (r) => r.name },
    { key: "dailyWave", label: `${day}号音浪`,    minWidth: 180, flex: 2.0, align: "right",  getText: (r) => (r.isLive ? formatWave(r.dailyWave) : "未开播") },
    { key: "totalWave", label: "累计总音浪",     minWidth: 160, flex: 1.4, align: "right",  getText: (r) => formatWave(r.totalWave) },
    { key: "tier",      label: "等级",           minWidth: 90,  flex: 0.8, align: "center", getText: (r) => r.tier || "" },
    { key: "duration",  label: "有效时长",       minWidth: 110, flex: 1.0, align: "center", getText: (r) => r.isLive && r.dailyDuration > 0 ? formatDurationText(r.dailyDuration) : "—" },
    { key: "master",    label: "师傅",           minWidth: 110, flex: 1.0, align: "left",   getText: (r) => r.masterName || "—" },
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
 *  主绘制函数 — 旧项目浅色自适应表格
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

  const { date, rows, gender, customTitle = "", scale = 2, visibleColumns = DEFAULT_VISIBLE_COLUMNS } = opts;

  const parts = date.split("-");
  const year  = parseInt(parts[0]) || 2026;
  const month = parseInt(parts[1]) || 1;
  const day   = parseInt(parts[2]) || 1;
  const formattedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const genderText = gender === "male" ? "男" : "女";
  const titleBase = customTitle.trim() || "薇笑传媒主播数据统计";
  const titleText = `${titleBase} ${formattedDate}`;
  const tablePaddingX = 20 * scale;
  const headerHeight = 54 * scale;
  const tableHeaderHeight = 32 * scale;
  const rowHeight = 38 * scale;
  const inactiveStreamers = rows.filter((r) => !r.isLive);
  const hasInactive = inactiveStreamers.length > 0;
  const liveRows = rows.filter((r) => r.isLive);

  ctx.font = `bold ${22 * scale}px sans-serif`;
  const titleW = ctx.measureText(titleText).width;
  const estimatedColumns = buildColumns(ctx, scale, 760 * scale, date, rows, visibleColumns);
  const estimatedWidth = estimatedColumns.reduce((sum, column) => sum + column.width, 0);
  const containerW = Math.max(
    680 * scale,
    Math.min(980 * scale, Math.max(titleW + 100 * scale, estimatedWidth + tablePaddingX * 2))
  );

  ctx.font = `${11 * scale}px sans-serif`;
  const inactiveLines = hasInactive
    ? wrapCanvasText(
        ctx,
        groupInactiveStreamers(inactiveStreamers),
        containerW / 2 - 40 * scale
      )
    : [];
  const footerHeight = hasInactive
    ? Math.max(96 * scale, (70 + inactiveLines.length * 18) * scale)
    : 64 * scale;

  const cols = buildColumns(ctx, scale, containerW - tablePaddingX * 2, date, rows, visibleColumns);
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
  if (hasInactive) {
    const badgeText = `未开播 ${inactiveStreamers.length}`;
    ctx.font = `bold ${12 * scale}px sans-serif`;
    const badgeW = Math.max(82 * scale, ctx.measureText(badgeText).width + 24 * scale);
    const badgeH = 24 * scale;
    const badgeX = containerW - tablePaddingX - badgeW;
    const badgeY = y + (headerHeight - badgeH) / 2;
    ctx.fillStyle = "#FEE2E2";
    ctx.beginPath();
    drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 12 * scale);
    ctx.fill();
    ctx.strokeStyle = "#FCA5A5";
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 12 * scale);
    ctx.stroke();
    ctx.fillStyle = "#B91C1C";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5 * scale);
  }
  y += headerHeight;

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
        const text = truncateCanvasText(ctx, row.name, col.width - 24 * scale);
        ctx.fillText(text, drawX + 12 * scale, cy);
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
  ctx.fillText(`${genderText}主播 ${rows.length} 人`, tablePaddingX, y + 26 * scale);
  ctx.font = `${12 * scale}px sans-serif`;
  ctx.fillStyle = "#64748B";
  ctx.fillText(`导出日期 ${formattedDate}`, tablePaddingX, y + 50 * scale);

  if (hasInactive) {
    const warnX = containerW / 2 - 8 * scale;
    const warnY = y + 14 * scale;
    const warnW = containerW / 2 - tablePaddingX + 8 * scale;
    const warnH = footerHeight - 28 * scale;
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
