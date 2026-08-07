"use strict";

/**
 * 每日报告自动推送：文案（男女当日音浪前三）+ 报告图。
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
  const lines = [`【${label}】今日前三`];
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
  const lastPushRaw = src.lastPush && typeof src.lastPush === "object"
    ? src.lastPush
    : (base.lastPush && typeof base.lastPush === "object" ? base.lastPush : null);
  return {
    enabled: Boolean(
      Object.prototype.hasOwnProperty.call(src, "enabled")
        ? src.enabled
        : base.enabled
    ),
    adminUserIds: unique(
      Object.prototype.hasOwnProperty.call(src, "adminUserIds")
        ? src.adminUserIds
        : base.adminUserIds
    ),
    recipientUserIds: unique(
      Object.prototype.hasOwnProperty.call(src, "recipientUserIds")
        ? src.recipientUserIds
        : base.recipientUserIds
    ),
    recipientGroupIds: unique(
      Object.prototype.hasOwnProperty.call(src, "recipientGroupIds")
        ? src.recipientGroupIds
        : base.recipientGroupIds
    ),
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
    adminUserIds: [],
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
    `管理员：${cfg.adminUserIds.length ? cfg.adminUserIds.join("、") : "未设置（请在桌面端配置）"}`,
    `推送用户：${cfg.recipientUserIds.length ? `${cfg.recipientUserIds.length} 人` : "名单用户（有会话）"}`,
    `推送群聊：${cfg.recipientGroupIds.length ? `${cfg.recipientGroupIds.length} 个` : "名单群（有会话）"}`,
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
 * 规则：
 * - 若配置了 recipientUserIds / recipientGroupIds，则仅推这些
 * - 否则推当前账号 allowlist 内、且已有会话上下文的联系人
 * - open 模式下未配名单时：推所有有上下文的联系人
 */
function resolveDailyPushTargets({
  accountId,
  contacts = [],
  contexts = new Map(),
  accessPolicy,
  pushSettings,
  accountScopedKey,
}) {
  const cfg = normalizeDailyReportPushSettings(pushSettings);
  const policy = accessPolicy || { accessMode: "allowlist", allowUserIds: [], allowGroupIds: [] };
  const hasExplicitRecipients = cfg.recipientUserIds.length > 0 || cfg.recipientGroupIds.length > 0;
  const explicitUsers = new Set(cfg.recipientUserIds);
  const explicitGroups = new Set(cfg.recipientGroupIds);
  const allowUsers = new Set(policy.allowUserIds || []);
  const allowGroups = new Set(policy.allowGroupIds || []);
  const open = policy.accessMode === "open";

  const targets = [];
  const seen = new Set();

  for (const contact of Array.isArray(contacts) ? contacts : []) {
    if (accountId && contact.accountId && contact.accountId !== accountId) continue;
    const id = String(contact.id || "").trim();
    if (!id) continue;
    const kind = contact.kind === "group" ? "group" : "user";
    const conversationId = String(contact.conversationId || (kind === "group" ? id : id)).trim() || id;

    if (hasExplicitRecipients) {
      if (kind === "group" ? !explicitGroups.has(id) : !explicitUsers.has(id)) continue;
    } else if (!open) {
      if (kind === "group" ? !allowGroups.has(id) : !allowUsers.has(id)) continue;
    }

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
