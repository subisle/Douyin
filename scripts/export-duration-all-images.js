"use strict";

/**
 * 全团时长统计图导出（男团+女团合并一张，无浏览器依赖）
 * 用法：node scripts/export-duration-all-images.js [2026-07 2026-08 ...]
 * 不传参默认导出 2026-07 与 2026-08。
 * 数据源：electron/db.js getMonthlyReport(month, "all")（与桌面端月报同口径）
 * 样式：对齐日报页「时长精简图」经典样式（序号/姓名/未播天数/当月时长 + 紫色时长进度条）
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { getMonthlyReport } = require("../electron/db");

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 分钟 → 「X时Y分 / X时 / Y分」，0 显示 —（与 draw-report-canvas 一致） */
function formatDurationText(minutes) {
  const m = Number(minutes) || 0;
  if (m <= 0) return "—";
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest > 0 ? `${h}时${rest}分` : `${h}时`;
  }
  return `${m}分`;
}

/** 粗略截断：按 CJK≈fontSize / ASCII≈fontSize*0.55 估宽 */
function truncateText(text, maxWidth, fontSize) {
  let w = 0;
  let out = "";
  for (const ch of String(text ?? "")) {
    const cw = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)
      ? fontSize
      : fontSize * 0.55;
    if (w + cw > maxWidth) return out + "…";
    w += cw;
    out += ch;
  }
  return out;
}

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const MONO = "'SF Mono','Menlo','Consolas',monospace";

// 设计尺寸（2x，与 canvas scale=2 对齐）
const PAD_X = 40;
const COL = { rank: 90, name: 240, notLiveDays: 150, duration: 280 };
const CONTENT_W = COL.rank + COL.name + COL.notLiveDays + COL.duration;
const W = CONTENT_W + PAD_X * 2;
const HEADER_H = 108;
const TABLE_HEADER_H = 64;
const ROW_H = 76;
const FOOTER_H = 128;

const colX = {
  rank: PAD_X,
  name: PAD_X + COL.rank,
  notLiveDays: PAD_X + COL.rank + COL.name,
  duration: PAD_X + COL.rank + COL.name + COL.notLiveDays,
};

function badge(rank) {
  const colors = { 1: "#FBBF24", 2: "#94A3B8", 3: "#FB923C" };
  const cx = colX.rank + COL.rank / 2;
  const cy = 0; // 相对行顶，由调用方平移
  return { colors, cx, cy };
}

function buildSvg(month, rows, summary) {
  const monthNum = Number(month.split("-")[1]);
  const title = `全团主播${monthNum}月数据统计`;
  const notLiveLabel = `${monthNum}月未播天数`;
  const maxDuration = rows.reduce((m, r) => Math.max(m, Number(r.totalDuration) || 0), 0) || 1;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HEADER_H + TABLE_HEADER_H + rows.length * ROW_H + FOOTER_H}" viewBox="0 0 ${W} ${HEADER_H + TABLE_HEADER_H + rows.length * ROW_H + FOOTER_H}">`
  );
  // 背景
  const totalH = HEADER_H + TABLE_HEADER_H + rows.length * ROW_H + FOOTER_H;
  parts.push(`<rect x="0" y="0" width="${W}" height="${totalH}" fill="#F8FAFC"/>`);

  // 标题栏
  parts.push(`<rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="#1E293B"/>`);
  parts.push(
    `<text x="${W / 2}" y="${HEADER_H / 2}" fill="#F8FAFC" font-family="${FONT}" font-size="44" font-weight="bold" text-anchor="middle" dominant-baseline="central">${escapeXml(title)}</text>`
  );

  // 表头
  let y = HEADER_H;
  parts.push(`<rect x="0" y="${y}" width="${W}" height="${TABLE_HEADER_H}" fill="#E2E8F0"/>`);
  const hy = y + TABLE_HEADER_H / 2;
  parts.push(
    `<text x="${colX.rank + COL.rank / 2}" y="${hy}" fill="#475569" font-family="${FONT}" font-size="26" font-weight="bold" text-anchor="middle" dominant-baseline="central">序号</text>`
  );
  parts.push(
    `<text x="${colX.name + 16}" y="${hy}" fill="#475569" font-family="${FONT}" font-size="26" font-weight="bold" text-anchor="start" dominant-baseline="central">姓名</text>`
  );
  parts.push(
    `<text x="${colX.notLiveDays + COL.notLiveDays / 2}" y="${hy}" fill="#475569" font-family="${FONT}" font-size="26" font-weight="bold" text-anchor="middle" dominant-baseline="central">${escapeXml(notLiveLabel)}</text>`
  );
  parts.push(
    `<text x="${colX.duration + COL.duration / 2}" y="${hy}" fill="#475569" font-family="${FONT}" font-size="26" font-weight="bold" text-anchor="middle" dominant-baseline="central">当月时长</text>`
  );
  y += TABLE_HEADER_H;

  // 数据行
  const badgeColors = { 1: "#FBBF24", 2: "#94A3B8", 3: "#FB923C" };
  rows.forEach((row, index) => {
    const rank = index + 1;
    const isInactive = !row.isLive;
    const dur = Number(row.totalDuration) || 0;

    let bg = index % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
    if (rank === 1) bg = "#FEF3C7";
    else if (rank === 2) bg = "#F8FAFC";
    else if (rank === 3) bg = "#FFEDD5";
    if (isInactive) bg = "#FEF2F2";
    parts.push(`<rect x="0" y="${y}" width="${W}" height="${ROW_H}" fill="${bg}"/>`);
    if (isInactive) {
      parts.push(`<rect x="0" y="${y}" width="8" height="${ROW_H}" fill="#DC2626"/>`);
    }
    parts.push(
      `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${isInactive ? "#FECACA" : "#E2E8F0"}" stroke-width="1"/>`
    );

    const cy = y + ROW_H / 2;

    // 序号：前三名圆徽章，其余斜体序号
    if (rank <= 3) {
      parts.push(
        `<circle cx="${colX.rank + COL.rank / 2}" cy="${cy}" r="20" fill="${badgeColors[rank]}"/>`
      );
      parts.push(
        `<text x="${colX.rank + COL.rank / 2}" y="${cy}" fill="#FFFFFF" font-family="${FONT}" font-size="26" font-weight="bold" text-anchor="middle" dominant-baseline="central">${rank}</text>`
      );
    } else {
      parts.push(
        `<text x="${colX.rank + COL.rank / 2}" y="${cy}" fill="${isInactive ? "#B91C1C" : "#334155"}" font-family="'Georgia',serif" font-size="30" font-weight="bold" font-style="italic" text-anchor="middle" dominant-baseline="central">${String(rank).padStart(2, "0")}</text>`
      );
    }

    // 姓名
    const nameText = truncateText(row.name, COL.name - 32, 30);
    parts.push(
      `<text x="${colX.name + 16}" y="${cy}" fill="${isInactive ? "#991B1B" : "#0F172A"}" font-family="${FONT}" font-size="30"${isInactive ? ' font-weight="bold"' : ""} text-anchor="start" dominant-baseline="central">${escapeXml(nameText)}</text>`
    );

    // 未播天数
    const nld = Number(row.notLiveDays) || 0;
    parts.push(
      `<text x="${colX.notLiveDays + COL.notLiveDays / 2}" y="${cy}" fill="${nld > 0 ? "#B91C1C" : "#15803D"}" font-family="${FONT}" font-size="26" font-weight="bold" text-anchor="middle" dominant-baseline="central">${nld}</text>`
    );

    // 当月时长进度条
    const barH = 44;
    const barW = COL.duration - 32;
    const barX = colX.duration + 16;
    const barY = cy - barH / 2;
    if (dur <= 0) {
      parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#F1F5F9"/>`);
      parts.push(
        `<text x="${barX + barW / 2}" y="${cy}" fill="#94A3B8" font-family="${FONT}" font-size="26" font-weight="bold" text-anchor="middle" dominant-baseline="central">—</text>`
      );
    } else {
      const ratio = Math.min(1, dur / maxDuration);
      const fillW = Math.max(barH, Math.round(barW * ratio));
      parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#EDE9FE"/>`);
      parts.push(`<rect x="${barX}" y="${barY}" width="${fillW}" height="${barH}" rx="${barH / 2}" fill="#A78BFA"/>`);
      const durText = truncateText(formatDurationText(dur), barW - 24, 26);
      const textColor = ratio > 0.52 ? "#FFFFFF" : "#5B21B6";
      parts.push(
        `<text x="${barX + barW / 2}" y="${cy}" fill="${textColor}" font-family="${MONO}" font-size="26" font-weight="bold" text-anchor="middle" dominant-baseline="central">${escapeXml(durText)}</text>`
      );
    }

    y += ROW_H;
  });

  // 页脚
  parts.push(`<rect x="0" y="${y}" width="${W}" height="${FOOTER_H}" fill="#E2E8F0"/>`);
  const notLiveCount = summary?.notLiveCount ?? rows.filter((r) => !r.isLive).length;
  parts.push(
    `<text x="${PAD_X}" y="${y + 46}" fill="#334155" font-family="${FONT}" font-size="36" font-weight="bold" text-anchor="start" dominant-baseline="central">全团主播 ${rows.length} 人 · 未开播人数 ${notLiveCount} 人 · 未开播天数 ${summary?.notLiveDays ?? 0} 天</text>`
  );
  parts.push(
    `<text x="${PAD_X}" y="${y + 94}" fill="#64748B" font-family="${FONT}" font-size="24" text-anchor="start" dominant-baseline="central">数据日期 ${month}</text>`
  );

  parts.push("</svg>");
  return parts.join("");
}

async function main() {
  const months = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["2026-07", "2026-08"];
  const outDir = path.join(__dirname, "..", "data", "exports");
  fs.mkdirSync(outDir, { recursive: true });

  for (const month of months) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`无效月份: ${month}`);
    const report = await getMonthlyReport(month, "all");
    // 时长统计图按当月时长降序
    const rows = [...report.rows].sort(
      (a, b) =>
        (Number(b.totalDuration) || 0) - (Number(a.totalDuration) || 0) ||
        (Number(b.totalWave) || 0) - (Number(a.totalWave) || 0)
    );
    if (!rows.length) {
      console.log(`[${month}] 无数据，跳过`);
      continue;
    }
    const svg = buildSvg(month, rows, report.summary);
    const filename = `${month}_全团_时长统计图_${rows.length}人.png`;
    const outPath = path.join(outDir, filename);
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    console.log(
      `[${month}] 已导出 ${filename}（${rows.length} 人，未开播 ${report.summary?.notLiveCount ?? 0} 人 / ${report.summary?.notLiveDays ?? 0} 天）`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("导出失败:", e);
    process.exit(1);
  });
