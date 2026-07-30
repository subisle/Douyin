"use strict";

/**
 * Mode + FastRoute for Weixin bot (P0).
 * mode: instruction | agent
 */

const SYSTEM_ENABLE_RE = /^(?:人工客服|智能客服|客服|开启客服|打开客服)$/i;
const SYSTEM_DISABLE_RE = /^(?:退出客服|关闭客服|结束客服|取消客服|清空对话|清除记忆)$/i;
const SYSTEM_CLEAR_HABITS_RE = /^(?:清除习惯|清除我的习惯|清空习惯)$/i;
const SYSTEM_HELP_RE = /^(?:\/?help|帮助|菜单|命令|指令)$/i;

const INSTRUCTION_HELP = [
  "【智能对话 · 全部由 AI 处理】",
  "· 直接聊天：查音浪/时长、出日报图、导出等均由助手选技能完成",
  "· 管理员：开启日报推送 / 关闭日报推送 / 日报推送状态",
  "· 发 CSV → 默认昨天；先说「24号数据」可指定日（文件导入仍确定性）",
  "· 「清空对话」→ 仅清除本会话对话记忆（习惯画像保留）",
  "· 「清除习惯」→ 清除本会话自动学习的习惯画像（对话记忆不动）",
  "· 无指令模式 / FastRoute 旁路；AI 未配置时才退回固定指令兜底",
].join("\n");

const AGENT_HELP = INSTRUCTION_HELP;

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
  defaultMode = "agent",
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
      // Persist both modes: default agent means "no row" === agent, so
      // instruction must be stored explicitly after 退出客服.
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
    "anchor-profile",
    "anchor-duration",
    "anchor-wave",
    "anchor-wave-days",
    "export-wave-file",
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
