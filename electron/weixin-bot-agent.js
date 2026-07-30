"use strict";

const DEFAULT_BASE_URL = "http://162.243.93.40:8317/v1";
const DEFAULT_MODEL = "grok-4.5";
// grok-4.5 等带 reasoning 的模型，单次 tool-call completion 实测常 20–40s；
// 45s 过紧，默认放宽到 90s（仍受 120s 硬顶）。
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_TOOL_ROUNDS = 4;
const HARD_MAX_TOOL_ROUNDS = 6;
const MAX_THREAD_TURNS = 20;
const MAX_THREAD_CHARS = 24_000;
const THREAD_TTL_MS = 24 * 60 * 60_000;
const SESSION_TTL_MS = 2 * 60 * 60_000;
const MAX_THREADS = 200;
const MAX_SESSIONS = 200;
const ALLOWED_AI_HTTP_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "162.243.93.40",
]);

const SYSTEM_PERSONA = [
  "【身份】你是「数据客服」，服务内部运营/管理，负责抖音主播音浪与直播时长数据答疑。",
  "语气专业、简洁、友好；默认中文。不卖萌、不闲聊扩写。",
  "",
  "【能力】只能通过已提供的工具读取/导出本地已有数据，包括：",
  "1) 查主播音浪、时长、对比",
  "2) 生成每日报告图（男团/女队）",
  "3) 导出音浪 CSV",
  "4) PK/争霸赛分组（make_pk_groups：默认 preset=内置锁定分组；也可 high_to_low 顺序 / balanced 均衡 / score_capable 能出分；默认导出分组图）",
  "功能与固定命令一致，但可用自然语言理解用户意图。",
  "",
  "【分组规则】调用 make_pk_groups 时：",
  "- 用户说「内置分组 / 锁定分组 / 固定分组 / 分组」→ mode=preset（56人锁定表，狼辉第4/狼佑第1，次强3/最强5，08:15×5min）",
  "- 用户说「顺序分组 / 从高到低 / 强弱切块 / 总分」→ mode=high_to_low（按月音浪总量 wave）",
  "- 用户要「均衡/平均/蛇形」→ mode=balanced",
  "- 用户要「能出分」→ mode=score_capable",
  "- 默认 sendImage=true 导出分组 PNG；用户说不要图时再关",
  "- 硬约束已内置：浩阳与浩沐间隔≥4、啸泽与啸帆间隔≥3；次强第3场 / 最强第4场；四人先抽出再插回",
  "- 默认用15号白名单；回复用工具返回的 text/replyText，不要自己编名单",
  "",
  "【边界 / 禁止】",
  "- 禁止编造任何数字、排名、日期、主播信息；工具无结果就说没有。",
  "- 禁止回答与本库数据无关的问题（天气、股票、政治、法律意见、医疗、八卦等）。",
  "- 禁止索要或输出 API Key、Token、服务器路径、数据库密码。",
  "- 禁止执行删除、修改权限、改配置、改主播档案；只能查询与导出。",
  "- 禁止假装是真人客服；若用户要投诉/人工裁决，说明你是数据助手，请联系管理员。",
  "- 不向用户展示工具原始 JSON、内部错误栈。",
  "",
  "【回答规范】",
  "- 有数据时尽量标注截止日期 asOfDate。",
  "- 需要图/文件时调用导出工具，不要口头描述代替附件。",
  "- 用户意图不清时给 1～2 个示例问法，不要长篇说明书。",
  "- 单次文字控制在 1200 字内。",
  "- 用户说退出客服时由系统处理，你无需额外解释流程。",
].join("\n");

function compactError(error) {
  return String(error instanceof Error ? error.message : error || "未知错误")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .slice(0, 500);
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const url = new URL(raw);
  const httpAllowed = url.protocol === "http:" && ALLOWED_AI_HTTP_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !httpAllowed) {
    throw new Error("AI 接口仅允许 HTTPS，或已放行的 HTTP 主机");
  }
  return url.toString().replace(/\/$/, "");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: String(text || "").slice(0, 2000) };
  }
}

function threadKeyFromContext(context = {}) {
  const accountId = String(context.accountId || "").trim() || "unknown";
  const groupId = String(context.groupId || "").trim();
  const userId = String(context.fromUserId || context.userId || "").trim();
  if (groupId) return `a:${accountId}|g:${groupId}|u:${userId || "unknown"}`;
  return `a:${accountId}|u:${userId || String(context.conversationId || "unknown")}`;
}

const OPENING_PROGRESS_TEXT = "收到，正在处理…";
const TOOL_PROGRESS_LABELS = Object.freeze({
  search_anchors: "正在搜索主播…",
  get_anchor_full_profile: "正在查询主播数据…",
  get_anchor_wave_profile: "正在查询音浪…",
  get_anchor_wave_days: "正在查询音浪天数…",
  compare_anchor_wave: "正在对比音浪…",
  get_anchor_duration: "正在查询直播时长…",
  analyze_anchor_wave: "正在分析音浪…",
  get_daily_report_data: "正在查询日报数据…",
  export_daily_report_image: "正在生成日报图…",
  export_wave_file: "正在导出音浪文件…",
  make_pk_groups: "正在计算 PK 分组并出图…",
  rag_search: "正在检索说明…",
});

function progressLabelForTool(name) {
  const key = String(name || "").trim();
  return TOOL_PROGRESS_LABELS[key] || "正在执行工具…";
}

function isProgressEnabled(config = {}) {
  return config.progressEnabled !== false;
}

async function sendProgressReply(replyText, message) {
  if (typeof replyText !== "function") return;
  const text = String(message || "").trim();
  if (!text) return;
  try {
    await replyText(text);
  } catch {
    // fail-open：进度失败不阻断主流程
  }
}

class WeixinBotAgent {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.skills = options.skills || null;
    this.getConfig = typeof options.getConfig === "function" ? options.getConfig : () => ({});
    this.modeStore = options.modeStore || null;
    this.fastRouteHandler = typeof options.fastRouteHandler === "function" ? options.fastRouteHandler : null;
    this.userMemory = options.userMemory || null;
    this.threads = new Map();
    this.sessions = new Map();
  }

  isEnabled() {
    const config = this.getConfig() || {};
    return Boolean(config.enabled && config.apiKey && config.model && config.baseUrl);
  }

  getPublicStatus() {
    const config = this.getConfig() || {};
    return {
      enabled: Boolean(config.enabled),
      configured: Boolean(config.apiKey && config.model && config.baseUrl),
      baseUrl: String(config.baseUrl || DEFAULT_BASE_URL),
      model: String(config.model || DEFAULT_MODEL),
      hasApiKey: Boolean(config.apiKey),
      timeoutMs: Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS,
      maxToolRounds: Number(config.maxToolRounds) || DEFAULT_MAX_TOOL_ROUNDS,
      progressEnabled: isProgressEnabled(config),
    };
  }

  enableSession(context = {}) {
    if (this.modeStore && typeof this.modeStore.setMode === "function") {
      this.modeStore.setMode(context, "agent");
    }
    const key = threadKeyFromContext(context);
    this.sessions.set(key, { enabled: true, updatedAt: Date.now() });
    this._pruneSessions();
    return key;
  }

  disableSession(context = {}) {
    // 切到纯指令：关会话入口并清线程；mode 由调用方/modeStore 写 instruction
    const key = threadKeyFromContext(context);
    this.sessions.set(key, { enabled: false, updatedAt: Date.now() });
    this.clearThread(key);
    if (this.modeStore && typeof this.modeStore.setMode === "function") {
      this.modeStore.setMode(context, "instruction");
    }
    return key;
  }

  isSessionEnabled(context = {}) {
    // 以 modeStore 为准：仅 agent 模式可进模型
    if (this.modeStore && typeof this.modeStore.isAgent === "function") {
      return this.modeStore.isAgent(context);
    }
    if (!this.isEnabled()) return false;
    const key = threadKeyFromContext(context);
    const session = this.sessions.get(key);
    if (!session?.enabled) return false;
    if (Date.now() - (session.updatedAt || 0) > SESSION_TTL_MS) {
      this.sessions.delete(key);
      return false;
    }
    session.updatedAt = Date.now();
    return true;
  }

  clearThread(key) {
    const id = String(key || "");
    this.threads.delete(id);
    if (this.userMemory && typeof this.userMemory.clearThread === "function") {
      try {
        this.userMemory.clearThread(id);
      } catch {
        // ignore persistence failures
      }
    }
  }

  clearProfile(key) {
    const id = String(key || "");
    if (this.userMemory && typeof this.userMemory.clearProfile === "function") {
      try {
        return this.userMemory.clearProfile(id);
      } catch {
        // ignore persistence failures
      }
    }
    return null;
  }

  clearAllThreads() {
    this.threads.clear();
  }

  _memoryEnabled() {
    return Boolean(this.userMemory && this.userMemory.enabled && this.userMemory.enabled());
  }

  _loadThreadFromMemory(key) {
    if (!this._memoryEnabled() || typeof this.userMemory.getThread !== "function") return null;
    try {
      return this.userMemory.getThread(key);
    } catch {
      return null;
    }
  }

  _persistThread(key, thread) {
    if (!this._memoryEnabled() || typeof this.userMemory.saveThread !== "function") return;
    try {
      this.userMemory.saveThread(key, thread.messages || []);
    } catch {
      // ignore
    }
  }

  _profileSummary(key) {
    if (!this._memoryEnabled()) return "";
    try {
      const profile = this.userMemory.getProfile(key);
      return this.userMemory.formatProfileSummary(profile) || "";
    } catch {
      return "";
    }
  }

  _learnTool(key, name, args, observation) {
    if (!this._memoryEnabled() || typeof this.userMemory.learnFromTool !== "function") return;
    try {
      this.userMemory.learnFromTool(key, name, args, observation);
    } catch {
      // ignore
    }
  }

  _pruneSessions() {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (now - (session.updatedAt || 0) > SESSION_TTL_MS) this.sessions.delete(key);
    }
    if (this.sessions.size <= MAX_SESSIONS) return;
    const ordered = [...this.sessions.entries()].sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0));
    while (this.sessions.size > MAX_SESSIONS && ordered.length) {
      const [key] = ordered.shift();
      this.sessions.delete(key);
    }
  }

  _pruneThreads() {
    const now = Date.now();
    for (const [key, thread] of this.threads.entries()) {
      if (now - (thread.updatedAt || 0) > THREAD_TTL_MS) this.threads.delete(key);
    }
    if (this.threads.size <= MAX_THREADS) return;
    const ordered = [...this.threads.entries()].sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0));
    while (this.threads.size > MAX_THREADS && ordered.length) {
      const [key] = ordered.shift();
      this.threads.delete(key);
    }
  }

  _getThread(key) {
    this._pruneThreads();
    if (!this.threads.has(key)) {
      const loaded = this._loadThreadFromMemory(key);
      this.threads.set(key, {
        messages: Array.isArray(loaded?.messages) ? loaded.messages.map((item) => ({
          role: item.role,
          content: String(item.content || "").slice(0, 2000),
        })) : [],
        updatedAt: Number(loaded?.updatedAt) || Date.now(),
      });
    }
    const thread = this.threads.get(key);
    thread.updatedAt = Date.now();
    return thread;
  }

  _pushThread(thread, role, content) {
    thread.messages.push({ role, content: String(content || "").slice(0, 2000) });
    while (thread.messages.length > MAX_THREAD_TURNS * 2) thread.messages.shift();
    let total = thread.messages.reduce((sum, item) => sum + item.content.length, 0);
    while (total > MAX_THREAD_CHARS && thread.messages.length > 2) {
      const removed = thread.messages.shift();
      total -= removed.content.length;
    }
  }

  async handleMessage(args = {}) {
    if (!this.isEnabled()) return { handled: false, reason: "disabled" };
    if (!this.skills) return { handled: false, reason: "no-skills" };
    if (!this.isSessionEnabled(args)) return { handled: false, reason: "session-off" };
    const text = String(args.text || "").trim();
    if (!text) return { handled: false, reason: "empty" };

    // 产品：全部业务文本走模型+技能；不再在 Agent 内走 FastRoute 旁路
    void this.fastRouteHandler;

    const config = this.getConfig() || {};
    const baseUrl = normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL);
    const model = String(config.model || DEFAULT_MODEL).trim();
    const apiKey = String(config.apiKey || "").trim();
    const timeoutMs = Math.min(120_000, Math.max(5_000, Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS));
    const maxToolRounds = Math.min(
      HARD_MAX_TOOL_ROUNDS,
      Math.max(1, Number(config.maxToolRounds) || DEFAULT_MAX_TOOL_ROUNDS)
    );
    const progressEnabled = isProgressEnabled(config);

    const key = threadKeyFromContext(args);
    const thread = this._getThread(key);
    this._pushThread(thread, "user", text);

    const habitSummary = this._profileSummary(key);
    const systemContent = habitSummary
      ? `${SYSTEM_PERSONA}\n\n${habitSummary}`
      : SYSTEM_PERSONA;

    const messages = [
      { role: "system", content: systemContent },
      ...thread.messages.map((item) => ({ role: item.role, content: item.content })),
    ];

    const artifacts = [];
    let finalText = "";
    let toolCalls = 0;
    let lastProgressLabel = "";

    if (progressEnabled) {
      await sendProgressReply(args.replyText, OPENING_PROGRESS_TEXT);
      lastProgressLabel = OPENING_PROGRESS_TEXT;
    }

    for (let round = 0; round < maxToolRounds; round += 1) {
      const response = await this._chatCompletion({
        baseUrl,
        apiKey,
        model,
        timeoutMs,
        messages,
        tools: this.skills.definitions,
        signal: args.signal,
      });

      const choice = response?.choices?.[0]?.message || {};
      const toolCallsList = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
      if (!toolCallsList.length) {
        finalText = String(choice.content || "").trim();
        break;
      }

      const executableToolCalls = toolCallsList.slice(0, Math.min(3, Math.max(0, 8 - toolCalls)));
      if (!executableToolCalls.length) {
        finalText = "工具调用次数过多，已停止。请缩小问题范围后重试。";
        break;
      }

      messages.push({
        role: "assistant",
        content: choice.content || null,
        tool_calls: executableToolCalls,
      });

      for (const call of executableToolCalls) {
        toolCalls += 1;
        const name = String(call?.function?.name || "").trim();
        if (progressEnabled) {
          const label = progressLabelForTool(name);
          if (label && label !== lastProgressLabel) {
            await sendProgressReply(args.replyText, label);
            lastProgressLabel = label;
          }
        }
        const rawArgs = String(call?.function?.arguments || "{}");
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(rawArgs || "{}");
        } catch {
          parsedArgs = {};
        }
        let observation;
        try {
          observation = await this.skills.execute(name, parsedArgs);
        } catch (error) {
          observation = { ok: false, error: compactError(error) };
        }
        this._learnTool(key, name, parsedArgs, observation);
        const multi = Array.isArray(observation?.artifacts)
          ? observation.artifacts.filter((item) => item?.buffer)
          : [];
        if (multi.length) {
          for (const item of multi) artifacts.push(item);
          observation = {
            ...observation,
            artifacts: multi.map((item) => ({ kind: item.kind, fileName: item.fileName })),
            artifact: multi[0]
              ? { kind: multi[0].kind, fileName: multi[0].fileName }
              : undefined,
          };
        } else if (observation?.artifact?.buffer) {
          artifacts.push(observation.artifact);
          observation = {
            ...observation,
            artifact: {
              kind: observation.artifact.kind,
              fileName: observation.artifact.fileName,
            },
          };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id || `tool_${toolCalls}`,
          content: JSON.stringify(observation).slice(0, 6000),
        });
      }
    }

    if (!finalText) {
      finalText = artifacts.length
        ? "已根据数据生成结果，见附件。"
        : "暂时无法回答，可换种问法，或用固定命令如「每日报告」。";
    }

    this._pushThread(thread, "assistant", finalText);
    this._persistThread(key, thread);

    if (typeof args.replyText === "function" && finalText) {
      await args.replyText(finalText.slice(0, 3500));
    }
    for (const artifact of artifacts) {
      if (artifact.kind === "image" && typeof args.replyImage === "function") {
        await args.replyImage({ buffer: artifact.buffer, fileName: artifact.fileName });
      } else if (artifact.kind === "file" && typeof args.replyFile === "function") {
        await args.replyFile({ buffer: artifact.buffer, fileName: artifact.fileName });
      }
    }

    return { handled: true, text: finalText, artifactCount: artifacts.length, toolCalls };
  }

  async _chatCompletion({ baseUrl, apiKey, model, timeoutMs, messages, tools, signal }) {
    if (typeof this.fetchImpl !== "function") throw new Error("当前环境缺少 fetch");
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await this.fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`AI 接口 HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      return safeJsonParse(text);
    } catch (error) {
      if (signal?.aborted) throw new Error("AI 请求已中止");
      if (timedOut || error?.name === "AbortError") throw new Error("AI 请求超时");
      throw new Error(compactError(error));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

module.exports = {
  WeixinBotAgent,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  SYSTEM_PERSONA,
  OPENING_PROGRESS_TEXT,
  TOOL_PROGRESS_LABELS,
  normalizeBaseUrl,
  threadKeyFromContext,
  compactError,
  progressLabelForTool,
  isProgressEnabled,
};
