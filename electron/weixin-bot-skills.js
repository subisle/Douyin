"use strict";

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

function compactAnchor(anchor) {
  if (!anchor) return null;
  return {
    id: String(anchor.anchorId || anchor.id || ""),
    name: String(anchor.name || anchor.anchorName || ""),
    gender: anchor.gender === "female" ? "female" : "male",
    douyinNo: String(anchor.douyinNo || ""),
  };
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function findAnchorsByQuery(query, anchors) {
  const q = normalizeName(query);
  if (!q) return [];
  const exact = [];
  const partial = [];
  for (const anchor of anchors) {
    const ids = [anchor.anchorId, anchor.douyinNo, ...(anchor.aliasIds || [])]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (ids.some((id) => id === String(query).trim() || normalizeName(id) === q)) {
      exact.push(anchor);
      continue;
    }
    const names = [anchor.name, anchor.anchorName].map(normalizeName).filter(Boolean);
    if (names.some((name) => name === q)) {
      exact.push(anchor);
      continue;
    }
    if (names.some((name) => name.includes(q) || q.includes(name))) partial.push(anchor);
  }
  return exact.length ? exact : partial;
}

function resolveSingleAnchor(query, anchors) {
  const matches = findAnchorsByQuery(query, anchors);
  if (matches.length === 1) return { anchor: matches[0], candidates: [] };
  return {
    anchor: null,
    candidates: matches.slice(0, 8).map(compactAnchor),
  };
}

function createWeixinBotSkills({ db, renderReportPng }) {
  if (!db) throw new Error("技能模块缺少数据库");
  if (typeof renderReportPng !== "function") throw new Error("技能模块缺少报告渲染器");

  async function latestWaveDate() {
    if (typeof db.getDashboardSummary === "function") {
      const summary = await db.getDashboardSummary();
      const date = String(summary?.latestWaveDate || summary?.latestDataDate || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    }
    if (typeof db.exportWaveSnapshots === "function") {
      const rows = await db.exportWaveSnapshots();
      const dates = rows.map((row) => String(row.日期 || row.date || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
      if (dates.length) return dates.sort().at(-1);
    }
    return null;
  }

  async function getAnchorWaveProfile({ query, date } = {}) {
    const anchors = await db.getAnchors();
    const resolved = resolveSingleAnchor(query, anchors);
    if (!resolved.anchor) {
      return {
        ok: false,
        error: resolved.candidates.length ? "主播不唯一" : "未找到主播",
        candidates: resolved.candidates,
      };
    }
    const asOfDate = date || (await latestWaveDate());
    if (!asOfDate) return { ok: false, error: "没有可用音浪日期" };
    const gender = resolved.anchor.gender === "female" ? "female" : "male";
    const report = await db.getDailyWaveReport(asOfDate, gender);
    const row = (report?.rows || []).find((item) => {
      const ids = new Set([resolved.anchor.anchorId, resolved.anchor.douyinNo, ...(resolved.anchor.aliasIds || [])].map(String));
      return ids.has(String(item.anchorId || "")) || normalizeName(item.name) === normalizeName(resolved.anchor.name);
    });
    if (!row) {
      return {
        ok: true,
        asOfDate,
        anchor: compactAnchor(resolved.anchor),
        found: false,
        message: `${resolved.anchor.name} 在 ${asOfDate} 没有音浪数据`,
      };
    }
    const total = Array.isArray(report.rows) ? report.rows.length : 0;
    const rank = Number(row.rank) || (report.rows.findIndex((item) => item === row) + 1);
    return {
      ok: true,
      asOfDate,
      found: true,
      anchor: compactAnchor(resolved.anchor),
      dailyWave: Number(row.dailyWave) || 0,
      dailyWaveText: formatWave(row.dailyWave),
      totalWave: Number(row.totalWave) || 0,
      totalWaveText: formatWave(row.totalWave),
      notLiveDays: Number(row.notLiveDays) || 0,
      isLive: Boolean(row.isLive),
      tier: row.tier || "",
      rank,
      teamSize: total,
    };
  }

  async function compareAnchorWave({ queries = [], date } = {}) {
    const list = (Array.isArray(queries) ? queries : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5);
    if (list.length < 2) return { ok: false, error: "请至少提供 2 位主播" };
    const asOfDate = date || (await latestWaveDate());
    if (!asOfDate) return { ok: false, error: "没有可用音浪日期" };
    const results = [];
    for (const query of list) {
      const profile = await getAnchorWaveProfile({ query, date: asOfDate });
      results.push(profile);
    }
    return { ok: true, asOfDate, results };
  }

  async function getAnchorDuration({ query } = {}) {
    const anchors = await db.getAnchors();
    const resolved = resolveSingleAnchor(query, anchors);
    if (!resolved.anchor) {
      return {
        ok: false,
        error: resolved.candidates.length ? "主播不唯一" : "未找到主播",
        candidates: resolved.candidates,
      };
    }
    const date = await latestWaveDate();
    const rows = typeof db.exportDurationSnapshots === "function"
      ? await db.exportDurationSnapshots()
      : [];
    const ids = new Set([resolved.anchor.anchorId, resolved.anchor.douyinNo, ...(resolved.anchor.aliasIds || [])].map(String));
    const matches = rows.filter((row) => ids.has(String(row.抖音号 || row.anchorId || "")));
    if (!matches.length) {
      return {
        ok: true,
        found: false,
        asOfDate: date,
        anchor: compactAnchor(resolved.anchor),
        message: `${resolved.anchor.name} 没有时长快照`,
      };
    }
    const best = matches.reduce((current, row) => (
      Number(row.时长分钟 || row.totalMinutes || 0) > Number(current.时长分钟 || current.totalMinutes || 0) ? row : current
    ));
    const minutes = Number(best.时长分钟 || best.totalMinutes || 0);
    return {
      ok: true,
      found: true,
      asOfDate: String(best.日期 || best.date || date || ""),
      anchor: compactAnchor(resolved.anchor),
      minutes,
      durationText: formatDuration(minutes),
    };
  }

  async function getDailyReportData({ date, gender = "male" } = {}) {
    const asOfDate = date || (await latestWaveDate());
    if (!asOfDate) return { ok: false, error: "没有可用音浪日期" };
    const team = gender === "female" ? "female" : gender === "both" ? "both" : "male";
    if (team === "both") {
      const male = await db.getDailyWaveReport(asOfDate, "male");
      const female = await db.getDailyWaveReport(asOfDate, "female");
      return {
        ok: true,
        asOfDate,
        male: { total: male?.rows?.length || 0, notLiveCount: male?.summary?.notLiveCount || 0 },
        female: { total: female?.rows?.length || 0, notLiveCount: female?.summary?.notLiveCount || 0 },
      };
    }
    const report = await db.getDailyWaveReport(asOfDate, team);
    return {
      ok: true,
      asOfDate,
      gender: team,
      total: report?.rows?.length || 0,
      notLiveCount: report?.summary?.notLiveCount || 0,
      notLiveDays: report?.summary?.notLiveDays || 0,
      top: (report?.rows || []).slice(0, 5).map((row, index) => ({
        rank: index + 1,
        name: row.name,
        dailyWave: formatWave(row.dailyWave),
        totalWave: formatWave(row.totalWave),
        isLive: Boolean(row.isLive),
      })),
    };
  }

  async function exportDailyReportImage({ date, gender = "male", title } = {}) {
    const asOfDate = date || (await latestWaveDate());
    if (!asOfDate) return { ok: false, error: "没有可用音浪日期" };
    const team = gender === "female" ? "female" : "male";
    const report = await db.getDailyWaveReport(asOfDate, team);
    if (!report?.rows?.length) return { ok: false, error: `${asOfDate} 没有${team === "female" ? "女队" : "男团"}数据` };
    const label = team === "female" ? "女队" : "男团";
    const buffer = await renderReportPng(report, { title: title || `${label}每日报告` });
    return {
      ok: true,
      asOfDate,
      gender: team,
      artifact: {
        kind: "image",
        buffer,
        fileName: `${asOfDate}_${label}_每日报告.png`,
      },
      meta: { total: report.rows.length, notLiveCount: report.summary?.notLiveCount || 0 },
    };
  }

  async function exportWaveFile({ date } = {}) {
    const asOfDate = date || (await latestWaveDate());
    if (!asOfDate) return { ok: false, error: "没有可用音浪日期" };
    const rows = await db.exportWaveSnapshots(asOfDate);
    if (!rows.length) return { ok: false, error: `${asOfDate} 没有音浪快照` };
    const Papa = require("papaparse");
    const csv = Papa.unparse(rows);
    const buffer = Buffer.from(`\uFEFF${csv}`, "utf8");
    return {
      ok: true,
      asOfDate,
      artifact: {
        kind: "file",
        buffer,
        fileName: `${asOfDate}_音浪数据.csv`,
      },
      meta: { rowCount: rows.length },
    };
  }

  const tools = [
    {
      type: "function",
      function: {
        name: "get_anchor_wave_profile",
        description: "查询一位主播的音浪表现（截止日期、日音浪、累计、排名等）",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "主播姓名、抖音号或主播 ID" },
            date: { type: "string", description: "YYYY-MM-DD，可选" },
          },
          required: ["query"],
        },
      },
      execute: getAnchorWaveProfile,
    },
    {
      type: "function",
      function: {
        name: "compare_anchor_wave",
        description: "比较 2-5 位主播的音浪数据",
        parameters: {
          type: "object",
          properties: {
            queries: { type: "array", items: { type: "string" } },
            date: { type: "string" },
          },
          required: ["queries"],
        },
      },
      execute: compareAnchorWave,
    },
    {
      type: "function",
      function: {
        name: "get_anchor_duration",
        description: "查询主播累计直播时长",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
      execute: getAnchorDuration,
    },
    {
      type: "function",
      function: {
        name: "get_daily_report_data",
        description: "获取某日男团/女队日报摘要",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string" },
            gender: { type: "string", enum: ["male", "female", "both"] },
          },
        },
      },
      execute: getDailyReportData,
    },
    {
      type: "function",
      function: {
        name: "export_daily_report_image",
        description: "生成并发送男团或女队每日报告图片",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string" },
            gender: { type: "string", enum: ["male", "female"] },
            title: { type: "string" },
          },
        },
      },
      execute: exportDailyReportImage,
    },
    {
      type: "function",
      function: {
        name: "export_wave_file",
        description: "导出并发送某日音浪 CSV 文件",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string" },
          },
        },
      },
      execute: exportWaveFile,
    },
  ];

  return {
    tools,
    definitions: tools.map(({ type, function: fn }) => ({ type, function: fn })),
    async execute(name, args) {
      const tool = tools.find((item) => item.function.name === name);
      if (!tool) return { ok: false, error: `未知工具: ${name}` };
      return tool.execute(args || {});
    },
  };
}

module.exports = {
  createWeixinBotSkills,
  formatWave,
  formatDuration,
  findAnchorsByQuery,
};
