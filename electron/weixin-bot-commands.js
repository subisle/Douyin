const crypto = require("crypto");
const Papa = require("papaparse");

const HELP_TEXT = [
  "可用命令：",
  "每日报告 / 18号音浪：发送男团报告图片（也支持 2026-07-18音浪）",
  "女团每日报告：发送女队报告图片",
  "主播名时长：查询累计直播时长",
  "主播名多少日音浪：查询本月有音浪天数与累计音浪",
  "主播名18号音浪：查询指定日期的日音浪",
  "音浪文件：发送指定日期音浪 CSV；直接发送 CSV 附件会自动解析导入",
  "日期可写为 18号、18日、2026-07-18、昨日或今日。",
].join("\n");

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

function parseBotCommand(input) {
  const original = normalizeText(input);
  if (!original) return null;
  if (/^(?:\/?help|帮助|菜单|命令|指令)$/i.test(original)) return { type: "help" };

  const gender = /(?:女团|女队|女性)/.test(original) ? "female" : "male";
  const withoutGender = original.replace(/(?:男团|男队|男性|女团|女队|女性)/g, "").trim();

  const fileMatch = withoutGender.match(/^(?:\/?(?:音浪文件|导出音浪(?:文件)?))(?:\s*(.+))?$/i);
  if (fileMatch) return { type: "export-wave-file", dateSpec: parseDateSpec(fileMatch[1] || "") };

  const reportMatch = withoutGender.match(/^(?:\/?(?:每日报告|日报|报告))(?:\s*(.+))?$/i);
  if (reportMatch) return { type: "report", gender, dateSpec: parseDateSpec(reportMatch[1] || "") };

  const dateOnlyWave = withoutGender.match(/^(今日|今天|昨日|昨天|20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}[日号]?|20\d{6}|\d{1,2}\s*[日号])\s*音浪$/);
  if (dateOnlyWave) return { type: "report", gender, dateSpec: parseDateSpec(dateOnlyWave[1]) };

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

async function getLatestDate(db, kind) {
  const summary = await db.getDashboardSummary();
  const fromSummary = kind === "duration"
    ? (summary.latestDurationDate || summary.latestDataDate)
    : (summary.latestWaveDate || summary.latestDataDate);
  if (fromSummary) return String(fromSummary).slice(0, 10);
  if (kind === "duration") {
    const rows = await db.exportDurationSnapshots();
    return rows
      .map((row) => String(row.快照日期 || row.日期 || "").slice(0, 10))
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  }
  const rows = await db.exportWaveSnapshots();
  return rows
    .map((row) => String(row.日期 || "").slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

async function resolveReportDate(db, spec, kind = "wave") {
  return resolveDateSpec(spec, await getLatestDate(db, kind));
}

async function sendReport(args, command, db, renderReportPng) {
  const date = await resolveReportDate(db, command.dateSpec, "wave");
  const available = await db.exportWaveSnapshots(date);
  if (!available.length) {
    await args.replyText(`${date} 没有音浪快照，暂时没有可发送的报告。`);
    return;
  }
  const report = await db.getDailyWaveReport(date, command.gender);
  if (!report?.rows?.length) {
    await args.replyText(`${date} 没有${command.gender === "female" ? "女队" : "男团"}主播数据。`);
    return;
  }
  const liveCount = report.rows.filter((row) => row.isLive).length;
  const caption = `${date} ${command.gender === "female" ? "女队" : "男团"}每日报告：${report.rows.length} 人，开播 ${liveCount} 人，未播 ${report.summary.notLiveCount} 人。`;
  await args.replyText(caption);
  try {
    const image = await renderReportPng(report, { title: `${command.gender === "female" ? "女队" : "男团"}每日报告` });
    await args.replyImage({ buffer: image, fileName: `${date}_${command.gender === "female" ? "女队" : "男团"}_每日报告.png` });
  } catch (error) {
    await args.replyText(`报告图片生成失败：${error instanceof Error ? error.message : String(error)}`);
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

function createWeixinCommandHandler({ db, renderReportPng }) {
  if (!db) throw new Error("微信机器人命令处理缺少数据库");
  if (typeof renderReportPng !== "function") throw new Error("微信机器人命令处理缺少图片渲染器");

  return async function handleCommand(args) {
    const items = Array.isArray(args.items) ? args.items : [];
    const fileItem = items.find((item) => item?.type === 4 && item.file_item);
    if (fileItem) {
      await handleInboundFile({ ...args, fileItem }, db);
      return { handled: true };
    }

    const command = parseBotCommand(args.text);
    if (!command) return { handled: false };
    if (command.type === "help") {
      await args.replyText(HELP_TEXT);
      return { handled: true };
    }
    if (command.type === "report") await sendReport(args, command, db, renderReportPng);
    else if (command.type === "anchor-duration") await handleAnchorDuration(args, command, db);
    else if (command.type === "anchor-wave-days") await handleAnchorWaveDays(args, command, db);
    else if (command.type === "anchor-wave") await handleAnchorWave(args, command, db);
    else if (command.type === "export-wave-file") await handleExportWaveFile(args, command, db);
    return { handled: true };
  };
}

module.exports = {
  HELP_TEXT,
  normalizeText,
  parseDateSpec,
  resolveDateSpec,
  parseBotCommand,
  parseWaveValue,
  parseDurationValue,
  inferImportKind,
  parseCsvText,
  matchImportRows,
  buildImportMeta,
  createWeixinCommandHandler,
};
