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

  const withoutGender = original.replace(/(?:男团|男队|男性|女团|女队|女性)/g, "").trim();

  const fileMatch = withoutGender.match(/^(?:\/?(?:音浪文件|导出音浪(?:文件)?))(?:\s*(.+))?$/i);
  if (fileMatch) return { type: "export-wave-file", dateSpec: parseDateSpec(fileMatch[1] || "") };

  if (AGENT_ENABLE_RE.test(original)) return { type: "agent-enable" };
  if (AGENT_DISABLE_RE.test(original)) return { type: "agent-disable" };

  // PK 分组：内置 / 顺序 / 均衡 / 能出分（可选 2026-07 / 7月）
  const pkGroupMatch = withoutGender.match(
    /^(?:\/?(?:内置分组|锁定分组|固定分组|顺序分组|从高到低分组|高低分组|强弱分组|均衡分组|平均分组|蛇形分组|能出分分组|出分分组|PK分组|争霸赛分组|自动分组|分组))(?:\s*(.+))?$/i
  );
  if (
    pkGroupMatch ||
    /^(?:内置|锁定|固定|顺序|从高到低|高低|强弱|均衡|平均|蛇形|能出分|出分)\s*分组/.test(withoutGender)
  ) {
    const raw = withoutGender;
    // 默认内置锁定分组
    let mode = "preset";
    if (/顺序|从高到低|高低|强弱|高到低/.test(raw)) mode = "high_to_low";
    if (/均衡|平均|蛇形/.test(raw)) mode = "balanced";
    if (/能出分|出分/.test(raw)) mode = "score_capable";
    if (/内置|锁定|固定/.test(raw)) mode = "preset";
    const rest = (pkGroupMatch && pkGroupMatch[1]) || "";
    const periodMatch =
      rest.match(/(20\d{2})[年./-](\d{1,2})(?:月)?/) ||
      raw.match(/(20\d{2})[年./-](\d{1,2})(?:月)?/) ||
      rest.match(/(\d{1,2})\s*月/) ||
      raw.match(/(\d{1,2})\s*月/);
    let period = null;
    if (periodMatch) {
      if (periodMatch[2]) {
        period = `${periodMatch[1]}-${String(Number(periodMatch[2])).padStart(2, "0")}`;
      } else {
        const now = new Date();
        period = `${now.getFullYear()}-${String(Number(periodMatch[1])).padStart(2, "0")}`;
      }
    }
    return {
      type: "pk-groups",
      mode,
      period,
      sendCsv: /csv|CSV|表格|文件/.test(original),
      sendImage: !/(?:不要图|无图|不出图|不要图片)/.test(original),
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

  // 直接输入主播名/抖音号/主播 ID：返回库内全部相关数据
  if (
    withoutGender.length >= 1
    && withoutGender.length <= 40
    && !/[，。！？、；：,.!?;:]/.test(withoutGender)
    && !/^(今日|今天|昨日|昨天|音浪|文件|报告|日报|导出|帮助|菜单|命令|指令|人工|客服|智能)/.test(withoutGender)
  ) {
    return { type: "anchor-profile", query: withoutGender };
  }
  return null;
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

async function sendOneGenderReport(args, date, gender, db, renderReportPng) {
  const label = genderLabel(gender);
  const report = await db.getDailyWaveReport(date, gender);
  if (!report?.rows?.length) {
    await args.replyText(`${date} 没有${label}主播数据。`);
    return false;
  }
  const liveCount = report.rows.filter((row) => row.isLive).length;
  const caption = `${date} ${label}每日报告：${report.rows.length} 人，开播 ${liveCount} 人，未播 ${report.summary?.notLiveCount || 0} 人。`;
  await args.replyText(caption);
  try {
    // 标题交给渲染层按性别默认（男团星嗨艺创 / 女队薇笑传媒），与软件日报一致
    const image = await renderReportPng(report, {});
    await args.replyImage({ buffer: image, fileName: `${date}_${label}_每日报告.png` });
    return true;
  } catch (error) {
    await args.replyText(`${label}报告图片生成失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function sendReport(args, command, db, renderReportPng) {
  const date = await resolveReportDate(db, command.dateSpec, "wave");
  const available = await db.exportWaveSnapshots(date);
  if (!available.length) {
    await args.replyText(`${date} 没有音浪快照，暂时没有可发送的报告。`);
    return;
  }

  const genders = command.gender === "both" ? ["male", "female"] : [command.gender === "female" ? "female" : "male"];
  if (genders.length > 1) {
    await args.replyText(`${date} 每日报告：依次发送男团、女队。`);
  }
  for (const gender of genders) {
    await sendOneGenderReport(args, date, gender, db, renderReportPng);
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

async function handlePkGroups(args, command, db) {
  const { createWeixinBotSkills } = require("./weixin-bot-skills");
  const skills = createWeixinBotSkills({
    db,
    renderReportPng: async () => Buffer.alloc(0),
  });
  const result = await skills.execute("make_pk_groups", {
    mode: command.mode || "preset",
    period: command.period || undefined,
    sendCsv: Boolean(command.sendCsv),
    // 默认出图；显式 noimage/无图 可关
    sendImage: command.sendImage !== false,
    usePresetRoster: true,
  });
  if (!result?.ok) {
    await args.replyText(result?.error || "分组失败");
    return;
  }
  const text = String(result.replyText || result.text || "").slice(0, 3500);
  if (text) await args.replyText(text);

  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  for (const artifact of artifacts) {
    if (artifact?.kind === "image" && artifact.buffer && typeof args.replyImage === "function") {
      await args.replyImage({
        buffer: artifact.buffer,
        fileName: artifact.fileName || result.imageFileName || "PK分组.png",
      });
    } else if (artifact?.kind === "file" && artifact.buffer && typeof args.replyFile === "function") {
      await args.replyFile({
        buffer: artifact.buffer,
        fileName: artifact.fileName || result.csvFileName || "PK分组.csv",
      });
    }
  }
  // 兼容旧字段：仅有 csv 无 artifacts
  if (!artifacts.length && result.csv && typeof args.replyFile === "function") {
    await args.replyFile({
      buffer: Buffer.from(String(result.csv), "utf8"),
      fileName: result.csvFileName || `PK分组_${result.modeLabel || "分组"}.csv`,
    });
  }
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

async function handleInboundFile(args, db, pendingDates) {
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
  await args.replyText(`已导入 ${date} ${label}数据${sourceHint}：${matched.rows.length} 条；未匹配 ${matched.unmatched.length} 条，重复行 ${matched.duplicateRows} 条，非法行 ${parsed.skipped} 条。`);
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

async function handleCustomCommand(args, command, db, renderReportPng) {
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
    await sendReport(args, { type: "report", gender: "both", dateSpec: null }, db, renderReportPng);
    return;
  }
  if (command.action === "male_report") {
    await sendReport(args, { type: "report", gender: "male", dateSpec: null }, db, renderReportPng);
    return;
  }
  if (command.action === "female_report") {
    await sendReport(args, { type: "report", gender: "female", dateSpec: null }, db, renderReportPng);
    return;
  }
  if (command.action === "wave_file") {
    await handleExportWaveFile(args, { type: "export-wave-file", dateSpec: null }, db);
  }
}

async function dispatchBusinessCommand(args, command, { db, renderReportPng, analytics }) {
  if (!command) return false;
  if (command.type === "report") await sendReport(args, command, db, renderReportPng);
  else if (command.type === "anchor-profile") await handleAnchorProfile(args, command, db, analytics);
  else if (command.type === "anchor-duration") await handleAnchorDuration(args, command, db, analytics);
  else if (command.type === "anchor-wave-days") await handleAnchorWaveDays(args, command, db, analytics);
  else if (command.type === "anchor-wave") await handleAnchorWave(args, command, db, analytics);
  else if (command.type === "export-wave-file") await handleExportWaveFile(args, command, db);
  else if (command.type === "pk-groups") await handlePkGroups(args, command, db);
  else return false;
  return true;
}

function createWeixinCommandHandler({ db, renderReportPng, agent = null, analytics: sharedAnalytics = null } = {}) {
  if (!db) throw new Error("微信机器人命令处理缺少数据库");
  if (typeof renderReportPng !== "function") throw new Error("微信机器人命令处理缺少图片渲染器");
  const pendingImportDates = createPendingImportDateStore();
  const modeStore = createModeStore();
  const analytics = sharedAnalytics || createWeixinAnalytics({ db, renderReportPng });
  const deps = { db, renderReportPng, analytics };

  async function handleCommand(args) {
    try {
      const items = Array.isArray(args.items) ? args.items : [];
      const fileItem = items.find((item) => item?.type === 4 && item.file_item);
      if (fileItem) {
        await handleInboundFile({ ...args, fileItem }, db, pendingImportDates);
        return { handled: true };
      }

      // 预告导入日：先说「24号数据」，再发 CSV（两种模式都允许）
      const importDateHint = parseExplicitImportDateFromText(args.text || "");
      if (importDateHint && /(?:数据|导入)/.test(normalizeText(args.text || ""))) {
        pendingImportDates.set(args, importDateHint);
        await args.replyText(`已记住导入日期 ${importDateHint}（10 分钟内有效）。请现在发送 CSV 文件。`);
        return { handled: true };
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

      // AI 模式：文本交 Agent（用户显式开启后）
      if (agentMode) {
        if (!aiReady) {
          await args.replyText(
            "当前是 AI 模式，但 AI 未就绪。请配置桌面 AI，或发「纯指令」改用固定指令。"
          );
          return { handled: true };
        }
        return { handled: false, via: "ai" };
      }

      // 纯指令模式：只跑确定性命令
      const custom = matchCustomCommand(args.text, args.settings?.customCommands);
      if (custom) {
        await handleCustomCommand(args, custom, db, renderReportPng);
        return { handled: true };
      }

      const command = parseBotCommand(args.text);
      if (!command) return { handled: false };

      if (command.type === "help") {
        await args.replyText(INSTRUCTION_HELP);
        return { handled: true };
      }
      if (command.type === "agent-enable" || command.type === "agent-disable") {
        return { handled: false };
      }

      const ok = await dispatchBusinessCommand(args, command, deps);
      return { handled: ok };
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
};
