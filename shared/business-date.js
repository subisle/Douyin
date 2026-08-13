"use strict";

/**
 * 业务日与日报默认日期。
 * 日报看音浪日；时长快照落在月末（如 7 月 31 日），不能拿来当日报默认日。
 */

function pad2(value) {
  return String(value).padStart(2, "0");
}

function businessDateStr(now = new Date()) {
  const d = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() - 1);
    return `${fallback.getFullYear()}-${pad2(fallback.getMonth() + 1)}-${pad2(fallback.getDate())}`;
  }
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function resolveDailyReportDefaultDate(summary = {}, now = new Date()) {
  return normalizeIsoDate(summary?.latestWaveDate) || businessDateStr(now);
}

function resolveMonthlyReportMonth(summary = {}, now = new Date()) {
  const source =
    normalizeIsoDate(summary?.latestDurationDate)
    || normalizeIsoDate(summary?.latestWaveDate)
    || businessDateStr(now);
  return source.slice(0, 7);
}

module.exports = {
  businessDateStr,
  normalizeIsoDate,
  resolveDailyReportDefaultDate,
  resolveMonthlyReportMonth,
};
