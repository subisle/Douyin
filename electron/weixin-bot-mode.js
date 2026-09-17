"use strict";

/**
 * 会话工具（纯指令模式）。
 * 产品已移除 AI：不再有 instruction/agent 模式切换，也没有 FastRoute。
 * 这里只保留两件事：
 * - sessionKeyFromContext：按账号/群/用户生成会话键（去重、串行、导入日期预告都用它）
 * - createSessionQueues：同会话内串行执行，避免并发导入互相踩
 */

const SYSTEM_HELP_RE = /^(?:\/?help|帮助|菜单|命令|指令)$/i;

const INSTRUCTION_HELP = [
  "【指令菜单】",
  "· 报告：每日报告、男团报告、女团报告、未开播天数报告",
  "· 数据：艺名 + 日期（如「艺名 9.11音浪」「艺名 9月时长」）",
  "· 导出：音浪文件（导出 CSV）",
  "· 绑定：绑定 抖音号 / 我的绑定 / 解绑（仅主播列表内抖音号，一人一号）",
  "· 管理员：开启日报推送 / 关闭日报推送 / 日报推送状态",
  "· 导入：先发日期（如「9.11」或「9.11数据」），再连发音浪、时长两个 CSV；",
  "  同一日期口令 10 分钟内可连传 2 个文件，两个都落到该日期；",
  "· 不指定日期直接发 CSV → 默认导入昨天",
].join("\n");

function sessionKeyFromContext(context = {}) {
  const accountId = String(context.accountId || "").trim() || "unknown";
  const groupId = String(context.groupId || "").trim();
  const userId = String(context.fromUserId || context.userId || "").trim();
  const conversationId = String(context.conversationId || "").trim();
  if (groupId) return `a:${accountId}|g:${groupId}|u:${userId || "unknown"}`;
  if (userId) return `a:${accountId}|u:${userId}`;
  return `a:${accountId}|c:${conversationId || "unknown"}`;
}

function createSessionQueues() {
  /** @type {Map<string, Promise<unknown>>} */
  const tails = new Map();

  async function runSerial(key, fn) {
    const k = String(key || "default");
    const prev = tails.get(k) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const next = prev.catch(() => undefined).then(() => gate);
    tails.set(k, next);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(k) === next) tails.delete(k);
    }
  }

  function reset(predicate = null) {
    for (const key of tails.keys()) {
      if (!predicate || predicate(key)) tails.delete(key);
    }
  }

  return { runSerial, reset };
}

module.exports = {
  SYSTEM_HELP_RE,
  INSTRUCTION_HELP,
  sessionKeyFromContext,
  createSessionQueues,
};
