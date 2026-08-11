"use strict";

/**
 * 每日报告自动推送：文案（每日之星前三）+ 每日之星图 + 报告图。
 * 纯函数与编排辅助，便于单测；真正发信由 WeixinBotService 完成。
 */

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

function pickTopByDailyWave(rows, limit = 3) {
  return [...(Array.isArray(rows) ? rows : [])]
    .map((row, index) => ({
      name: String(row?.name || row?.anchorName || "未知").trim() || "未知",
      dailyWave: Number(row?.dailyWave) || 0,
      rank: Number(row?.rank) || index + 1,
    }))
    .sort((a, b) => b.dailyWave - a.dailyWave || a.rank - b.rank || a.name.localeCompare(b.name, "zh"))
    .slice(0, Math.max(0, limit));
}

const MEDAL = ["1.", "2.", "3."];

/**
 * @param {string} label
 * @param {Array<{name:string,dailyWave?:number}>} rows
 * @param {{ namesOnly?: boolean }} [options]
 */
function formatTopBlock(label, rows, options = {}) {
  const namesOnly = options.namesOnly !== false; // 默认只发人名
  const lines = [`【${label}】每日之星（前三名）`];
  if (!rows.length) {
    lines.push("暂无数据");
    return lines.join("\n");
  }
  rows.forEach((row, index) => {
    const medal = MEDAL[index] || `${index + 1}.`;
    if (namesOnly) {
      lines.push(`${medal} ${row.name}`);
    } else {
      lines.push(`${medal} ${row.name} · ${formatWave(row.dailyWave)}`);
    }
  });
  return lines.join("\n");
}

/**
 * 单团今日前三文案。
 * @param {string} date YYYY-MM-DD
 * @param {"male"|"female"} gender
 * @param {{ rows?: any[] } | null} report
 * @param {{ withDate?: boolean, namesOnly?: boolean }} [options]
 */
function buildGenderTop3Text(date, gender, report, options = {}) {
  const day = String(date || "").trim() || "当日";
  const label = gender === "female" ? "女队" : "男团";
  const top = pickTopByDailyWave(report?.rows, 3);
  const block = formatTopBlock(label, top, { namesOnly: options.namesOnly !== false });
  if (options.withDate) {
    return [`${day} 每日报告`, "", block].join("\n");
  }
  return block;
}

/**
 * 兼容：日期 + 男女两块（自动推送/指令更推荐按团拆开发送）。
 * @param {string} date YYYY-MM-DD
 * @param {{ rows?: any[] } | null} maleReport
 * @param {{ rows?: any[] } | null} femaleReport
 * @param {{ namesOnly?: boolean }} [options]
 */
function buildDailyTop3Text(date, maleReport, femaleReport, options = {}) {
  const day = String(date || "").trim() || "当日";
  const namesOnly = options.namesOnly !== false;
  const maleTop = pickTopByDailyWave(maleReport?.rows, 3);
  const femaleTop = pickTopByDailyWave(femaleReport?.rows, 3);
  return [
    `${day} 每日报告`,
    "",
    formatTopBlock("男团", maleTop, { namesOnly }),
    "",
    formatTopBlock("女队", femaleTop, { namesOnly }),
  ].join("\n");
}

function normalizeDailyReportPushSettings(input = {}, fallback = {}) {
  const src = input && typeof input === "object" ? input : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const unique = (list) => {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const id = String(raw || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };
  // 备注表：键=userId，值=备注；src 优先，其次 base，只保留非空键与有效备注
  const pickRemarks = (holder) => {
    const out = {};
    if (holder && typeof holder === "object") {
      for (const [id, remark] of Object.entries(holder)) {
        const key = String(id || "").trim();
        const value = String(remark ?? "").trim();
        if (!key || !value) continue;
        out[key] = value.slice(0, 100);
      }
    }
    return out;
  };
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const hasReminder =
    hasOwn(src, "reminderEnabled") || hasOwn(base, "reminderEnabled");
  const lastPushRaw = src.lastPush && typeof src.lastPush === "object"
    ? src.lastPush
    : (base.lastPush && typeof base.lastPush === "object" ? base.lastPush : null);
  return {
    enabled: Boolean(
      hasOwn(src, "enabled") ? src.enabled : base.enabled
    ),
    // 午夜提醒默认开启；旧配置无此字段时也为 true
    reminderEnabled: hasReminder
      ? Boolean(
          hasOwn(src, "reminderEnabled") ? src.reminderEnabled : base.reminderEnabled
        )
      : true,
    lastReminderDate: String(
      hasOwn(src, "lastReminderDate")
        ? src.lastReminderDate
        : base.lastReminderDate || ""
    ).trim() || null,
    adminUserIds: unique(
      hasOwn(src, "adminUserIds") ? src.adminUserIds : base.adminUserIds
    ),
    adminRemarks: {
      ...pickRemarks(base.adminRemarks),
      ...pickRemarks(src.adminRemarks),
    },
    // 产品：始终推全部有会话联系人；旧 recipient* 名单不再生效，normalize 时清空
    recipientUserIds: [],
    recipientGroupIds: [],
    lastPush: lastPushRaw
      ? {
          date: String(lastPushRaw.date || "") || null,
          at: String(lastPushRaw.at || "") || null,
          ok: Number(lastPushRaw.ok) || 0,
          fail: Number(lastPushRaw.fail) || 0,
          skipped: String(lastPushRaw.skipped || "") || null,
        }
      : null,
  };
}

const DEFAULT_DAILY_REPORT_PUSH = Object.freeze(
  normalizeDailyReportPushSettings({
    enabled: false,
    reminderEnabled: true,
    lastReminderDate: null,
    adminUserIds: [],
    adminRemarks: {},
    recipientUserIds: [],
    recipientGroupIds: [],
    lastPush: null,
  })
);

/**
 * 解析管理员日报推送指令。
 * @returns {{ type: 'enable'|'disable'|'status' } | null}
 */
function matchDailyPushCommand(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/^(?:开启|打开|启用|启动)(?:每日)?(?:日报|报告)?推送$/.test(raw)) {
    return { type: "enable" };
  }
  if (/^(?:关闭|停止|停用|取消)(?:每日)?(?:日报|报告)?推送$/.test(raw)) {
    return { type: "disable" };
  }
  if (/^(?:每日)?(?:日报|报告)?推送状态$/.test(raw) || raw === "推送状态") {
    return { type: "status" };
  }
  return null;
}

function formatDailyPushStatusText(push) {
  const cfg = normalizeDailyReportPushSettings(push);
  const lines = [
    `日报自动推送：${cfg.enabled ? "已开启" : "已关闭"}`,
    `午夜提醒：${cfg.reminderEnabled ? "已开启" : "已关闭"}`,
    "推送对象：全部有会话用户/群",
  ];
  if (cfg.lastPush?.at) {
    lines.push(
      `上次推送：${cfg.lastPush.date || "—"} · 成功 ${cfg.lastPush.ok || 0} / 失败 ${cfg.lastPush.fail || 0}`
        + (cfg.lastPush.skipped ? `（${cfg.lastPush.skipped}）` : "")
        + ` · ${cfg.lastPush.at}`
    );
  }
  return lines.join("\n");
}

/**
 * 解析应推送的会话目标。
 * 产品：始终推当前账号下全部有会话上下文的用户/群（忽略旧 recipient* 配置）。
 */
function resolveDailyPushTargets({
  accountId,
  contacts = [],
  contexts = new Map(),
  accessPolicy: _accessPolicy,
  pushSettings: _pushSettings,
  accountScopedKey,
}) {
  const targets = [];
  const seen = new Set();

  for (const contact of Array.isArray(contacts) ? contacts : []) {
    if (accountId && contact.accountId && contact.accountId !== accountId) continue;
    const id = String(contact.id || "").trim();
    if (!id) continue;
    const kind = contact.kind === "group" ? "group" : "user";
    const conversationId = String(contact.conversationId || id).trim() || id;

    const ctxKey = typeof accountScopedKey === "function"
      ? accountScopedKey(contact.accountId || accountId, conversationId)
      : `${contact.accountId || accountId}::${conversationId}`;
    const context = contexts instanceof Map
      ? contexts.get(ctxKey)
      : (contexts && contexts[ctxKey]);
    const contextToken = String(context?.contextToken || contact.contextToken || "").trim();
    if (!contextToken) continue;

    const dedupe = `${contact.accountId || accountId}|${kind}|${conversationId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    targets.push({
      accountId: contact.accountId || accountId,
      id,
      kind,
      conversationId,
      groupId: kind === "group" ? (contact.groupId || id) : null,
      context: {
        accountId: contact.accountId || accountId,
        contextToken,
        toUserId: String(context?.toUserId || (kind === "user" ? id : contact.toUserId || "")).trim(),
        groupId: kind === "group" ? (contact.groupId || id) : null,
      },
    });
  }

  return targets;
}

module.exports = {
  formatWave,
  pickTopByDailyWave,
  formatTopBlock,
  buildGenderTop3Text,
  buildDailyTop3Text,
  normalizeDailyReportPushSettings,
  DEFAULT_DAILY_REPORT_PUSH,
  matchDailyPushCommand,
  formatDailyPushStatusText,
  resolveDailyPushTargets,
};
