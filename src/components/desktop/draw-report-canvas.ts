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

/** 绘制线性渐变填充矩形 */
function drawGradientRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  grad: CanvasGradient
) {
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
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

/* ────────────────── 配色常量 ────────────────── */

const C = {
  bg: "#F1F5F9",
  cardBg: "#FFFFFF",
  titleGradStart: "#0F172A",
  titleGradEnd: "#334155",
  headerBg: "#F8FAFC",
  headerBorder: "#CBD5E1",
  headerText: "#334155",
  rowOdd: "#FFFFFF",
  rowEven: "#F8FAFC",
  rowBorder: "#E2E8F0",
  rank1Bg: "#FEF3C7",
  rank2Bg: "#F1F5F9",
  rank3Bg: "#FFEDD5",
  nameText: "#0F172A",
  nameTop: "#0F172A",
  waveTrackBg: "#E2E8F0",
  waveBarGradStart: "#3B82F6",
  waveBarGradEnd: "#60A5FA",
  waveText: "#1E293B",
  waveInactive: "#EF4444",
  totalWaveText: "#475569",
  durationText: "#7C3AED",
  masterText: "#64748B",
  footerBg: "#F8FAFC",
  footerBorder: "#E2E8F0",
  footerTitle: "#0F172A",
  footerMeta: "#64748B",
  footerInactive: "#DC2626",
  footerInactiveText: "#991B1B",
};

const TIER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  A: { bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.3)", text: "#059669" },
  B: { bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.3)", text: "#2563EB" },
  C: { bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.3)", text: "#D97706" },
  D: { bg: "rgba(244, 63, 94, 0.12)", border: "rgba(244, 63, 94, 0.3)", text: "#E11D48" },
};

const RANK_MEDAL_COLORS: Record<number, { gradStart: string; gradEnd: string; text: string }> = {
  1: { gradStart: "#F59E0B", gradEnd: "#FBBF24", text: "#78350F" },
  2: { gradStart: "#94A3B8", gradEnd: "#CBD5E1", text: "#334155" },
  3: { gradStart: "#D97706", gradEnd: "#F59E0B", text: "#78350F" },
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
  const titleText = `${customTitle || `${genderText}主播数据统计`}`;
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
    ? wrapCanvasText(
        ctx,
        inactiveStreamers.map((r) => r.name).join("、"),
        containerW / 2 - 48 * scale
      )
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

  // ── 卡片外框（圆角白底 + 阴影模拟）──
  const cardX = margin;
  const cardY = margin;
  const cardW = innerW;
  const cardH = totalH - margin * 2;

  // 阴影
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.06)";
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

  // ── 标题栏（渐变背景）──
  const titleGrad = ctx.createLinearGradient(0, y, 0, y + headerHeight);
  titleGrad.addColorStop(0, C.titleGradStart);
  titleGrad.addColorStop(1, C.titleGradEnd);
  drawGradientRect(ctx, cardX, y, cardW, headerHeight, titleGrad);

  // 标题左侧装饰条
  const decoW = 5 * scale;
  const decoGrad = ctx.createLinearGradient(0, y, 0, y + headerHeight);
  decoGrad.addColorStop(0, "#3B82F6");
  decoGrad.addColorStop(1, "#60A5FA");
  ctx.fillStyle = decoGrad;
  ctx.fillRect(cardX + tablePaddingX, y + headerHeight * 0.25, decoW, headerHeight * 0.5);

  // 标题文字
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${24 * scale}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(titleText, cardX + tablePaddingX + decoW + 14 * scale, y + headerHeight * 0.38);

  // 副标题（日期）
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.font = `${13 * scale}px sans-serif`;
  ctx.fillText(subtitleText, cardX + tablePaddingX + decoW + 14 * scale, y + headerHeight * 0.72);

  // 右上角人数标签
  ctx.font = `bold ${13 * scale}px sans-serif`;
  const countText = `共 ${rows.length} 人`;
  const countW = ctx.measureText(countText).width + 28 * scale;
  const countH = 28 * scale;
  const countX = cardX + cardW - tablePaddingX - countW;
  const countY = y + (headerHeight - countH) / 2;
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.beginPath();
  drawRoundRect(ctx, countX, countY, countW, countH, countH / 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.textAlign = "center";
  ctx.fillText(countText, countX + countW / 2, countY + countH / 2);

  y += headerHeight;

  // ── 表头 ──
  ctx.fillStyle = C.headerBg;
  ctx.fillRect(cardX, y, cardW, tableHeaderHeight);
  // 表头底部强调线
  ctx.fillStyle = C.headerBorder;
  ctx.fillRect(cardX, y + tableHeaderHeight - 2 * scale, cardW, 2 * scale);

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

  // ── 数据行 ──
  const maxWave = rows.filter((r) => r.isLive).length > 0
    ? Math.max(...rows.filter((r) => r.isLive).map((r) => r.dailyWave))
    : 1;

  rows.forEach((row, index) => {
    const rank = index + 1;
    const isTop3 = rank <= 3;
    const isInactive = !row.isLive;

    // 行背景
    let rowBg =
      rank === 1 ? C.rank1Bg :
      rank === 2 ? C.rank2Bg :
      rank === 3 ? C.rank3Bg :
      index % 2 === 0 ? C.rowOdd : C.rowEven;

    ctx.fillStyle = rowBg;
    ctx.fillRect(cardX, y, cardW, rowHeight);

    // 行分隔线
    ctx.strokeStyle = C.rowBorder;
    ctx.lineWidth = 0.5 * scale;
    ctx.beginPath();
    ctx.moveTo(cardX, y);
    ctx.lineTo(cardX + cardW, y);
    ctx.stroke();

    // 前3名左侧高亮条
    if (isTop3) {
      const mc = RANK_MEDAL_COLORS[rank];
      const barGrad = ctx.createLinearGradient(cardX, y, cardX, y + rowHeight);
      barGrad.addColorStop(0, mc.gradStart);
      barGrad.addColorStop(1, mc.gradEnd);
      ctx.fillStyle = barGrad;
      ctx.fillRect(cardX, y, 4 * scale, rowHeight);
    }

    cols.forEach((col) => {
      const drawX = cardX + tablePaddingX + col.x;
      const cy = y + rowHeight / 2;

      if (col.key === "rank") {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (isTop3) {
          const mc = RANK_MEDAL_COLORS[rank];
          const medalSize = 28 * scale;
          const mx = drawX + (col.width - medalSize) / 2;
          const my = cy - medalSize / 2;

          // 渐变圆形徽章
          const medalGrad = ctx.createLinearGradient(mx, my, mx, my + medalSize);
          medalGrad.addColorStop(0, mc.gradStart);
          medalGrad.addColorStop(1, mc.gradEnd);
          ctx.fillStyle = medalGrad;
          ctx.beginPath();
          ctx.arc(mx + medalSize / 2, cy, medalSize / 2, 0, Math.PI * 2);
          ctx.fill();

          // 徽章数字
          ctx.fillStyle = "#FFFFFF";
          ctx.font = `bold ${14 * scale}px sans-serif`;
          ctx.fillText(String(rank), drawX + col.width / 2, cy + 1 * scale);
        } else {
          ctx.fillStyle = "#94A3B8";
          ctx.font = `bold ${14 * scale}px sans-serif`;
          ctx.fillText(String(rank).padStart(2, "0"), drawX + col.width / 2, cy);
        }
      } else if (col.key === "name") {
        ctx.textAlign = "left";
        ctx.fillStyle = isTop3 ? C.nameTop : C.nameText;
        ctx.font = `${isTop3 ? "bold " : ""}${15 * scale}px sans-serif`;
        const text = truncateCanvasText(ctx, row.name, col.width - 24 * scale);
        ctx.fillText(text, drawX + 10 * scale, cy);
      } else if (col.key === "dailyWave") {
        if (!isInactive) {
          const barAreaW = col.width - 28 * scale;
          const barH = 16 * scale;
          const barTop = cy - barH / 2;
          const barLeft = drawX + 8 * scale;

          // 进度条轨道
          ctx.fillStyle = C.waveTrackBg;
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, barAreaW, barH, barH / 2);
          ctx.fill();

          // 进度条填充
          const barW = Math.max((barAreaW * row.dailyWave) / maxWave, 20 * scale);
          const barGrad = ctx.createLinearGradient(barLeft, 0, barLeft + barW, 0);
          barGrad.addColorStop(0, C.waveBarGradStart);
          barGrad.addColorStop(1, C.waveBarGradEnd);
          ctx.fillStyle = barGrad;
          ctx.beginPath();
          drawRoundRect(ctx, barLeft, barTop, Math.min(barW, barAreaW), barH, barH / 2);
          ctx.fill();
        }
        ctx.textAlign = "right";
        ctx.font = `bold ${14 * scale}px monospace`;
        ctx.fillStyle = isInactive ? C.waveInactive : C.waveText;
        ctx.fillText(isInactive ? "未开播" : formatWave(row.dailyWave), drawX + col.width - 10 * scale, cy);
      } else if (col.key === "totalWave") {
        ctx.textAlign = "right";
        ctx.font = `${14 * scale}px monospace`;
        ctx.fillStyle = C.totalWaveText;
        ctx.fillText(formatWave(row.totalWave), drawX + col.width - 10 * scale, cy);
      } else if (col.key === "tier") {
        if (row.tier) {
          const bw = Math.min(col.width - 16 * scale, 60 * scale);
          const bh = 24 * scale;
          const bl = drawX + (col.width - bw) / 2;
          const bt = cy - bh / 2;
          const tierLetter = (row.tier.charAt(0) || "D").toUpperCase();
          const tc = TIER_COLORS[tierLetter] || TIER_COLORS.D;

          // 等级徽章背景
          ctx.fillStyle = tc.bg;
          ctx.beginPath();
          drawRoundRect(ctx, bl, bt, bw, bh, bh / 2);
          ctx.fill();

          // 边框
          ctx.strokeStyle = tc.border;
          ctx.lineWidth = 1 * scale;
          ctx.beginPath();
          drawRoundRect(ctx, bl, bt, bw, bh, bh / 2);
          ctx.stroke();

          // 文字
          ctx.fillStyle = tc.text;
          ctx.font = `bold ${13 * scale}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(row.tier, drawX + col.width / 2, cy + 1 * scale);
        }
      } else if (col.key === "duration") {
        ctx.textAlign = "center";
        ctx.fillStyle = C.durationText;
        ctx.font = `${13 * scale}px sans-serif`;
        const dText = row.isLive && row.dailyDuration > 0
          ? formatDurationText(row.dailyDuration)
          : "—";
        ctx.fillText(dText, drawX + col.width / 2, cy);
      } else if (col.key === "master") {
        ctx.textAlign = "left";
        ctx.fillStyle = C.masterText;
        ctx.font = `${13 * scale}px sans-serif`;
        const text = truncateCanvasText(ctx, row.masterName || "—", col.width - 24 * scale);
        ctx.fillText(text, drawX + 10 * scale, cy);
      }
    });

    y += rowHeight;
  });

  // ── 底部 ──
  ctx.fillStyle = C.footerBg;
  ctx.fillRect(cardX, y, cardW, footerHeight);
  // 顶部分隔线
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

  ctx.restore(); // 恢复裁剪
}
