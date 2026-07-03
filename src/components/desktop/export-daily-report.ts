// 每日报告海报导出 - #00b8ff 蓝色渐变主题
// 与 export-family-poster.ts 使用完全一致的色彩体系和视觉风格
import type { DailyReportRow } from "@/types/electron";
import { formatWave, formatDuration } from "./format";
import { downloadCanvasAsPng } from "./export-image";

// 主题色 —— 与族谱海报完全一致
const C = {
  cyan: "#00f5d4",
  blue: "#00b8ff",
  bg1: "#0a0f1c",
  bg2: "#020617",
  bg3: "#000000",
  panel: "rgba(10, 24, 37, 0.88)",
  panelBorder: "rgba(255, 255, 255, 0.08)",
  text: "#f8fafc",
  textMuted: "#94a3b8",
  textCyan: "#a5f3fc",
  white92: "rgba(255, 255, 255, 0.92)",
  white04: "rgba(255, 255, 255, 0.04)",
  pink: "#f472b6",
};

/** 绘制圆角矩形路径 */
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

/** 等级颜色 */
function tierColors(tier: string): { bg: string; text: string } {
  const c = tier.charAt(0).toUpperCase();
  switch (c) {
    case "A": return { bg: "rgba(16, 185, 129, 0.18)", text: "#34d399" };
    case "B": return { bg: "rgba(56, 189, 248, 0.18)", text: "#38bdf8" };
    case "C": return { bg: "rgba(251, 191, 36, 0.18)", text: "#fbbf24" };
    case "D": return { bg: "rgba(244, 63, 94, 0.18)", text: "#f43f5e" };
    default: return { bg: "rgba(255, 255, 255, 0.06)", text: C.textMuted };
  }
}

/** 截断文字 */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

interface ExportOptions {
  rows: DailyReportRow[];
  date: string;
  gender: "male" | "female";
  visibleCols: Record<string, boolean>;
  filename?: string;
}

/** 将每日报告导出为海报风格 PNG 并下载 */
export async function exportDailyReportPoster(opts: ExportOptions): Promise<void> {
  const { rows, date, gender, visibleCols, filename } = opts;
  const scale = 2;

  const showDailyWave = visibleCols.dailyWave !== false;
  const showTotalWave = visibleCols.totalWave !== false;
  const showDuration = visibleCols.duration !== false;
  const showTier = visibleCols.tier !== false;

  const maxDailyWave = rows.length > 0 ? Math.max(...rows.map((r) => r.dailyWave)) : 0;
  const genderLabel = gender === "male" ? "男主播" : "女主播";
  const teamLabel = gender === "male" ? "男队" : "女队";

  // ---- 1. 尺寸计算 ----
  const posterW = 1080;
  const borderW = 6;
  const padX = borderW + 18;
  const contentW = posterW - padX * 2;

  const headerH = 110;
  const rowH = 44;
  const tableHeaderH = 36;
  const footerH = 64;
  const tableH = tableHeaderH + rows.length * rowH;
  const summaryH = 40;
  const neededH = headerH + tableH + summaryH + footerH + 60;
  const posterH = Math.max(posterW, neededH);

  // ---- 2. Canvas 初始化 ----
  const canvas = document.createElement("canvas");
  canvas.width = posterW * scale;
  canvas.height = posterH * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // ---- 3. 背景：径向渐变 + 网格线 + 右上光效 ----
  const bgGrad = ctx.createRadialGradient(
    posterW * 0.5, posterH * 0.18, 0,
    posterW * 0.5, posterH * 0.18, posterH * 0.85
  );
  bgGrad.addColorStop(0, C.bg1);
  bgGrad.addColorStop(0.62, C.bg2);
  bgGrad.addColorStop(1, C.bg3);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, posterW, posterH);

  // 右上角径向光效
  const topRightGrad = ctx.createRadialGradient(posterW, 0, 0, posterW, 0, posterW * 0.4);
  topRightGrad.addColorStop(0, "rgba(0, 245, 212, 0.16)");
  topRightGrad.addColorStop(1, "transparent");
  ctx.fillStyle = topRightGrad;
  ctx.fillRect(0, 0, posterW, posterH);

  // 网格线
  ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx < posterW; gx += 28) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, posterH); ctx.stroke();
  }
  for (let gy = 0; gy < posterH; gy += 28) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(posterW, gy); ctx.stroke();
  }

  // ---- 4. 外边框：渐变边框 ----
  const borderGrad = ctx.createLinearGradient(0, 0, posterW, 0);
  borderGrad.addColorStop(0, C.cyan);
  borderGrad.addColorStop(1, C.blue);
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = borderW;
  ctx.strokeRect(borderW / 2, borderW / 2, posterW - borderW, posterH - borderW);

  ctx.strokeStyle = C.white04;
  ctx.lineWidth = 1;
  ctx.strokeRect(borderW + 1, borderW + 1, posterW - borderW * 2 - 2, posterH - borderW * 2 - 2);

  // ---- 5. 标题面板 ----
  const panelX = padX;
  const panelW = contentW;
  const panelY = borderW + 18;
  const panelH = 80;

  drawRoundRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.fillStyle = C.panel;
  ctx.fill();
  drawRoundRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.strokeStyle = C.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 标题图标
  const iconSize = 48;
  const iconX = panelX + 20;
  const iconY = panelY + (panelH - iconSize) / 2;
  drawRoundRect(ctx, iconX, iconY, iconSize, iconSize, 14);
  const iconGrad = ctx.createLinearGradient(iconX, iconY, iconX + iconSize, iconY + iconSize);
  iconGrad.addColorStop(0, "rgba(0, 245, 212, 0.18)");
  iconGrad.addColorStop(1, "rgba(0, 184, 255, 0.18)");
  ctx.fillStyle = iconGrad;
  ctx.fill();
  drawRoundRect(ctx, iconX, iconY, iconSize, iconSize, 14);
  ctx.strokeStyle = "rgba(0, 245, 212, 0.32)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = C.text;
  ctx.fillText("报", iconX + iconSize / 2, iconY + iconSize / 2);

  // 标题文字
  const titleX = iconX + iconSize + 16;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  ctx.font = "12px sans-serif";
  ctx.fillStyle = C.cyan;
  ctx.fillText(`${teamLabel} · 每日音浪`, titleX, panelY + 14);

  ctx.font = "bold 28px sans-serif";
  ctx.fillStyle = C.text;
  ctx.shadowColor = "rgba(0, 245, 212, 0.18)";
  ctx.shadowBlur = 24;
  ctx.fillText(`${genderLabel}音浪日报`, titleX, panelY + 34);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // 右侧人数卡片
  const dateCardW = 140;
  const dateCardH = 54;
  const dateCardX = panelX + panelW - dateCardW - 20;
  const dateCardY = panelY + (panelH - dateCardH) / 2;
  drawRoundRect(ctx, dateCardX, dateCardY, dateCardW, dateCardH, 16);
  ctx.fillStyle = "rgba(15, 37, 56, 0.82)";
  ctx.fill();
  drawRoundRect(ctx, dateCardX, dateCardY, dateCardW, dateCardH, 16);
  ctx.strokeStyle = "rgba(0, 245, 212, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "11px sans-serif";
  ctx.fillStyle = C.textMuted;
  ctx.fillText("人数", dateCardX + dateCardW / 2, dateCardY + 16);
  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = C.text;
  ctx.fillText(String(rows.length), dateCardX + dateCardW / 2, dateCardY + 38);

  // ---- 6. 表格 ----
  const tableX = padX;
  const tableY = panelY + panelH + 16;
  const tableW = contentW;

  // 表头背景
  drawRoundRect(ctx, tableX, tableY, tableW, tableHeaderH, 12);
  ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
  ctx.fill();

  // 列宽计算
  const rankColW = 50;
  const nameColW = 100;
  const tierColW = showTier ? 64 : 0;
  const durationColW = showDuration ? 90 : 0;
  const totalWaveColW = showTotalWave ? 110 : 0;
  const dailyWaveColW = tableW - rankColW - nameColW - tierColW - durationColW - totalWaveColW;

  // 绘制表头
  ctx.textBaseline = "middle";
  ctx.font = "12px sans-serif";
  ctx.fillStyle = C.textMuted;

  let colX = tableX;
  ctx.textAlign = "center";
  ctx.fillText("序号", colX + rankColW / 2, tableY + tableHeaderH / 2);
  colX += rankColW;

  ctx.textAlign = "left";
  ctx.fillText("主播", colX + 12, tableY + tableHeaderH / 2);
  colX += nameColW;

  if (showDailyWave) {
    ctx.textAlign = "center";
    ctx.fillText("当日音浪", colX + dailyWaveColW / 2, tableY + tableHeaderH / 2);
    colX += dailyWaveColW;
  }
  if (showTotalWave) {
    ctx.textAlign = "right";
    ctx.fillText("累计总音浪", colX + totalWaveColW - 12, tableY + tableHeaderH / 2);
    colX += totalWaveColW;
  }
  if (showDuration) {
    ctx.textAlign = "center";
    ctx.fillText("直播时长", colX + durationColW / 2, tableY + tableHeaderH / 2);
    colX += durationColW;
  }
  if (showTier) {
    ctx.textAlign = "center";
    ctx.fillText("等级", colX + tierColW / 2, tableY + tableHeaderH / 2);
    colX += tierColW;
  }

  // 表头底线
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tableX, tableY + tableHeaderH);
  ctx.lineTo(tableX + tableW, tableY + tableHeaderH);
  ctx.stroke();

  // 绘制数据行
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ry = tableY + tableHeaderH + i * rowH;

    // 行分隔线
    if (i > 0) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tableX + 12, ry);
      ctx.lineTo(tableX + tableW - 12, ry);
      ctx.stroke();
    }

    const rowYCenter = ry + rowH / 2;

    // 序号
    colX = tableX;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (r.rank <= 3) {
      const rankColors = ["#fbbf24", "#94a3b8", "#fb923c"];
      const rankBgColors = ["rgba(251,191,36,0.15)", "rgba(148,163,184,0.12)", "rgba(251,146,60,0.15)"];
      drawRoundRect(ctx, colX + rankColW / 2 - 12, rowYCenter - 12, 24, 24, 12);
      ctx.fillStyle = rankBgColors[r.rank - 1];
      ctx.fill();
      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = rankColors[r.rank - 1];
    } else {
      ctx.font = "12px sans-serif";
      ctx.fillStyle = C.textMuted;
    }
    ctx.fillText(String(r.rank), colX + rankColW / 2, rowYCenter);
    colX += rankColW;

    // 主播名
    ctx.textAlign = "left";
    ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = r.isLive ? C.white92 : C.textMuted;
    ctx.fillText(truncateText(ctx, r.name, nameColW - 16), colX + 12, rowYCenter);
    colX += nameColW;

    // 当日音浪
    if (showDailyWave) {
      if (r.isLive) {
        ctx.textAlign = "left";
        ctx.font = "13px sans-serif";
        ctx.fillStyle = C.text;
        const waveText = formatWave(r.dailyWave);
        ctx.fillText(waveText, colX + 12, rowYCenter);

        // 进度条
        const barX = colX + 12 + ctx.measureText(waveText).width + 10;
        const barW = Math.min(dailyWaveColW - ctx.measureText(waveText).width - 36, 100);
        if (barW > 20) {
          const barH = 6;
          const barY = rowYCenter - barH / 2;
          drawRoundRect(ctx, barX, barY, barW, barH, 3);
          ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
          ctx.fill();
          const fillW = maxDailyWave > 0 ? (r.dailyWave / maxDailyWave) * barW : 0;
          if (fillW > 0) {
            drawRoundRect(ctx, barX, barY, fillW, barH, 3);
            const barGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
            barGrad.addColorStop(0, C.cyan);
            barGrad.addColorStop(1, C.blue);
            ctx.fillStyle = barGrad;
            ctx.fill();
          }
        }
      } else {
        ctx.textAlign = "left";
        ctx.font = "bold 11px sans-serif";
        ctx.fillStyle = "#f43f5e";
        ctx.fillText("未开播", colX + 12, rowYCenter);
      }
      colX += dailyWaveColW;
    }

    // 累计总音浪
    if (showTotalWave) {
      ctx.textAlign = "right";
      ctx.font = "12px sans-serif";
      ctx.fillStyle = C.textMuted;
      ctx.fillText(formatWave(r.totalWave), colX + totalWaveColW - 12, rowYCenter);
      colX += totalWaveColW;
    }

    // 直播时长
    if (showDuration) {
      ctx.textAlign = "center";
      ctx.font = "12px sans-serif";
      ctx.fillStyle = C.textMuted;
      const durText = r.isLive && r.dailyDuration > 0
        ? formatDuration(r.dailyDuration)
        : r.isLive ? "0分钟" : "—";
      ctx.fillText(durText, colX + durationColW / 2, rowYCenter);
      colX += durationColW;
    }

    // 等级
    if (showTier) {
      if (r.tier) {
        const tc = tierColors(r.tier);
        const badgeW = 44;
        const badgeH = 22;
        const badgeX = colX + (tierColW - badgeW) / 2;
        const badgeY = rowYCenter - badgeH / 2;
        drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 6);
        ctx.fillStyle = tc.bg;
        ctx.fill();
        drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 6);
        ctx.strokeStyle = tc.text;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.textAlign = "center";
        ctx.font = "bold 11px sans-serif";
        ctx.fillStyle = tc.text;
        ctx.fillText(r.tier, colX + tierColW / 2, rowYCenter);
      }
      colX += tierColW;
    }
  }

  // ---- 7. 底部摘要 ----
  const summaryY = tableY + tableHeaderH + rows.length * rowH + 12;
  const notLiveCount = rows.filter((r) => !r.isLive).length;
  const notLiveNames = rows.filter((r) => !r.isLive).map((r) => r.name);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "12px sans-serif";
  ctx.fillStyle = C.textMuted;
  ctx.fillText(`${genderLabel} ${rows.length} 人  ·  导出日期 ${date}`, padX + 4, summaryY + 12);

  if (notLiveCount > 0) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#f43f5e";
    const notLiveText = `未开播 ${notLiveCount} 人：${notLiveNames.join("、")}`;
    ctx.fillText(truncateText(ctx, notLiveText, contentW - 200), padX + contentW - 4, summaryY + 12);
  }

  // ---- 8. 底部面板 ----
  const footerPanelY = posterH - borderW - 18 - 48;
  const footerPanelH = 48;
  drawRoundRect(ctx, panelX, footerPanelY, panelW, footerPanelH, 20);
  ctx.fillStyle = C.panel;
  ctx.fill();
  drawRoundRect(ctx, panelX, footerPanelY, panelW, footerPanelH, 20);
  ctx.strokeStyle = C.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 底部圆点 + 标题
  const dotX = panelX + 20;
  const dotY = footerPanelY + footerPanelH / 2;
  const dotGrad = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 5);
  dotGrad.addColorStop(0, C.cyan);
  dotGrad.addColorStop(1, C.blue);
  ctx.fillStyle = dotGrad;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "rgba(0, 245, 212, 0.48)";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = C.textCyan;
  ctx.fillText("每日报告导出", dotX + 14, dotY);

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  ctx.textAlign = "right";
  ctx.font = "12px sans-serif";
  ctx.fillStyle = C.textMuted;
  ctx.fillText(`导出日期 ${dateStr}`, panelX + panelW - 20, dotY);

  // ---- 9. 导出下载 ----
  await downloadCanvasAsPng(canvas, filename || `每日报告-${date}-${teamLabel}.png`);
}
