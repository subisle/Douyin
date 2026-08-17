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
  if (number <= 0) return "0";
  if (number >= 100_000_000) {
    const yi = number / 100_000_000;
    const r = Math.round(yi * 10) / 10;
    return Number.isInteger(r) ? `${r} 亿` : `${r.toFixed(1)} 亿`;
  }
  // 低于一万：直接显示数字
  if (number < 10_000) {
    return Math.round(number).toLocaleString("zh-CN");
  }
  // ≥1 万用「万」，精确到 0.1 万（千）
  const wan = number / 10_000;
  const r = Math.round(wan * 10) / 10;
  if (r <= 0) return "0";
  return Number.isInteger(r) ? `${r} 万` : `${r.toFixed(1)} 万`;
}

function formatDuration(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}小时${rest}分` : `${rest}分钟`;
}

function formatDurationShort(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  if (minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0) return rest > 0 ? `${hours}时${rest}分` : `${hours}时`;
  return `${rest}分`;
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
    baseline = "alphabetic",
  } = options;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}px" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="${baseline}">${escapeXml(text)}</text>`;
}

function formatMonthNotLiveDaysLabel(date) {
  const month = Number(String(date || "").split("-")[1]);
  return Number.isFinite(month) && month >= 1 && month <= 12 ? `${month}月未播天数` : "本月未播天数";
}

function formatDailyWaveLabel(date) {
  const day = Number(String(date || "").split("-")[2]);
  return Number.isFinite(day) && day >= 1 && day <= 31 ? `${day}日音浪` : "日音浪";
}

function formatAppleDate(date) {
  const parts = String(date || "").split("-");
  const year = parseInt(parts[0] || "2026", 10) || 2026;
  const month = parseInt(parts[1] || "1", 10) || 1;
  const day = parseInt(parts[2] || "1", 10) || 1;
  return `${year}年${month}月${day}日`;
}

function formatClassicDate(date) {
  const parts = String(date || "").split("-");
  const year = parseInt(parts[0] || "2026", 10) || 2026;
  const month = parseInt(parts[1] || "1", 10) || 1;
  const day = parseInt(parts[2] || "1", 10) || 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 超过该人数且允许拆页时，导出拆成上下两张。 */
const DAILY_REPORT_EXPORT_SPLIT_THRESHOLD = 30;

function formatDailyReportPageSuffix(pageIndex, pageCount) {
  const total = Number(pageCount) || 0;
  const page = Number(pageIndex) || 0;
  if (total <= 1 || page <= 0) return "";
  return `（${page}/${total}）`;
}

function resolveSplitOption(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function splitDailyReportRowsForExport(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const threshold = Math.max(1, resolveSplitOption(options.threshold, DAILY_REPORT_EXPORT_SPLIT_THRESHOLD));
  const maxPages = Math.max(1, Math.min(2, resolveSplitOption(options.maxPages, 2)));
  if (list.length <= threshold || maxPages < 2) {
    return [{ rows: list, rankOffset: 0, pageIndex: 1, pageCount: 1 }];
  }
  const mid = Math.ceil(list.length / 2);
  return [
    { rows: list.slice(0, mid), rankOffset: 0, pageIndex: 1, pageCount: 2 },
    { rows: list.slice(mid), rankOffset: mid, pageIndex: 2, pageCount: 2 },
  ];
}

function appleTierColor(tier) {
  const key = String(tier || "").charAt(0).toUpperCase();
  if (key === "A") return { bg: "#FFF7E6", border: "#FDBA74", text: "#9A3412" };
  if (key === "B") return { bg: "#EAF3FF", border: "#60A5FA", text: "#1D4ED8" };
  if (key === "C") return { bg: "#ECFDF3", border: "#34D399", text: "#047857" };
  if (key === "D") return { bg: "#F5F3FF", border: "#A78BFA", text: "#6D28D9" };
  return { bg: "#F2F4F7", border: "#EAECF0", text: "#667085" };
}

function groupInactiveStreamers(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.masterName || "").trim() || "无师傅";
    const list = groups.get(key) || [];
    list.push(String(row.name || ""));
    groups.set(key, list);
  }
  return Array.from(groups.entries())
    .map(([master, names]) => `${master}: ${names.join("、")}`)
    .join("  /  ");
}

function wrapText(text, maxCharsPerLine) {
  const source = String(text || "");
  if (!source) return [];
  const lines = [];
  let current = "";
  for (const ch of source) {
    if (Array.from(current).length >= maxCharsPerLine) {
      lines.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function resolveReportStyle(gender, options = {}) {
  if (options.style === "classic" || options.style === "apple") return options.style;
  // Project defaults: male = 样式二(apple), female = 样式一(classic)
  return gender === "female" ? "classic" : "apple";
}

function normalizeRows(report) {
  return Array.isArray(report?.rows) ? report.rows : [];
}

function getTitle(report, options, style) {
  const gender = report.gender === "female" ? "female" : "male";
  const custom = String(options.title || "").trim();
  if (custom) return custom;
  // 与桌面端日报导出标题一致：男团星嗨艺创 / 女队薇笑传媒
  if (gender === "female" || style === "classic") return "薇笑传媒主播数据统计";
  return "星嗨艺创主播数据统计";
}

function renderClassicSvg(report, options = {}) {
  const rows = normalizeRows(report);
  const date = String(report.date || options.date || "");
  const gender = report.gender === "female" ? "female" : "male";
  const genderText = gender === "male" ? "男" : "女";
  const formattedDate = formatClassicDate(date);
  const rankOffset = Math.max(0, Number(options.rankOffset) || 0);
  const pageIndex = Math.max(1, Number(options.pageIndex) || 1);
  const pageCount = Math.max(1, Number(options.pageCount) || 1);
  const titleBase = getTitle(report, options, "classic");
  const pageSuffix = formatDailyReportPageSuffix(pageIndex, pageCount);
  const titleText = `${titleBase} ${formattedDate}${pageSuffix ? ` ${pageSuffix}` : ""}`;
  const notLiveDaysLabel = formatMonthNotLiveDaysLabel(date);
  const dailyWaveLabel = formatDailyWaveLabel(date);
  const summary = report.summary || {};
  const allRows = Array.isArray(options.statsRows) && options.statsRows.length
    ? options.statsRows
    : rows;
  const inactiveStreamers = allRows.filter((row) => !row.isLive);
  const liveRows = allRows.filter((row) => row.isLive);
  const notLivePeopleCount = Number(summary.notLiveCount ?? inactiveStreamers.length) || 0;
  const notLiveDays = Number(summary.notLiveDays) || 0;
  const showInactiveFooter = options.showInactiveFooter != null
    ? Boolean(options.showInactiveFooter)
    : pageCount <= 1 || pageIndex >= pageCount;
  const hasInactive = showInactiveFooter && inactiveStreamers.length > 0;
  const maxWave = liveRows.length > 0 ? Math.max(...liveRows.map((row) => Number(row.dailyWave) || 0), 1) : 1;

  const width = 1440;
  const scale = 2;
  const logicalW = width / scale;
  const headerHeight = 54;
  const tableHeaderHeight = 32;
  const rowHeight = 38;
  const tablePaddingX = 20;
  const inactiveText = groupInactiveStreamers(inactiveStreamers);
  const inactiveLines = hasInactive ? wrapText(inactiveText, 58) : [];
  const footerHeight = hasInactive
    ? Math.max(118, 86 + inactiveLines.length * 18)
    : 64;
  const height = (headerHeight + tableHeaderHeight + rowHeight * rows.length + footerHeight) * scale;

  const columns = [
    { key: "rank", label: "排名", width: 70, align: "center" },
    { key: "name", label: "主播姓名", width: 180, align: "left" },
    { key: "notLiveDays", label: notLiveDaysLabel, width: 110, align: "center" },
    { key: "dailyWave", label: dailyWaveLabel, width: 280, align: "right" },
    { key: "totalWave", label: "累计总音浪", width: 180, align: "right" },
    { key: "tier", label: "等级", width: 100, align: "center" },
  ];
  const tableWidth = logicalW - tablePaddingX * 2;
  const totalCol = columns.reduce((sum, col) => sum + col.width, 0);
  columns.forEach((col) => { col.width = (col.width / totalCol) * tableWidth; });
  let xCursor = tablePaddingX;
  columns.forEach((col) => {
    col.x = xCursor;
    xCursor += col.width;
  });

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logicalW} ${height / scale}">`,
    `<rect width="${logicalW}" height="${height / scale}" fill="#F8FAFC"/>`,
  ];

  let y = 0;
  parts.push(`<rect x="0" y="${y}" width="${logicalW}" height="${headerHeight}" fill="#1E293B"/>`);
  parts.push(textNode(titleText, logicalW / 2, y + headerHeight / 2 + 1, {
    size: 22, fill: "#F8FAFC", weight: 700, anchor: "middle", baseline: "middle",
  }));
  y += headerHeight;

  parts.push(`<rect x="0" y="${y}" width="${logicalW}" height="${tableHeaderHeight}" fill="#E2E8F0"/>`);
  for (const col of columns) {
    // 表头列名统一居中
    parts.push(textNode(col.label, col.x + col.width / 2, y + tableHeaderHeight / 2 + 1, {
      size: 13, fill: "#475569", weight: 700, anchor: "middle", baseline: "middle",
    }));
  }
  y += tableHeaderHeight;

  rows.forEach((row, index) => {
    const rank = rankOffset + index + 1;
    const isTop3 = rank <= 3;
    const isInactive = !row.isLive;
    const fill = isInactive ? "#FEF2F2"
      : rank === 1 ? "#FEF3C7"
      : rank === 2 ? "#F8FAFC"
      : rank === 3 ? "#FFEDD5"
      : index % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
    parts.push(`<rect x="0" y="${y}" width="${logicalW}" height="${rowHeight}" fill="${fill}"/>`);
    if (isInactive) {
      parts.push(`<rect x="0" y="${y}" width="4" height="${rowHeight}" fill="#DC2626"/>`);
    }
    parts.push(`<line x1="0" y1="${y}" x2="${logicalW}" y2="${y}" stroke="${isInactive ? "#FECACA" : "#E2E8F0"}" stroke-width="0.5"/>`);

    const cy = y + rowHeight / 2 + 1;
    for (const col of columns) {
      if (col.key === "rank") {
        const mainX = col.x + col.width / 2;
        if (isTop3) {
          const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
          parts.push(textNode(medal, mainX, cy, {
            size: 20, fill: isInactive ? "#B91C1C" : "#334155", weight: 700, anchor: "middle", baseline: "middle",
          }));
        } else {
          parts.push(textNode(String(rank).padStart(2, "0"), mainX, cy, {
            size: 15, fill: isInactive ? "#B91C1C" : "#334155", weight: 700, anchor: "middle", baseline: "middle",
            family: "Georgia, Times New Roman, serif",
          }));
        }
      } else if (col.key === "name") {
        parts.push(textNode(truncateText(row.name || "-", 12), col.x + 8, cy, {
          size: 15, fill: isInactive ? "#991B1B" : "#0F172A", weight: isInactive ? 700 : 500, anchor: "start", baseline: "middle",
        }));
      } else if (col.key === "notLiveDays") {
        const days = Number(row.notLiveDays) || 0;
        parts.push(textNode(String(days), col.x + col.width / 2, cy, {
          size: 13, fill: days > 0 ? "#B91C1C" : "#15803D", weight: 700, anchor: "middle", baseline: "middle",
        }));
      } else if (col.key === "dailyWave") {
        const padX = 8;
        const barH = 22;
        const barTop = cy - barH / 2;
        const barLeft = col.x + padX;
        const barTrackW = Math.max(48, col.width - padX * 2);
        if (isInactive) {
          parts.push(`<rect x="${barLeft}" y="${barTop}" width="${barTrackW}" height="${barH}" rx="${barH / 2}" fill="#FEE2E2"/>`);
          parts.push(textNode("未开播", barLeft + barTrackW / 2, cy, {
            size: 13, fill: "#DC2626", weight: 700, anchor: "middle", baseline: "middle",
          }));
        } else {
          const waveText = formatWave(row.dailyWave);
          const fillW = Math.max(0, Math.min(barTrackW, (barTrackW * (Number(row.dailyWave) || 0)) / maxWave));
          parts.push(`<rect x="${barLeft}" y="${barTop}" width="${barTrackW}" height="${barH}" rx="${barH / 2}" fill="#DBEAFE"/>`);
          if (fillW > 0) {
            const drawnFill = Math.max(fillW, barH);
            parts.push(`<rect x="${barLeft}" y="${barTop}" width="${drawnFill}" height="${barH}" rx="${barH / 2}" fill="#60A5FA"/>`);
          }
          // 数字画在进度条内居中
          const textFill = fillW / Math.max(barTrackW, 1) > 0.52 ? "#FFFFFF" : "#1E3A8A";
          parts.push(textNode(waveText, barLeft + barTrackW / 2, cy, {
            size: 13, fill: textFill, weight: 700, anchor: "middle", baseline: "middle",
            family: "Menlo, Consolas, monospace",
          }));
        }
      } else if (col.key === "totalWave") {
        parts.push(textNode(formatWave(row.totalWave), col.x + col.width - 12, cy, {
          size: 14, fill: "#475569", weight: 500, anchor: "end", baseline: "middle",
          family: "Menlo, Consolas, monospace",
        }));
      } else if (col.key === "tier") {
        if (row.tier) {
          const bw = Math.min(col.width - 20, 66);
          const bh = 20;
          const bl = col.x + (col.width - bw) / 2;
          const bt = y + (rowHeight - bh) / 2;
          parts.push(`<rect x="${bl}" y="${bt}" width="${bw}" height="${bh}" rx="8" fill="${isInactive ? "#FEE2E2" : "#E0F2FE"}"/>`);
          parts.push(textNode(String(row.tier), col.x + col.width / 2, cy, {
            size: 11, fill: isInactive ? "#B91C1C" : "#0369A1", weight: 700, anchor: "middle", baseline: "middle",
          }));
        }
      }
    }
    y += rowHeight;
  });

  parts.push(`<rect x="0" y="${y}" width="${logicalW}" height="${footerHeight}" fill="#E2E8F0"/>`);
  const totalCount = allRows.length;
  const pageCountLabel = pageCount > 1
    ? `本页 ${rows.length} 人 · 共 ${totalCount} 人`
    : `${genderText}主播 ${totalCount} 人`;
  const summaryText = `${pageCountLabel} · 未开播人数 ${notLivePeopleCount} 人 · 未开播天数 ${notLiveDays} 天`;
  parts.push(textNode(summaryText, tablePaddingX, y + 26, {
    size: 18, fill: "#334155", weight: 700, anchor: "start",
  }));
  parts.push(textNode(`数据日期 ${formattedDate}`, tablePaddingX, y + 50, {
    size: 12, fill: "#64748B", weight: 500, anchor: "start",
  }));

  if (hasInactive) {
    const warnX = tablePaddingX;
    const warnY = y + 64;
    const warnW = logicalW - tablePaddingX * 2;
    const warnH = footerHeight - 78;
    parts.push(`<rect x="${warnX}" y="${warnY}" width="${warnW}" height="${warnH}" rx="8" fill="#FEF2F2" stroke="#FECACA"/>`);
    parts.push(textNode(`未开播人数 ${notLivePeopleCount} 人 · 未开播天数 ${notLiveDays} 天`, warnX + 14, warnY + 22, {
      size: 14, fill: "#DC2626", weight: 700, anchor: "start",
    }));
    inactiveLines.forEach((line, i) => {
      parts.push(textNode(line, warnX + 14, warnY + 40 + i * 16, {
        size: 11, fill: "#7F1D1D", weight: 500, anchor: "start",
      }));
    });
  }

  parts.push("</svg>");
  return parts.join("");
}

function renderAppleSvg(report, options = {}) {
  const rows = normalizeRows(report);
  const date = String(report.date || options.date || "");
  const gender = report.gender === "female" ? "female" : "male";
  const genderText = gender === "male" ? "男团" : "女队";
  const rankOffset = Math.max(0, Number(options.rankOffset) || 0);
  const pageIndex = Math.max(1, Number(options.pageIndex) || 1);
  const pageCount = Math.max(1, Number(options.pageCount) || 1);
  const titleBaseRaw = getTitle(report, options, "apple");
  const pageSuffix = formatDailyReportPageSuffix(pageIndex, pageCount);
  const titleBase = pageSuffix ? `${titleBaseRaw} ${pageSuffix}` : titleBaseRaw;
  const notLiveDaysLabel = formatMonthNotLiveDaysLabel(date);
  const dailyWaveLabel = formatDailyWaveLabel(date);
  const summary = report.summary || {};
  const allRows = Array.isArray(options.statsRows) && options.statsRows.length
    ? options.statsRows
    : rows;
  const liveRows = allRows.filter((row) => row.isLive);
  const inactiveRows = allRows.filter((row) => !row.isLive);
  const notLivePeopleCount = Number(summary.notLiveCount ?? inactiveRows.length) || 0;
  const notLiveDays = Number(summary.notLiveDays) || 0;
  const showInactiveFooter = options.showInactiveFooter != null
    ? Boolean(options.showInactiveFooter)
    : pageCount <= 1 || pageIndex >= pageCount;
  const maxWave = liveRows.length > 0 ? Math.max(...liveRows.map((row) => Number(row.dailyWave) || 0), 1) : 1;

  const width = 1440;
  const scale = 2;
  const logicalW = width / scale;
  const headerH = 86;
  const tableHeaderH = 34;
  const rowH = 48;
  const rowGap = 6;
  const footerTextGap = 8;
  const footerTextH = 18;
  const warnGap = 20;
  const warnH = 42;
  const footerH = footerTextGap + footerTextH + (showInactiveFooter && inactiveRows.length > 0 ? warnGap + warnH : 0);
  const tableRowsH = rows.length * rowH + Math.max(0, rows.length - 1) * rowGap;
  const heightLogical = headerH + tableHeaderH + rowGap + tableRowsH + footerH;
  const height = heightLogical * scale;

  const columns = [
    { key: "rank", label: "排名", width: 70, align: "center" },
    { key: "name", label: "主播姓名", width: 150, align: "left" },
    { key: "notLiveDays", label: notLiveDaysLabel, width: 110, align: "center" },
    { key: "dailyWave", label: dailyWaveLabel, width: 280, align: "right" },
    { key: "totalWave", label: "累计总音浪", width: 170, align: "right" },
    { key: "tier", label: "等级", width: 100, align: "center" },
  ];
  const tableX = 0;
  const tableW = logicalW;
  const totalCol = columns.reduce((sum, col) => sum + col.width, 0);
  columns.forEach((col) => { col.width = (col.width / totalCol) * tableW; });
  let xCursor = tableX;
  columns.forEach((col) => {
    col.x = xCursor;
    xCursor += col.width;
  });

  const font = "-apple-system, BlinkMacSystemFont, SF Pro Display, SF Pro Text, PingFang SC, sans-serif";
  const mono = "SF Mono, Menlo, Consolas, monospace";
  const blue = "#007AFF";

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logicalW} ${heightLogical}">`,
    `<rect width="${logicalW}" height="${heightLogical}" fill="#FFFFFF"/>`,
  ];

  // Watermark grid
  const watermark = "内部数据 · 请勿外传";
  for (let wy = -40; wy <= heightLogical + 40; wy += 76) {
    for (let wx = -40; wx <= logicalW + 40; wx += 180) {
      parts.push(
        `<text x="${wx}" y="${wy}" font-family="${escapeXml(font)}" font-size="18" font-weight="900" fill="rgba(51,65,85,0.055)" text-anchor="middle" transform="rotate(-18 ${wx} ${wy})">${escapeXml(watermark)}</text>`
      );
    }
  }

  let y = 0;
  parts.push(textNode(titleBase, logicalW / 2, y + 22, {
    size: 25, fill: "#101828", weight: 700, anchor: "middle", family: font,
  }));
  parts.push(textNode(formatAppleDate(date), logicalW / 2, y + 50, {
    size: 13, fill: "#475467", weight: 500, anchor: "middle", family: font,
  }));
  y += headerH;

  parts.push(`<rect x="${tableX}" y="${y}" width="${tableW}" height="${tableHeaderH}" fill="#F2F4F7"/>`);
  for (const col of columns) {
    // 表头列名统一居中
    parts.push(textNode(col.label, col.x + col.width / 2, y + tableHeaderH / 2 + 1, {
      size: 12, fill: "#667085", weight: 700, anchor: "middle", baseline: "middle", family: font,
    }));
  }
  y += tableHeaderH + rowGap;

  rows.forEach((row, index) => {
    const rank = rankOffset + index + 1;
    const isInactive = !row.isLive;
    const rowFill = isInactive ? "#FFF7F7" : "#FFFFFF";
    const stroke = isInactive ? "#FEE4E2" : "#EAECF0";
    parts.push(`<rect x="${tableX}" y="${y}" width="${tableW}" height="${rowH}" fill="${rowFill}" stroke="${stroke}" stroke-width="1"/>`);
    if (isInactive) {
      parts.push(`<rect x="${tableX}" y="${y + 8}" width="4" height="${rowH - 16}" rx="2" fill="#F04438"/>`);
    }

    const cy = y + rowH / 2 + 1;
    for (const col of columns) {
      if (col.key === "rank") {
        const chipW = 40;
        const chipH = 24;
        const chipX = col.x + (col.width - chipW) / 2;
        const chipY = y + (rowH - chipH) / 2;
        let chipFill = "#F2F4F7";
        let chipStroke = "#EAECF0";
        let chipText = "#475467";
        if (rank === 1) { chipFill = "#FFFAEB"; chipStroke = "#FEDF89"; chipText = "#B54708"; }
        if (rank === 2) { chipFill = "#F9FAFB"; chipStroke = "#D0D5DD"; chipText = "#475467"; }
        if (rank === 3) { chipFill = "#FFF6ED"; chipStroke = "#FED7AA"; chipText = "#C4320A"; }
        if (isInactive) { chipFill = "#FFF1F2"; chipStroke = "#FFE4E6"; chipText = "#B42318"; }
        parts.push(`<rect x="${chipX}" y="${chipY}" width="${chipW}" height="${chipH}" rx="${chipH / 2}" fill="${chipFill}" stroke="${chipStroke}"/>`);
        parts.push(textNode(String(rank).padStart(2, "0"), chipX + chipW / 2, cy, {
          size: 12, fill: chipText, weight: 700, anchor: "middle", baseline: "middle", family: mono,
        }));
      } else if (col.key === "name") {
        parts.push(textNode(truncateText(row.name || "-", 12), col.x + 8, cy, {
          size: 14, fill: isInactive ? "#B42318" : "#101828", weight: 700, anchor: "start", baseline: "middle", family: font,
        }));
      } else if (col.key === "notLiveDays") {
        const days = Number(row.notLiveDays) || 0;
        parts.push(textNode(String(days), col.x + col.width / 2, cy, {
          size: 13, fill: days > 0 ? "#B42318" : "#027A48", weight: 700, anchor: "middle", baseline: "middle", family: font,
        }));
      } else if (col.key === "dailyWave") {
        const padX = 8;
        const barH = 22;
        const barX = col.x + padX;
        const barW = Math.max(48, col.width - padX * 2);
        const barY = cy - barH / 2;
        if (isInactive) {
          parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#FEE4E2"/>`);
          parts.push(textNode("未开播", barX + barW / 2, cy, {
            size: 13, fill: "#D92D20", weight: 700, anchor: "middle", baseline: "middle", family: font,
          }));
        } else {
          const waveText = formatWave(row.dailyWave);
          const waveRatio = (Number(row.dailyWave) || 0) / Math.max(maxWave, 1);
          const fillW = Math.max(0, Math.min(barW, waveRatio * barW));
          parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#EAF3FF"/>`);
          if (fillW > 0) {
            parts.push(`<rect x="${barX}" y="${barY}" width="${Math.max(fillW, barH)}" height="${barH}" rx="${barH / 2}" fill="${blue}"/>`);
          }
          // 数字画在进度条内居中
          const textFill = fillW / Math.max(barW, 1) > 0.52 ? "#FFFFFF" : "#1D4ED8";
          parts.push(textNode(waveText, barX + barW / 2, cy, {
            size: 13, fill: textFill, weight: 800, anchor: "middle", baseline: "middle", family: mono,
          }));
        }
      } else if (col.key === "totalWave") {
        parts.push(textNode(formatWave(row.totalWave), col.x + col.width - 12, cy, {
          size: 13, fill: "#475467", weight: 600, anchor: "end", baseline: "middle", family: mono,
        }));
      } else if (col.key === "tier") {
        const tier = String(row.tier || "-");
        const colors = appleTierColor(row.tier);
        const pillW = Math.min(col.width - 18, Math.max(42, tier.length * 12 + 20));
        const pillX = col.x + (col.width - pillW) / 2;
        const pillY = y + (rowH - 24) / 2;
        parts.push(`<rect x="${pillX}" y="${pillY}" width="${pillW}" height="24" rx="12" fill="${colors.bg}" stroke="${colors.border}"/>`);
        parts.push(textNode(tier, col.x + col.width / 2, cy, {
          size: 11, fill: colors.text, weight: 700, anchor: "middle", baseline: "middle", family: font,
        }));
      }
    }

    y += rowH + (index === rows.length - 1 ? 0 : rowGap);
  });

  y += footerTextGap;
  const totalCount = allRows.length;
  const peopleLabel = pageCount > 1
    ? `本页 ${rows.length}/${totalCount} 人`
    : `${genderText} ${totalCount} 人`;
  parts.push(textNode(`数据日期 ${formatAppleDate(date)} · ${peopleLabel}`, tableX + 8, y + 4, {
    size: 12, fill: "#667085", weight: 600, anchor: "start", family: font,
  }));
  parts.push(textNode(`未开播人数 ${notLivePeopleCount} 人 · 未开播天数 ${notLiveDays} 天`, tableX + tableW - 8, y + 4, {
    size: 12, fill: "#667085", weight: 600, anchor: "end", family: font,
  }));
  parts.push(textNode("内部数据 · 请勿外传", tableX + tableW / 2, y + 4, {
    size: 12, fill: "#98A2B3", weight: 700, anchor: "middle", family: font,
  }));

  if (showInactiveFooter && inactiveRows.length > 0) {
    const warnY = y + warnGap;
    parts.push(`<rect x="${tableX}" y="${warnY}" width="${tableW}" height="${warnH}" fill="#FFF7F7" stroke="#FEE4E2"/>`);
    const inactiveText = inactiveRows.map((row) => row.name).join("、");
    parts.push(textNode(truncateText(`未开播：${inactiveText}`, 56), tableX + 14, warnY + warnH / 2 + 1, {
      size: 12, fill: "#B42318", weight: 700, anchor: "start", baseline: "middle", family: font,
    }));
  }

  parts.push("</svg>");
  return parts.join("");
}

/**
 * Render a daily report image for bot replies.
 * Uses the project's built-in export styles:
 * - male  -> 样式二 (apple)
 * - female -> 样式一 (classic)
 * No browser dependency so commands continue to work while another page is open.
 */
async function renderOneDailyReportPng(report, options = {}) {
  const rows = normalizeRows(report);
  if (rows.length === 0) throw new Error("该日期没有可生成的报告数据");
  const gender = report.gender === "female" ? "female" : "male";
  const style = resolveReportStyle(gender, options);
  const svg = style === "classic"
    ? renderClassicSvg({ ...report, gender }, options)
    : renderAppleSvg({ ...report, gender }, options);

  return getSharp()(Buffer.from(svg, "utf8"))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * 单张兼容接口：默认仍渲染「当前传入的全部 rows」为一张图。
 * 若 options.split === true，则返回第一页（请优先用 renderDailyReportPngPages）。
 */
async function renderDailyReportPng(report, options = {}) {
  if (options && options.split === true) {
    const pages = await renderDailyReportPngPages(report, options);
    if (!pages.length) throw new Error("该日期没有可生成的报告数据");
    return pages[0].buffer;
  }
  return renderOneDailyReportPng(report, options);
}

/**
 * 按 threshold / maxPages 拆成最多两张 PNG（与桌面端每日报告导出一致）。
 * @returns {Promise<Array<{ buffer: Buffer, pageIndex: number, pageCount: number, fileNameSuffix: string }>>}
 */
async function renderDailyReportPngPages(report, options = {}) {
  const allRows = normalizeRows(report);
  if (!allRows.length) throw new Error("该日期没有可生成的报告数据");
  const gender = report.gender === "female" ? "female" : "male";
  const pages = splitDailyReportRowsForExport(allRows, {
    threshold: options.threshold,
    maxPages: options.maxPages,
  });
  const out = [];
  for (const page of pages) {
    const buffer = await renderOneDailyReportPng(
      { ...report, gender, rows: page.rows },
      {
        ...options,
        rankOffset: page.rankOffset,
        pageIndex: page.pageIndex,
        pageCount: page.pageCount,
        statsRows: allRows,
      }
    );
    out.push({
      buffer,
      pageIndex: page.pageIndex,
      pageCount: page.pageCount,
      fileNameSuffix: page.pageCount > 1 ? `_${page.pageIndex}of${page.pageCount}` : "",
    });
  }
  return out;
}

/**
 * 统一产出「可发送/可导出」的日报图片列表。
 * - 传入真实 renderDailyReportPng / 未传自定义渲染器：自动按人数拆最多 2 页
 * - 传入测试 mock 等自定义单图渲染器：保持单张兼容
 */
async function toDailyReportImagePages(renderFn, report, options = {}) {
  if (!renderFn || renderFn === renderDailyReportPng) {
    return renderDailyReportPngPages(report, options);
  }
  if (typeof renderFn.renderPages === "function") {
    return renderFn.renderPages(report, options);
  }
  const buffer = await renderFn(report, options);
  return [{
    buffer,
    pageIndex: 1,
    pageCount: 1,
    fileNameSuffix: "",
  }];
}

module.exports = {
  escapeXml,
  formatWave,
  formatDuration,
  formatDurationShort,
  truncateText,
  resolveReportStyle,
  splitDailyReportRowsForExport,
  DAILY_REPORT_EXPORT_SPLIT_THRESHOLD,
  renderClassicSvg,
  renderAppleSvg,
  renderDailyReportPng,
  renderDailyReportPngPages,
  toDailyReportImagePages,
};
