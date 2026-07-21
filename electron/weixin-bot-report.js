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

function formatWave(value) {
  const number = Number(value) || 0;
  if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(2)} 亿`;
  if (number >= 10_000) return `${(number / 10_000).toFixed(1)} 万`;
  return number.toLocaleString("zh-CN");
}

function formatDuration(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}小时${rest}分` : `${rest}分钟`;
}

function truncateText(value, maxLength) {
  const chars = Array.from(String(value || ""));
  return chars.length > maxLength ? `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…` : chars.join("");
}

function textNode(text, x, y, options = {}) {
  const {
    size = 24,
    fill = "#17231d",
    weight = 500,
    anchor = "start",
    family = "Arial, PingFang SC, Microsoft YaHei, sans-serif",
  } = options;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}px" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(text)}</text>`;
}

/**
 * Render a compact daily report image for bot replies. It intentionally has
 * no browser dependency so commands continue to work while another page is open.
 */
async function renderDailyReportPng(report, options = {}) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  if (rows.length === 0) throw new Error("该日期没有可生成的报告数据");
  const date = String(report.date || options.date || "");
  const gender = report.gender === "female" ? "女队" : "男团";
  const title = String(options.title || `${gender}每日报告`);
  const width = 1440;
  const margin = 44;
  const headerHeight = 176;
  const tableTop = headerHeight;
  const rowHeight = 54;
  const footerHeight = 66;
  const height = tableTop + 48 + rows.length * rowHeight + footerHeight;
  const tableWidth = width - margin * 2;
  const columns = [
    { label: "排名", width: 86, align: "middle" },
    { label: "主播姓名", width: 250, align: "start" },
    { label: `${Number(date.slice(5, 7)) || ""}月未播天数`, width: 170, align: "middle" },
    { label: `${Number(date.slice(8, 10)) || ""}日音浪`, width: 230, align: "end" },
    { label: "累计总音浪", width: 250, align: "end" },
    { label: "有效时长", width: 220, align: "middle" },
    { label: "等级", width: 146, align: "middle" },
  ];
  const scale = tableWidth / columns.reduce((sum, column) => sum + column.width, 0);
  columns.forEach((column) => { column.width *= scale; });

  const summary = report.summary || {};
  const liveCount = rows.filter((row) => row.isLive).length;
  const totalWave = rows.reduce((sum, row) => sum + (Number(row.totalWave) || 0), 0);
  const notLiveDays = Number(summary.notLiveDays) || 0;
  const dailyWaveLabel = `${Number(date.slice(8, 10)) || ""}日音浪`;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#f7faf8"/>`,
    `<rect x="0" y="0" width="${width}" height="${headerHeight}" fill="#17231d"/>`,
    textNode(title, margin, 62, { size: 38, fill: "#ffffff", weight: 700 }),
    textNode(`${date}  ·  ${gender}`, margin, 105, { size: 22, fill: "#b9d8c2", weight: 500 }),
    textNode(`开播 ${liveCount}/${rows.length}`, width - margin, 58, { size: 22, fill: "#d9fdd3", weight: 700, anchor: "end" }),
    textNode(`未播 ${Number(summary.notLiveCount) || 0} 人  ·  本月未播 ${notLiveDays} 天`, width - margin, 96, { size: 20, fill: "#b9d8c2", weight: 500, anchor: "end" }),
    textNode(`总音浪 ${formatWave(totalWave)}`, width - margin, 130, { size: 20, fill: "#b9d8c2", weight: 500, anchor: "end" }),
    `<rect x="${margin}" y="${tableTop}" width="${tableWidth}" height="48" rx="8" fill="#d9e9dd"/>`,
  ];

  let x = margin;
  for (const column of columns) {
    const anchor = column.align === "end" ? "end" : column.align === "middle" ? "middle" : "start";
    const tx = anchor === "end" ? x + column.width - 16 : anchor === "middle" ? x + column.width / 2 : x + 16;
    parts.push(textNode(column.label, tx, tableTop + 31, { size: 18, fill: "#315b3e", weight: 700, anchor }));
    x += column.width;
  }

  rows.forEach((row, index) => {
    const y = tableTop + 48 + index * rowHeight;
    const fill = index % 2 === 0 ? "#ffffff" : "#eef5f0";
    parts.push(`<rect x="${margin}" y="${y}" width="${tableWidth}" height="${rowHeight}" fill="${fill}"/>`);
    const values = [
      String(index + 1),
      truncateText(row.name || "-", 10),
      String(Number(row.notLiveDays) || 0),
      row.isLive ? formatWave(row.dailyWave) : "未开播",
      formatWave(row.totalWave),
      formatDuration(row.dailyDuration),
      truncateText(row.tier || "-", 8),
    ];
    let cellX = margin;
    values.forEach((value, valueIndex) => {
      const column = columns[valueIndex];
      const anchor = column.align === "end" ? "end" : column.align === "middle" ? "middle" : "start";
      const tx = anchor === "end" ? cellX + column.width - 16 : anchor === "middle" ? cellX + column.width / 2 : cellX + 16;
      const color = valueIndex === 3 && !row.isLive ? "#9b4d36" : "#17231d";
      parts.push(textNode(value, tx, y + 34, { size: 19, fill: color, weight: valueIndex === 1 ? 650 : 500, anchor }));
      cellX += column.width;
    });
    parts.push(`<line x1="${margin}" y1="${y + rowHeight}" x2="${margin + tableWidth}" y2="${y + rowHeight}" stroke="#d9e5dc" stroke-width="1"/>`);
  });

  const footerY = tableTop + 48 + rows.length * rowHeight + 40;
  parts.push(textNode(`数据日期 ${date}  ·  ${dailyWaveLabel}为当日快照`, margin, footerY, { size: 16, fill: "#607a68" }));
  parts.push(textNode("抖音数据管理", width - margin, footerY, { size: 16, fill: "#607a68", anchor: "end" }));
  parts.push("</svg>");

  return getSharp()(Buffer.from(parts.join(""), "utf8"))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports = {
  escapeXml,
  formatWave,
  formatDuration,
  truncateText,
  renderDailyReportPng,
};
