const crypto = require("crypto");
const Papa = require("papaparse");

const HELP_TEXT = [
  "用法很简单：",
  "· 直接发艺名 → 查库内全部数据",
  "· 每日报告 → 最新双团报告图",
  "· 18号报告 / 18号音浪 → 指定日报告",
  "· 艺名+时长 → 累计直播时长",
  "· 艺名+音浪 → 最新音浪",
  "· 音浪文件 → 导出 CSV（也可直接发 CSV 导入）",
  "· 人工客服 → 开启智能助手",
  "· 退出客服 → 关闭智能助手",
].join("\n");

const AGENT_ENABLE_RE = /^(?:人工客服|智能客服|客服|开启客服|打开客服)$/i;
const AGENT_DISABLE_RE = /^(?:退出客服|关闭客服|结束客服|取消客服)$/i;

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
  const day = text.match(/(?:^|\s)(\d{1,2})\s*[日号](?=$|\s|音浪|文件|日报|报告|_|\.)/);
  if (day) return { type: "day", day: Number(day[1]) };
  return null;
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

function extractDateFromText(text, fallbackDate) {
  return resolveDateSpec(parseDateSpec(text), fallbackDate);
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

async function handleAnchorDuration(args, command, db) {
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
async function handleAnchorProfile(args, command, db) {
  const anchor = await resolveAnchorOrReply(args, command.query, db);
  if (!anchor) return;

  const genderLabel = anchor.gender === "female" ? "女队" : "男团";
  const accountIds = [anchor.anchorId, ...(anchor.aliasIds || [])]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const uniqueIds = [...new Set(accountIds)];

  const waveByDate = new Map();
  const durationByDate = new Map();
  const hasWaveTrend = typeof db.getAnchorWaveTrend === "function";
  const hasDurationTrend = typeof db.getAnchorDurationTrend === "function";

  for (const accountId of uniqueIds) {
    if (hasWaveTrend) {
      const trend = await db.getAnchorWaveTrend(accountId);
      for (const point of Array.isArray(trend) ? trend : []) {
        const date = String(point.date || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const total = Number(point.total) || 0;
        const rank = Number(point.rank) || 0;
        const prev = waveByDate.get(date);
        if (!prev || total > prev.total) waveByDate.set(date, { date, total, rank });
      }
    }
    if (hasDurationTrend) {
      const trend = await db.getAnchorDurationTrend(accountId);
      for (const point of Array.isArray(trend) ? trend : []) {
        const date = String(point.date || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const total = Number(point.total) || 0;
        const prev = durationByDate.get(date);
        if (!prev || total > prev.total) durationByDate.set(date, { date, total });
      }
    }
  }

  // 兼容无 trend API 时，从 export 全表过滤（测试/旧库）
  if (!hasWaveTrend && typeof db.exportWaveSnapshots === "function") {
    const rows = await db.exportWaveSnapshots();
    const idSet = new Set(uniqueIds);
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = String(row.抖音号 || row.anchorId || "").trim();
      if (!idSet.has(id)) continue;
      const date = String(row.日期 || row.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const total = Number(row.音浪 || row.wave || row.total || 0) || 0;
      const rank = Number(row.排名 || row.rank || 0) || 0;
      const prev = waveByDate.get(date);
      if (!prev || total > prev.total) waveByDate.set(date, { date, total, rank });
    }
  }
  if (!hasDurationTrend && typeof db.exportDurationSnapshots === "function") {
    const rows = await db.exportDurationSnapshots();
    const idSet = new Set(uniqueIds);
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = String(row.抖音号 || row.anchorId || "").trim();
      if (!idSet.has(id)) continue;
      const date = String(row.日期 || row.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const total = Number(row.时长分钟 || row.totalMinutes || row.total || 0) || 0;
      const prev = durationByDate.get(date);
      if (!prev || total > prev.total) durationByDate.set(date, { date, total });
    }
  }

  const waveDates = [...waveByDate.keys()].sort();
  const durationDates = [...durationByDate.keys()].sort();
  const latestWave = waveDates.length ? waveByDate.get(waveDates[waveDates.length - 1]) : null;
  const latestDuration = durationDates.length
    ? durationByDate.get(durationDates[durationDates.length - 1])
    : null;
  const peakWave = waveDates.length
    ? [...waveByDate.values()].reduce((best, item) => (item.total > best.total ? item : best))
    : null;
  const waveSum = [...waveByDate.values()].reduce((sum, item) => sum + item.total, 0);

  const lines = [
    `【${anchor.name}】库内全部数据`,
    `队伍：${genderLabel}`,
    `主播ID：${anchor.anchorId || "-"}`,
    `抖音号：${anchor.douyinNo || "-"}`,
    anchor.masterName ? `师父：${anchor.masterName}` : null,
    uniqueIds.length > 1 ? `关联账号：${uniqueIds.join("、")}` : null,
    "",
    "—— 音浪 ——",
    waveDates.length
      ? `记录 ${waveDates.length} 天（${waveDates[0]} ~ ${waveDates[waveDates.length - 1]}）`
      : "暂无音浪快照",
    latestWave
      ? `最新 ${latestWave.date}：日音浪 ${formatWave(latestWave.total)}${latestWave.rank ? ` · 排名 ${latestWave.rank}` : ""}`
      : null,
    peakWave
      ? `峰值 ${peakWave.date}：${formatWave(peakWave.total)}${peakWave.rank ? ` · 排名 ${peakWave.rank}` : ""}`
      : null,
    waveDates.length ? `各日合计：${formatWave(waveSum)}` : null,
    "",
    "—— 时长 ——",
    durationDates.length
      ? `记录 ${durationDates.length} 次（${durationDates[0]} ~ ${durationDates[durationDates.length - 1]}）`
      : "暂无时长快照",
    latestDuration
      ? `最新累计 ${latestDuration.date}：${formatDuration(latestDuration.total)}（${compactNumber(latestDuration.total)} 分钟）`
      : null,
  ].filter((line) => line !== null);

  // 附上全部明细（控制长度，过长则只发最近一段 + 提示）
  const detailLines = [];
  if (waveDates.length) {
    detailLines.push("", "音浪明细：");
    for (const date of waveDates) {
      const item = waveByDate.get(date);
      detailLines.push(
        `${date}  ${formatWave(item.total)}${item.rank ? `  #${item.rank}` : ""}`
      );
    }
  }
  if (durationDates.length) {
    detailLines.push("", "时长明细（累计分钟）：");
    for (const date of durationDates) {
      const item = durationByDate.get(date);
      detailLines.push(`${date}  ${formatDuration(item.total)}`);
    }
  }

  const full = [...lines, ...detailLines].join("\n");
  // 微信单条文本不宜过长，超过约 3500 字时拆成摘要 + 明细
  if (full.length <= 3500) {
    await args.replyText(full);
    return;
  }
  await args.replyText(lines.join("\n"));
  // 明细按块发送
  const chunks = [];
  let buf = "";
  for (const line of detailLines) {
    if ((buf + "\n" + line).length > 3200) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) chunks.push(buf);
  for (const chunk of chunks) {
    if (chunk.trim()) await args.replyText(chunk);
  }
}

async function handleAnchorWaveDays(args, command, db) {
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

async function handleAnchorWave(args, command, db) {
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

async function handleInboundFile(args, db) {
  const file = await args.downloadMedia(args.fileItem);
  const fileName = String(file.fileName || "weixin-file.bin");
  if (!/\.csv$/i.test(fileName)) {
    await args.replyText("请发送 CSV 格式的音浪或时长文件；文件名可带日期，例如 2026-07-18_音浪.csv。\n");
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
  const date = extractDateFromText(`${args.text}\n${fileName}`, null);
  const meta = buildImportMeta(file.buffer, fileName, kind, matched.rows);
  const importRows = kind === "wave"
    ? matched.rows.map((row) => ({ anchorId: row.anchorId, waveValue: row.value, rank: row.rank }))
    : matched.rows.map((row) => ({ anchorId: row.anchorId, totalMinutes: row.value }));
  if (kind === "wave") {
    await db.importWaveSnapshots(date, importRows, meta);
  } else {
    await db.importDurationSnapshots(date, importRows, meta);
  }
  const label = kind === "wave" ? "音浪" : "时长";
  await args.replyText(`已导入 ${date} ${label}数据：${matched.rows.length} 条；未匹配 ${matched.unmatched.length} 条，重复行 ${matched.duplicateRows} 条，非法行 ${parsed.skipped} 条。`);
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

function createWeixinCommandHandler({ db, renderReportPng, agent = null }) {
  if (!db) throw new Error("微信机器人命令处理缺少数据库");
  if (typeof renderReportPng !== "function") throw new Error("微信机器人命令处理缺少图片渲染器");

  return async function handleCommand(args) {
    try {
      const items = Array.isArray(args.items) ? args.items : [];
      const fileItem = items.find((item) => item?.type === 4 && item.file_item);
      if (fileItem) {
        await handleInboundFile({ ...args, fileItem }, db);
        return { handled: true };
      }

      const custom = matchCustomCommand(args.text, args.settings?.customCommands);
      if (custom) {
        await handleCustomCommand(args, custom, db, renderReportPng);
        return { handled: true };
      }

      const command = parseBotCommand(args.text);
      if (!command) return { handled: false };

      if (command.type === "help") {
        await args.replyText(HELP_TEXT);
        return { handled: true };
      }

      if (command.type === "agent-enable") {
        if (!agent || typeof agent.enableSession !== "function") {
          await args.replyText("智能客服暂不可用，请先在桌面端配置 AI。");
          return { handled: true };
        }
        const status = typeof agent.getPublicStatus === "function" ? agent.getPublicStatus() : {};
        if (!status.configured) {
          await args.replyText("智能客服未配置：请管理员在桌面端填写 API Key 并启用 AI。");
          return { handled: true };
        }
        if (!status.enabled) {
          await args.replyText("智能客服已配置但未启用，请管理员在桌面端打开 AI 开关。");
          return { handled: true };
        }
        agent.enableSession(args);
        await args.replyText([
          "已接入智能客服。",
          "可直接说：查某艺名、每日报告、18号报告、对比两位主播、发音浪文件。",
          "固定命令仍然可用；回复「退出客服」结束。",
        ].join("\n"));
        return { handled: true };
      }

      if (command.type === "agent-disable") {
        if (agent && typeof agent.disableSession === "function") agent.disableSession(args);
        await args.replyText("已退出智能客服。固定命令仍可用，发「帮助」查看。");
        return { handled: true };
      }

      if (command.type === "report") await sendReport(args, command, db, renderReportPng);
      else if (command.type === "anchor-profile") await handleAnchorProfile(args, command, db);
      else if (command.type === "anchor-duration") await handleAnchorDuration(args, command, db);
      else if (command.type === "anchor-wave-days") await handleAnchorWaveDays(args, command, db);
      else if (command.type === "anchor-wave") await handleAnchorWave(args, command, db);
      else if (command.type === "export-wave-file") await handleExportWaveFile(args, command, db);
      return { handled: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (typeof args.replyText === "function") {
        await args.replyText(`处理失败：${message}`);
      }
      return { handled: true, error: message };
    }
  };
}

module.exports = {
  HELP_TEXT,
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
  createWeixinCommandHandler,
};
