import type { RosterEntry } from "@/types/electron";
import { downloadCanvasAsPng } from "./export-image";

interface RosterPosterOptions {
  surname: string;
  entries: RosterEntry[];
}

const COLORS = {
  浩: { primary: "#007AFF", bg: "#F0F7FF", border: "#84CAFF", chipBg: "rgba(0,122,255,0.12)" },
  狼: { primary: "#34C759", bg: "#F0FDF4", border: "#86EFAC", chipBg: "rgba(52,199,89,0.12)" },
  玖: { primary: "#FF9500", bg: "#FFF7ED", border: "#FDBA74", chipBg: "rgba(255,149,0,0.14)" },
  啸: { primary: "#AF52DE", bg: "#FAF5FF", border: "#D8B4FE", chipBg: "rgba(175,82,222,0.12)" },
} as const;

function getColor(surname: string) {
  return COLORS[surname as keyof typeof COLORS] || {
    primary: "#8E8E93",
    bg: "#FFFFFF",
    border: "#EAECF0",
    chipBg: "rgba(142,142,147,0.12)",
  };
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
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

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

export async function exportRosterPoster({ surname, entries }: RosterPosterOptions): Promise<void> {
  const scale = 2;
  const c = getColor(surname);

  // 布局参数
  const cols = entries.length > 20 ? 2 : 1;
  const rowH = 44;
  const headerH = 120;
  const footerH = 40;
  const padX = 48;
  const padY = 32;
  const colGap = 40;

  // 列宽
  const colW = cols === 2 ? 380 : 560;
  const perCol = Math.ceil(entries.length / cols);

  const posterW = padX * 2 + cols * colW + (cols - 1) * colGap;
  const posterH = Math.max(400, headerH + perCol * rowH + footerH + padY);

  const canvas = document.createElement("canvas");
  canvas.width = posterW * scale;
  canvas.height = posterH * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // 背景
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, posterW, posterH);

  const glow = ctx.createRadialGradient(posterW / 2, posterH * 0.04, 0, posterW / 2, posterH * 0.04, Math.max(posterW, posterH) * 0.7);
  glow.addColorStop(0, c.chipBg);
  glow.addColorStop(0.5, "rgba(255,255,255,0.92)");
  glow.addColorStop(1, "#FFFFFF");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, posterW, posterH);

  // 标题
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = c.primary;
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(`${surname}字辈名单`, posterW / 2, padY);

  // 统计
  ctx.fillStyle = "#667085";
  ctx.font = "14px sans-serif";
  const totalWave = entries.reduce((s, e) => s + (e.dailyWave || 0), 0);
  ctx.fillText(
    `共 ${entries.length} 人 · 合计日音浪 ${totalWave.toLocaleString()}`,
    posterW / 2,
    padY + 38
  );

  // 分割线
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, padY + 68);
  ctx.lineTo(posterW - padX, padY + 68);
  ctx.stroke();

  // 表头
  const headerY = padY + 80;
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "#667085";
  ctx.textBaseline = "middle";

  for (let col = 0; col < cols; col++) {
    const x = padX + col * (colW + colGap);
    const colEntries = entries.slice(col * perCol, (col + 1) * perCol);

    // 列背景
    if (colEntries.length > 0) {
      const colTop = headerY;
      const colBottom = headerY + colEntries.length * rowH + 8;
      ctx.fillStyle = c.chipBg;
      drawRoundRect(ctx, x - 8, colTop - 4, colW + 16, colBottom - colTop, 12);
      ctx.fill();
    }

    // 排名 / 姓名 / 师傅 / 日音浪
    ctx.textAlign = "left";
    ctx.fillStyle = "#667085";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("#", x + 12, headerY + 2);
    ctx.fillText("姓名", x + 44, headerY + 2);
    ctx.fillText("师傅", x + 160, headerY + 2);
    ctx.textAlign = "right";
    ctx.fillText("日音浪", x + colW - 12, headerY + 2);

    // 名单
    for (let i = 0; i < colEntries.length; i++) {
      const e = colEntries[i];
      const y = headerY + (i + 1) * rowH + rowH / 2 - 4;

      // 排名
      ctx.textAlign = "left";
      ctx.fillStyle = c.primary;
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(`${col * perCol + i + 1}`, x + 10, y);

      // 姓名
      ctx.fillStyle = "#101828";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(truncate(ctx, e.name, 110), x + 36, y);

      // 师傅
      ctx.fillStyle = "#667085";
      ctx.font = "12px sans-serif";
      ctx.fillText(truncate(ctx, e.masterName || "—", 80), x + 150, y);

      // 日音浪
      ctx.textAlign = "right";
      ctx.fillStyle = e.dailyWave > 0 ? c.primary : "#9CA3AF";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(
        e.dailyWave > 0 ? e.dailyWave.toLocaleString() : "—",
        x + colW - 12,
        y
      );
    }
  }

  // 底部
  ctx.textAlign = "center";
  ctx.fillStyle = "#9CA3AF";
  ctx.font = "11px sans-serif";
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  ctx.fillText(`${surname}字辈 · ${dateStr} · 共 ${entries.length} 人`, posterW / 2, posterH - footerH + 8);

  await downloadCanvasAsPng(canvas, `${surname}字辈名单-${dateStr}.png`);
}
