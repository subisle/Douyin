const crypto = require("crypto");
const Papa = require("papaparse");
const { createWeixinAnalytics } = require("./weixin-bot-analytics");
const {
  createModeStore,
  matchSystemToken,
  matchFastRoute,
  INSTRUCTION_HELP,
  AGENT_HELP,
  SYSTEM_ENABLE_RE: AGENT_ENABLE_RE,
  SYSTEM_DISABLE_RE: AGENT_DISABLE_RE,
} = require("./weixin-bot-mode");
const { threadKeyFromContext } = require("./weixin-bot-agent");
const { matchDailyPushCommand, buildGenderTop3Text } = require("./weixin-bot-daily-push");
const { toDailyReportImagePages, toNotLiveReportImagePages, sortNotLiveReportRows, buildNotLiveCsvRows } = require("./weixin-bot-report");
const { renderDailyStarPng } = require("./weixin-bot-daily-star");
const { parseBindCommand, formatBindReply, createAnchorBindService } = require("./bot-anchor-bind");
const { renderPkGroupsPng } = require("./pk-group-image");
const { readLayoutSnapshot } = require("./pk-layout-snapshot");

const HELP_TEXT = INSTRUCTION_HELP;
const PENDING_IMPORT_DATE_TTL_MS = 10 * 60_000;

function normalizeText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .replace(/[。！!，,；;]+$/g, "")
    .trim();
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_＿\-—–·.。:：/\\|()[\]{}（）【】<>《》]/g, "");
}

function parseDateSpec(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^(?:今天|今日)$/.test(text)) return { type: "relative", offset: 0 };
  if (/^(?:昨天|昨日)$/.test(text)) return { type: "relative", offset: -1 };

  const full = text.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*[日号]?/);
  if (full) return { type: "date", year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) };
  const compact = text.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) return { type: "date", year: Number(compact[1]), month: Number(compact[2]), day: Number(compact[3]) };
  const monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (monthDay) return { type: "month-day", month: Number(monthDay[1]), day: Number(monthDay[2]) };
  const day = text.match(/(?:^|\s)(\d{1,2})\s*[日号](?=$|\s|音浪|文件|日报|报告|数据|_|\.)/);
  if (day) return { type: "day", day: Number(day[1]) };
  // normalizeText 去空格后：24号数据 / 24号音浪
  const dayCompact = text.match(/^(\d{1,2})[日号](?:数据|音浪|文件|日报|报告)?$/);
  if (dayCompact) return { type: "day", day: Number(dayCompact[1]) };
  return null;
}

function parseMonthSpec(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const full = text.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*月?/);
  if (full) return { type: "month", year: Number(full[1]), month: Number(full[2]) };
  const compact = text.match(/(20\d{2})(\d{2})(?!\d)/);
  if (compact) return { type: "month", year: Number(compact[1]), month: Number(compact[2]) };
  const monthOnly = text.match(/(\d{1,2})\s*月/);
  if (monthOnly) return { type: "month-only", month: Number(monthOnly[1]) };
  return null;
}

function resolveMonthSpec(spec, fallbackDate = null) {
  const fallback = /^\d{4}-\d{2}-\d{2}$/.test(String(fallbackDate || ""))
    ? String(fallbackDate)
    : localYesterdayIso();
  const year = Number(fallback.slice(0, 4));
  const month = Number(fallback.slice(5, 7));
  if (!spec) return `${year}-${String(month).padStart(2, "0")}`;
  if (spec.type === "month") {
    const m = Number(spec.month);
    if (!Number.isFinite(m) || m < 1 || m > 12) throw new Error("月份无效");
    return `${Number(spec.year)}-${String(m).padStart(2, "0")}`;
  }
  if (spec.type === "month-only") {
    const m = Number(spec.month);
    if (!Number.isFinite(m) || m < 1 || m > 12) throw new Error("月份无效");
    return `${year}-${String(m).padStart(2, "0")}`;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** 仅从用户文字解析导入日期；不读文件名，避免误把 22 号发的文件落到 22 */
function parseExplicitImportDateFromText(text) {
  const original = normalizeText(text);
  if (!original) return null;
  // 优先识别「24号数据 / 24号音浪数据 / 数据24号」
  const labeled = original.match(/(\d{1,2})[日号](?:音浪|时长)?数据/)
    || original.match(/(?:音浪|时长)?数据(\d{1,2})[日号]/)
    || original.match(/(20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}[日号]?)(?:音浪|时长)?数据/);
  if (labeled) {
    const raw = labeled[1] || labeled[0];
    const spec = parseDateSpec(String(raw).includes("数据") ? String(raw).replace(/数据/g, "") : raw);
    if (spec) return resolveDateSpec(spec, localYesterdayIso());
  }
  const spec = parseDateSpec(original);
  if (!spec) return null;
  // 仅当文案明显在指定导入日时才采纳（避免闲聊里的数字误触发）
  if (!/(?:数据|音浪|时长|导入|文件)/.test(original) && spec.type === "day") return null;
  return resolveDateSpec(spec, localYesterdayIso());
}

function localTodayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localYesterdayIso() {
  return shiftDate(localTodayIso(), -1);
}

/** 2026-08-10 -> 10号（当年当月）；跨月补月；跨年补年 */
function dayToFriendly(dateStr) {
  const match = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(dateStr || "");
  const [, year, month, day] = match;
  const now = new Date();
  const thisYear = String(now.getFullYear());
  const thisMonth = String(now.getMonth() + 1).padStart(2, "0");
  const dayNum = Number(day);
  const monthNum = Number(month);
  if (year === thisYear && month === thisMonth) return `${dayNum}号`;
  if (year === thisYear) return `${monthNum}月${dayNum}号`;
  return `${year}年${monthNum}月${dayNum}号`;
}

function isValidDateParts(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function toIsoDate(year, month, day) {
  if (!isValidDateParts(year, month, day)) throw new Error("日期无效");
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDate(date, offset) {
  const [year, month, day] = String(date).split("-").map(Number);
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() + Number(offset || 0));
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function resolveDateSpec(spec, fallbackDate = null) {
  const fallback = /^\d{4}-\d{2}-\d{2}$/.test(String(fallbackDate || ""))
    ? String(fallbackDate)
    : (() => {
        const now = new Date();
        now.setDate(now.getDate() - 1);
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      })();
  if (!spec) return fallback;
  if (spec.type === "relative") {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return shiftDate(today, spec.offset);
  }
  if (spec.type === "date") return toIsoDate(spec.year, spec.month, spec.day);
  if (spec.type === "month-day") return toIsoDate(Number(fallback.slice(0, 4)), spec.month, spec.day);
  if (spec.type === "day") return toIsoDate(Number(fallback.slice(0, 4)), Number(fallback.slice(5, 7)), spec.day);
  return fallback;
}

function parseReportGender(original) {
  const hasFemale = /(?:女团|女队|女性)/.test(original);
  const hasMale = /(?:男团|男队|男性)/.test(original);
  if (hasFemale && !hasMale) return "female";
  if (hasMale && !hasFemale) return "male";
  // 未写性别的「每日报告」默认双团；写了男女两边则也按双团
  if (hasFemale && hasMale) return "both";
  return "both";
}

function parseSingleGender(original) {
  return /(?:女团|女队|女性)/.test(original) ? "female" : "male";
}

function parseBotCommand(input) {
  const original = normalizeText(input);
  if (!original) return null;
  if (/^(?:\/?help|帮助|菜单|命令|指令)$/i.test(original)) return { type: "help" };

  const bindCommand = parseBindCommand(original);
  if (bindCommand) return bindCommand;

  const withoutGender = original.replace(/(?:男团|男队|男性|女团|女队|女性)/g, "").trim();

  const fileMatch = withoutGender.match(/^(?:\/?(?:音浪文件|导出音浪(?:文件)?))(?:\s*(.+))?$/i);
  if (fileMatch) return { type: "export-wave-file", dateSpec: parseDateSpec(fileMatch[1] || "") };

  if (AGENT_ENABLE_RE.test(original)) return { type: "agent-enable" };
  if (AGENT_DISABLE_RE.test(original)) return { type: "agent-disable" };

  const notLiveMatch = withoutGender.match(/^(?:\/?(?:未开播天数报告|未开播报告|未播天数报告|未播报告))(?:\s*(.+))?$/i)
    || withoutGender.match(/^(.+?)\s*(?:未开播天数报告|未开播报告|未播天数报告|未播报告)$/);
  if (notLiveMatch) {
    const rest = String(notLiveMatch[1] || "").trim();
    const dateSpec = parseDateSpec(rest);
    const monthSpec = dateSpec ? null : parseMonthSpec(rest);
    return {
      type: "not-live-report",
      gender: parseReportGender(original),
      dateSpec,
      monthSpec,
    };
  }

  const reportMatch = withoutGender.match(/^(?:\/?(?:每日报告|日报|报告))(?:\s*(.+))?$/i);
  if (reportMatch) {
    return {
      type: "report",
      gender: parseReportGender(original),
      dateSpec: parseDateSpec(reportMatch[1] || ""),
    };
  }

  // 「18号报告」→ 默认双团；可写 男团18号报告
  const dateOnlyReport = withoutGender.match(/^(今日|今天|昨日|昨天|20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}[日号]?|20\d{6}|\d{1,2}\s*[日号])\s*报告$/);
  if (dateOnlyReport) {
    const hasGender = /(?:男团|男队|男性|女团|女队|女性)/.test(original);
    return {
      type: "report",
      gender: hasGender ? parseSingleGender(original) : "both",
      dateSpec: parseDateSpec(dateOnlyReport[1]),
    };
  }

  const dateOnlyWave = withoutGender.match(/^(今日|今天|昨日|昨天|20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}[日号]?|20\d{6}|\d{1,2}\s*[日号])\s*音浪$/);
  if (dateOnlyWave) {
    return {
      type: "report",
      gender: parseSingleGender(original),
      dateSpec: parseDateSpec(dateOnlyWave[1]),
    };
  }

  const daysMatch = withoutGender.match(/^(.+?)\s*(?:多少日|多少天)音浪$/);
  if (daysMatch?.[1]?.trim()) return { type: "anchor-wave-days", query: daysMatch[1].trim() };

  const durationMatch = withoutGender.match(/^(.+?)\s*(?:直播)?时长$/);
  if (durationMatch?.[1]?.trim()) return { type: "anchor-duration", query: durationMatch[1].trim() };

  const namedWaveMatch = withoutGender.match(/^(.+?)\s*(今日|今天|昨日|昨天|20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}[日号]?|20\d{6}|\d{1,2}\s*[日号])\s*音浪$/);
  if (namedWaveMatch?.[1]?.trim()) {
    return {
      type: "anchor-wave",
      query: namedWaveMatch[1].trim(),
      dateSpec: parseDateSpec(namedWaveMatch[2]),
    };
  }

  // 「艺名音浪」→ 最新日音浪
  const simpleWaveMatch = withoutGender.match(/^(.+?)\s*音浪$/);
  if (simpleWaveMatch?.[1]?.trim()
    && !/^(今日|今天|昨日|昨天|最新|音浪文件|导出)/.test(simpleWaveMatch[1].trim())) {
    return {
      type: "anchor-wave",
      query: simpleWaveMatch[1].trim(),
      dateSpec: null,
    };
  }

  // PK 分组：发组名（9.1 / 第1组 / 1组 / 组1）回对应分组图；发「分组 / 各组」回全部
  const pkGroupLabel = original.match(/^\/?(\d{1,3}[.．]\d{1,3})$/);
  if (pkGroupLabel) return { type: "pk-group-image", query: pkGroupLabel[1].replace("．", ".") };
  const pkGroupIndex = withoutGender.match(/^(?:第\s*([0-9]{1,3})\s*组|([0-9]{1,3})\s*组|组\s*([0-9]{1,3}))$/);
  if (pkGroupIndex) {
    const index = Number(pkGroupIndex[1] || pkGroupIndex[2] || pkGroupIndex[3]);
    return { type: "pk-group-image", query: String(index) };
  }
  if (/^\/?(?:分组图|全部分组|各组|分组)$/.test(original)) {
    return { type: "pk-group-image", query: "" };
  }

  // 直接输入主播名/抖音号/主播 ID：返回库内全部相关数据
  if (
    withoutGender.length >= 1
    && withoutGender.length <= 40
    && !/[，。！？、；：,.!?;:]/.test(withoutGender)
    && !/^(今日|今天|昨日|昨天|音浪|文件|报告|日报|导出|帮助|菜单|命令|指令|人工|客服|智能|未开播|未播|第?[1-9一二三四五六七八九十]组|组[1-9一二三四五六七八九十]|各组)/.test(withoutGender)
  ) {
    return { type: "anchor-profile", query: withoutGender };
  }
  return null;
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

function compactNumber(value) {
  return (Number(value) || 0).toLocaleString("zh-CN");
}

function findAnchor(query, anchors) {
  const needle = normalizeText(query).toLowerCase();
  if (!needle) return null;
  const fields = (anchor) => [
    anchor.name,
    anchor.anchorName,
    anchor.anchorId,
    anchor.douyinNo,
    ...(Array.isArray(anchor.aliasIds) ? anchor.aliasIds : []),
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const exact = anchors.filter((anchor) => fields(anchor).includes(needle));
  if (exact.length === 1) return exact[0];
  const fuzzy = anchors.filter((anchor) => fields(anchor).some((value) => value.includes(needle) || needle.includes(value)));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

function rowMatchesAnchor(row, anchor) {
  const ids = new Set([anchor.anchorId, ...(anchor.aliasIds || [])].map((value) => String(value || "")));
  return ids.has(String(row.anchorId || "")) || String(row.name || "").trim() === String(anchor.name || "").trim();
}

function findColumn(headers, names) {
  const wanted = names.map(normalizeHeader);
  return headers.find((header) => wanted.includes(normalizeHeader(header)));
}

function parseWaveValue(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  if (text.includes("万")) {
    const number = Number.parseFloat(text.replace(/,/g, "").replace("万", ""));
    return Number.isFinite(number) ? Math.round(number * 10_000) : NaN;
  }
  const number = Number.parseInt(text.replace(/,/g, "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(number) ? number : NaN;
}

function parseDurationValue(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  const cn = text.match(/^(?:(\d+)\s*小时)?(?:(\d+)\s*分(?:钟)?)?(?:(\d+)\s*秒)?$/);
  if (cn && (cn[1] || cn[2] || cn[3])) {
    return Number(cn[1] || 0) * 60 + Number(cn[2] || 0) + Math.round(Number(cn[3] || 0) / 60);
  }
  if (text.includes(":")) {
    const parts = text.split(":").map((part) => Number.parseInt(part, 10) || 0);
    if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  const number = Number.parseInt(text.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(number) ? number : NaN;
}

function inferImportKind(text, fileName, commandText) {
  const sources = [text.split(/\r?\n/, 1)[0], commandText, fileName]
    .map((value) => String(value || "").toLowerCase());
  for (const source of sources) {
    if (/时长|duration|开播|有效时长/.test(source)) return "duration";
    if (/音浪|wave|总音浪/.test(source)) return "wave";
  }
  return "wave";
}

function parseCsvText(text, kind) {
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (result.errors?.length) {
    const first = result.errors[0];
    throw new Error(`CSV 解析失败：${first.message || "格式错误"}`);
  }
  const data = Array.isArray(result.data) ? result.data : [];
  const headers = Object.keys(data[0] || {});
  const idCol = findColumn(headers, ["主播id", "主播账号", "抖音号", "抖音ID", "anchor_id", "anchorId", "uid"]);
  const nameCol = findColumn(headers, ["主播名", "主播名称", "主播昵称", "昵称", "用户昵称", "姓名", "名字", "主播", "anchor_name", "anchorName", "name", "nickname"]);
  const valueCol = kind === "wave"
    ? findColumn(headers, ["音浪", "wave_value", "wave", "总音浪"])
    : findColumn(headers, ["时长", "duration", "duration_minutes", "直播时长", "开播有效时长", "有效时长", "开播时长"]);
  const rankCol = findColumn(headers, ["排名", "rank"]);
  if (!valueCol) throw new Error(`CSV 中未找到${kind === "wave" ? "音浪" : "时长"}列`);

  const rows = [];
  let skipped = 0;
  for (const row of data) {
    const anchorIdRaw = String(row[idCol || ""] || "").trim();
    const anchorName = String(row[nameCol || ""] || "").trim();
    const value = kind === "wave" ? parseWaveValue(row[valueCol]) : parseDurationValue(row[valueCol]);
    const rank = Number.parseInt(String(row[rankCol || ""] || "0"), 10) || 0;
    if ((!anchorIdRaw && !anchorName) || !Number.isFinite(value) || value < 0) {
      skipped += 1;
      continue;
    }
    rows.push({ anchorIdRaw, anchorName, value, rank });
  }
  return { rows, skipped, totalRows: data.length };
}

function matchImportRows(rows, anchors) {
  const byField = new Map();
  const nameOwners = new Map();
  for (const anchor of anchors) {
    const primaryId = String(anchor.anchorId || "").trim();
    if (primaryId) byField.set(primaryId, { anchor, accountId: primaryId });
    const douyinNo = String(anchor.douyinNo || "").trim();
    if (douyinNo && primaryId) byField.set(douyinNo, { anchor, accountId: primaryId });
    for (const aliasId of anchor.aliasIds || []) {
      const accountId = String(aliasId || "").trim();
      if (accountId) byField.set(accountId, { anchor, accountId });
    }
    const name = String(anchor.name || "").trim();
    if (name) {
      if (nameOwners.has(name)) nameOwners.set(name, null);
      else nameOwners.set(name, primaryId ? { anchor, accountId: primaryId } : null);
    }
  }
  const matched = [];
  const unmatched = [];
  for (const row of rows) {
    const rawId = row.anchorIdRaw.replace(/["'\s]/g, "");
    const match = byField.get(rawId) || nameOwners.get(row.anchorName.trim());
    if (!match) {
      unmatched.push(row);
      continue;
    }
    matched.push({
      anchorId: match.accountId,
      anchorName: match.anchor.anchorName || match.anchor.name || row.anchorName,
      value: row.value,
      rank: row.rank,
    });
  }
  const deduped = new Map();
  let duplicateRows = 0;
  for (const row of matched) {
    if (deduped.has(row.anchorId)) duplicateRows += 1;
    deduped.set(row.anchorId, row);
  }
  return { rows: Array.from(deduped.values()), unmatched, duplicateRows };
}

function buildImportMeta(buffer, fileName, kind, rows) {
  const canonical = rows
    .map((row) => ({
      anchorId: row.anchorId,
      value: Math.round(row.value) || 0,
      rank: kind === "wave" ? Math.round(row.rank) || 0 : 0,
    }))
    .sort((a, b) => a.anchorId.localeCompare(b.anchorId));
  return {
    fileHash: crypto.createHash("md5").update(buffer).digest("hex"),
    dataHash: crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    fileName: String(fileName || "weixin.csv"),
    rowCount: canonical.length,
  };
}

function decodeCsv(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("gb18030").decode(buffer).replace(/^\uFEFF/, "");
  }
}

function csvBuffer(rows) {
  const text = Papa.unparse(rows);
  return Buffer.from(`\uFEFF${text}`, "utf8");
}

function normalizeIsoDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // 本地年月日，避免 toISOString 在东八区把午夜推前一天
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

async function getLatestDate(db, kind) {
  let summary = {};
  try {
    if (typeof db.getDashboardSummary === "function") {
      summary = (await db.getDashboardSummary()) || {};
    }
  } catch {
    summary = {};
  }
  const fromSummary = kind === "duration"
    ? (summary.latestDurationDate || summary.latestDataDate)
    : (summary.latestWaveDate || summary.latestDataDate);
  const fromSummaryDate = normalizeIsoDate(fromSummary);
  if (fromSummaryDate) return fromSummaryDate;

  try {
    if (kind === "duration") {
      const rows = typeof db.exportDurationSnapshots === "function"
        ? await db.exportDurationSnapshots()
        : [];
      return (Array.isArray(rows) ? rows : [])
        .map((row) => normalizeIsoDate(row?.快照日期 || row?.日期))
        .filter(Boolean)
        .sort()
        .at(-1) || null;
    }
    const rows = typeof db.exportWaveSnapshots === "function"
      ? await db.exportWaveSnapshots()
      : [];
    return (Array.isArray(rows) ? rows : [])
      .map((row) => normalizeIsoDate(row?.日期))
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  } catch {
    return null;
  }
}

async function resolveReportDate(db, spec, kind = "wave") {
  return resolveDateSpec(spec, await getLatestDate(db, kind));
}

function genderLabel(gender) {
  return gender === "female" ? "女队" : "男团";
}

/**
 * 发送单团日报：每日之星文案 → 报告图（可多页）。
 * @param {{ withDate?: boolean }} [options] withDate 时在文案前加日期标题
 */
async function sendOneGenderReport(args, date, gender, db, renderReportPng, options = {}) {
  const label = genderLabel(gender);
  const report = await db.getDailyWaveReport(date, gender);
  if (!report?.rows?.length) {
    await args.replyText(`${date} 没有${label}主播数据。`);
    return false;
  }
  // 文案：日期（可选）+ 每日之星前三人名
  const top3Text = buildGenderTop3Text(date, gender, report, {
    withDate: Boolean(options.withDate),
    namesOnly: true,
  });
  await args.replyText(top3Text);

  try {
    // 标题交给渲染层按性别默认（男团星嗨艺创 / 女队薇笑传媒），与软件日报一致
    // 超过默认阈值才拆最多两张；人数不够保持一张
    const pages = await toDailyReportImagePages(renderReportPng, report, {});
    for (const page of pages) {
      const suffix = page.fileNameSuffix || "";
      await args.replyImage({
        buffer: page.buffer,
        fileName: `${date}_${label}_每日报告${suffix}.png`,
      });
    }
    return true;
  } catch (error) {
    await args.replyText(`${label}报告图片生成失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function sendReport(args, command, db, renderReportPng, extra = {}) {
  const date = await resolveReportDate(db, command.dateSpec, "wave");
  const available = await db.exportWaveSnapshots(date);
  if (!available.length) {
    await args.replyText(`${date} 没有音浪快照，暂时没有可发送的报告。`);
    return;
  }

  // 顺序：男团每日之星文案/报告 → 女队每日之星文案/报告；日期只出现在首条文案
  const genders = command.gender === "both" ? ["male", "female"] : [command.gender === "female" ? "female" : "male"];
  let first = true;
  for (const gender of genders) {
    await sendOneGenderReport(args, date, gender, db, renderReportPng, {
      withDate: first,
      renderDailyStarPng: extra.renderDailyStarPng,
    });
    first = false;
  }
}

function notLiveSummaryText(periodLabel, gender, report) {
  const label = genderLabel(gender);
  const total = report?.rows?.length || 0;
  const notLiveCount = Number(report?.summary?.notLiveCount) || 0;
  const notLiveDays = Number(report?.summary?.notLiveDays) || 0;
  return `${periodLabel} ${label}未开播天数报告：共 ${total} 人，未开播人数 ${notLiveCount} 人，未开播天数 ${notLiveDays} 天。`;
}

async function sendOneGenderNotLiveReport(args, periodLabel, gender, report, renderReportPng, options = {}) {
  const label = genderLabel(gender);
  const sorted = {
    ...report,
    gender,
    date: report.date || periodLabel,
    month: report.month || (periodLabel.length === 7 ? periodLabel : undefined),
    rows: sortNotLiveReportRows(report.rows || []),
  };
  if (!sorted.rows.length) {
    await args.replyText(`${periodLabel} 没有${label}主播数据。`);
    return false;
  }
  await args.replyText(notLiveSummaryText(periodLabel, gender, sorted));
  try {
    const pages = await toNotLiveReportImagePages(renderReportPng, sorted, {
      period: options.period || "daily",
    });
    for (const page of pages) {
      await args.replyImage({
        buffer: page.buffer,
        fileName: `${periodLabel}_${label}_未开播天数报告${page.fileNameSuffix || ""}.png`,
      });
    }
  } catch (error) {
    await args.replyText(`${label}未开播报告图片生成失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  if (typeof args.replyFile === "function") {
    const csvRows = buildNotLiveCsvRows(sorted, {
      dateLabel: periodLabel,
      period: options.period || "daily",
    });
    await args.replyFile({
      buffer: csvBuffer(csvRows),
      fileName: `${periodLabel}_${label}_未开播天数.csv`,
    });
  }
  return true;
}

async function sendNotLiveReport(args, command, db, renderReportPng) {
  const latest = await getLatestDate(db, "wave");
  const genders = command.gender === "both" ? ["male", "female"] : [command.gender === "female" ? "female" : "male"];
  if (command.monthSpec) {
    const month = resolveMonthSpec(command.monthSpec, latest);
    if (typeof db.getMonthlyReport !== "function") {
      await args.replyText("月度未开播报告暂不可用。");
      return;
    }
    for (const gender of genders) {
      const report = await db.getMonthlyReport(month, gender);
      await sendOneGenderNotLiveReport(args, month, gender, report, renderReportPng, { period: "monthly" });
    }
    return;
  }
  const date = await resolveReportDate(db, command.dateSpec, "wave");
  const available = typeof db.exportWaveSnapshots === "function"
    ? await db.exportWaveSnapshots(date)
    : [{ 音浪: 1 }];
  if (!available.length) {
    await args.replyText(`${date} 没有音浪快照，暂时没有可发送的未开播报告。`);
    return;
  }
  for (const gender of genders) {
    const report = await db.getDailyWaveReport(date, gender);
    await sendOneGenderNotLiveReport(args, date, gender, report, renderReportPng, { period: "daily" });
  }
}

async function resolveAnchorOrReply(args, query, db) {
  const anchors = await db.getAnchors();
  const anchor = findAnchor(query, anchors);
  if (!anchor) {
    await args.replyText(`没有找到唯一主播“${query}”，请使用主播姓名、抖音号或主播 ID。`);
    return null;
  }
  return anchor;
}

async function handleAnchorDuration(args, command, db, analytics) {
  if (analytics) {
    const result = await analytics.getAnchorDuration({ query: command.query });
    if (!result.ok) {
      if (result.candidates?.length) {
        await args.replyText(`没有找到唯一主播“${command.query}”，请使用主播姓名、抖音号或主播 ID。`);
      } else {
        await args.replyText(result.error || `没有找到唯一主播“${command.query}”，请使用主播姓名、抖音号或主播 ID。`);
      }
      return;
    }
    if (!result.found) {
      await args.replyText(result.message || `${command.query} 没有时长快照。`);
      return;
    }
    await args.replyText(result.text);
    return;
  }
  const anchor = await resolveAnchorOrReply(args, command.query, db);
  if (!anchor) return;
  const date = await resolveReportDate(db, null, "duration");
  const rows = await db.exportDurationSnapshots(date);
  const ids = new Set([anchor.anchorId, ...(anchor.aliasIds || [])].map((value) => String(value || "")));
  const matches = rows.filter((row) => ids.has(String(row.抖音号 || "")));
  if (!matches.length) {
    await args.replyText(`${anchor.name} 在 ${date} 之前没有时长快照。`);
    return;
  }
  const best = matches.reduce((current, row) => Number(row.时长分钟) > Number(current.时长分钟) ? row : current);
  await args.replyText(`${anchor.name} 截至 ${date} 的累计直播时长：${formatDuration(best.时长分钟)}（${compactNumber(best.时长分钟)} 分钟）。`);
}

/**
 * 直接输入名字：汇总该主播库内全部已有数据（基础信息 + 音浪/时长全量）。
 */
async function handleAnchorProfile(args, command, db, analytics) {
  if (analytics) {
    const result = await analytics.getAnchorFullProfile({ query: command.query });
    if (!result.ok) {
      await args.replyText(`没有找到唯一主播“${command.query}”，请使用主播姓名、抖音号或主播 ID。`);
      return;
    }
    for (const part of result.textParts || [result.summaryText].filter(Boolean)) {
      if (part) await args.replyText(part);
    }
    return;
  }
  // 无 analytics 时的最小回退
  const anchor = await resolveAnchorOrReply(args, command.query, db);
  if (!anchor) return;
  await args.replyText(`【${anchor.name}】库内全部数据\n主播ID：${anchor.anchorId || "-"}`);
}

async function handleAnchorWaveDays(args, command, db, analytics) {
  if (analytics) {
    const result = await analytics.getAnchorWaveDays({ query: command.query });
    if (!result.ok) {
      await args.replyText(`没有找到唯一主播“${command.query}”，请使用主播姓名、抖音号或主播 ID。`);
      return;
    }
    if (!result.found) {
      await args.replyText(result.message || `${command.query} 没有可用音浪数据。`);
      return;
    }
    await args.replyText(result.text);
    return;
  }
  const anchor = await resolveAnchorOrReply(args, command.query, db);
  if (!anchor) return;
  const date = await resolveReportDate(db, null, "wave");
  const report = await db.getDailyWaveReport(date, anchor.gender === "female" ? "female" : "male");
  const row = report?.rows?.find((item) => rowMatchesAnchor(item, anchor));
  if (!row) {
    await args.replyText(`${anchor.name} 在 ${date} 没有可用音浪数据。`);
    return;
  }
  const dayOfMonth = Number(date.slice(8, 10)) || 0;
  const liveDays = Math.max(0, dayOfMonth - (Number(row.notLiveDays) || 0));
  await args.replyText(`${anchor.name} 截至 ${date} 本月有音浪 ${liveDays} 天，累计音浪 ${formatWave(row.totalWave)}，${Number(date.slice(5, 7))}月未播 ${row.notLiveDays || 0} 天。`);
}

async function handleAnchorWave(args, command, db, analytics) {
  if (analytics) {
    const date = command.dateSpec ? resolveDateSpec(command.dateSpec, await getLatestDate(db, "wave")) : null;
    const result = await analytics.getAnchorWaveProfile({ query: command.query, date });
    if (!result.ok) {
      await args.replyText(`没有找到唯一主播“${command.query}”，请使用主播姓名、抖音号或主播 ID。`);
      return;
    }
    if (!result.found) {
      await args.replyText(result.message || `${command.query} 没有可用音浪数据。`);
      return;
    }
    await args.replyText(
      `${result.anchor.name} ${result.asOfDate} 日音浪：${result.dailyWaveText}；截至当日累计音浪：${result.totalWaveText}。`
    );
    return;
  }
  const anchor = await resolveAnchorOrReply(args, command.query, db);
  if (!anchor) return;
  const date = await resolveReportDate(db, command.dateSpec, "wave");
  const report = await db.getDailyWaveReport(date, anchor.gender === "female" ? "female" : "male");
  const row = report?.rows?.find((item) => rowMatchesAnchor(item, anchor));
  if (!row) {
    await args.replyText(`${anchor.name} 在 ${date} 没有可用音浪数据。`);
    return;
  }
  await args.replyText(`${anchor.name} ${date} 日音浪：${formatWave(row.dailyWave)}；截至当日累计音浪：${formatWave(row.totalWave)}。`);
}

async function handleExportWaveFile(args, command, db) {
  const date = await resolveReportDate(db, command.dateSpec, "wave");
  const rows = await db.exportWaveSnapshots(date);
  if (!rows.length) {
    await args.replyText(`${date} 没有音浪快照，暂时没有可发送的文件。`);
    return;
  }
  const buffer = csvBuffer(rows);
  await args.replyText(`正在发送 ${date} 音浪文件，共 ${rows.length} 条。`);
  await args.replyFile({ buffer, fileName: `${date}_音浪数据.csv` });
}

function pendingImportKey(args = {}) {
  const accountId = String(args.accountId || "").trim() || "unknown";
  const groupId = String(args.groupId || "").trim();
  const userId = String(args.fromUserId || args.userId || "").trim();
  const conversationId = String(args.conversationId || "").trim();
  if (groupId) return `a:${accountId}|g:${groupId}|u:${userId || "unknown"}`;
  if (userId) return `a:${accountId}|u:${userId}`;
  return `a:${accountId}|c:${conversationId || "unknown"}`;
}

function createPendingImportDateStore() {
  /** @type {Map<string, { date: string, expiresAt: number }>} */
  const store = new Map();
  return {
    set(args, date) {
      const key = pendingImportKey(args);
      store.set(key, { date, expiresAt: Date.now() + PENDING_IMPORT_DATE_TTL_MS });
      return key;
    },
    take(args) {
      const key = pendingImportKey(args);
      const item = store.get(key);
      if (!item) return null;
      store.delete(key);
      if (Date.now() > item.expiresAt) return null;
      return item.date;
    },
    peek(args) {
      const key = pendingImportKey(args);
      const item = store.get(key);
      if (!item) return null;
      if (Date.now() > item.expiresAt) {
        store.delete(key);
        return null;
      }
      return item.date;
    },
    clear(args) {
      store.delete(pendingImportKey(args));
    },
  };
}

/**
 * CSV 导入日期规则：
 * 1) 消息文字明确指定日期（如「24号数据」）→ 该日
 * 2) 否则若会话有 10 分钟内预告的导入日 → 预告日
 * 3) 否则默认「昨天」
 * 不再使用文件名里的日期，避免 22 号发送的 csv 误导入 22 号。
 */
function resolveInboundImportDate(args, pendingDates) {
  const fromText = parseExplicitImportDateFromText(args.text || "");
  if (fromText) {
    pendingDates.clear(args);
    return { date: fromText, source: "message" };
  }
  const pending = pendingDates.take(args);
  if (pending) return { date: pending, source: "pending" };
  return { date: localYesterdayIso(), source: "yesterday" };
}

async function handleInboundFile(args, db, pendingDates, dailyPush = null) {
  args.assertLease?.();
  const file = await args.downloadMedia(args.fileItem);
  args.assertLease?.();
  const fileName = String(file.fileName || "weixin-file.bin");
  if (!/\.csv$/i.test(fileName)) {
    await args.replyText("请发送 CSV 格式的音浪或时长文件。\n默认导入到昨天；若要指定日期，请先发「24号数据」再传文件。");
    return;
  }
  const text = decodeCsv(file.buffer);
  const kind = inferImportKind(text, fileName, args.text);
  const parsed = parseCsvText(text, kind);
  const anchors = await db.getAnchors();
  const matched = matchImportRows(parsed.rows, anchors);
  if (!matched.rows.length) {
    await args.replyText(`文件已解析，但没有匹配到主播。有效行 ${parsed.rows.length}，未匹配 ${matched.unmatched.length}。`);
    return;
  }
  const resolved = resolveInboundImportDate(args, pendingDates);
  const date = resolved.date;
  const meta = buildImportMeta(file.buffer, fileName, kind, matched.rows);
  const importRows = kind === "wave"
    ? matched.rows.map((row) => ({ anchorId: row.anchorId, waveValue: row.value, rank: row.rank }))
    : matched.rows.map((row) => ({ anchorId: row.anchorId, totalMinutes: row.value }));
  args.assertLease?.();
  if (kind === "wave") {
    await db.importWaveSnapshots(date, importRows, meta);
  } else {
    await db.importDurationSnapshots(date, importRows, meta);
  }
  args.assertLease?.();
  const label = kind === "wave" ? "音浪" : "时长";
  const sourceHint = resolved.source === "yesterday"
    ? "（默认昨天；指定日期请先发「X号数据」）"
    : resolved.source === "pending"
      ? "（按你预告的日期）"
      : "（按消息指定日期）";
  await args.replyText(`已导入 ${dayToFriendly(date)} 的${label}数据${sourceHint}：${matched.rows.length} 条；未匹配 ${matched.unmatched.length} 条，重复行 ${matched.duplicateRows} 条，非法行 ${parsed.skipped} 条。`);
  if (kind === "wave" && dailyPush && typeof dailyPush.notifyAfterImport === "function") {
    try {
      void dailyPush.notifyAfterImport(date, { delayMs: 1500 });
    } catch {
      // ignore schedule errors
    }
  }
}


const CUSTOM_ACTIONS = new Set(["reply", "daily_report", "male_report", "female_report", "wave_file", "help"]);

function matchCustomCommand(text, customCommands) {
  const original = normalizeText(text);
  if (!original) return null;
  const list = Array.isArray(customCommands) ? customCommands : [];
  const lower = original.toLowerCase();
  for (const item of list) {
    if (!item || item.enabled === false) continue;
    const trigger = normalizeText(item.trigger);
    if (!trigger) continue;
    if (trigger.toLowerCase() !== lower) continue;
    const action = String(item.action || "reply").trim();
    if (!CUSTOM_ACTIONS.has(action)) continue;
    return {
      type: "custom",
      action,
      replyText: String(item.replyText || "").trim(),
      trigger,
    };
  }
  return null;
}

async function handleCustomCommand(args, command, db, renderReportPng, extra = {}) {
  if (command.action === "reply") {
    const text = command.replyText || "已收到。";
    await args.replyText(text);
    return;
  }
  if (command.action === "help") {
    await args.replyText(HELP_TEXT);
    return;
  }
  if (command.action === "daily_report") {
    await sendReport(args, { type: "report", gender: "both", dateSpec: null }, db, renderReportPng, extra);
    return;
  }
  if (command.action === "male_report") {
    await sendReport(args, { type: "report", gender: "male", dateSpec: null }, db, renderReportPng, extra);
    return;
  }
  if (command.action === "female_report") {
    await sendReport(args, { type: "report", gender: "female", dateSpec: null }, db, renderReportPng, extra);
    return;
  }
  if (command.action === "wave_file") {
    await handleExportWaveFile(args, { type: "export-wave-file", dateSpec: null }, db);
  }
}

async function handleBindCommand(args, command, bindService) {
  if (!bindService) {
    await args.replyText("绑定功能暂不可用。");
    return true;
  }
  const context = {
    channel: args.channel,
    fromUserId: args.fromUserId || args.userId,
    userId: args.userId,
  };
  let result;
  if (command.type === "bind") {
    result = await bindService.bind({ ...context, douyinNo: command.douyinNo });
  } else if (command.type === "bind-status") {
    result = await bindService.status(context);
  } else if (command.type === "unbind") {
    result = await bindService.unbind(context);
  } else {
    return false;
  }
  await args.replyText(formatBindReply(result));
  return true;
}

const PK_GROUP_CANON = (value) => String(value || "").replace(/\s+/g, "").replace(/[（(]/g, "(").replace(/[）)]/g, ")");

/** 微信/QQ：发组名（9.1 / 第1组 / 分组）→ 回 PK 分组图 */
async function handlePkGroupImage(args, command, db) {
  const snapshot = readLayoutSnapshot();
  if (!snapshot || !Array.isArray(snapshot.nameGroups) || !snapshot.nameGroups.length) {
    await args.replyText("还没有保存分组。请先在软件「PK 分组」页保存一次分组，之后发组名（如 9.1 或 第1组）即可收到分组图。");
    return;
  }

  const period = String(snapshot.period || "").trim();
  const memberByCanon = new Map();
  try {
    const roster = await db.getPkRoster(period || undefined);
    const all = [...(roster?.males || []), ...(roster?.females || [])];
    for (const member of all) {
      const key = PK_GROUP_CANON(member?.name);
      if (key && !memberByCanon.has(key)) {
        memberByCanon.set(key, {
          name: member.name,
          wave: Number(member.wave) || 0,
          trimmedAvg: Number(member.trimmedAvg ?? member.trimmed ?? 0),
          gender: member.gender || "",
        });
      }
    }
  } catch {
    // 拿不到战力也能出图（显示 0）
  }

  const groups = snapshot.nameGroups.map((names, index) => {
    // 保留快照里的成员顺序（组内排位由保存时的顺序决定，不按战力重排）
    const members = names.map(
      (name) => memberByCanon.get(PK_GROUP_CANON(name)) || { name, wave: 0, trimmedAvg: 0, gender: "" }
    );
    const top4 = members
      .map((m) => Number(m.wave) || 0)
      .sort((a, b) => b - a)
      .slice(0, 4)
      .reduce((sum, v) => sum + v, 0);
    return {
      label: String(snapshot.groupLabels?.[index] || "").trim() || `第${index + 1}组`,
      members,
      top4,
      average: members.length ? members.reduce((s, m) => s + (Number(m.wave) || 0), 0) / members.length : 0,
    };
  });

  const query = String(command.query || "").trim();
  let targets = groups;
  let matchedLabel = "";
  if (query) {
    if (/^\d{1,3}$/.test(query)) {
      // 数字：优先按组序号（第N组），其次按「N」结尾的自定义组名
      const index = Number(query) - 1;
      targets = groups[index] ? [groups[index]] : [];
      matchedLabel = groups[index]?.label || "";
      if (!targets.length) {
        targets = groups.filter((g) => PK_GROUP_CANON(g.label) === query);
        matchedLabel = targets[0]?.label || "";
      }
    } else {
      const key = PK_GROUP_CANON(query).toLowerCase();
      targets = groups.filter((g) => PK_GROUP_CANON(g.label).toLowerCase() === key);
      matchedLabel = targets[0]?.label || "";
      if (!targets.length) {
        // 容错：9.10 → 第10组 这类序号式组名
        const tail = query.split(".")[1];
        if (tail && /^\d{1,3}$/.test(tail)) {
          const byIndex = groups[Number(tail) - 1];
          if (byIndex) {
            targets = [byIndex];
            matchedLabel = byIndex.label;
          }
        }
      }
    }
    if (!targets.length) {
      const labels = groups.map((g) => g.label).join("、");
      await args.replyText(`没有找到分组「${query}」。当前可用：${labels}（也可发「分组」看全部）`);
      return;
    }
  }

  try {
    const buffer = await renderPkGroupsPng(
      {
        period,
        groups: targets,
        total: targets.reduce((sum, g) => sum + (g.members?.length || 0), 0),
      },
      { period, showWave: true, title: String(snapshot.name || "").trim() || "PK分组" }
    );
    const nameText = targets.length === groups.length ? "" : `${matchedLabel || query}`;
    await args.replyImage({
      buffer,
      fileName: `PK分组_${nameText || "全部"}_${localTodayIso()}.png`,
    });
  } catch (error) {
    await args.replyText(`分组图生成失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function dispatchBusinessCommand(args, command, { db, renderReportPng, renderDailyStarPng = null, analytics, bindService = null }) {
  if (!command) return false;
  if (command.type === "report") await sendReport(args, command, db, renderReportPng, { renderDailyStarPng });
  else if (command.type === "not-live-report") await sendNotLiveReport(args, command, db, renderReportPng);
  else if (command.type === "anchor-profile") await handleAnchorProfile(args, command, db, analytics);
  else if (command.type === "anchor-duration") await handleAnchorDuration(args, command, db, analytics);
  else if (command.type === "anchor-wave-days") await handleAnchorWaveDays(args, command, db, analytics);
  else if (command.type === "anchor-wave") await handleAnchorWave(args, command, db, analytics);
  else if (command.type === "export-wave-file") await handleExportWaveFile(args, command, db);
  else if (command.type === "pk-group-image") await handlePkGroupImage(args, command, db);
  else if (command.type === "bind" || command.type === "bind-status" || command.type === "unbind") {
    await handleBindCommand(args, command, bindService);
  }
  else return false;
  return true;
}

function createWeixinCommandHandler({ db, renderReportPng, renderDailyStarPng: renderDailyStarPngOpt = null, agent = null, analytics: sharedAnalytics = null, dailyPush = null } = {}) {
  if (!db) throw new Error("微信机器人命令处理缺少数据库");
  if (typeof renderReportPng !== "function") throw new Error("微信机器人命令处理缺少图片渲染器");
  const pendingImportDates = createPendingImportDateStore();
  const modeStore = createModeStore();
  const analytics = sharedAnalytics || createWeixinAnalytics({ db, renderReportPng });
  const bindService = createAnchorBindService({ db });
  const deps = { db, renderReportPng, renderDailyStarPng: renderDailyStarPngOpt, analytics, bindService };

  async function handleCommand(args) {
    try {
      const items = Array.isArray(args.items) ? args.items : [];
      const fileItem = items.find((item) => item?.type === 4 && item.file_item);
      if (fileItem) {
        await handleInboundFile({ ...args, fileItem }, db, pendingImportDates, dailyPush);
        return { handled: true };
      }

      // 预告导入日：先说「24号数据」，再发 CSV（两种模式都允许）
      const importDateHint = parseExplicitImportDateFromText(args.text || "");
      if (importDateHint && /(?:数据|导入)/.test(normalizeText(args.text || ""))) {
        pendingImportDates.set(args, importDateHint);
        await args.replyText(`已记住导入日期 ${importDateHint}（10 分钟内有效）。请现在发送 CSV 文件。`);
        return { handled: true };
      }

      const pushCommand = matchDailyPushCommand(args.text);
      if (pushCommand) {
        if (!dailyPush) {
          await args.replyText("日报推送能力未就绪。");
          return { handled: true };
        }
        const actorUserId = String(args.fromUserId || args.userId || "").trim();
        const accountId = String(args.accountId || "").trim();
        try {
          if (pushCommand.type === "status") {
            const text = typeof dailyPush.getStatusText === "function"
              ? dailyPush.getStatusText()
              : "无法读取推送状态";
            await args.replyText(text);
            return { handled: true };
          }
          if (pushCommand.type === "enable") {
            dailyPush.setEnabled(true, { actorUserId, accountId });
            await args.replyText("已开启日报自动推送。音浪数据更新后将发送每日之星（前三名）文案与报告图。发「关闭日报推送」可关闭。");
            return { handled: true };
          }
          if (pushCommand.type === "disable") {
            dailyPush.setEnabled(false, { actorUserId, accountId });
            await args.replyText("已关闭日报自动推送。");
            return { handled: true };
          }
        } catch (error) {
          await args.replyText(error instanceof Error ? error.message : String(error));
          return { handled: true };
        }
      }

      const systemToken = matchSystemToken(args.text);
      const aiStatus = typeof agent?.getPublicStatus === "function" ? agent.getPublicStatus() : {};
      const aiReady = Boolean(aiStatus.configured && aiStatus.enabled);
      // 模式仅由用户显式切换；不因 AI 就绪与否自动改 mode。
      // 无 agent 实例时无法进模型，按纯指令路径执行（不改写 modeStore）。
      const agentMode = Boolean(agent) && modeStore.isAgent(args);

      if (systemToken === "help") {
        await args.replyText(agentMode ? AGENT_HELP : INSTRUCTION_HELP);
        if (agentMode && !aiReady) {
          await args.replyText(
            "提示：当前是 AI 模式，但桌面 AI 未就绪；业务文本可能无法回答。可发「纯指令」切回固定指令，或去桌面配置 Key。"
          );
        }
        return { handled: true };
      }
      if (systemToken === "enable") {
        if (!agent || typeof agent.enableSession !== "function") {
          await args.replyText("智能对话暂不可用。请检查桌面 AI 配置。");
          return { handled: true };
        }
        if (!aiReady) {
          await args.replyText(
            "AI 未就绪：请确认桌面已保存接口地址、模型与 API Key，并开启 AI。配置好后再发「智能模式」。"
          );
          return { handled: true };
        }
        modeStore.setMode(args, "agent");
        agent.enableSession(args);
        await args.replyText([
          "已切换到【AI 模型模式】。",
          "业务文本由 AI 处理；发「纯指令」可切回固定指令。",
          "模式不会自动切换。",
        ].join("\n"));
        return { handled: true };
      }
      if (systemToken === "disable") {
        modeStore.setMode(args, "instruction");
        if (agent && typeof agent.disableSession === "function") agent.disableSession(args);
        await args.replyText([
          "已切换到【纯指令模式】。",
          "只认固定指令（每日报告、艺名音浪等），不调 AI 模型。",
          "发「智能模式」可再开 AI。",
        ].join("\n"));
        return { handled: true };
      }
      if (systemToken === "clear-memory") {
        // 仅清对话记忆，不改当前模式
        const keep = modeStore.getMode(args);
        if (agent && typeof agent.clearThread === "function") {
          agent.clearThread(threadKeyFromContext(args));
        } else if (agent && typeof agent.disableSession === "function") {
          agent.disableSession(args);
        }
        modeStore.setMode(args, keep);
        await args.replyText(
          keep === "agent"
            ? "已清空本会话对话记忆。当前仍为 AI 模式。"
            : "已清空本会话对话记忆。当前仍为纯指令模式。"
        );
        return { handled: true };
      }
      if (systemToken === "clear-habits") {
        const key = threadKeyFromContext(args);
        if (agent && typeof agent.clearProfile === "function") {
          agent.clearProfile(key);
        } else if (agent?.userMemory && typeof agent.userMemory.clearProfile === "function") {
          try {
            agent.userMemory.clearProfile(key);
          } catch {
            // ignore
          }
        }
        await args.replyText("已清除本会话习惯画像；对话记忆与模式未改。");
        return { handled: true };
      }

      // AI 模式：高置信短指令走确定性路径；其余交 Agent
      if (agentMode && aiReady) {
        const custom = matchCustomCommand(args.text, args.settings?.customCommands);
        if (custom) {
          await handleCustomCommand(args, custom, db, renderReportPng, { renderDailyStarPng: renderDailyStarPngOpt });
          return { handled: true, via: "fast-route" };
        }
        const fast = matchFastRoute(args.text, { parseBotCommand });
        if (fast) {
          const ok = await dispatchBusinessCommand(args, fast, deps);
          return { handled: ok, via: "fast-route" };
        }
        return { handled: false, via: "ai" };
      }

      // 纯指令模式（或 AI 未就绪兜底）：确定性命令
      const custom = matchCustomCommand(args.text, args.settings?.customCommands);
      if (custom) {
        await handleCustomCommand(args, custom, db, renderReportPng, { renderDailyStarPng: renderDailyStarPngOpt });
        return { handled: true };
      }

      const command = parseBotCommand(args.text);
      if (!command) {
        if (agentMode && !aiReady) {
          await args.replyText(
            "当前是 AI 模式，但 AI 未就绪。请配置桌面 AI，或发「纯指令」改用固定指令。"
          );
          return { handled: true };
        }
        return { handled: false };
      }

      if (command.type === "help") {
        await args.replyText(agentMode ? AGENT_HELP : INSTRUCTION_HELP);
        return { handled: true };
      }
      if (command.type === "agent-enable" || command.type === "agent-disable") {
        return { handled: false };
      }

      const ok = await dispatchBusinessCommand(args, command, deps);
      return { handled: ok, via: agentMode && !aiReady ? "instruction-fallback" : undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (typeof args.replyText === "function") {
        await args.replyText(`处理失败：${message}`);
      }
      return { handled: true, error: message };
    }
  }

  handleCommand.modeStore = modeStore;
  handleCommand.analytics = analytics;
  return handleCommand;
}

module.exports = {
  HELP_TEXT,
  AGENT_HELP,
  AGENT_ENABLE_RE,
  AGENT_DISABLE_RE,
  normalizeText,
  parseDateSpec,
  resolveDateSpec,
  normalizeIsoDate,
  getLatestDate,
  parseBotCommand,
  parseMonthSpec,
  resolveMonthSpec,
  parseBindCommand,
  matchCustomCommand,
  parseWaveValue,
  parseDurationValue,
  inferImportKind,
  parseCsvText,
  matchImportRows,
  buildImportMeta,
  pendingImportKey,
  createWeixinCommandHandler,
  createModeStore,
  matchFastRoute,
  matchSystemToken,
  matchDailyPushCommand,
};
