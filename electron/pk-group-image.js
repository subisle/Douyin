"use strict";

/**
 * PK 分组图（机器人导出，无浏览器依赖）
 * 风格对齐桌面星嗨争霸导出板：糖果渐变 + 分组卡片
 */

let sharp;

function getSharp() {
  if (!sharp) sharp = require("sharp");
  return sharp;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatStrength(value) {
  const n = Number(value) || 0;
  if (n <= 0) return "0";
  if (n >= 100_000_000) {
    const yi = n / 100_000_000;
    const r = Math.round(yi * 10) / 10;
    return Number.isInteger(r) ? `${r}亿` : `${r.toFixed(1)}亿`;
  }
  // 统一「万」为单位，精确到 0.1 万（千），不显示千后零碎
  const wan = n / 10_000;
  const r = Math.round(wan * 10) / 10;
  if (r <= 0) return "0";
  return Number.isInteger(r) ? `${r}万` : `${r.toFixed(1)}万`;
}

const ACCENTS = [
  { main: "#FF2D95", soft: "#FFE4F3", deep: "#C4006C" },
  { main: "#7C3AED", soft: "#EDE9FE", deep: "#5B21B6" },
  { main: "#06B6D4", soft: "#CFFAFE", deep: "#0E7490" },
  { main: "#F59E0B", soft: "#FEF3C7", deep: "#B45309" },
  { main: "#22C55E", soft: "#DCFCE7", deep: "#15803D" },
  { main: "#F43F5E", soft: "#FFE4E6", deep: "#BE123C" },
  { main: "#3B82F6", soft: "#DBEAFE", deep: "#1D4ED8" },
  { main: "#A855F7", soft: "#F3E8FF", deep: "#7E22CE" },
];

function periodDisplay(period) {
  const raw = String(period || "").trim();
  const m = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}年${Number(m[2])}月`;
  return raw || "当月";
}

/**
 * @param {object} result buildPkGroups 成功结果
 * @param {object} [options]
 * @param {string} [options.period]
 * @param {string} [options.title]
 * @param {string[]} [options.constraints]
 * @param {string} [options.rosterSource]
 */
function renderPkGroupsSvg(result, options = {}) {
  const groups = Array.isArray(result?.groups) ? result.groups : [];
  if (!groups.length) throw new Error("没有可绘制的分组");

  const count = groups.length;
  const columns = count <= 3 ? count : count <= 6 ? 3 : 4;
  const cardW = 300;
  const gap = 16;
  const pad = 36;
  const headerH = 118;
  const constraintH =
    (Array.isArray(options.constraints) && options.constraints.length) ||
    (Array.isArray(result.constraints) && result.constraints.length)
      ? 44
      : 0;
  const boardW = Math.max(960, columns * cardW + (columns - 1) * gap + pad * 2);

  const maxMembers = Math.max(...groups.map((g) => (g.members || []).length), 1);
  const cardHeader = 72;
  const rowH = 28;
  const cardPad = 14;
  const cardH = cardHeader + cardPad + maxMembers * rowH + 18;
  const boardH = pad + headerH + constraintH + Math.ceil(count / columns) * (cardH + gap) - gap + pad + 28;

  const title = options.title || `星嗨争霸赛 · ${result.modeLabel || "分组"}`;
  const periodText = periodDisplay(options.period || result.period);
  const total = result.total || groups.reduce((s, g) => s + (g.members?.length || 0), 0);
  const sub = `${periodText} · 共 ${total} 人 · ${count} 组 · ${result.modeLabel || ""}`.trim();

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${boardW}" height="${boardH}" viewBox="0 0 ${boardW} ${boardH}">`
  );
  parts.push(
    `<defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#FFF0F8"/>
        <stop offset="28%" stop-color="#F3E8FF"/>
        <stop offset="62%" stop-color="#E0F2FE"/>
        <stop offset="100%" stop-color="#FEF3C7"/>
      </linearGradient>
      <linearGradient id="hd" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#FF2D95"/>
        <stop offset="45%" stop-color="#7C3AED"/>
        <stop offset="100%" stop-color="#06B6D4"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#7C3AED" flood-opacity="0.16"/>
      </filter>
    </defs>`
  );
  parts.push(`<rect width="${boardW}" height="${boardH}" fill="url(#bg)"/>`);
  // decor
  parts.push(
    `<circle cx="${boardW - 40}" cy="0" r="160" fill="#FF2D95" fill-opacity="0.12"/>`
  );
  parts.push(`<circle cx="40" cy="${boardH}" r="140" fill="#7C3AED" fill-opacity="0.12"/>`);

  // header
  const hx = pad;
  const hy = pad;
  const hw = boardW - pad * 2;
  parts.push(
    `<rect x="${hx}" y="${hy}" width="${hw}" height="96" rx="22" fill="url(#hd)" filter="url(#shadow)"/>`
  );
  parts.push(
    `<text x="${hx + 22}" y="${hy + 28}" fill="#fff" font-size="12" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif" opacity="0.95">★ PENGZAI · STAR BATTLE</text>`
  );
  parts.push(
    `<text x="${hx + 22}" y="${hy + 58}" fill="#fff" font-size="30" font-weight="900" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(title)}</text>`
  );
  parts.push(
    `<text x="${hx + 22}" y="${hy + 82}" fill="#fff" font-size="14" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif" opacity="0.92">${escapeXml(sub)}</text>`
  );
  // stats pills
  const pillX = hx + hw - 210;
  parts.push(
    `<rect x="${pillX}" y="${hy + 22}" width="88" height="52" rx="14" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.4)"/>`
  );
  parts.push(
    `<text x="${pillX + 44}" y="${hy + 44}" text-anchor="middle" fill="#fff" font-size="20" font-weight="900" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">${count}</text>`
  );
  parts.push(
    `<text x="${pillX + 44}" y="${hy + 62}" text-anchor="middle" fill="#fff" font-size="11" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">组</text>`
  );
  parts.push(
    `<rect x="${pillX + 100}" y="${hy + 22}" width="88" height="52" rx="14" fill="rgba(255,255,255,0.92)"/>`
  );
  parts.push(
    `<text x="${pillX + 144}" y="${hy + 44}" text-anchor="middle" fill="#7C3AED" font-size="20" font-weight="900" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">${total}</text>`
  );
  parts.push(
    `<text x="${pillX + 144}" y="${hy + 62}" text-anchor="middle" fill="#A855F7" font-size="11" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">人</text>`
  );

  let contentTop = hy + 96 + 16;
  if (constraintHActive(options, result)) {
    const notes = (options.constraints || result.constraints || []).join("  ·  ");
    parts.push(
      `<rect x="${pad}" y="${contentTop}" width="${hw}" height="36" rx="12" fill="rgba(255,255,255,0.82)" stroke="rgba(124,58,237,0.15)"/>`
    );
    parts.push(
      `<text x="${pad + 16}" y="${contentTop + 23}" fill="#5B21B6" font-size="12" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">${escapeXml(truncate(notes, 90))}</text>`
    );
    contentTop += 48;
  }

  groups.forEach((group, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = pad + col * (cardW + gap);
    const y = contentTop + row * (cardH + gap);
    const accent = ACCENTS[index % ACCENTS.length];
    const members = Array.isArray(group.members) ? group.members : [];

    parts.push(
      `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="18" fill="#fff" stroke="${accent.main}55" stroke-width="2" filter="url(#shadow)"/>`
    );
    // left accent bar
    parts.push(
      `<path d="M${x + 8},${y + 16} h4 a4,4 0 0 1 4,4 v${cardH - 40} a4,4 0 0 1 -4,4 h-4 z" fill="${accent.main}"/>`
    );
    // card header strip
    parts.push(
      `<rect x="${x + 18}" y="${y + 14}" width="${cardW - 36}" height="48" rx="12" fill="${accent.soft}"/>`
    );
    const label = group.label || `第${index + 1}组`;
    const time = group.startTime || group.scheduleLabel || "";
    parts.push(
      `<text x="${x + 30}" y="${y + 34}" fill="${accent.deep}" font-size="16" font-weight="900" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">${escapeXml(label)}</text>`
    );
    parts.push(
      `<text x="${x + 30}" y="${y + 52}" fill="${accent.deep}" font-size="11" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif" opacity="0.85">${escapeXml(time)} · ${members.length}人</text>`
    );
    // meta right
    if (group.top4) {
      parts.push(
        `<text x="${x + cardW - 24}" y="${y + 36}" text-anchor="end" fill="${accent.deep}" font-size="11" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">T4 ${escapeXml(formatStrength(group.top4))}</text>`
      );
    }

    members.forEach((m, mi) => {
      const my = y + cardHeader + 8 + mi * rowH;
      const rank = m.index || mi + 1;
      const name = m.name || "";
      const strength = m.strength || m.trimmedAvg || m.wave || 0;
      // rank chip
      parts.push(
        `<circle cx="${x + 34}" cy="${my + 10}" r="10" fill="${accent.soft}" stroke="${accent.main}66"/>`
      );
      parts.push(
        `<text x="${x + 34}" y="${my + 14}" text-anchor="middle" fill="${accent.deep}" font-size="10" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">${rank}</text>`
      );
      parts.push(
        `<text x="${x + 52}" y="${my + 14}" fill="#1A1033" font-size="13" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">${escapeXml(truncate(name, 8))}</text>`
      );
      parts.push(
        `<text x="${x + cardW - 22}" y="${my + 14}" text-anchor="end" fill="#6B5B95" font-size="11" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">${escapeXml(formatStrength(strength))}</text>`
      );
    });
  });

  // footer
  parts.push(
    `<text x="${boardW / 2}" y="${boardH - 12}" text-anchor="middle" fill="#6B5B95" font-size="11" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">${escapeXml(options.rosterSource || "")} · 自动分组导出</text>`
  );
  parts.push("</svg>");
  return parts.join("");
}

function constraintHActive(options, result) {
  const list = options.constraints || result.constraints || [];
  return Array.isArray(list) && list.length > 0;
}

function truncate(value, max) {
  const s = String(value || "");
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

async function renderPkGroupsPng(result, options = {}) {
  const svg = renderPkGroupsSvg(result, options);
  return getSharp()(Buffer.from(svg, "utf8"))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports = {
  renderPkGroupsSvg,
  renderPkGroupsPng,
  formatStrength,
};
