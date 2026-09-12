"use strict";

/**
 * Mode + FastRoute for Weixin bot (P0).
 * mode: instruction | agent
 */

const SYSTEM_ENABLE_RE =
  /^(?:智能模式|AI模式|ai模式|人工客服|智能客服|客服|开启客服|打开客服|开启智能|打开智能)$/i;
const SYSTEM_DISABLE_RE =
  /^(?:纯指令|指令模式|仅指令|退出客服|关闭客服|结束客服|取消客服|关闭智能|退出智能)$/i;
const SYSTEM_CLEAR_MEMORY_RE = /^(?:清空对话|清除记忆|清除对话)$/i;
const SYSTEM_CLEAR_HABITS_RE = /^(?:清除习惯|清除我的习惯|清空习惯)$/i;
const SYSTEM_HELP_RE = /^(?:\/?help|帮助|菜单|命令|指令)$/i;

const INSTRUCTION_HELP = [
  "【纯指令模式】",
  "· 固定指令：每日报告、未开播报告、艺名音浪、音浪文件、帮助等",
  "· 音浪/时长：艺名 + 日期（9月1日 / 9.1 / 9月 / 2026年），如「艺名 9月音浪」",
  "· 绑定：绑定 抖音号 / 我的绑定 / 解绑（仅主播列表内抖音号，一人一号）",
  "· 管理员：开启日报推送 / 关闭日报推送 / 日报推送状态",
  "· 发 CSV → 默认昨天；先发「9.1」即导入 9 月 1 日（10 分钟内有效）",
  "· 切换：默认纯指令；发「智能模式」或「AI模式」→ 改用 AI 模型",
].join("\n");

const AGENT_HELP = [
  "【AI 模型模式】",
  "· 业务文本由 AI + 技能处理（查音浪/出图/导出/绑定等）",
  "· 绑定：发送「绑定 + 本人抖音号」；仅主播列表内有效，一个抖音号对应一个用户",
  "· 发 CSV → 默认昨天；先说「24号数据」可指定日（导入仍确定性）",
  "· 「清空对话」→ 清本会话对话记忆；「清除习惯」→ 清习惯画像",
  "· 切换：发「纯指令」→ 只走固定指令，不调模型（不会自动切换）",
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

function createModeStore({
  ttlMs = 2 * 60 * 60_000,
  maxSessions = 50,
  /** @type {'instruction'|'agent'} */
  defaultMode = "instruction",
} = {}) {
  /** @type {Map<string, { mode: 'instruction'|'agent', updatedAt: number }>} */
  const store = new Map();
  const fallback = defaultMode === "instruction" ? "instruction" : "agent";

  function prune() {
    const now = Date.now();
    for (const [key, item] of store.entries()) {
      if (now - (item.updatedAt || 0) > ttlMs) store.delete(key);
    }
    if (store.size <= maxSessions) return;
    const ordered = [...store.entries()].sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0));
    while (store.size > maxSessions && ordered.length) {
      const [key] = ordered.shift();
      store.delete(key);
    }
  }

  return {
    defaultMode: fallback,
    getMode(context) {
      prune();
      const key = sessionKeyFromContext(context);
      const item = store.get(key);
      if (!item) return fallback;
      if (Date.now() - (item.updatedAt || 0) > ttlMs) {
        store.delete(key);
        return fallback;
      }
      item.updatedAt = Date.now();
      return item.mode === "agent" ? "agent" : "instruction";
    },
    setMode(context, mode) {
      prune();
      const key = sessionKeyFromContext(context);
      const next = mode === "agent" ? "agent" : "instruction";
      // 默认纯指令：no row === instruction；AI 模式由「智能模式」显式写入并持久
      store.set(key, { mode: next, updatedAt: Date.now() });
      return key;
    },
    isAgent(context) {
      return this.getMode(context) === "agent";
    },
    key: sessionKeyFromContext,
  };
}

function matchSystemToken(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (SYSTEM_ENABLE_RE.test(t)) return "enable";
  if (SYSTEM_DISABLE_RE.test(t)) return "disable";
  if (SYSTEM_CLEAR_MEMORY_RE.test(t)) return "clear-memory";
  if (SYSTEM_CLEAR_HABITS_RE.test(t)) return "clear-habits";
  if (SYSTEM_HELP_RE.test(t)) return "help";
  return null;
}

/**
 * FastRoute for agent mode — deterministic, no LLM.
 * Returns command-like object or null.
 */
function matchFastRoute(text, { parseBotCommand }) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (typeof parseBotCommand !== "function") return null;
  const command = parseBotCommand(raw);
  if (!command) return null;
  // Only high-confidence business intents
  const allowed = new Set([
    "report",
    "not-live-report",
    "anchor-profile",
    "anchor-duration",
    "anchor-wave",
    "anchor-wave-days",
    "export-wave-file",
    "pk-group-image",
    "bind",
    "bind-status",
    "unbind",
  ]);
  if (!allowed.has(command.type)) return null;
  // 裸艺名：排除明显口语/问句，避免抢走 agent 自然语言
  if (command.type === "anchor-profile") {
    const q = String(command.query || "").trim();
    if (!q || q.length > 20) return null;
    if (/[？?！!]/.test(q)) return null;
    if (/(?:对比|帮我|一下|怎么|如何|什么|哪些|谁|多少|最近|分析|总结|为什么|可否|能否|请)/.test(q)) {
      return null;
    }
  }
  return command;
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
  SYSTEM_ENABLE_RE,
  SYSTEM_DISABLE_RE,
  SYSTEM_CLEAR_MEMORY_RE,
  SYSTEM_CLEAR_HABITS_RE,
  SYSTEM_HELP_RE,
  INSTRUCTION_HELP,
  AGENT_HELP,
  sessionKeyFromContext,
  createModeStore,
  matchSystemToken,
  matchFastRoute,
  createSessionQueues,
};
