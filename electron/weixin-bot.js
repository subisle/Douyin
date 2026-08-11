const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const QRCode = require("qrcode");
const {
  CDN_BASE_URL,
  buildMediaItem,
  downloadInboundMedia,
  normalizeCdnBaseUrl,
  uploadMediaBuffer,
} = require("./weixin-bot-media");
const { createSessionQueues } = require("./weixin-bot-mode");
const { toDailyReportImagePages } = require("./weixin-bot-report");
const { renderDailyStarPng } = require("./weixin-bot-daily-star");
const {
  DEFAULT_DAILY_REPORT_PUSH,
  normalizeDailyReportPushSettings,
  buildGenderTop3Text,
  formatDailyPushStatusText,
  resolveDailyPushTargets,
} = require("./weixin-bot-daily-push");
const {
  acquireRunnerLock,
  renewRunnerLock,
  releaseRunnerLock,
} = require("./weixin-bot-runner-lock");
const {
  DEFAULT_BASE_URL,
  IlinkAdapter,
  IlinkSessionExpiredError,
  SESSION_EXPIRED_CODE,
  normalizeBaseUrl,
} = require("../shared/ilink-adapter");

const BOT_TYPE = "3";
const LOGIN_TTL_MS = 5 * 60_000;
const QR_POLL_TIMEOUT_MS = 38_000;
const API_TIMEOUT_MS = 15_000;
const LONG_POLL_TIMEOUT_MS = 38_000;
const HISTORY_LIMIT = 200;
const SEEN_MESSAGE_LIMIT = 500;
const RUNNER_LEASE_TTL_MS = 120_000;

const DEFAULT_AI_BASE_URL = "http://192.168.5.12/v1";
const DEFAULT_AI_MODEL = "deepseek-ai/deepseek-v4-flash-0731";
const ALLOWED_AI_HTTP_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "192.168.5.12",
  "162.243.93.40",
]);

const DEFAULT_SETTINGS = Object.freeze({
  autoReplyEnabled: false,
  autoReplyText: "消息已收到。",
  accessMode: "open", // 开放：任意用户 / 任意群；allow* 字段仅兼容旧存储
  allowUserIds: [],
  allowGroupIds: [],
  customCommands: [],
  ai: {
    enabled: true,
    baseUrl: DEFAULT_AI_BASE_URL,
    model: DEFAULT_AI_MODEL,
    timeoutMs: 90_000,
    maxToolRounds: 4,
    progressEnabled: true,
  },
  dailyReportPush: { ...DEFAULT_DAILY_REPORT_PUSH },
});

function isAllowedAiBaseUrl(url) {
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return ALLOWED_AI_HTTP_HOSTS.has(url.hostname);
}

function normalizeAiBaseUrl(value, fallback = DEFAULT_AI_BASE_URL) {
  const raw = String(value || fallback).trim() || fallback;
  const url = new URL(raw);
  if (!isAllowedAiBaseUrl(url)) {
    throw new Error("AI 接口仅允许 HTTPS，或已放行的 HTTP 主机");
  }
  return url.toString().replace(/\/$/, "");
}

function environmentAiApiKey(env = process.env) {
  return String(env.AI_API_KEY || env.OPENAI_API_KEY || "").trim();
}

function environmentAiEnabled(env = process.env) {
  const raw = String(env.AI_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return null;
}

function environmentAiBaseUrl(env = process.env) {
  return String(env.AI_BASE_URL || "").trim();
}

function environmentAiModel(env = process.env) {
  return String(env.AI_MODEL || "").trim();
}

function clampAiTimeoutMs(value, fallback = 90_000) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(120_000, Math.max(5_000, raw));
}

function environmentAiTimeoutMs(env = process.env) {
  const raw = String(env.AI_TIMEOUT_MS ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return clampAiTimeoutMs(value);
}

function environmentAiProgressEnabled(env = process.env) {
  const raw = String(env.AI_PROGRESS ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return null;
}

function resolveProgressEnabled(settingsValue, env = process.env) {
  const envProgress = environmentAiProgressEnabled(env);
  if (envProgress !== null) return envProgress;
  return settingsValue !== false;
}

function compactError(error) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  return message.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 500);
}

function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}

function isSessionExpiredError(error) {
  return error instanceof IlinkSessionExpiredError
    || Number(error?.code) === SESSION_EXPIRED_CODE;
}

function createAbortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(createAbortError());
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function messageTimestamp(value) {
  const millis = Number(value);
  const date = Number.isFinite(millis) && millis > 0 ? new Date(millis) : new Date();
  return date.toISOString();
}

function accountScopedKey(accountId, value) {
  return JSON.stringify([String(accountId || "").trim(), String(value || "").trim()]);
}

function extractMessagePreview(message) {
  const parts = [];
  let kind = "unknown";

  for (const item of Array.isArray(message?.item_list) ? message.item_list : []) {
    if (item?.type === 1 && item.text_item?.text) {
      if (kind === "unknown") kind = "text";
      parts.push(String(item.text_item.text));
    } else if (item?.type === 2) {
      if (kind === "unknown") kind = "image";
      parts.push("[图片]");
    } else if (item?.type === 3) {
      if (kind === "unknown") kind = "voice";
      const voiceText = String(item.voice_item?.text || "").trim();
      parts.push(voiceText ? `[语音] ${voiceText}` : "[语音]");
    } else if (item?.type === 4) {
      if (kind === "unknown") kind = "file";
      const fileName = String(item.file_item?.file_name || "").trim();
      parts.push(fileName ? `[文件] ${fileName}` : "[文件]");
    } else if (item?.type === 5) {
      if (kind === "unknown") kind = "video";
      parts.push("[视频]");
    }
  }

  return {
    kind,
    content: parts.join("\n").trim() || "[空消息]",
  };
}

function extractMessageText(message) {
  return (Array.isArray(message?.item_list) ? message.item_list : [])
    .filter((item) => item?.type === 1 && item.text_item?.text != null)
    .map((item) => String(item.text_item.text))
    .join("\n")
    .trim();
}


function uniqueIds(values) {
  const list = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  for (const value of list) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 200) break;
  }
  return out;
}

function normalizeAccessPolicy(input = {}, fallback = DEFAULT_SETTINGS) {
  return {
    accessMode: input.accessMode === "open" || input.accessMode === "allowlist"
      ? input.accessMode
      : (fallback.accessMode === "open" ? "open" : "allowlist"),
    allowUserIds: uniqueIds(input.allowUserIds ?? fallback.allowUserIds),
    allowGroupIds: uniqueIds(input.allowGroupIds ?? fallback.allowGroupIds),
  };
}

function normalizeCustomCommands(values) {
  const list = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const trigger = String(item?.trigger || "").trim().slice(0, 40);
    const action = String(item?.action || "reply").trim();
    const replyText = String(item?.replyText || "").trim().slice(0, 1000);
    const enabled = item?.enabled !== false;
    if (!trigger) continue;
    const key = trigger.toLowerCase();
    if (seen.has(key)) continue;
    if (!["reply", "daily_report", "male_report", "female_report", "wave_file", "help"].includes(action)) continue;
    seen.add(key);
    out.push({
      id: String(item?.id || `cmd_${out.length + 1}`),
      trigger,
      action,
      replyText,
      enabled,
    });
    if (out.length >= 50) break;
  }
  return out;
}

class WeixinBotService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.storagePath = options.storagePath;
    this.encryptToken = options.encryptToken;
    this.decryptToken = options.decryptToken;
    this.cdnBaseUrl = normalizeCdnBaseUrl(options.cdnBaseUrl || CDN_BASE_URL);
    this.commandHandler = null;
    this.agentHandler = null;
    this.modeStore = null;
    this.sessionQueues = createSessionQueues();
    const runnerLock = options.runnerLock || {};
    this.runnerLockApi = {
      acquire: runnerLock.acquire || acquireRunnerLock,
      renew: runnerLock.renew || renewRunnerLock,
      release: runnerLock.release || releaseRunnerLock,
    };
    this.runner = String(options.runner || process.env.BOT_RUNNER || "desktop").trim() || "desktop";
    this.runnerOwnerId = String(options.runnerOwnerId || "").trim() || undefined;
    this.runnerLockFile = String(options.runnerLockFile || "").trim() || undefined;
    this.runnerLeaseTtlMs = Math.max(10, Number(options.runnerLeaseTtlMs) || RUNNER_LEASE_TTL_MS);
    this.runnerHeartbeatMs = Math.max(
      5,
      Number(options.runnerHeartbeatMs) || Math.floor(this.runnerLeaseTtlMs / 3)
    );
    this.runnerLease = null;
    this.runnerHeartbeat = null;
    this.runnerLeaseLost = false;
    this.outboundControllers = new Set();
    this.outboundOperations = new Map();
    this.runnerWorkControllers = new Set();
    this.runnerWorkOperations = new Map();
    this.encryptedAiKey = "";
    this.knownContacts = new Map();
    this.dailyPushDb = options.db || null;
    this.dailyPushRenderReportPng = options.renderReportPng || null;
    this._dailyPushTimers = new Map();
    this._dailyPushInFlight = new Map();
    this.generateQrDataUrl = options.generateQrDataUrl || ((content) => QRCode.toDataURL(content, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#17231d", light: "#ffffff" },
    }));

    if (typeof this.fetchImpl !== "function") throw new Error("当前运行环境缺少 fetch");
    if (typeof this.storagePath !== "function") throw new Error("微信机器人缺少存储路径");
    if (typeof this.encryptToken !== "function" || typeof this.decryptToken !== "function") {
      throw new Error("微信机器人缺少安全存储实现");
    }
    this.ilinkAdapter = options.ilinkAdapter || new IlinkAdapter({
      fetchImpl: this.fetchImpl,
      timeoutMs: API_TIMEOUT_MS,
      randomUin: options.randomUin,
    });
    if (
      typeof this.ilinkAdapter.getJson !== "function"
      || typeof this.ilinkAdapter.postJson !== "function"
      || typeof this.ilinkAdapter.fetchJson !== "function"
    ) {
      throw new Error("微信机器人缺少有效的 iLink Adapter");
    }

    /** @type {Map<string, {
   *   accountId: string,
   *   credentials: { token: string, accountId: string, userId: string, baseUrl: string, savedAt: string },
   *   encryptedToken: string,
   *   updatesBuf: string,
   *   monitorController: AbortController | null,
   *   monitorPromise: Promise<any> | null,
   *   phase: string,
   *   lastPollAt: string | null,
   *   error: string | null,
   *   receivedCount: number,
   *   sentCount: number,
   * }>} */
    this.accounts = new Map();
    this.accountPolicies = new Map();
    this.defaultAccessPolicy = normalizeAccessPolicy();
    this.activeAccountId = null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      dailyReportPush: normalizeDailyReportPushSettings(DEFAULT_SETTINGS.dailyReportPush),
      customCommands: [],
      ai: { ...DEFAULT_SETTINGS.ai },
    };
    this.messages = [];
    this.contexts = new Map();
    this.seenMessageIds = new Set();
    this.seenMessageOrder = [];
    this.loginSession = null;
    this.loginPromise = null;
    this.status = {
      available: true,
      phase: "disconnected",
      connected: false,
      monitoring: false,
      accountId: null,
      userId: null,
      baseUrl: DEFAULT_BASE_URL,
      savedAt: null,
      qrDataUrl: null,
      qrExpiresAt: null,
      statusText: "尚未连接",
      lastPollAt: null,
      lastMessageAt: null,
      error: null,
      receivedCount: 0,
      sentCount: 0,
      accounts: [],
    };
  }

  /** 兼容旧测试/调用：当前活动账号凭据 */
  get credentials() {
    return this._getActiveAccount()?.credentials || null;
  }

  get encryptedToken() {
    return this._getActiveAccount()?.encryptedToken || "";
  }

  get updatesBuf() {
    return this._getActiveAccount()?.updatesBuf || "";
  }

  set updatesBuf(value) {
    const account = this._getActiveAccount();
    if (account) account.updatesBuf = String(value || "");
  }

  get monitorController() {
    return this._getActiveAccount()?.monitorController || null;
  }

  get monitorPromise() {
    return this._getActiveAccount()?.monitorPromise || null;
  }

  _getActiveAccount() {
    if (this.activeAccountId && this.accounts.has(this.activeAccountId)) {
      return this.accounts.get(this.activeAccountId);
    }
    const first = this.accounts.values().next().value || null;
    if (first) this.activeAccountId = first.accountId;
    return first;
  }

  _getAccount(accountId) {
    const id = String(accountId || "").trim();
    if (id) return this.accounts.get(id) || null;
    return this._getActiveAccount();
  }

  _getAccessPolicy(accountId) {
    const id = String(accountId || "").trim();
    const policy = id ? this.accountPolicies.get(id) : null;
    return normalizeAccessPolicy(policy || this.defaultAccessPolicy);
  }

  _listAccountsPublic() {
    return [...this.accounts.values()].map((item) => ({
      accountId: item.accountId,
      userId: item.credentials.userId || null,
      baseUrl: item.credentials.baseUrl,
      savedAt: item.credentials.savedAt,
      phase: item.phase,
      monitoring: Boolean(item.monitorPromise),
      lastPollAt: item.lastPollAt,
      error: item.error,
      receivedCount: item.receivedCount,
      sentCount: item.sentCount,
    }));
  }

  _refreshAggregateStatus(patch = {}) {
    const accounts = this._listAccountsPublic();
    const active = this._getActiveAccount();
    const anyMonitoring = accounts.some((item) => item.monitoring);
    const anyConnected = accounts.length > 0;
    const anyExpired = accounts.some((item) => item.phase === "session_expired");
    const anyError = accounts.some((item) => item.phase === "error");
    const loginActive = ["connecting", "awaiting_scan", "scanned"].includes(this.status.phase)
      && Boolean(this.loginSession);

    let phase = "disconnected";
    let statusText = "尚未连接";
    if (loginActive) {
      phase = this.status.phase;
      statusText = this.status.statusText;
    } else if (anyMonitoring) {
      phase = "running";
      statusText = accounts.length > 1
        ? `已连接 ${accounts.length} 个账号，运行中`
        : "机器人运行中";
    } else if (anyExpired) {
      phase = "session_expired";
      statusText = "有账号登录已过期";
    } else if (anyError) {
      phase = "error";
      statusText = "有账号连接异常";
    } else if (anyConnected) {
      phase = "stopped";
      statusText = accounts.length > 1
        ? `已连接 ${accounts.length} 个账号，已暂停`
        : "机器人已暂停";
    }

    this._setStatus({
      phase,
      connected: anyConnected,
      monitoring: anyMonitoring,
      accountId: active?.accountId || null,
      userId: active?.credentials.userId || null,
      baseUrl: active?.credentials.baseUrl || DEFAULT_BASE_URL,
      savedAt: active?.credentials.savedAt || null,
      statusText,
      lastPollAt: accounts.map((item) => item.lastPollAt).filter(Boolean).sort().at(-1) || null,
      receivedCount: accounts.reduce((sum, item) => sum + (item.receivedCount || 0), 0),
      sentCount: accounts.reduce((sum, item) => sum + (item.sentCount || 0), 0),
      accounts,
      ...patch,
    });
  }

  async initialize({ autoStart = true } = {}) {
    try {
      this._loadStore();
    } catch (error) {
      this._setStatus({
        phase: "error",
        statusText: "读取微信连接信息失败",
        error: compactError(error),
      });
      return this.getStatus();
    }

    if (!this.accounts.size) {
      this._refreshAggregateStatus({ error: null });
      return this.getStatus();
    }

    for (const account of this.accounts.values()) {
      account.phase = autoStart ? "connecting" : "stopped";
      account.error = null;
    }
    this._refreshAggregateStatus({
      statusText: autoStart ? "正在恢复连接" : "连接已暂停",
      error: null,
    });
    if (autoStart) {
      for (const account of this.accounts.values()) {
        await this.startMonitoring(account.accountId);
      }
    }
    return this.getStatus();
  }

  getStatus() {
    return {
      ...this.status,
      accounts: this._listAccountsPublic(),
    };
  }

  setCommandHandler(handler) {
    if (handler !== null && typeof handler !== "function") {
      throw new Error("微信机器人命令处理器必须是函数");
    }
    this.commandHandler = handler;
    if (handler?.modeStore) this.modeStore = handler.modeStore;
  }

  setModeStore(store) {
    this.modeStore = store || null;
  }

  setAgentHandler(handler) {
    if (handler !== null && typeof handler !== "function") {
      throw new Error("微信机器人 AI 处理器必须是函数");
    }
    this.agentHandler = handler;
  }

  getMessages() {
    return this.messages.map((message) => ({ ...message }));
  }

  clearMessages() {
    this.messages = [];
    this.contexts.clear();
    this.seenMessageIds.clear();
    this.seenMessageOrder = [];
    for (const account of this.accounts.values()) {
      account.receivedCount = 0;
      account.sentCount = 0;
    }
    this._refreshAggregateStatus({
      lastMessageAt: null,
    });
    this.emit("messages-cleared");
    return { cleared: true };
  }

  getSettings(accountId) {
    const targetAccountId = String(accountId || this._getActiveAccount()?.accountId || "").trim();
    return {
      accountId: targetAccountId || null,
      autoReplyEnabled: Boolean(this.settings.autoReplyEnabled),
      autoReplyText: String(this.settings.autoReplyText || ""),
      // 产品：开放访问；旧 allowlist 配置忽略
      accessMode: "open",
      allowUserIds: [],
      allowGroupIds: [],
      customCommands: (this.settings.customCommands || []).map((item) => ({ ...item })),
      ai: {
        // 回显用户勾选/填写偏好，不回写 runtime 有效态
        // 否则 AI_ENABLED=1 / AI_PROGRESS=1 会在点保存后把 UI 开关顶回勾选
        enabled: this.settings.ai?.enabled !== false,
        baseUrl: String(this.settings.ai?.baseUrl || DEFAULT_AI_BASE_URL),
        model: String(this.settings.ai?.model || DEFAULT_AI_MODEL),
        timeoutMs: clampAiTimeoutMs(this.settings.ai?.timeoutMs, 90_000),
        maxToolRounds: Number(this.settings.ai?.maxToolRounds) || 4,
        progressEnabled: this.settings.ai?.progressEnabled !== false,
        // 仅表示本机已保存的加密 Key；env 中的 Key 只影响 runtime，避免「清除」后仍显示已保存
        hasApiKey: Boolean(this.encryptedAiKey),
      },
      contacts: this.getContacts().filter((item) => !targetAccountId || item.accountId === targetAccountId),
      dailyReportPush: normalizeDailyReportPushSettings(this.settings.dailyReportPush),
    };
  }

  getContacts() {
    // strip tokens from public contact view
    return [...this.knownContacts.values()]
      .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))
      .map((item) => ({
        accountId: item.accountId,
        id: item.id,
        kind: item.kind === "group" ? "group" : "user",
        conversationId: item.conversationId,
        groupId: item.groupId || null,
        lastContent: item.lastContent || "",
        lastSeenAt: item.lastSeenAt || "",
        hasContext: Boolean(item.contextToken),
        allowed: true,
      }));
  }

  getAiRuntimeConfig() {
    let apiKey = "";
    if (this.encryptedAiKey) {
      try {
        apiKey = this.decryptToken(this.encryptedAiKey) || "";
      } catch {
        apiKey = "";
      }
    }
    if (!apiKey) apiKey = environmentAiApiKey();
    const envEnabled = environmentAiEnabled();
    const envBase = environmentAiBaseUrl();
    const envModel = environmentAiModel();
    let baseUrl = String(envBase || this.settings.ai?.baseUrl || DEFAULT_AI_BASE_URL);
    try {
      baseUrl = normalizeAiBaseUrl(baseUrl);
    } catch {
      baseUrl = DEFAULT_AI_BASE_URL;
    }
    const model = String(envModel || this.settings.ai?.model || DEFAULT_AI_MODEL).trim() || DEFAULT_AI_MODEL;
    // 用户勾选优先；env AI_ENABLED=0 可强制关；=1 只表示「允许开启」不覆盖 UI 关闭
    // 真正可用还需要 Key + 模型 + 地址
    const preferenceOn = this.settings.ai?.enabled !== false;
    const enabled = envEnabled === false
      ? false
      : Boolean(preferenceOn && apiKey && model && baseUrl);
    const envTimeoutMs = environmentAiTimeoutMs();
    return {
      enabled,
      baseUrl,
      model,
      timeoutMs: envTimeoutMs ?? clampAiTimeoutMs(this.settings.ai?.timeoutMs, 90_000),
      maxToolRounds: Number(this.settings.ai?.maxToolRounds) || 4,
      progressEnabled: resolveProgressEnabled(this.settings.ai?.progressEnabled),
      apiKey,
    };
  }

  saveSettings(input = {}) {
    const autoReplyText = String(input.autoReplyText ?? this.settings.autoReplyText ?? "").trim().slice(0, 1000);
    const autoReplyEnabled = Boolean(input.autoReplyEnabled ?? this.settings.autoReplyEnabled);
    if (autoReplyEnabled && !autoReplyText) throw new Error("请填写自动回复内容");

    const targetAccountId = String(input.accountId || this._getActiveAccount()?.accountId || "").trim();
    // 产品：开放访问，不再接受白名单配置
    const accessMode = "open";
    const allowUserIds = [];
    const allowGroupIds = [];
    const customCommands = normalizeCustomCommands(input.customCommands ?? this.settings.customCommands);
    const dailyReportPush = normalizeDailyReportPushSettings(
      input.dailyReportPush && typeof input.dailyReportPush === "object"
        ? input.dailyReportPush
        : this.settings.dailyReportPush,
      this.settings.dailyReportPush
    );

    const prevAi = this.settings.ai || {};
    const nextAiInput = input.ai && typeof input.ai === "object" ? input.ai : {};
    const hasAiEnabledInput = Object.prototype.hasOwnProperty.call(nextAiInput, "enabled");
    const hasProgressInput = Object.prototype.hasOwnProperty.call(nextAiInput, "progressEnabled");
    const ai = {
      // 默认开启；仅显式 false 关闭。无关保存不得把 undefined 收成 false
      enabled: hasAiEnabledInput ? Boolean(nextAiInput.enabled) : prevAi.enabled !== false,
      baseUrl: String(nextAiInput.baseUrl ?? prevAi.baseUrl ?? DEFAULT_AI_BASE_URL).trim() || DEFAULT_AI_BASE_URL,
      model: String(nextAiInput.model ?? prevAi.model ?? DEFAULT_AI_MODEL).trim() || DEFAULT_AI_MODEL,
      timeoutMs: clampAiTimeoutMs(nextAiInput.timeoutMs ?? prevAi.timeoutMs, 90_000),
      maxToolRounds: Math.min(6, Math.max(1, Number(nextAiInput.maxToolRounds ?? prevAi.maxToolRounds) || 4)),
      progressEnabled: hasProgressInput
        ? Boolean(nextAiInput.progressEnabled)
        : prevAi.progressEnabled !== false,
    };
    try {
      ai.baseUrl = normalizeAiBaseUrl(ai.baseUrl);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "AI 接口地址无效");
    }
    if (Object.prototype.hasOwnProperty.call(nextAiInput, "apiKey")) {
      const apiKey = String(nextAiInput.apiKey || "").trim();
      if (apiKey) {
        const encrypted = this.encryptToken(apiKey);
        if (!encrypted) throw new Error("AI Key 加密失败");
        this.encryptedAiKey = encrypted;
      } else if (nextAiInput.clearApiKey) {
        this.encryptedAiKey = "";
      }
    }
    // 无 Key 时 runtime 本来就不可用；UI 偏好保持用户选择。
    // 仅在「显式打开启用」且无 Key 时拒绝，避免无关保存把开关静默关掉。
    if (
      hasAiEnabledInput
      && nextAiInput.enabled
      && !this.encryptedAiKey
      && !environmentAiApiKey()
    ) {
      throw new Error("启用 AI 前请先填写 API Key");
    }

    const nextPolicy = { accessMode, allowUserIds, allowGroupIds };
    if (targetAccountId && this.accounts.has(targetAccountId)) {
      this.accountPolicies.set(targetAccountId, nextPolicy);
    } else {
      this.defaultAccessPolicy = nextPolicy;
    }
    this.settings = {
      autoReplyEnabled,
      autoReplyText,
      accessMode: "open",
      allowUserIds: [],
      allowGroupIds: [],
      customCommands,
      ai,
      dailyReportPush,
    };
    this._writeStore();
    return this.getSettings(targetAccountId);
  }

  async startLogin() {
    // 支持多账号：扫码登录不打断已有账号轮询
    await this.cancelLogin({ updateStatus: false });

    const controller = new AbortController();
    const session = {
      id: crypto.randomUUID(),
      controller,
      qrcode: "",
      startedAt: Date.now(),
      refreshCount: 0,
    };
    this.loginSession = session;
    this._setStatus({
      phase: "connecting",
      qrDataUrl: null,
      qrExpiresAt: null,
      statusText: "正在获取登录二维码",
      error: null,
      accounts: this._listAccountsPublic(),
    });

    try {
      await this._refreshLoginQr(session);
    } catch (error) {
      if (this.loginSession === session) this.loginSession = null;
      this._refreshAggregateStatus({
        statusText: "获取登录二维码失败",
        error: compactError(error),
        qrDataUrl: null,
        qrExpiresAt: null,
      });
      throw error;
    }

    const task = this._pollLogin(session);
    this.loginPromise = task;
    const clearLoginTask = () => {
      if (this.loginPromise === task) this.loginPromise = null;
    };
    void task.then(clearLoginTask, clearLoginTask);
    return this.getStatus();
  }

  async cancelLogin({ updateStatus = true } = {}) {
    const session = this.loginSession;
    this.loginSession = null;
    session?.controller.abort();
    const task = this.loginPromise;
    if (task) await task.catch(() => undefined);
    if (updateStatus) {
      this._refreshAggregateStatus({
        qrDataUrl: null,
        qrExpiresAt: null,
        error: null,
      });
    }
    return this.getStatus();
  }

  async _refreshLoginQr(session) {
    const response = await this._getJson(
      `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`,
      { signal: session.controller.signal, timeoutMs: API_TIMEOUT_MS }
    );
    const qrcode = String(response?.qrcode || "").trim();
    const content = String(response?.qrcode_img_content || "").trim();
    if (!qrcode || !content) throw new Error("微信接口未返回有效二维码");

    session.qrcode = qrcode;
    session.startedAt = Date.now();
    const qrDataUrl = await this.generateQrDataUrl(content);
    if (this.loginSession !== session || session.controller.signal.aborted) return;
    this._setStatus({
      phase: "awaiting_scan",
      qrDataUrl,
      qrExpiresAt: new Date(session.startedAt + LOGIN_TTL_MS).toISOString(),
      statusText: "等待微信扫码",
      error: null,
      connected: this.accounts.size > 0,
      monitoring: [...this.accounts.values()].some((item) => item.monitorPromise),
      accounts: this._listAccountsPublic(),
    });
  }

  async _pollLogin(session) {
    try {
      while (
        this.loginSession === session
        && !session.controller.signal.aborted
        && Date.now() - session.startedAt < LOGIN_TTL_MS
      ) {
        const url = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(session.qrcode)}`;
        const response = await this._getJson(url, {
          signal: session.controller.signal,
          timeoutMs: QR_POLL_TIMEOUT_MS,
          allowTimeout: true,
          headers: { "iLink-App-ClientVersion": "1" },
        }) || { status: "wait" };

        if (this.loginSession !== session || session.controller.signal.aborted) return;
        const phase = String(response.status || "wait");
        if (phase === "scaned") {
          this._setStatus({ phase: "scanned", statusText: "已扫码，等待微信确认", error: null });
        } else if (phase === "expired") {
          session.refreshCount += 1;
          if (session.refreshCount > 3) throw new Error("二维码多次过期，请重新连接");
          this._setStatus({ phase: "connecting", statusText: "二维码已过期，正在刷新" });
          await this._refreshLoginQr(session);
        } else if (phase === "confirmed") {
          await this._completeLogin(session, response);
          return;
        } else {
          this._setStatus({
            phase: "awaiting_scan",
            statusText: "等待微信扫码",
            error: null,
            accounts: this._listAccountsPublic(),
            connected: this.accounts.size > 0,
            monitoring: [...this.accounts.values()].some((item) => item.monitorPromise),
          });
        }

        await sleep(600, session.controller.signal);
      }

      if (this.loginSession === session) throw new Error("登录二维码已过期，请重新连接");
    } catch (error) {
      if (isAbortError(error) || this.loginSession !== session) return;
      this.loginSession = null;
      this._refreshAggregateStatus({
        qrDataUrl: null,
        qrExpiresAt: null,
        statusText: "微信连接失败",
        error: compactError(error),
      });
    }
  }

  async _completeLogin(session, response) {
    const token = String(response.bot_token || "").trim();
    const accountId = String(response.ilink_bot_id || "").trim();
    if (!token || !accountId) throw new Error("微信确认成功，但连接凭据不完整");

    const credentials = {
      token,
      accountId,
      userId: String(response.ilink_user_id || "").trim(),
      baseUrl: normalizeBaseUrl(response.baseurl || DEFAULT_BASE_URL),
      savedAt: new Date().toISOString(),
    };
    const encryptedToken = this.encryptToken(credentials.token);
    if (!encryptedToken) throw new Error("微信令牌加密失败");

    const existing = this.accounts.get(accountId);
    if (existing?.monitorPromise) {
      await this.stopMonitoring(accountId, { updateStatus: false });
    }
    this.accounts.set(accountId, {
      accountId,
      credentials,
      encryptedToken,
      updatesBuf: existing?.updatesBuf || "",
      monitorController: null,
      monitorPromise: null,
      phase: "connecting",
      lastPollAt: existing?.lastPollAt || null,
      error: null,
      receivedCount: existing?.receivedCount || 0,
      sentCount: existing?.sentCount || 0,
    });
    if (!this.accountPolicies.has(accountId)) {
      this.accountPolicies.set(accountId, normalizeAccessPolicy(this.defaultAccessPolicy));
    }
    this.activeAccountId = accountId;
    this._writeStore();
    this.loginSession = null;
    this._setStatus({
      phase: "connecting",
      connected: true,
      monitoring: false,
      accountId: credentials.accountId,
      userId: credentials.userId || null,
      baseUrl: credentials.baseUrl,
      savedAt: credentials.savedAt,
      qrDataUrl: null,
      qrExpiresAt: null,
      statusText: "登录成功，正在启动机器人",
      error: null,
      accounts: this._listAccountsPublic(),
    });
    await this.startMonitoring(accountId);
  }

  _runnerLeaseCallOptions(lease = this.runnerLease) {
    return {
      runner: this.runner,
      ttlMs: this.runnerLeaseTtlMs,
      file: lease?.file || this.runnerLockFile,
      ownerId: lease?.ownerId || this.runnerOwnerId,
    };
  }

  _acquireRunnerLease() {
    if (this.runnerLease) return;
    let lock;
    try {
      lock = this.runnerLockApi.acquire(this._runnerLeaseCallOptions(null));
    } catch (error) {
      const wrapped = new Error(`微信 Runner 锁获取失败：${compactError(error)}`);
      wrapped.code = "BOT_RUNNER_LOCKED";
      throw wrapped;
    }
    if (!lock?.ok) {
      const error = new Error(lock?.error || "微信 Runner 锁获取失败");
      error.code = "BOT_RUNNER_LOCKED";
      throw error;
    }
    this.runnerLease = {
      file: lock.file || this.runnerLockFile,
      ownerId: lock.lease?.ownerId || this.runnerOwnerId,
    };
    this.runnerLeaseLost = false;
    this._startRunnerHeartbeat();
  }

  _startRunnerHeartbeat() {
    if (this.runnerHeartbeat) clearInterval(this.runnerHeartbeat);
    this.runnerHeartbeat = setInterval(() => {
      if (!this.runnerLease) return;
      let renewed;
      try {
        renewed = this.runnerLockApi.renew(this._runnerLeaseCallOptions());
      } catch (error) {
        this._handleRunnerLeaseFailure(compactError(error));
        return;
      }
      if (!renewed?.ok) {
        this._handleRunnerLeaseFailure(renewed?.error || "微信 Runner 租约续期失败");
      }
    }, this.runnerHeartbeatMs);
    this.runnerHeartbeat.unref?.();
  }

  _stopRunnerHeartbeat() {
    if (this.runnerHeartbeat) clearInterval(this.runnerHeartbeat);
    this.runnerHeartbeat = null;
  }

  _handleRunnerLeaseFailure(reason) {
    if (!this.runnerLease) return;
    const error = `微信 Runner 租约失效：${String(reason || "续期失败")}`;
    this._stopRunnerHeartbeat();
    this.runnerLeaseLost = true;
    this.runnerLease = null;
    for (const controller of this.outboundControllers) controller.abort();
    for (const controller of this.runnerWorkControllers) controller.abort();
    for (const account of this.accounts.values()) {
      if (!account.monitorPromise && !account.monitorController) continue;
      account.phase = "error";
      account.error = error;
      account.monitorController?.abort();
    }
    this._refreshAggregateStatus({
      phase: "error",
      monitoring: false,
      statusText: "Runner 租约失效，机器人已停止",
      error,
    });
  }

  _beginOutboundOperation(accountId, runnerWork = null) {
    if (runnerWork) this._assertRunnerWork(runnerWork);
    if (this.runnerLeaseLost || !this.runnerLease) {
      throw new Error("微信 Runner 租约已失效，已阻止发送");
    }
    const operation = {
      controller: new AbortController(),
      accountId: String(accountId || runnerWork?.accountId || "").trim(),
      lease: runnerWork?.lease || this.runnerLease,
    };
    if (operation.lease !== this.runnerLease) {
      throw new Error("微信 Runner 租约已失效，已阻止发送");
    }
    this.outboundControllers.add(operation.controller);
    this.outboundOperations.set(operation.controller, operation);
    return operation;
  }

  _assertOutboundOperation(operation) {
    if (
      operation.controller.signal.aborted
      || this.runnerLeaseLost
      || (operation.lease && this.runnerLease !== operation.lease)
    ) {
      throw new Error("微信 Runner 租约已失效，已阻止发送");
    }
  }

  _finishOutboundOperation(operation) {
    this.outboundControllers.delete(operation.controller);
    this.outboundOperations.delete(operation.controller);
  }

  _beginRunnerWork(accountId) {
    if (this.runnerLeaseLost) throw new Error("微信 Runner 租约已失效，已停止处理消息");
    if (!this.runnerLease) this._acquireRunnerLease();
    const operation = {
      controller: new AbortController(),
      accountId: String(accountId || "").trim(),
      lease: this.runnerLease,
    };
    this.runnerWorkControllers.add(operation.controller);
    this.runnerWorkOperations.set(operation.controller, operation);
    return operation;
  }

  _assertRunnerWork(operation) {
    if (
      operation.controller.signal.aborted
      || this.runnerLeaseLost
      || (operation.lease && this.runnerLease !== operation.lease)
    ) {
      throw new Error("微信 Runner 租约已失效，已停止处理消息");
    }
  }

  _finishRunnerWork(operation) {
    this.runnerWorkControllers.delete(operation.controller);
    this.runnerWorkOperations.delete(operation.controller);
  }

  _abortOperationsForAccounts(accountIds = null) {
    const filter = accountIds && new Set([...accountIds].map((id) => String(id || "").trim()));
    const matches = (operation) => !filter || filter.has(String(operation?.accountId || "").trim());
    for (const [controller, operation] of this.outboundOperations.entries()) {
      if (matches(operation)) controller.abort();
    }
    for (const [controller, operation] of this.runnerWorkOperations.entries()) {
      if (matches(operation)) controller.abort();
    }
  }

  _resetSessionQueuesForAccounts(accountIds) {
    const ids = new Set([...accountIds].map((id) => String(id || "").trim()).filter(Boolean));
    if (!ids.size || typeof this.sessionQueues?.reset !== "function") return;
    this.sessionQueues.reset((key) => {
      const match = /^account:([^:]+):/.exec(String(key || ""));
      if (!match) return false;
      try {
        return ids.has(decodeURIComponent(match[1]));
      } catch {
        return false;
      }
    });
  }

  _hasActiveOutboundOperation() {
    return [...this.outboundOperations.values()].some((operation) => !operation.controller.signal.aborted);
  }

  _hasActiveRunnerWork() {
    return [...this.runnerWorkOperations.values()].some((operation) => !operation.controller.signal.aborted);
  }

  _hasRunningMonitor() {
    return [...this.accounts.values()].some((account) =>
      Boolean(account.monitorPromise && !account.monitorController?.signal.aborted)
    );
  }

  _releaseRunnerLeaseIfIdle({ force = false } = {}) {
    if (
      !force
      && (
        this._hasRunningMonitor()
        || this._hasActiveOutboundOperation()
        || this._hasActiveRunnerWork()
      )
    ) return;
    if (force) this._abortOperationsForAccounts();
    this._stopRunnerHeartbeat();
    const lease = this.runnerLease;
    this.runnerLease = null;
    if (!lease) return;
    try {
      const released = this.runnerLockApi.release(this._runnerLeaseCallOptions(lease));
      if (released?.ok === false) {
        this._refreshAggregateStatus({ error: released.error || "微信 Runner 租约释放失败" });
      }
    } catch (error) {
      this._refreshAggregateStatus({ error: `微信 Runner 租约释放失败：${compactError(error)}` });
    }
  }

  async startMonitoring(accountId) {
    const account = this._getAccount(accountId);
    if (!account?.credentials?.token) throw new Error("请先连接微信");

    if (account.monitorPromise) {
      if (account.phase === "running") {
        this.activeAccountId = account.accountId;
        this._refreshAggregateStatus();
        return this.getStatus();
      }
      await this.stopMonitoring(account.accountId, { updateStatus: false });
    }

    this._acquireRunnerLease();

    const controller = new AbortController();
    account.monitorController = controller;
    account.phase = "running";
    account.error = null;
    this.activeAccountId = account.accountId;
    this._refreshAggregateStatus({
      qrDataUrl: null,
      qrExpiresAt: null,
      statusText: "机器人运行中",
      error: null,
    });

    const task = this._monitorLoop(account, controller.signal);
    account.monitorPromise = task;
    const clearMonitorTask = () => {
      if (account.monitorPromise !== task) return;
      account.monitorPromise = null;
      account.monitorController = null;
      if (account.phase === "running") account.phase = "stopped";
      this._refreshAggregateStatus();
      this._releaseRunnerLeaseIfIdle();
    };
    void task.then(clearMonitorTask, clearMonitorTask);
    return this.getStatus();
  }

  async stopMonitoring(accountId, { updateStatus = true } = {}) {
    // 兼容旧签名 stopMonitoring({ updateStatus })
    let options = { updateStatus: true };
    let targetId = accountId;
    if (accountId && typeof accountId === "object") {
      options = accountId;
      targetId = null;
    } else if (typeof updateStatus === "object") {
      options = updateStatus;
    } else {
      options = { updateStatus };
    }

    const targets = targetId
      ? [this._getAccount(targetId)].filter(Boolean)
      : [...this.accounts.values()];
    const targetIds = new Set(targets.map((account) => account.accountId));
    this._abortOperationsForAccounts(targetIds);
    this._resetSessionQueuesForAccounts(targetIds);
    for (const account of targets) {
      const controller = account.monitorController;
      const task = account.monitorPromise;
      controller?.abort();
      // The handler may be user supplied and ignore AbortSignal. Mark the
      // monitor stopped immediately; its work remains fenced by the aborted
      // operation and cannot send after a replacement monitor acquires the
      // shared lease.
      if (account.monitorPromise === task) {
        account.monitorPromise = null;
        account.monitorController = null;
      }
      void task?.catch(() => undefined);
      if (options.updateStatus !== false) {
        account.phase = "stopped";
        account.error = null;
      }
    }
    this._releaseRunnerLeaseIfIdle();
    if (options.updateStatus !== false) this._refreshAggregateStatus({ error: null });
    return this.getStatus();
  }

  async disconnect(accountId) {
    const targetId = String(accountId || "").trim();
    await this.cancelLogin({ updateStatus: false });
    if (targetId) {
      const account = this.accounts.get(targetId);
      if (account) {
        await this.stopMonitoring(targetId, { updateStatus: false });
        this.accounts.delete(targetId);
        this.accountPolicies.delete(targetId);
        for (const [key, context] of this.contexts.entries()) {
          if (context.accountId === targetId) this.contexts.delete(key);
        }
        if (this.activeAccountId === targetId) {
          this.activeAccountId = this.accounts.keys().next().value || null;
        }
      }
    } else {
      await this.stopMonitoring(null, { updateStatus: false });
      this.accounts.clear();
      this.accountPolicies.clear();
      this.activeAccountId = null;
    }
    if (!targetId) this.contexts.clear();
    this._writeStore();
    this._refreshAggregateStatus({
      qrDataUrl: null,
      qrExpiresAt: null,
      error: null,
    });
    return this.getStatus();
  }

  async setActiveAccount(accountId) {
    const id = String(accountId || "").trim();
    if (!id || !this.accounts.has(id)) throw new Error("账号不存在");
    this.activeAccountId = id;
    this._refreshAggregateStatus();
    return this.getStatus();
  }

  async shutdown() {
    await this.cancelLogin({ updateStatus: false });
    this._abortOperationsForAccounts();
    await this.stopMonitoring(null, { updateStatus: false });
    this._releaseRunnerLeaseIfIdle({ force: true });
  }

  async _monitorLoop(account, signal) {
    let consecutiveFailures = 0;
    let timeoutMs = LONG_POLL_TIMEOUT_MS;

    while (!signal.aborted && account.credentials?.token && this.accounts.has(account.accountId)) {
      try {
        const response = await this._postJson(
          account.credentials.baseUrl,
          "ilink/bot/getupdates",
          { get_updates_buf: account.updatesBuf || "" },
          {
            token: account.credentials.token,
            signal,
            timeoutMs,
            allowTimeout: true,
          }
        );
        if (signal.aborted) return;

        if (!response) {
          account.lastPollAt = new Date().toISOString();
          this._refreshAggregateStatus({ error: null });
          continue;
        }

        const code = Number(response.errcode ?? response.ret ?? 0);
        if (code === SESSION_EXPIRED_CODE) {
          this._markSessionExpired(account.accountId);
          return;
        }
        if (code !== 0) {
          throw new Error(`微信收取消息失败 (${code}): ${String(response.errmsg || "未知错误")}`);
        }

        consecutiveFailures = 0;
        const suggested = Number(response.longpolling_timeout_ms);
        if (Number.isFinite(suggested) && suggested > 0) {
          timeoutMs = Math.min(65_000, Math.max(5_000, suggested + 3_000));
        }

        for (const message of Array.isArray(response.msgs) ? response.msgs : []) {
          await this._handleInboundMessage(message, account);
          if (signal.aborted) return;
        }

        if (signal.aborted) return;

        const nextBuf = String(response.get_updates_buf || "");
        if (nextBuf && nextBuf !== account.updatesBuf) {
          account.updatesBuf = nextBuf;
          this._writeStore();
        }
        account.phase = "running";
        account.lastPollAt = new Date().toISOString();
        account.error = null;
        this._refreshAggregateStatus({ error: null });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        if (
          isSessionExpiredError(error)
          || /微信接口 HTTP (401|403)/.test(String(error?.message || ""))
        ) {
          this._markSessionExpired(account.accountId);
          return;
        }
        consecutiveFailures += 1;
        const backoffMs = consecutiveFailures >= 3 ? 30_000 : 2_000;
        if (consecutiveFailures >= 3) consecutiveFailures = 0;
        account.phase = "running";
        account.error = compactError(error);
        this._refreshAggregateStatus({
          statusText: "连接波动，正在重试",
          error: compactError(error),
        });
        try {
          await sleep(backoffMs, signal);
        } catch (sleepError) {
          if (isAbortError(sleepError)) return;
          throw sleepError;
        }
      }
    }
  }

  async _handleInboundMessage(rawMessage, account) {
    if (Number(rawMessage?.message_type) !== 1) return;
    const fromUserId = String(rawMessage.from_user_id || "").trim();
    if (!fromUserId) return;

    const requestedAccountId = String(account?.accountId || "").trim();
    const owner = requestedAccountId
      ? this.accounts.get(requestedAccountId)
      : this._getActiveAccount();
    if (!owner?.credentials?.token) return;
    const accountId = owner.accountId;
    const work = this._beginRunnerWork(accountId);

    try {

    const groupId = String(rawMessage.group_id || "").trim();
    const conversationId = groupId || fromUserId;
    const contextToken = String(rawMessage.context_token || "").trim();
    const rawId = String(rawMessage.message_id || rawMessage.client_id || "").trim();
    const fallbackId = crypto
      .createHash("sha1")
      .update(`${conversationId}|${rawMessage.create_time_ms || ""}|${JSON.stringify(rawMessage.item_list || [])}`)
      .digest("hex");
    const id = `in-${accountId}-${rawId || fallbackId}`;
    if (this._hasSeenMessage(accountId, id)) return;

    const context = { accountId, contextToken, toUserId: fromUserId, groupId };
    if (contextToken) {
      this.contexts.set(accountScopedKey(accountId, conversationId), context);
    }
    const preview = extractMessagePreview(rawMessage);
    this._addMessage({
      id,
      accountId,
      direction: "inbound",
      conversationId,
      userId: fromUserId,
      groupId: groupId || null,
      kind: preview.kind,
      content: preview.content,
      createdAt: messageTimestamp(rawMessage.create_time_ms),
      status: "received",
    });

    this._rememberContact({
      accountId,
      id: fromUserId,
      kind: "user",
      conversationId,
      groupId: groupId || null,
      lastContent: preview.content,
      lastSeenAt: messageTimestamp(rawMessage.create_time_ms),
      contextToken,
      toUserId: fromUserId,
    });
    if (groupId) {
      this._rememberContact({
        accountId,
        id: groupId,
        kind: "group",
        conversationId: groupId,
        groupId,
        lastContent: preview.content,
        lastSeenAt: messageTimestamp(rawMessage.create_time_ms),
        contextToken,
        toUserId: fromUserId,
      });
    }

    const containsFile = (Array.isArray(rawMessage.item_list) ? rawMessage.item_list : [])
      .some((item) => Number(item?.type) === 4);

    let commandHandled = false;
    const inboundText = extractMessageText(rawMessage);
    const replyApi = {
      accountId,
      text: inboundText,
      items: Array.isArray(rawMessage.item_list) ? rawMessage.item_list : [],
      rawMessage,
      conversationId,
      fromUserId,
      groupId: groupId || null,
      settings: this.getSettings(accountId),
      signal: work.controller.signal,
      assertLease: () => this._assertRunnerWork(work),
      replyText: (text) => {
        this._assertRunnerWork(work);
        return this._sendTextWithContext(
          conversationId,
          String(text).slice(0, 4000),
          context,
          owner,
          { runnerWork: work }
        );
      },
      replyImage: (input) => {
        this._assertRunnerWork(work);
        return this._sendMediaWithContext(
          conversationId,
          { ...input, mediaKind: "image" },
          context,
          owner,
          { runnerWork: work }
        );
      },
      replyFile: (input) => {
        this._assertRunnerWork(work);
        return this._sendMediaWithContext(
          conversationId,
          { ...input, mediaKind: "file" },
          context,
          owner,
          { runnerWork: work }
        );
      },
      downloadMedia: (requestedItem) => {
        this._assertRunnerWork(work);
        const mediaItem = requestedItem || (Array.isArray(rawMessage.item_list) ? rawMessage.item_list : [])
          .find((item) => [2, 3, 4, 5].includes(Number(item?.type)));
        return downloadInboundMedia({
          fetchImpl: this.fetchImpl,
          item: mediaItem,
          cdnBaseUrl: this.cdnBaseUrl,
          signal: work.controller.signal,
        });
      },
    };

    if (!contextToken) return;

    const modeKey = this.modeStore?.key?.(replyApi) || conversationId;
    const queueKey = `account:${encodeURIComponent(accountId)}:${modeKey}`;
    await this.sessionQueues.runSerial(queueKey, async () => {
      this._assertRunnerWork(work);
      if (this.commandHandler) {
        try {
          const result = await this.commandHandler(replyApi);
          this._assertRunnerWork(work);
          commandHandled = Boolean(result?.handled);
        } catch (error) {
          if (work.controller.signal.aborted || this.runnerLeaseLost) throw error;
          commandHandled = true;
          const message = `命令执行失败：${compactError(error)}`;
          try {
            await this._sendTextWithContext(
              conversationId,
              message,
              context,
              owner,
              { runnerWork: work }
            );
          } catch (sendError) {
            this._setStatus({ error: `${message}；回复失败：${compactError(sendError)}` });
          }
        }
      }

      if (!commandHandled && this.agentHandler) {
        try {
          this._assertRunnerWork(work);
          const result = await this.agentHandler(replyApi);
          this._assertRunnerWork(work);
          commandHandled = Boolean(result?.handled);
        } catch (error) {
          if (work.controller.signal.aborted || this.runnerLeaseLost) throw error;
          commandHandled = true;
          const message = `AI 处理失败：${compactError(error)}`;
          try {
            await this._sendTextWithContext(
              conversationId,
              message,
              context,
              owner,
              { runnerWork: work }
            );
          } catch (sendError) {
            this._setStatus({ error: `${message}；回复失败：${compactError(sendError)}` });
          }
        }
      }

      if (!commandHandled && this.settings.autoReplyEnabled && this.settings.autoReplyText) {
        try {
          this._assertRunnerWork(work);
          await this._sendTextWithContext(
            conversationId,
            this.settings.autoReplyText,
            context,
            owner,
            { runnerWork: work }
          );
        } catch (error) {
          this._setStatus({ error: `自动回复失败: ${compactError(error)}` });
        }
      }
    });
    } finally {
      this._finishRunnerWork(work);
      this._releaseRunnerLeaseIfIdle();
    }
  }

  async sendText(input = {}) {
    const conversationId = String(input.conversationId || "").trim();
    const text = String(input.text || "").trim();
    if (!conversationId) throw new Error("请选择一个微信会话");
    if (!text) throw new Error("消息内容为空");
    if (text.length > 4000) throw new Error("单条消息最多 4000 个字符");
    const requestedAccountId = String(input.accountId || "").trim();
    const account = requestedAccountId
      ? this.accounts.get(requestedAccountId)
      : this._getActiveAccount();
    if (!account?.credentials?.token) throw new Error("微信尚未连接");
    const context = this.contexts.get(accountScopedKey(account.accountId, conversationId));
    if (!context?.contextToken) throw new Error("当前会话缺少上下文，请等待对方发送新消息");
    if (!this.runnerLease) this._acquireRunnerLease();
    try {
      return await this._sendTextWithContext(conversationId, text, context, account);
    } finally {
      this._releaseRunnerLeaseIfIdle();
    }
  }

  _accountForContext(context, account) {
    const accountId = String(account?.accountId || context?.accountId || "").trim();
    if (!accountId || (context?.accountId && context.accountId !== accountId)) {
      throw new Error("微信会话与账号不匹配");
    }
    const owner = this.accounts.get(accountId);
    if (!owner?.credentials?.token) throw new Error("微信尚未连接");
    return owner;
  }

  async _sendTextWithContext(conversationId, text, context, account, options = {}) {
    const owner = this._accountForContext(context, account);
    const accountId = owner.accountId;
    const credentials = { ...owner.credentials };
    const clientId = `douyin-${crypto.randomUUID()}`;
    const msg = {
      from_user_id: "",
      to_user_id: context.toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: context.contextToken,
      item_list: [{ type: 1, text_item: { text } }],
      ...(context.groupId ? { group_id: context.groupId } : {}),
    };
    const operation = this._beginOutboundOperation(accountId, options.runnerWork);

    try {
      this._assertOutboundOperation(operation);
      const response = await this._postJson(
        credentials.baseUrl,
        "ilink/bot/sendmessage",
        { msg },
        { token: credentials.token, timeoutMs: API_TIMEOUT_MS, signal: operation.controller.signal }
      );
      this._assertOutboundOperation(operation);
      const code = Number(response?.errcode ?? response?.ret ?? 0);
      if (code === SESSION_EXPIRED_CODE) {
        this._markSessionExpired(accountId);
        throw new Error("微信登录已过期，请重新扫码连接");
      }
      if (code !== 0) {
        throw new Error(`微信发送消息失败 (${code}): ${String(response?.errmsg || "未知错误")}`);
      }

      const sent = {
        id: clientId,
        accountId,
        direction: "outbound",
        conversationId,
        userId: context.toUserId,
        groupId: context.groupId || null,
        kind: "text",
        content: text,
        createdAt: new Date().toISOString(),
        status: "sent",
      };
      this._addMessage(sent);
      return { ...sent };
    } catch (error) {
      if (
        isSessionExpiredError(error)
        || /微信接口 HTTP (401|403)/.test(String(error?.message || ""))
      ) {
        this._markSessionExpired(accountId);
      }
      const failed = {
        id: clientId,
        accountId,
        direction: "outbound",
        conversationId,
        userId: context.toUserId,
        groupId: context.groupId || null,
        kind: "text",
        content: text,
        createdAt: new Date().toISOString(),
        status: "failed",
      };
      this._addMessage(failed);
      if (operation.controller.signal.aborted || this.runnerLeaseLost) {
        throw new Error("微信 Runner 租约已失效，已阻止发送");
      }
      throw error;
    } finally {
      this._finishOutboundOperation(operation);
    }
  }

  async _sendMediaWithContext(conversationId, input, context, account, options = {}) {
    const owner = this._accountForContext(context, account);
    const accountId = owner.accountId;
    const credentials = { ...owner.credentials };
    const mediaKind = input.mediaKind === "image" ? "image" : "file";
    const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer || []);
    if (!buffer.length) throw new Error("待发送媒体内容为空");
    const fileName = String(input.fileName || (mediaKind === "image" ? "report.png" : "data.csv"));
    const clientId = `douyin-${crypto.randomUUID()}`;
    const content = mediaKind === "image" ? `[图片] ${fileName}` : `[文件] ${fileName}`;
    const operation = this._beginOutboundOperation(accountId, options.runnerWork);

    try {
      this._assertOutboundOperation(operation);
      const uploaded = await uploadMediaBuffer({
        fetchImpl: this.fetchImpl,
        buffer,
        fileName,
        mediaKind,
        toUserId: context.toUserId,
        cdnBaseUrl: this.cdnBaseUrl,
        signal: operation.controller.signal,
        getUploadUrl: async (payload) => {
          this._assertOutboundOperation(operation);
          const response = await this._postJson(
            credentials.baseUrl,
            "ilink/bot/getuploadurl",
            payload,
            { token: credentials.token, timeoutMs: API_TIMEOUT_MS, signal: operation.controller.signal }
          );
          this._assertOutboundOperation(operation);
          const code = Number(response?.errcode ?? response?.ret ?? 0);
          if (code === SESSION_EXPIRED_CODE) {
            this._markSessionExpired(accountId);
            throw new Error("微信登录已过期，请重新扫码连接");
          }
          if (code !== 0) {
            throw new Error(`微信获取上传地址失败 (${code}): ${String(response?.errmsg || "未知错误")}`);
          }
          return response;
        },
      });
      this._assertOutboundOperation(operation);
      const item = buildMediaItem(mediaKind, uploaded);
      const msg = {
        from_user_id: "",
        to_user_id: context.toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: context.contextToken,
        item_list: [item],
        ...(context.groupId ? { group_id: context.groupId } : {}),
      };
      const response = await this._postJson(
        credentials.baseUrl,
        "ilink/bot/sendmessage",
        { msg },
        { token: credentials.token, timeoutMs: API_TIMEOUT_MS, signal: operation.controller.signal }
      );
      this._assertOutboundOperation(operation);
      const code = Number(response?.errcode ?? response?.ret ?? 0);
      if (code === SESSION_EXPIRED_CODE) {
        this._markSessionExpired(accountId);
        throw new Error("微信登录已过期，请重新扫码连接");
      }
      if (code !== 0) {
        throw new Error(`微信发送媒体失败 (${code}): ${String(response?.errmsg || "未知错误")}`);
      }

      const sent = {
        id: clientId,
        accountId,
        direction: "outbound",
        conversationId,
        userId: context.toUserId,
        groupId: context.groupId || null,
        kind: mediaKind,
        content,
        createdAt: new Date().toISOString(),
        status: "sent",
      };
      this._addMessage(sent);
      return { ...sent };
    } catch (error) {
      if (
        isSessionExpiredError(error)
        || /微信接口 HTTP (401|403)/.test(String(error?.message || ""))
      ) {
        this._markSessionExpired(accountId);
      }
      const failed = {
        id: clientId,
        accountId,
        direction: "outbound",
        conversationId,
        userId: context.toUserId,
        groupId: context.groupId || null,
        kind: mediaKind,
        content,
        createdAt: new Date().toISOString(),
        status: "failed",
      };
      this._addMessage(failed);
      if (operation.controller.signal.aborted || this.runnerLeaseLost) {
        throw new Error("微信 Runner 租约已失效，已阻止发送");
      }
      throw error;
    } finally {
      this._finishOutboundOperation(operation);
    }
  }

  _addMessage(message) {
    const accountId = String(message?.accountId || "").trim();
    if (!accountId) throw new Error("微信消息缺少账号标识");
    this._rememberMessage(accountId, message.id);
    this.messages.push({ ...message, accountId });
    if (this.messages.length > HISTORY_LIMIT) this.messages.splice(0, this.messages.length - HISTORY_LIMIT);
    const inbound = message.direction === "inbound";
    const delivered = message.direction === "outbound" && message.status === "sent";
    const account = this.accounts.get(accountId);
    if (account) {
      if (inbound) account.receivedCount += 1;
      if (delivered) account.sentCount += 1;
    }
    this._refreshAggregateStatus({
      lastMessageAt: message.createdAt,
    });
    this.emit("message", { ...message, accountId });
  }

  _hasSeenMessage(accountId, id) {
    return this.seenMessageIds.has(accountScopedKey(accountId, id));
  }

  _rememberContact(contact) {
    const accountId = String(contact?.accountId || "").trim();
    const id = String(contact?.id || "").trim();
    if (!accountId || !id) return;
    const key = accountScopedKey(accountId, id);
    const prev = this.knownContacts.get(key) || {};
    this.knownContacts.set(key, {
      accountId,
      id,
      kind: contact.kind === "group" ? "group" : "user",
      conversationId: String(contact.conversationId || prev.conversationId || id),
      groupId: contact.groupId || prev.groupId || null,
      lastContent: String(contact.lastContent || prev.lastContent || "").slice(0, 200),
      lastSeenAt: String(contact.lastSeenAt || prev.lastSeenAt || new Date().toISOString()),
      contextToken: String(contact.contextToken || prev.contextToken || "").trim(),
      toUserId: String(contact.toUserId || prev.toUserId || (contact.kind === "group" ? "" : id)).trim(),
      allowed: true,
    });
    // Keep map bounded
    if (this.knownContacts.size > 300) {
      const ordered = [...this.knownContacts.entries()].sort((a, b) =>
        String(a[1].lastSeenAt || "").localeCompare(String(b[1].lastSeenAt || ""))
      );
      while (this.knownContacts.size > 300 && ordered.length) {
        const [key] = ordered.shift();
        this.knownContacts.delete(key);
      }
    }
    this._writeStore();
  }

  _rememberMessage(accountId, id) {
    const key = accountScopedKey(accountId, id);
    if (this.seenMessageIds.has(key)) return;
    this.seenMessageIds.add(key);
    this.seenMessageOrder.push(key);
    if (this.seenMessageOrder.length <= SEEN_MESSAGE_LIMIT) return;
    const expired = this.seenMessageOrder.shift();
    if (expired) this.seenMessageIds.delete(expired);
  }

  async _getJson(url, options = {}) {
    return this.ilinkAdapter.getJson(url, options);
  }

  async _postJson(baseUrl, endpoint, body, options = {}) {
    return this.ilinkAdapter.postJson(baseUrl, endpoint, body, options);
  }

  async _fetchJson(url, options = {}) {
    return this.ilinkAdapter.fetchJson(url, options);
  }

  _loadStore() {
    const file = this.storagePath();
    if (!fs.existsSync(file)) return;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (![1, 2, 3, 4].includes(parsed?.version)) {
      throw new Error("微信机器人存储版本不受支持");
    }

    const ai = parsed.settings?.ai || {};
    this.accountPolicies = new Map();
    if (parsed.version === 4) {
      this.defaultAccessPolicy = normalizeAccessPolicy(parsed.defaultAccessPolicy);
      for (const [accountId, policy] of Object.entries(parsed.accountPolicies || {})) {
        const id = String(accountId || "").trim();
        if (id) this.accountPolicies.set(id, normalizeAccessPolicy(policy));
      }
    } else {
      // Legacy stores had one global policy and defaulted to open. Migrate the
      // old allowlist only to the active account; every other account starts closed.
      this.defaultAccessPolicy = normalizeAccessPolicy();
      const legacyAccountId = String(
        parsed.activeAccountId
          || parsed.credentials?.accountId
          || parsed.accounts?.[0]?.accountId
          || ""
      ).trim();
      if (legacyAccountId) {
        this.accountPolicies.set(legacyAccountId, normalizeAccessPolicy({
          accessMode: "allowlist",
          allowUserIds: parsed.settings?.allowUserIds,
          allowGroupIds: parsed.settings?.allowGroupIds,
        }));
      }
    }
    this.settings = {
      autoReplyEnabled: Boolean(parsed.settings?.autoReplyEnabled),
      autoReplyText: String(parsed.settings?.autoReplyText ?? DEFAULT_SETTINGS.autoReplyText).slice(0, 1000),
      accessMode: "open",
      allowUserIds: [],
      allowGroupIds: [],
      customCommands: normalizeCustomCommands(parsed.settings?.customCommands),
      ai: {
        // 默认开启智能；仅显式 false 时关闭
        enabled: ai.enabled === undefined ? true : Boolean(ai.enabled),
        baseUrl: String(ai.baseUrl || DEFAULT_AI_BASE_URL),
        model: String(ai.model || DEFAULT_AI_MODEL),
        // 旧默认 45s 对 grok-4.5 tool-call 过紧，加载时抬到 90s
        timeoutMs: clampAiTimeoutMs(
          Number(ai.timeoutMs) === 45_000 ? 90_000 : ai.timeoutMs,
          90_000
        ),
        maxToolRounds: Number(ai.maxToolRounds) || 4,
        // 旧 store 无该字段时默认开启进度回执
        progressEnabled: ai.progressEnabled !== false,
      },
      dailyReportPush: normalizeDailyReportPushSettings(parsed.settings?.dailyReportPush),
    };
    try {
      this.settings.ai.baseUrl = normalizeAiBaseUrl(this.settings.ai.baseUrl);
    } catch {
      this.settings.ai.baseUrl = DEFAULT_AI_BASE_URL;
    }
    this.encryptedAiKey = String(parsed.encryptedAiKey || "");
    this.knownContacts = new Map();
    for (const item of Array.isArray(parsed.contacts) ? parsed.contacts : []) {
      const id = String(item?.id || "").trim();
      if (!id) continue;
      const accountId = String(
        item?.accountId || parsed.activeAccountId || parsed.credentials?.accountId || "legacy"
      ).trim();
      const conversationId = String(item.conversationId || id);
      const contextToken = String(item.contextToken || "").trim();
      const toUserId = String(item.toUserId || (item.kind === "group" ? "" : id)).trim();
      this.knownContacts.set(accountScopedKey(accountId, id), {
        accountId,
        id,
        kind: item.kind === "group" ? "group" : "user",
        conversationId,
        groupId: item.groupId || null,
        lastContent: String(item.lastContent || "").slice(0, 200),
        lastSeenAt: String(item.lastSeenAt || ""),
        contextToken,
        toUserId,
        allowed: true,
      });
      if (contextToken) {
        this.contexts.set(accountScopedKey(accountId, conversationId), {
          accountId,
          contextToken,
          toUserId: toUserId || id,
          groupId: item.kind === "group" ? (item.groupId || id) : null,
        });
      }
    }

    this.accounts = new Map();
    this.activeAccountId = null;

    const legacyBuf = typeof parsed.updatesBuf === "string" ? parsed.updatesBuf : "";
    const accountList = Array.isArray(parsed.accounts) && parsed.accounts.length
      ? parsed.accounts
      : (parsed.credentials?.encryptedToken && parsed.credentials?.accountId
        ? [{ ...parsed.credentials, updatesBuf: legacyBuf }]
        : []);

    for (const stored of accountList) {
      if (!stored?.encryptedToken || !stored?.accountId) continue;
      const token = this.decryptToken(String(stored.encryptedToken));
      if (!token) throw new Error("微信令牌解密失败");
      const accountId = String(stored.accountId);
      this.accounts.set(accountId, {
        accountId,
        credentials: {
          token,
          accountId,
          userId: String(stored.userId || ""),
          baseUrl: normalizeBaseUrl(stored.baseUrl || DEFAULT_BASE_URL),
          savedAt: String(stored.savedAt || ""),
        },
        encryptedToken: String(stored.encryptedToken),
        updatesBuf: typeof stored.updatesBuf === "string" ? stored.updatesBuf : legacyBuf,
        monitorController: null,
        monitorPromise: null,
        phase: "stopped",
        lastPollAt: null,
        error: null,
        receivedCount: 0,
        sentCount: 0,
      });
      if (!this.accountPolicies.has(accountId)) {
        this.accountPolicies.set(accountId, normalizeAccessPolicy(this.defaultAccessPolicy));
      }
    }
    this.activeAccountId = String(parsed.activeAccountId || "") || this.accounts.keys().next().value || null;
  }


  setDailyPushDependencies({ db, renderReportPng } = {}) {
    if (db) this.dailyPushDb = db;
    if (typeof renderReportPng === "function") this.dailyPushRenderReportPng = renderReportPng;
  }

  isDailyPushAdmin(userId) {
    // 无权限墙：任意用户都可指令开关日报推送
    return Boolean(String(userId || "").trim());
  }

  getDailyReportPushStatusText() {
    return formatDailyPushStatusText(this.settings.dailyReportPush);
  }

  setDailyReportPushEnabled(enabled, { actorUserId: _actorUserId, accountId: _accountId } = {}) {
    const dailyReportPush = normalizeDailyReportPushSettings({
      ...normalizeDailyReportPushSettings(this.settings.dailyReportPush),
      enabled: Boolean(enabled),
    });
    this.settings = { ...this.settings, dailyReportPush };
    this._writeStore();
    return dailyReportPush;
  }

  /**
   * 午夜提醒：给所有已对接（有会话上下文）的用户发「请发送音浪文件」。
   * 由 main.js 调度器每天跨 0 点后调用一次；受 reminderEnabled 与 lastReminderDate 防重。
   */
  async sendMidnightReminder(text = "请发送音浪文件即可") {
    const push = normalizeDailyReportPushSettings(this.settings.dailyReportPush);
    if (!push.reminderEnabled) {
      return { sent: 0, fail: 0, skipped: "disabled", at: null };
    }
    const now = new Date();
    const todayKey = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    if (push.lastReminderDate === todayKey) {
      return { sent: 0, fail: 0, skipped: "already_sent", at: todayKey };
    }

    const targets = [];
    for (const contact of this.knownContacts.values()) {
      if (contact.kind !== "user") continue;
      const account = this.accounts.get(contact.accountId);
      if (!account?.credentials?.token) continue;
      const conversationId = String(contact.conversationId || contact.id);
      const context = this.contexts.get(accountScopedKey(contact.accountId, conversationId));
      if (!context?.contextToken) continue;
      targets.push({ conversationId, context, account });
    }

    let sent = 0;
    let fail = 0;
    if (targets.length) {
      if (!this.runnerLease) this._acquireRunnerLease();
      try {
        for (const target of targets) {
          try {
            await this._sendTextWithContext(
              target.conversationId,
              String(text).slice(0, 1000),
              target.context,
              target.account
            );
            sent += 1;
          } catch (error) {
            fail += 1;
            console.warn("[weixin-midnight-reminder] send failed", target.conversationId, error?.message || error);
          }
        }
      } finally {
        this._releaseRunnerLeaseIfIdle();
      }
    }

    const dailyReportPush = normalizeDailyReportPushSettings({
      ...push,
      lastReminderDate: todayKey,
    });
    this.settings = { ...this.settings, dailyReportPush };
    this._writeStore();
    return { sent, fail, skipped: sent ? null : "no_target", at: todayKey };
  }

  /**
   * 音浪数据更新后调用：防抖后向配置的微信用户/群推送每日之星（前三）+ 日报图。
   */
  notifyDailyReportDataUpdated(date, options = {}) {
    const day = String(date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return Promise.resolve({ ok: false, skipped: "invalid_date" });
    }
    const delayMs = Math.max(0, Number(options.delayMs ?? 2500) || 0);
    const existing = this._dailyPushTimers.get(day);
    if (existing) clearTimeout(existing);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._dailyPushTimers.delete(day);
        this._runDailyReportPush(day, options).then(resolve).catch((error) => {
          resolve({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, delayMs);
      this._dailyPushTimers.set(day, timer);
    });
  }

  async _runDailyReportPush(date, options = {}) {
    const push = normalizeDailyReportPushSettings(this.settings.dailyReportPush);
    if (!push.enabled && !options.force) {
      return { ok: true, skipped: "disabled", date };
    }

    const db = options.db || this.dailyPushDb;
    const renderReportPng = options.renderReportPng || this.dailyPushRenderReportPng;
    if (!db || typeof db.getDailyWaveReport !== "function") {
      return { ok: false, skipped: "no_db", date };
    }
    if (typeof renderReportPng !== "function") {
      return { ok: false, skipped: "no_renderer", date };
    }

    if (this._dailyPushInFlight.get(date)) {
      return this._dailyPushInFlight.get(date);
    }

    const task = this._deliverDailyReportPush(date, db, renderReportPng, options);
    this._dailyPushInFlight.set(date, task);
    try {
      return await task;
    } finally {
      this._dailyPushInFlight.delete(date);
    }
  }

  async _deliverDailyReportPush(date, db, renderReportPng, options = {}) {
    const account = options.accountId
      ? this.accounts.get(String(options.accountId))
      : this._getActiveAccount();
    if (!account?.credentials?.token) {
      return { ok: false, skipped: "not_connected", date };
    }
    const accountId = account.accountId;
    const push = normalizeDailyReportPushSettings(this.settings.dailyReportPush);

    // 用内部联系人（含 contextToken）
    const internalContacts = [...this.knownContacts.values()].filter((c) => c.accountId === accountId);
    const targets = resolveDailyPushTargets({
      accountId,
      contacts: internalContacts,
      contexts: this.contexts,
      accessPolicy: { accessMode: "open", allowUserIds: [], allowGroupIds: [] },
      pushSettings: push,
      accountScopedKey,
    });

    if (!targets.length) {
      const lastPush = {
        date,
        at: new Date().toISOString(),
        ok: 0,
        fail: 0,
        skipped: "no_targets",
      };
      this.settings = {
        ...this.settings,
        dailyReportPush: normalizeDailyReportPushSettings({ ...push, lastPush }),
      };
      this._writeStore();
      return { ok: true, skipped: "no_targets", date, targets: 0 };
    }

    let maleReport = null;
    let femaleReport = null;
    try {
      maleReport = await db.getDailyWaveReport(date, "male");
    } catch {
      maleReport = { rows: [] };
    }
    try {
      femaleReport = await db.getDailyWaveReport(date, "female");
    } catch {
      femaleReport = { rows: [] };
    }

    // 按团预渲染：每日之星文案 → 每日之星图 → 报告图
    const genderPayloads = [];
    const renderStar = typeof options.renderDailyStarPng === "function"
      ? options.renderDailyStarPng
      : renderDailyStarPng;
    for (const [gender, report] of [["male", maleReport], ["female", femaleReport]]) {
      const images = [];
      const starImages = [];
      const label = gender === "female" ? "女队" : "男团";
      if (report?.rows?.length) {
        try {
          const star = await renderStar(date, gender, report);
          if (star?.buffer?.length) {
            starImages.push({
              gender,
              buffer: star.buffer,
              fileName: star.fileName || `${date}_${label}_每日之星.png`,
              kind: "daily_star",
            });
          }
        } catch (error) {
          console.warn("[weixin-daily-push] daily-star render failed", gender, error);
        }
        try {
          // 人数过多时自动拆成最多两张，与桌面端/指令日报一致
          const pages = await toDailyReportImagePages(renderReportPng, report, {});
          for (const page of pages) {
            if (!page?.buffer?.length) continue;
            images.push({
              gender,
              buffer: page.buffer,
              fileName: `${date}_${label}_每日报告${page.fileNameSuffix || ""}.png`,
              pageIndex: page.pageIndex,
              pageCount: page.pageCount,
              kind: "daily_report",
            });
          }
        } catch (error) {
          // 单团失败不阻断另一团
          console.warn("[weixin-daily-push] render failed", gender, error);
        }
      }
      // 即使没有图片，也发每日之星文案（空则“暂无数据”）
      genderPayloads.push({
        gender,
        report,
        starImages,
        images,
        top3Text: buildGenderTop3Text(date, gender, report, {
          // 首团带日期标题
          withDate: genderPayloads.length === 0,
          namesOnly: true,
        }),
      });
    }
    const imageCount = genderPayloads.reduce((n, g) => n + g.images.length + (g.starImages?.length || 0), 0);

    if (!this.runnerLease) this._acquireRunnerLease();
    let ok = 0;
    let fail = 0;
    const errors = [];
    try {
      for (const target of targets) {
        const context = {
          accountId,
          contextToken: target.context.contextToken,
          toUserId: target.context.toUserId || (target.kind === "user" ? target.id : ""),
          groupId: target.groupId || null,
        };
        if (!context.contextToken || !context.toUserId) {
          fail += 1;
          errors.push(`${target.id}: missing context`);
          continue;
        }
        // 刷新内存 context
        this.contexts.set(accountScopedKey(accountId, target.conversationId), context);
        try {
          for (const payload of genderPayloads) {
            await this._sendTextWithContext(target.conversationId, payload.top3Text, context, account);
            for (const image of payload.starImages || []) {
              await this._sendMediaWithContext(
                target.conversationId,
                { buffer: image.buffer, fileName: image.fileName, mediaKind: "image" },
                context,
                account
              );
            }
            for (const image of payload.images) {
              await this._sendMediaWithContext(
                target.conversationId,
                { buffer: image.buffer, fileName: image.fileName, mediaKind: "image" },
                context,
                account
              );
            }
          }
          ok += 1;
        } catch (error) {
          fail += 1;
          errors.push(`${target.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      this._releaseRunnerLeaseIfIdle();
    }

    const lastPush = {
      date,
      at: new Date().toISOString(),
      ok,
      fail,
      skipped: null,
    };
    this.settings = {
      ...this.settings,
      dailyReportPush: normalizeDailyReportPushSettings({
        ...normalizeDailyReportPushSettings(this.settings.dailyReportPush),
        lastPush,
      }),
    };
    this._writeStore();
    return {
      ok: fail === 0,
      date,
      targets: targets.length,
      sent: ok,
      failed: fail,
      images: imageCount,
      errors: errors.slice(0, 5),
    };
  }

  _writeStore() {
    const file = this.storagePath();
    const accounts = [...this.accounts.values()].map((item) => ({
      encryptedToken: item.encryptedToken,
      accountId: item.accountId,
      userId: item.credentials.userId,
      baseUrl: item.credentials.baseUrl,
      savedAt: item.credentials.savedAt,
      updatesBuf: item.updatesBuf || "",
    }));
    const active = this._getActiveAccount();
    const data = {
      version: 4,
      settings: {
        autoReplyEnabled: this.settings.autoReplyEnabled,
        autoReplyText: this.settings.autoReplyText,
        accessMode: "open",
        allowUserIds: [],
        allowGroupIds: [],
        customCommands: this.settings.customCommands,
        dailyReportPush: normalizeDailyReportPushSettings(this.settings.dailyReportPush),
        ai: {
          enabled: this.settings.ai?.enabled !== false,
          baseUrl: String(this.settings.ai?.baseUrl || DEFAULT_AI_BASE_URL),
          model: String(this.settings.ai?.model || DEFAULT_AI_MODEL),
          timeoutMs: clampAiTimeoutMs(this.settings.ai?.timeoutMs, 90_000),
          maxToolRounds: Number(this.settings.ai?.maxToolRounds) || 4,
          progressEnabled: this.settings.ai?.progressEnabled !== false,
        },
      },
      defaultAccessPolicy: this.defaultAccessPolicy,
      accountPolicies: Object.fromEntries(
        [...this.accountPolicies.entries()].map(([accountId, policy]) => [
          accountId,
          normalizeAccessPolicy(policy),
        ])
      ),
      encryptedAiKey: this.encryptedAiKey || "",
      contacts: [...this.knownContacts.values()].map((item) => ({
        accountId: item.accountId,
        id: item.id,
        kind: item.kind === "group" ? "group" : "user",
        conversationId: item.conversationId,
        groupId: item.groupId || null,
        lastContent: item.lastContent || "",
        lastSeenAt: item.lastSeenAt || "",
        contextToken: item.contextToken || "",
        toUserId: item.toUserId || "",
      })),
      activeAccountId: this.activeAccountId,
      accounts,
      // 兼容旧版读取：保留当前活动账号快照
      updatesBuf: active?.updatesBuf || "",
      ...(active
        ? {
            credentials: {
              encryptedToken: active.encryptedToken,
              accountId: active.accountId,
              userId: active.credentials.userId,
              baseUrl: active.credentials.baseUrl,
              savedAt: active.credentials.savedAt,
            },
          }
        : {}),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempFile, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows does not implement POSIX file modes.
    }
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.getStatus());
  }

  _markSessionExpired(accountId) {
    const account = this._getAccount(accountId);
    if (account) {
      account.phase = "session_expired";
      account.error = "请重新扫码连接";
      account.monitorController?.abort();
    }
    this._refreshAggregateStatus({
      phase: "session_expired",
      monitoring: false,
      statusText: "微信登录已过期",
      error: "请重新扫码连接",
    });
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  WeixinBotService,
  extractMessagePreview,
  extractMessageText,
  normalizeBaseUrl,
};
