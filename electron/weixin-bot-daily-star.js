 "use strict";

/**
 * 每日之星（前三名）海报：日报推送 / 指令「每日报告」时与报告图一并发送。
 * 无浏览器依赖，SVG + sharp。
 */

const { pickTopByDailyWave, formatWave } = require("./weixin-bot-daily-push");

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

const FONT =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

const MEDAL = [
  { rank: 1, label: "NO.1", accent: "#F5D76E", soft: "#FFF6D6", glow: "#F5D76E55" },
  { rank: 2, label: "NO.2", accent: "#D7DEE8", soft: "#F4F7FB", glow: "#D7DEE855" },
  { rank: 3, label: "NO.3", accent: "#E8B48A", soft: "#FFF1E6", glow: "#E8B48A55" },
];

function genderMeta(gender) {
  if (gender === "female") {
    return {
      label: "女队",
      brand: "薇笑传媒",
      accent: "#EC4899",
      accent2: "#A855F7",
    };
  }
  return {
    label: "男团",
    brand: "星嗨艺创",
    accent: "#F59E0B",
    accent2: "#F97316",
  };
}

function formatDateTitle(date) {
  const parts = String(date || "").split("-");
  const y = parts[0] || "";
  const m = Number(parts[1] || 0);
  const d = Number(parts[2] || 0);
  if (y && m && d) return `${y}年${m}月${d}日`;
  return String(date || "当日");
}

function truncateName(name, max = 8) {
  const chars = Array.from(String(name || "未知").trim() || "未知");
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

/**
 * @param {string} date YYYY-MM-DD
 * @param {"male"|"female"} gender
 * @param {{ rows?: any[] } | null} report
 * @param {Record<number, string>} avatarsByRank
 * @returns {string} SVG
 */
function renderDailyStarSvg(date, gender, report, avatarsByRank = {}) {
  const meta = genderMeta(gender);
  const top = pickTopByDailyWave(report?.rows, 3);
  while (top.length < 3) {
    top.push({ name: "虚位以待", dailyWave: 0, rank: top.length + 1 });
  }

  const W = 900;
  const H = 1180;
  const cardY = [260, 520, 780];
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  );
  parts.push(`<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B1020"/>
      <stop offset="45%" stop-color="#14101F"/>
      <stop offset="100%" stop-color="#1A1208"/>
    </linearGradient>
    <linearGradient id="titleGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FFF7D6"/>
      <stop offset="45%" stop-color="#F5D76E"/>
      <stop offset="100%" stop-color="${meta.accent}"/>
    </linearGradient>
    <linearGradient id="cardGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.10)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.03)"/>
    </linearGradient>
    <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>`);

  parts.push(`<rect width="${W}" height="${H}" rx="36" fill="url(#bg)"/>`);
  parts.push(
    `<circle cx="120" cy="110" r="160" fill="${meta.accent}" opacity="0.12"/>`
  );
  parts.push(
    `<circle cx="780" cy="980" r="200" fill="${meta.accent2}" opacity="0.12"/>`
  );
  parts.push(
    `<rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="28" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>`
  );

  // header
  parts.push(
    `<text x="${W / 2}" y="88" text-anchor="middle" fill="rgba(255,255,255,0.72)" font-size="24" font-family="${FONT}" font-weight="700" letter-spacing="6">${escapeXml(meta.brand)}</text>`
  );
  parts.push(
    `<text x="${W / 2}" y="160" text-anchor="middle" fill="url(#titleGrad)" font-size="64" font-family="${FONT}" font-weight="900" filter="url(#softGlow)">每日之星</text>`
  );
  parts.push(
    `<text x="${W / 2}" y="210" text-anchor="middle" fill="rgba(255,255,255,0.78)" font-size="28" font-family="${FONT}" font-weight="600">${escapeXml(formatDateTitle(date))} · ${escapeXml(meta.label)}前三名</text>`
  );

  top.forEach((row, index) => {
    const medal = MEDAL[index] || MEDAL[2];
    const y = cardY[index];
    const name = truncateName(row.name, 10);
    const wave = Number(row.dailyWave) > 0 ? formatWave(row.dailyWave) : "—";
    const podiumH = index === 0 ? 210 : 190;

    parts.push(
      `<rect x="70" y="${y}" width="${W - 140}" height="${podiumH}" rx="28" fill="url(#cardGrad)" stroke="${medal.accent}" stroke-opacity="0.45" stroke-width="2"/>`
    );
    parts.push(
      `<circle cx="160" cy="${y + podiumH / 2}" r="46" fill="${medal.soft}" stroke="${medal.accent}" stroke-width="3"/>`
    );
    parts.push(
      `<clipPath id="avatarClip" x="160" y="${y + podiumH / 2 - 46}" width="92" height="92" />`
    );
    const avatarUrl = avatarsByRank[index + 1] || "";
    parts.push(
      `<image x="160" y="${y + podiumH / 2 - 46}" width="92" height="92" href="${avatarUrl}" clip-path="url(#avatarClip)" />`
    );
    parts.push(
      `<text x="160" y="${y + podiumH / 2 + 10}" text-anchor="middle" fill="#1F2937" font-size="28" font-family="${FONT}" font-weight="900">${escapeXml(medal.label)}</text>`
    );
    parts.push(
      `<text x="240" y="${y + podiumH / 2 - 18}" text-anchor="start" fill="#FFFFFF" font-size="42" font-family="${FONT}" font-weight="800">${escapeXml(name)}</text>`
    );
    parts.push(
      `<text x="240" y="${y + podiumH / 2 + 28}" text-anchor="start" fill="${medal.accent}" font-size="30" font-family="${FONT}" font-weight="700">日音浪 ${escapeXml(wave)}</text>`
    );
    parts.push(
      `<text x="${W - 110}" y="${y + podiumH / 2 + 12}" text-anchor="end" fill="rgba(255,255,255,0.28)" font-size="72" font-family="${FONT}" font-weight="900">${index + 1}</text>`
    );
  });

  parts.push(
    `<text x="${W / 2}" y="${H - 58}" text-anchor="middle" fill="rgba(255,255,255,0.42)" font-size="20" font-family="${FONT}" font-weight="600">与每日报告同步推送 · TOP 3</text>`
  );
  parts.push("</svg>");
  return parts.join("");
}

/**
 * @param {string} date
 * @param {"male"|"female"} gender
 * @param {{ rows?: any[] } | null} report
 * @param {Record<number, string>} avatarsByRank
 * @returns {Promise<{ buffer: Buffer, fileName: string }>}
 */
async function renderDailyStarPng(date, gender, report, avatarsByRank = {}) {
  if (!avatarsByRank || Object.keys(avatarsByRank).length === 0) {
    avatarsByRank = {};
    (report?.rows || []).forEach(row => {
      if (row.anchorId && row.avatarUrl) {
        avatarsByRank[row.rank] = row.avatarUrl;
      }
    });
  }
  const day = String(date || "").trim() || "当日";
  const label = gender === "female" ? "女队" : "男团";
  const svg = renderDailyStarSvg(day, gender === "female" ? "female" : "male", report, avatarsByRank);
  const buffer = await getSharp()(Buffer.from(svg, "utf8"))
    .png({ compressionLevel: 9 })
    .toBuffer();
  return {
    buffer,
    fileName: `${day}_${label}_每日之星.png`,
  };
}

module.exports = {
  renderDailyStarSvg,
  renderDailyStarPng,
  genderMeta,
};
