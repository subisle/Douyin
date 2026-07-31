"use strict";

/**
 * PK 分组图（机器人 / 脚本导出，无浏览器依赖）
 * 品牌标题：星嗨艺创 · 干净名单板，不展示音浪/战力数字
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
  // 统一「万」为单位，精确到 0.1 万；内部/调试仍可用，导出图不再展示
  const wan = n / 10_000;
  const r = Math.round(wan * 10) / 10;
  if (r <= 0) return "0";
  return Number.isInteger(r) ? `${r}万` : `${r.toFixed(1)}万`;
}

const ACCENTS = [
  { main: "#FF2D95", soft: "#FFE4F3", deep: "#BE185D", glow: "#FF2D9522" },
  { main: "#7C3AED", soft: "#EDE9FE", deep: "#5B21B6", glow: "#7C3AED22" },
  { main: "#06B6D4", soft: "#CFFAFE", deep: "#0E7490", glow: "#06B6D422" },
  { main: "#F59E0B", soft: "#FEF3C7", deep: "#B45309", glow: "#F59E0B22" },
  { main: "#22C55E", soft: "#DCFCE7", deep: "#15803D", glow: "#22C55E22" },
  { main: "#F43F5E", soft: "#FFE4E6", deep: "#BE123C", glow: "#F43F5E22" },
  { main: "#3B82F6", soft: "#DBEAFE", deep: "#1D4ED8", glow: "#3B82F622" },
  { main: "#A855F7", soft: "#F3E8FF", deep: "#7E22CE", glow: "#A855F722" },
];

const FONT =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

function periodDisplay(period) {
  const raw = String(period || "").trim();
  const m = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}年${Number(m[2])}月`;
  return raw || "当月";
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

/**
 * @param {object} result buildPkGroups 成功结果
 * @param {object} [options]
 * @param {string} [options.period]
 * @param {string} [options.title]
 * @param {string} [options.subtitle]
 * @param {string[]} [options.constraints]
 * @param {string} [options.rosterSource]
 * @param {boolean} [options.showWave] 默认 false，导出不带音浪
 */
function renderPkGroupsSvg(result, options = {}) {
  const groups = Array.isArray(result?.groups) ? result.groups : [];
  if (!groups.length) throw new Error("没有可绘制的分组");

  const showWave = options.showWave === true;
  const count = groups.length;
  const columns = count <= 3 ? count : count <= 6 ? 3 : 4;
  const cardW = 292;
  const gap = 18;
  const pad = 40;
  const headerH = 128;
  const constraintH = constraintHActive(options, result) ? 44 : 0;
  const boardW = Math.max(980, columns * cardW + (columns - 1) * gap + pad * 2);

  const maxMembers = Math.max(...groups.map((g) => (g.members || []).length), 1);
  // 双列名单更紧凑好看
  const nameCols = maxMembers >= 6 ? 2 : 1;
  const nameRows = Math.ceil(maxMembers / nameCols);
  const cardHeader = 70;
  const rowH = 34;
  const cardPadY = 16;
  const cardH = cardHeader + cardPadY + nameRows * rowH + 20;
  const rows = Math.ceil(count / columns);
  const boardH =
    pad + headerH + constraintH + rows * (cardH + gap) - gap + pad + 36;

  const title = String(options.title || "星嗨艺创").trim() || "星嗨艺创";
  const periodText = periodDisplay(options.period || result.period);
  const total =
    result.total || groups.reduce((s, g) => s + (g.members?.length || 0), 0);
  const modeBit = result.modeLabel ? ` · ${result.modeLabel}` : "";
  const sub =
    options.subtitle ||
    `${periodText} · 共 ${total} 人 · ${count} 组${modeBit}`.trim();

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${boardW}" height="${boardH}" viewBox="0 0 ${boardW} ${boardH}">`
  );
  parts.push(
    `<defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#FFF7FB"/>
        <stop offset="32%" stop-color="#F5F0FF"/>
        <stop offset="68%" stop-color="#ECFEFF"/>
        <stop offset="100%" stop-color="#FFF7ED"/>
      </linearGradient>
      <linearGradient id="hd" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#FF2D95"/>
        <stop offset="42%" stop-color="#A855F7"/>
        <stop offset="78%" stop-color="#6366F1"/>
        <stop offset="100%" stop-color="#06B6D4"/>
      </linearGradient>
      <linearGradient id="hdShine" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
        <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#7C3AED" flood-opacity="0.14"/>
      </filter>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#1A1033" flood-opacity="0.06"/>
      </filter>
    </defs>`
  );
  parts.push(`<rect width="${boardW}" height="${boardH}" fill="url(#bg)"/>`);
  // decor blobs
  parts.push(
    `<circle cx="${boardW - 60}" cy="30" r="180" fill="#FF2D95" fill-opacity="0.10"/>`
  );
  parts.push(
    `<circle cx="30" cy="${boardH - 20}" r="160" fill="#7C3AED" fill-opacity="0.10"/>`
  );
  parts.push(
    `<circle cx="${boardW * 0.42}" cy="${boardH - 10}" r="90" fill="#06B6D4" fill-opacity="0.08"/>`
  );

  // header
  const hx = pad;
  const hy = pad;
  const hw = boardW - pad * 2;
  const hh = 108;
  parts.push(
    `<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" rx="26" fill="url(#hd)" filter="url(#shadow)"/>`
  );
  parts.push(
    `<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" rx="26" fill="url(#hdShine)"/>`
  );
  // brand mark
  parts.push(
    `<circle cx="${hx + 38}" cy="${hy + 54}" r="18" fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>`
  );
  parts.push(
    `<text x="${hx + 38}" y="${hy + 59}" text-anchor="middle" fill="#fff" font-size="16" font-weight="900" font-family="${FONT}">星</text>`
  );
  parts.push(
    `<text x="${hx + 68}" y="${hy + 34}" fill="#fff" font-size="12" font-weight="800" letter-spacing="2" font-family="${FONT}" opacity="0.92">XINGHAI YICHUANG · PK GROUP</text>`
  );
  parts.push(
    `<text x="${hx + 68}" y="${hy + 68}" fill="#fff" font-size="34" font-weight="900" font-family="${FONT}">${escapeXml(title)}</text>`
  );
  parts.push(
    `<text x="${hx + 68}" y="${hy + 92}" fill="#fff" font-size="13" font-weight="700" font-family="${FONT}" opacity="0.9">${escapeXml(sub)}</text>`
  );

  // stats pills
  const pillX = hx + hw - 214;
  parts.push(
    `<rect x="${pillX}" y="${hy + 28}" width="90" height="52" rx="16" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.35)"/>`
  );
  parts.push(
    `<text x="${pillX + 45}" y="${hy + 50}" text-anchor="middle" fill="#fff" font-size="22" font-weight="900" font-family="${FONT}">${count}</text>`
  );
  parts.push(
    `<text x="${pillX + 45}" y="${hy + 68}" text-anchor="middle" fill="#fff" font-size="11" font-weight="700" font-family="${FONT}">组</text>`
  );
  parts.push(
    `<rect x="${pillX + 102}" y="${hy + 28}" width="90" height="52" rx="16" fill="rgba(255,255,255,0.95)" filter="url(#soft)"/>`
  );
  parts.push(
    `<text x="${pillX + 147}" y="${hy + 50}" text-anchor="middle" fill="#7C3AED" font-size="22" font-weight="900" font-family="${FONT}">${total}</text>`
  );
  parts.push(
    `<text x="${pillX + 147}" y="${hy + 68}" text-anchor="middle" fill="#A855F7" font-size="11" font-weight="800" font-family="${FONT}">人</text>`
  );

  let contentTop = hy + hh + 18;
  if (constraintHActive(options, result)) {
    const notes = (options.constraints || result.constraints || []).join("  ·  ");
    parts.push(
      `<rect x="${pad}" y="${contentTop}" width="${hw}" height="36" rx="14" fill="rgba(255,255,255,0.88)" stroke="rgba(124,58,237,0.12)" filter="url(#soft)"/>`
    );
    parts.push(
      `<text x="${pad + 16}" y="${contentTop + 23}" fill="#5B21B6" font-size="12" font-weight="700" font-family="${FONT}">${escapeXml(truncate(notes, 96))}</text>`
    );
    contentTop += 50;
  }

  groups.forEach((group, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = pad + col * (cardW + gap);
    const y = contentTop + row * (cardH + gap);
    const accent = ACCENTS[index % ACCENTS.length];
    const members = Array.isArray(group.members) ? group.members : [];
    // card shell
    parts.push(
      `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="20" fill="#ffffff" stroke="${accent.main}40" stroke-width="1.5" filter="url(#shadow)"/>`
    );
    // top color ribbon
    parts.push(
      `<path d="M${x},${y + 18} v-2 a18,18 0 0 1 18,-18 h${cardW - 36} a18,18 0 0 1 18,18 v2 z" fill="${accent.main}"/>`
    );
    // left accent
    parts.push(
      `<path d="M${x + 10},${y + 28} h3 a3,3 0 0 1 3,3 v${cardH - 52} a3,3 0 0 1 -3,3 h-3 z" fill="${accent.main}"/>`
    );
    // header chip
    parts.push(
      `<rect x="${x + 20}" y="${y + 18}" width="${cardW - 40}" height="44" rx="14" fill="${accent.soft}"/>`
    );

    const label = group.label || `第${index + 1}组`;
    const time = group.startTime || group.scheduleLabel || "";
    const meta = [time, `${members.length}人`].filter(Boolean).join(" · ");

    parts.push(
      `<text x="${x + 34}" y="${y + 38}" fill="${accent.deep}" font-size="16" font-weight="900" font-family="${FONT}">${escapeXml(label)}</text>`
    );
    parts.push(
      `<text x="${x + 34}" y="${y + 54}" fill="${accent.deep}" font-size="11" font-weight="700" font-family="${FONT}" opacity="0.82">${escapeXml(meta)}</text>`
    );

    if (showWave && group.top4) {
      parts.push(
        `<text x="${x + cardW - 24}" y="${y + 44}" text-anchor="end" fill="${accent.deep}" font-size="11" font-weight="800" font-family="${FONT}">T4 ${escapeXml(formatStrength(group.top4))}</text>`
      );
    }

    const colW = nameCols === 2 ? (cardW - 48) / 2 : cardW - 40;
    members.forEach((m, mi) => {
      const c = mi % nameCols;
      const r = Math.floor(mi / nameCols);
      const mx = x + 24 + c * colW;
      const my = y + cardHeader + 6 + r * rowH;
      const rank = m.index || mi + 1;
      const name = m.name || "";

      parts.push(
        `<rect x="${mx}" y="${my}" width="${colW - 8}" height="28" rx="10" fill="${accent.soft}" fill-opacity="0.55"/>`
      );
      parts.push(
        `<circle cx="${mx + 14}" cy="${my + 14}" r="9" fill="#fff" stroke="${accent.main}55"/>`
      );
      parts.push(
        `<text x="${mx + 14}" y="${my + 18}" text-anchor="middle" fill="${accent.deep}" font-size="10" font-weight="800" font-family="${FONT}">${rank}</text>`
      );
      parts.push(
        `<text x="${mx + 28}" y="${my + 18}" fill="#1A1033" font-size="13" font-weight="700" font-family="${FONT}">${escapeXml(truncate(name, nameCols === 2 ? 5 : 10))}</text>`
      );

      if (showWave) {
        const strength = m.strength || m.trimmedAvg || m.wave || 0;
        parts.push(
          `<text x="${mx + colW - 14}" y="${my + 18}" text-anchor="end" fill="#6B5B95" font-size="11" font-weight="700" font-family="${FONT}">${escapeXml(formatStrength(strength))}</text>`
        );
      }
    });
  });

  const footerBits = [
    options.rosterSource || "",
    "星嗨艺创",
    "分组导出",
  ].filter(Boolean);
  parts.push(
    `<text x="${boardW / 2}" y="${boardH - 14}" text-anchor="middle" fill="#7C6B9A" font-size="11" font-weight="600" font-family="${FONT}">${escapeXml(footerBits.join(" · "))}</text>`
  );
  parts.push("</svg>");
  return parts.join("");
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
