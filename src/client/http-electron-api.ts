import type { IpcResult } from "@/types/electron";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: string | { code?: string; message?: string; detail?: unknown } };

function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function enc(value: string | number) {
  return encodeURIComponent(String(value));
}

function normalizeError(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : String(error || "请求失败");
}

function apiBaseUrl() {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  return base.replace(/\/$/, "");
}

async function request<T>(
  path: string,
  options: { method?: HttpMethod; body?: unknown } = {}
): Promise<IpcResult<T>> {
  try {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(`${apiBaseUrl()}/api/v1${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!response.ok) {
      return {
        success: false,
        error: normalizeError(payload?.success === false ? payload.error : `HTTP ${response.status}`),
      };
    }
    if (!payload) return { success: false, error: "响应为空" };
    if (!payload.success) return { success: false, error: normalizeError(payload.error) };
    return { success: true, data: payload.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const noopAsync = async () => undefined;

const WEB_QQ_STATUS = {
  channel: "qqbot" as const,
  phase: "idle" as const,
  connected: false,
  error: "Web 模式不支持 QQ 机器人，请使用桌面端",
  hasCredentials: false,
  messageCount: 0,
};

const WEB_QQ_SETTINGS = {
  appId: "",
  clientSecret: "",
  apiBase: "https://api.sgroup.qq.com",
  intents: 1 << 25,
  autoConnect: false,
  autoReplyEnabled: false,
  autoReplyText: "消息已收到。",
  accessMode: "allowlist" as const,
  allowUserIds: [] as string[],
  allowGroupIds: [] as string[],
};
const WEB_WEIXIN_STATUS = {
  available: false,
  phase: "disconnected" as const,
  connected: false,
  monitoring: false,
  accountId: null,
  userId: null,
  baseUrl: "",
  savedAt: null,
  qrDataUrl: null,
  qrExpiresAt: null,
  statusText: "微信机器人仅支持桌面端",
  lastPollAt: null,
  lastMessageAt: null,
  error: null,
  receivedCount: 0,
  sentCount: 0,
  accounts: [] as [],
};

const WEB_WEIXIN_SETTINGS = {
  accountId: null,
  autoReplyEnabled: false,
  autoReplyText: "消息已收到。",
  accessMode: "allowlist" as const,
  allowUserIds: [] as string[],
  allowGroupIds: [] as string[],
  customCommands: [] as [],
  ai: {
    enabled: false,
    baseUrl: "http://162.243.93.40:8317/v1",
    model: "grok-4.5",
    timeoutMs: 90_000,
    maxToolRounds: 4,
    progressEnabled: true,
    hasApiKey: false,
  },
  contacts: [] as [],
  dailyReportPush: {
    enabled: false,
    adminUserIds: [] as string[],
    recipientUserIds: [] as string[],
    recipientGroupIds: [] as string[],
    lastPush: null,
  },
};

export function createHttpElectronApi(): ElectronAPI {
  return {
    windowMinimize: noopAsync,
    windowMaximize: async () => false,
    windowClose: noopAsync,
    windowIsMaximized: async () => false,
    onMaximizeChange: () => () => undefined,
    getAppInfo: () =>
      Promise.resolve({
        name: "douyin-web",
        version: "web",
        productName: "抖音数据管理 Web",
        isPackaged: false,
        platform: "web",
        arch: "web",
        electron: "none",
        updateProxy: "",
      }),
    startLivePkMonitor: () =>
      Promise.resolve({
        success: false,
        error: "浏览器预览模式不支持直播监控",
      }),
    openLivePkEmbeddedMonitor: () =>
      Promise.resolve({
        success: false,
        error: "浏览器预览模式不支持内嵌直播监控",
      }),
    setLivePkEmbeddedBounds: () =>
      Promise.resolve({
        success: true,
        data: { embedded: false, liveRoomUrl: "" },
      }),
    closeLivePkEmbeddedMonitor: () =>
      Promise.resolve({
        success: true,
        data: { status: "idle", startedAt: null, lastError: null, lastRankAt: null },
      }),
    reloadLivePkEmbeddedView: () =>
      Promise.resolve({
        success: false,
        error: "浏览器预览模式不支持内嵌直播监控",
      }),
    setLivePkEmbeddedMuted: (muted) =>
      Promise.resolve({
        success: true,
        data: { muted },
      }),
    onLivePkEmbeddedState: () => () => undefined,
    startLivePkMonitorFromUrl: () =>
      Promise.resolve({
        success: false,
        error: "浏览器预览模式不支持内置直播监控",
      }),
    stopLivePkMonitor: () =>
      Promise.resolve({
        success: true,
        data: { status: "idle", startedAt: null, lastError: null, lastRankAt: null },
      }),
    getLivePkMonitorStatus: () =>
      Promise.resolve({
        success: true,
        data: { status: "idle", startedAt: null, lastError: null, lastRankAt: null },
      }),
    startLivePkMultiMonitor: () =>
      Promise.resolve({
        success: false,
        error: "浏览器预览模式不支持多主播监控",
      }),
    stopLivePkMultiMonitor: () =>
      Promise.resolve({
        success: true,
        data: {
          status: "idle",
          roomCount: 0,
          runningCount: 0,
          pendingCount: 0,
          errorCount: 0,
          maxRooms: 0,
          captureConcurrency: 0,
          preferProtocol: true,
          scoreOnly: true,
          updatedAt: new Date().toISOString(),
          rooms: [],
        },
      }),
    getLivePkMultiMonitorStatus: () =>
      Promise.resolve({
        success: true,
        data: {
          status: "idle",
          roomCount: 0,
          runningCount: 0,
          pendingCount: 0,
          errorCount: 0,
          maxRooms: 0,
          captureConcurrency: 0,
          preferProtocol: true,
          scoreOnly: true,
          updatedAt: new Date().toISOString(),
          rooms: [],
        },
      }),
    onLivePkMultiStatus: () => () => undefined,
    saveLivePkCookie: () =>
      Promise.resolve({
        success: false,
        error: "浏览器预览模式不支持保存直播 Cookie",
      }),
    readLivePkCookie: () =>
      Promise.resolve({
        success: true,
        data: { saved: false, cookie: "", updatedAt: null },
      }),
    clearLivePkCookie: () =>
      Promise.resolve({
        success: true,
        data: { saved: false },
      }),
    onLivePkStatus: () => () => undefined,
    onLivePkRank: () => () => undefined,
    onLivePkGift: () => () => undefined,
    onLivePkMember: () => () => undefined,
    onLivePkChat: () => () => undefined,
    onLivePkEvent: () => () => undefined,
    onLivePkError: () => () => undefined,
    onLivePkCaptureStatus: () => () => undefined,

    getWeixinBotStatus: () => Promise.resolve({ success: true, data: WEB_WEIXIN_STATUS }),
    getWeixinBotMessages: () => Promise.resolve({ success: true, data: [] }),
    getWeixinBotSettings: () => Promise.resolve({ success: true, data: WEB_WEIXIN_SETTINGS }),
    startWeixinBotLogin: () =>
      Promise.resolve({ success: false, error: "浏览器预览模式不支持微信机器人" }),
    cancelWeixinBotLogin: () => Promise.resolve({ success: true, data: WEB_WEIXIN_STATUS }),
    startWeixinBot: () =>
      Promise.resolve({ success: false, error: "浏览器预览模式不支持微信机器人" }),
    stopWeixinBot: () => Promise.resolve({ success: true, data: WEB_WEIXIN_STATUS }),
    disconnectWeixinBot: () => Promise.resolve({ success: true, data: WEB_WEIXIN_STATUS }),
    setActiveWeixinBotAccount: () => Promise.resolve({ success: true, data: WEB_WEIXIN_STATUS }),
    sendWeixinBotMessage: () =>
      Promise.resolve({ success: false, error: "浏览器预览模式不支持微信机器人" }),
    saveWeixinBotSettings: (payload) =>
      Promise.resolve({
        success: true,
        data: {
          ...WEB_WEIXIN_SETTINGS,
          ...payload,
          customCommands: payload.customCommands ?? WEB_WEIXIN_SETTINGS.customCommands,
          allowUserIds: payload.allowUserIds ?? WEB_WEIXIN_SETTINGS.allowUserIds,
          allowGroupIds: payload.allowGroupIds ?? WEB_WEIXIN_SETTINGS.allowGroupIds,
          ai: {
            ...WEB_WEIXIN_SETTINGS.ai,
            ...(payload.ai || {}),
            hasApiKey: Boolean(
              (payload.ai && "apiKey" in payload.ai && payload.ai.apiKey)
                || (payload.ai?.clearApiKey ? false : WEB_WEIXIN_SETTINGS.ai.hasApiKey)
            ),
            apiKey: undefined,
            clearApiKey: undefined,
          },
          contacts: WEB_WEIXIN_SETTINGS.contacts,
          dailyReportPush: {
            ...WEB_WEIXIN_SETTINGS.dailyReportPush,
            ...(payload.dailyReportPush || {}),
            adminUserIds:
              payload.dailyReportPush?.adminUserIds
              ?? WEB_WEIXIN_SETTINGS.dailyReportPush.adminUserIds,
            recipientUserIds:
              payload.dailyReportPush?.recipientUserIds
              ?? WEB_WEIXIN_SETTINGS.dailyReportPush.recipientUserIds,
            recipientGroupIds:
              payload.dailyReportPush?.recipientGroupIds
              ?? WEB_WEIXIN_SETTINGS.dailyReportPush.recipientGroupIds,
            lastPush:
              payload.dailyReportPush && "lastPush" in payload.dailyReportPush
                ? payload.dailyReportPush.lastPush ?? null
                : WEB_WEIXIN_SETTINGS.dailyReportPush.lastPush,
          },
        },
      }),
    clearWeixinBotMessages: () => Promise.resolve({ success: true, data: { cleared: true } }),
    onWeixinBotStatus: () => () => undefined,
    onWeixinBotMessage: () => () => undefined,
    onWeixinBotMessagesCleared: () => () => undefined,
    getQqBotStatus: () => Promise.resolve({ success: true, data: WEB_QQ_STATUS }),
    getQqBotMessages: () => Promise.resolve({ success: true, data: [] }),
    getQqBotSettings: () => Promise.resolve({ success: true, data: WEB_QQ_SETTINGS }),
    saveQqBotSettings: () =>
      Promise.resolve({ success: false, error: "Web 模式不支持 QQ 机器人" }),
    connectQqBot: () =>
      Promise.resolve({ success: false, error: "Web 模式不支持 QQ 机器人，请使用桌面端" }),
    disconnectQqBot: () => Promise.resolve({ success: true, data: WEB_QQ_STATUS }),
    clearQqBotMessages: () => Promise.resolve({ success: true, data: { cleared: true } }),
    onQqBotStatus: () => () => undefined,
    onQqBotMessage: () => () => undefined,
    onQqBotMessagesCleared: () => () => undefined,

    getAnchors: () => request("/anchors"),
    getFamilyTree: () => request("/family-tree"),
    getRosterBySurname: (surname: string) => request(`/roster/${encodeURIComponent(surname)}`),
    exportFamilyRoster: () => request("/exports/family-roster"),
    getDashboardSummary: () => request("/dashboard/summary"),
    getStartupHealth: () => request("/startup-health"),
    getWaveRanking: (limit) => request(`/dashboard/wave-ranking${qs({ limit })}`),
    getWaveTrendByGender: () => request("/dashboard/wave-trend-by-gender"),
    importWave: (date, rows, meta) =>
      request("/imports/wave", { method: "POST", body: { date, rows, meta } }),
    importDuration: (date, rows, meta) =>
      request("/imports/duration", { method: "POST", body: { date, rows, meta } }),
    getImportPreview: (kind, date, anchorIds, meta) =>
      request("/imports/preview", { method: "POST", body: { kind, date, anchorIds, meta } }),
    exportWave: (date) => request(`/exports/wave${qs({ date })}`),
    exportDuration: (date) => request(`/exports/duration${qs({ date })}`),
    exportAnchors: () => request("/exports/anchors"),
    addAnchor: (payload) => request("/anchors", { method: "POST", body: payload }),
    batchImportAnchors: (rows) => request("/anchors/batch-import", { method: "POST", body: { rows } }),
    mergeAccounts: (payload) => request("/anchors/merge-accounts", { method: "POST", body: payload }),
    deleteAnchors: (personIds) => request("/anchors", { method: "DELETE", body: { ids: personIds } }),
    findDuplicateAnchors: () => request("/anchors/duplicates"),
    getWaveTrendTotal: () => request("/dashboard/wave-trend-total"),
    getAnchorCountTrend: () => request("/dashboard/anchor-count-trend"),
    updateAnchorName: (payload) =>
      request(`/anchors/${enc(payload.personId)}/name`, { method: "PATCH", body: payload }),
    updateAnchorInfo: (payload) =>
      request(`/anchors/${enc(payload.personId)}`, { method: "PATCH", body: payload }),
    updateAnchorMaster: (payload) =>
      request(`/anchors/${enc(payload.personId)}/master`, { method: "PATCH", body: payload }),
    getAnchorDailySnapshot: (anchorId, date) =>
      request(`/anchors/${enc(anchorId)}/daily-snapshot${qs({ date })}`),
    saveAnchorDailySnapshot: (payload) =>
      request(`/anchors/${enc(payload.anchorId)}/daily-snapshot`, { method: "PUT", body: payload }),
    getAnchorWaveTrend: (anchorId) => request(`/anchors/${enc(anchorId)}/wave-trend`),
    getAnchorsWaveTrend: (anchorIds) => request(`/anchors-wave-trend${qs({ ids: anchorIds.join(",") })}`),
    getFlowingFlag: (personId) => request(`/flags/person/${enc(personId)}`),
    getFlagGroups: (period) => request(`/flags/groups${qs({ period })}`),
    settleFlagScores: (period) => request("/flags/settle", { method: "POST", body: { period } }),
    getTierRules: () => request("/reports/tier-rules"),
    saveTierRules: (rules) => request("/reports/tier-rules", { method: "PUT", body: { rules } }),
    getDailyWaveReport: (date, gender) => request(`/reports/daily-wave${qs({ date, gender })}`),
    getPkRoster: (period, groupSize) => request(`/pk/roster${qs({ period, groupSize })}`),
    buildPkGroups: (payload) => request("/pk/groups", { method: "POST", body: payload }),
    getStarBattleScores: (period) => request(`/star-battle/scores${qs({ period })}`),
    saveStarBattleScore: (payload) =>
      request("/star-battle/scores", { method: "POST", body: payload }),
    getFlagWinner: (period) => request(`/flags/winner${qs({ period })}`),
    getRewardReport: (period, config) => {
      if (config) return request("/rewards/report", { method: "POST", body: { period, config } });
      return request(`/rewards/report${qs({ period })}`);
    },

    // ── 应用密码锁（Web 模式 stub）──
    verifyAppPassword: () => Promise.resolve({ success: true, data: { ok: true, role: "admin" as const } }),
    hasAppPassword: () => Promise.resolve({ success: true, data: { hasPassword: false } }),

    checkForUpdates: () => Promise.resolve({ success: true, data: { status: "web-unavailable" } }),
    downloadUpdate: () => Promise.resolve({ success: true, data: { status: "web-unavailable" } }),
    installUpdate: () => Promise.resolve({ success: true, data: { status: "web-unavailable" } }),
    getUpdateStatus: () =>
      Promise.resolve({
        success: true,
        data: {
          status: "idle",
          info: null,
          progress: null,
          error: null,
          feed: null,
          checkedAt: null,
        },
      }),
    onUpdateStatus: () => () => undefined,
  };
}

let httpApi: ElectronAPI | null = null;
let hybridApi: ElectronAPI | null = null;

function getHttpApi(): ElectronAPI {
  if (!httpApi) httpApi = createHttpElectronApi();
  return httpApi;
}

/**
 * Electron preload 只在进程启动时注入一次。
 * 开发中若热更了前端但没重启 Electron，window.electronAPI 会缺新方法。
 * 这里对缺失方法自动回退到 HTTP API（Next /api/v1），避免 "is not a function"。
 */
function createHybridApi(electronApi: ElectronAPI): ElectronAPI {
  const http = getHttpApi();
  return new Proxy(electronApi, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      const value = Reflect.get(target, prop, receiver);
      if (value !== undefined && value !== null) return value;
      const fallback = Reflect.get(http, prop, http);
      return fallback;
    },
  }) as ElectronAPI;
}

export function getDataApi(): ElectronAPI | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.electronAPI) {
    if (!hybridApi) hybridApi = createHybridApi(window.electronAPI);
    return hybridApi;
  }
  return getHttpApi();
}
