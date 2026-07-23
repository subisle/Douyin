"use strict";

/**
 * Shared analytics for Weixin bot commands + agent skills (P0).
 * Keep deterministic; no LLM; no Douyin crawl.
 */

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

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function compactAnchor(anchor) {
  if (!anchor) return null;
  return {
    id: String(anchor.anchorId || anchor.id || ""),
    name: String(anchor.name || anchor.anchorName || ""),
    gender: anchor.gender === "female" ? "female" : "male",
    douyinNo: String(anchor.douyinNo || ""),
    masterName: anchor.masterName || null,
    aliasIds: Array.isArray(anchor.aliasIds) ? anchor.aliasIds.map(String) : [],
  };
}

function accountIdsOf(anchor) {
  return [...new Set(
    [anchor.anchorId, anchor.douyinNo, ...(anchor.aliasIds || [])]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
  )];
}

function findAnchorsByQuery(query, anchors) {
  const q = normalizeName(query);
  const raw = String(query || "").trim();
  if (!q && !raw) return [];
  const exact = [];
  const partial = [];
  for (const anchor of anchors) {
    const ids = [anchor.anchorId, anchor.douyinNo, ...(anchor.aliasIds || [])]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (ids.some((id) => id === raw || normalizeName(id) === q)) {
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

function rowMatchesAnchor(row, anchor) {
  const ids = new Set(accountIdsOf(anchor));
  return ids.has(String(row.anchorId || ""))
    || normalizeName(row.name) === normalizeName(anchor.name);
}

function localYesterdayIso() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function createWeixinAnalytics({ db, renderReportPng = null } = {}) {
  if (!db) throw new Error("analytics 缺少数据库");

  async function latestWaveDate() {
    if (typeof db.getDashboardSummary === "function") {
      const summary = await db.getDashboardSummary();
      const date = String(summary?.latestWaveDate || summary?.latestDataDate || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    }
    return null;
  }

  async function latestDurationDate() {
    if (typeof db.getDashboardSummary === "function") {
      const summary = await db.getDashboardSummary();
      const date = String(summary?.latestDurationDate || summary?.latestDataDate || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    }
    return null;
  }

  async function getAnchors() {
    return typeof db.getAnchors === "function" ? await db.getAnchors() : [];
  }

  async function searchAnchors({ query, limit = 8 } = {}) {
    const anchors = await getAnchors();
    const matches = findAnchorsByQuery(query, anchors).slice(0, Math.max(1, Number(limit) || 8));
    return {
      ok: true,
      query: String(query || ""),
      count: matches.length,
      anchors: matches.map(compactAnchor),
    };
  }

  async function resolveAnchor(query) {
    const anchors = await getAnchors();
    return resolveSingleAnchor(query, anchors);
  }

  async function collectWaveDurationMaps(anchor) {
    const uniqueIds = accountIdsOf(anchor);
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
    return { waveByDate, durationByDate, uniqueIds };
  }

  function formatFullProfileText(anchor, maps) {
    const genderLabel = anchor.gender === "female" ? "女队" : "男团";
    const { waveByDate, durationByDate, uniqueIds } = maps;
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

    const detailLines = [];
    if (waveDates.length) {
      detailLines.push("", "音浪明细：");
      for (const date of waveDates) {
        const item = waveByDate.get(date);
        detailLines.push(`${date}  ${formatWave(item.total)}${item.rank ? `  #${item.rank}` : ""}`);
      }
    }
    if (durationDates.length) {
      detailLines.push("", "时长明细（累计分钟）：");
      for (const date of durationDates) {
        const item = durationByDate.get(date);
        detailLines.push(`${date}  ${formatDuration(item.total)}`);
      }
    }
    return { lines, detailLines, waveDates, durationDates, latestWave, latestDuration, peakWave, waveSum };
  }

  async function getAnchorFullProfile({ query } = {}) {
    const resolved = await resolveAnchor(query);
    if (!resolved.anchor) {
      return {
        ok: false,
        error: resolved.candidates.length ? "主播不唯一" : "未找到主播",
        candidates: resolved.candidates,
      };
    }
    const maps = await collectWaveDurationMaps(resolved.anchor);
    const formatted = formatFullProfileText(resolved.anchor, maps);
    const textParts = [];
    const full = [...formatted.lines, ...formatted.detailLines].join("\n");
    if (full.length <= 3500) {
      textParts.push(full);
    } else {
      textParts.push(formatted.lines.join("\n"));
      let buf = "";
      for (const line of formatted.detailLines) {
        if ((buf + "\n" + line).length > 3200) {
          if (buf) textParts.push(buf);
          buf = line;
        } else {
          buf = buf ? `${buf}\n${line}` : line;
        }
      }
      if (buf.trim()) textParts.push(buf);
    }
    return {
      ok: true,
      found: true,
      anchor: compactAnchor(resolved.anchor),
      waveDays: formatted.waveDates.length,
      durationPoints: formatted.durationDates.length,
      latestWave: formatted.latestWave,
      latestDuration: formatted.latestDuration,
      peakWave: formatted.peakWave,
      waveSum: formatted.waveSum,
      textParts,
      summaryText: formatted.lines.join("\n"),
    };
  }

  async function getAnchorWaveProfile({ query, date } = {}) {
    const resolved = await resolveAnchor(query);
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
    const row = (report?.rows || []).find((item) => rowMatchesAnchor(item, resolved.anchor));
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

  async function getAnchorWaveDays({ query, date } = {}) {
    const resolved = await resolveAnchor(query);
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
    const row = (report?.rows || []).find((item) => rowMatchesAnchor(item, resolved.anchor));
    if (!row) {
      return {
        ok: true,
        found: false,
        asOfDate,
        anchor: compactAnchor(resolved.anchor),
        message: `${resolved.anchor.name} 在 ${asOfDate} 没有可用音浪数据`,
      };
    }
    const dayOfMonth = Number(asOfDate.slice(8, 10)) || 0;
    const liveDays = Math.max(0, dayOfMonth - (Number(row.notLiveDays) || 0));
    return {
      ok: true,
      found: true,
      asOfDate,
      anchor: compactAnchor(resolved.anchor),
      liveDays,
      notLiveDays: Number(row.notLiveDays) || 0,
      totalWave: Number(row.totalWave) || 0,
      totalWaveText: formatWave(row.totalWave),
      month: Number(asOfDate.slice(5, 7)),
      text: `${resolved.anchor.name} 截至 ${asOfDate} 本月有音浪 ${liveDays} 天，累计音浪 ${formatWave(row.totalWave)}，${Number(asOfDate.slice(5, 7))}月未播 ${row.notLiveDays || 0} 天。`,
    };
  }

  async function getAnchorDuration({ query, date } = {}) {
    const resolved = await resolveAnchor(query);
    if (!resolved.anchor) {
      return {
        ok: false,
        error: resolved.candidates.length ? "主播不唯一" : "未找到主播",
        candidates: resolved.candidates,
      };
    }
    const asOfDate = date || (await latestDurationDate()) || (await latestWaveDate()) || localYesterdayIso();
    const rows = typeof db.exportDurationSnapshots === "function"
      ? await db.exportDurationSnapshots(asOfDate)
      : [];
    const ids = new Set(accountIdsOf(resolved.anchor));
    const matches = rows.filter((row) => ids.has(String(row.抖音号 || row.anchorId || "")));
    if (!matches.length) {
      return {
        ok: true,
        found: false,
        asOfDate,
        anchor: compactAnchor(resolved.anchor),
        message: `${resolved.anchor.name} 在 ${asOfDate} 之前没有时长快照`,
      };
    }
    const best = matches.reduce((current, row) => (
      Number(row.时长分钟 || row.totalMinutes || 0) > Number(current.时长分钟 || current.totalMinutes || 0)
        ? row
        : current
    ));
    const minutes = Number(best.时长分钟 || best.totalMinutes || 0);
    // 文案中的「截至」日期与查询截断日一致（与指令模式历史行为对齐）
    return {
      ok: true,
      found: true,
      asOfDate,
      snapshotDate: String(best.日期 || best.date || asOfDate || ""),
      anchor: compactAnchor(resolved.anchor),
      minutes,
      durationText: formatDuration(minutes),
      text: `${resolved.anchor.name} 截至 ${asOfDate} 的累计直播时长：${formatDuration(minutes)}（${compactNumber(minutes)} 分钟）。`,
    };
  }

  async function compareAnchorWave({ queries = [], date } = {}) {
    const list = (Array.isArray(queries) ? queries : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 5);
    if (list.length < 2) return { ok: false, error: "请至少提供 2 位主播" };
    const asOfDate = date || (await latestWaveDate());
    if (!asOfDate) return { ok: false, error: "没有可用音浪日期" };
    const results = [];
    for (const query of list) {
      results.push(await getAnchorWaveProfile({ query, date: asOfDate }));
    }
    return { ok: true, asOfDate, results };
  }

  async function analyzeAnchorWave({ query, range = "30d" } = {}) {
    const profile = await getAnchorFullProfile({ query });
    if (!profile.ok) return profile;
    const maps = await collectWaveDurationMaps(
      (await resolveAnchor(query)).anchor
    );
    const points = [...maps.waveByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!points.length) {
      return {
        ok: true,
        found: false,
        anchor: profile.anchor,
        message: `${profile.anchor.name} 暂无音浪序列`,
      };
    }
    let window = points;
    if (range === "7d") window = points.slice(-7);
    else if (range === "14d") window = points.slice(-14);
    const totals = window.map((p) => p.total);
    const sum = totals.reduce((a, b) => a + b, 0);
    const avg = sum / totals.length;
    const peak = window.reduce((best, p) => (p.total > best.total ? p : best));
    const latest = window[window.length - 1];
    const prev = window.length > 1 ? window[window.length - 2] : null;
    const delta = prev ? latest.total - prev.total : null;
    return {
      ok: true,
      found: true,
      asOfDate: latest.date,
      anchor: profile.anchor,
      range,
      points: window.slice(-14),
      latest,
      peak,
      avg,
      avgText: formatWave(avg),
      sum,
      sumText: formatWave(sum),
      delta,
      deltaText: delta == null ? null : formatWave(delta),
      text: [
        `${profile.anchor.name} 音浪分析（${range}，截至 ${latest.date}）`,
        `最新：${formatWave(latest.total)}${latest.rank ? ` #${latest.rank}` : ""}`,
        `峰值：${peak.date} ${formatWave(peak.total)}`,
        `均值：${formatWave(avg)} · 合计：${formatWave(sum)}`,
        delta == null ? null : `环比前日：${delta >= 0 ? "+" : ""}${formatWave(delta)}`,
      ].filter(Boolean).join("\n"),
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
    if (typeof renderReportPng !== "function") {
      return { ok: false, error: "缺少报告渲染器" };
    }
    const asOfDate = date || (await latestWaveDate());
    if (!asOfDate) return { ok: false, error: "没有可用音浪日期" };

    const teams = gender === "both" ? ["male", "female"] : [gender === "female" ? "female" : "male"];
    const artifacts = [];
    const errors = [];
    for (const team of teams) {
      const report = await db.getDailyWaveReport(asOfDate, team);
      const label = team === "female" ? "女队" : "男团";
      if (!report?.rows?.length) {
        errors.push(`${asOfDate} 没有${label}数据`);
        continue;
      }
      const buffer = await renderReportPng(report, { title: title || undefined });
      artifacts.push({
        kind: "image",
        buffer,
        fileName: `${asOfDate}_${label}_每日报告.png`,
        gender: team,
        meta: { total: report.rows.length, notLiveCount: report.summary?.notLiveCount || 0 },
      });
    }
    if (!artifacts.length) {
      return { ok: false, error: errors.join("；") || "没有可导出的报告" };
    }
    return {
      ok: true,
      asOfDate,
      gender: gender === "both" ? "both" : teams[0],
      artifacts,
      // 兼容旧单图字段
      artifact: artifacts[0],
      errors,
    };
  }

  async function exportWaveFile({ date } = {}) {
    const asOfDate = date || (await latestWaveDate());
    if (!asOfDate) return { ok: false, error: "没有可用音浪日期" };
    const rows = await db.exportWaveSnapshots(asOfDate);
    if (!rows.length) return { ok: false, error: `${asOfDate} 没有音浪快照` };
    const Papa = require("papaparse");
    const csv = Papa.unparse(rows);
    const buffer = Buffer.from("\uFEFF" + String(csv || ""), "utf8");
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

  return {
    formatWave,
    formatDuration,
    compactNumber,
    compactAnchor,
    findAnchorsByQuery,
    resolveSingleAnchor,
    rowMatchesAnchor,
    latestWaveDate,
    searchAnchors,
    resolveAnchor,
    getAnchorFullProfile,
    getAnchorWaveProfile,
    getAnchorWaveDays,
    getAnchorDuration,
    compareAnchorWave,
    analyzeAnchorWave,
    getDailyReportData,
    exportDailyReportImage,
    exportWaveFile,
    localYesterdayIso,
  };
}

module.exports = {
  createWeixinAnalytics,
  formatWave,
  formatDuration,
  compactNumber,
  compactAnchor,
  findAnchorsByQuery,
  resolveSingleAnchor,
  rowMatchesAnchor,
  localYesterdayIso,
};
