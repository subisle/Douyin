const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowMaximize: () => ipcRenderer.invoke("window:maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  windowIsMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  onMaximizeChange: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("window:maximized-changed", handler);
    return () => ipcRenderer.removeListener("window:maximized-changed", handler);
  },
  getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
  startLivePkMonitor: (payload) => ipcRenderer.invoke("live-pk:start", payload),
  openLivePkEmbeddedMonitor: (payload) => ipcRenderer.invoke("live-pk:embed-open", payload),
  setLivePkEmbeddedBounds: (bounds) => ipcRenderer.invoke("live-pk:embed-bounds", bounds),
  closeLivePkEmbeddedMonitor: (payload) => ipcRenderer.invoke("live-pk:embed-close", payload),
  reloadLivePkEmbeddedView: () => ipcRenderer.invoke("live-pk:embed-reload"),
  setLivePkEmbeddedMuted: (muted) => ipcRenderer.invoke("live-pk:embed-muted", muted),
  onLivePkEmbeddedState: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live-pk:embed-state", handler);
    return () => ipcRenderer.removeListener("live-pk:embed-state", handler);
  },
  startLivePkMonitorFromUrl: (payload) => ipcRenderer.invoke("live-pk:start-from-url", payload),
  stopLivePkMonitor: () => ipcRenderer.invoke("live-pk:stop"),
  getLivePkMonitorStatus: () => ipcRenderer.invoke("live-pk:status"),
  startLivePkMultiMonitor: (payload) => ipcRenderer.invoke("live-pk:multi-start", payload),
  stopLivePkMultiMonitor: (payload) => ipcRenderer.invoke("live-pk:multi-stop", payload),
  getLivePkMultiMonitorStatus: () => ipcRenderer.invoke("live-pk:multi-status"),
  onLivePkMultiStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("live-pk:multi-status", handler);
    return () => ipcRenderer.removeListener("live-pk:multi-status", handler);
  },
  saveLivePkCookie: (cookie) => ipcRenderer.invoke("live-pk:cookie-save", cookie),
  readLivePkCookie: () => ipcRenderer.invoke("live-pk:cookie-read"),
  clearLivePkCookie: () => ipcRenderer.invoke("live-pk:cookie-clear"),
  onLivePkStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("live-pk:status-changed", handler);
    return () => ipcRenderer.removeListener("live-pk:status-changed", handler);
  },
  onLivePkRank: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live-pk:rank", handler);
    return () => ipcRenderer.removeListener("live-pk:rank", handler);
  },
  onLivePkGift: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live-pk:gift", handler);
    return () => ipcRenderer.removeListener("live-pk:gift", handler);
  },
  onLivePkMember: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live-pk:member", handler);
    return () => ipcRenderer.removeListener("live-pk:member", handler);
  },
  onLivePkChat: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live-pk:chat", handler);
    return () => ipcRenderer.removeListener("live-pk:chat", handler);
  },
  onLivePkEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live-pk:event", handler);
    return () => ipcRenderer.removeListener("live-pk:event", handler);
  },
  onLivePkError: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("live-pk:error", handler);
    return () => ipcRenderer.removeListener("live-pk:error", handler);
  },
  onLivePkCaptureStatus: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("live-pk:capture-status", handler);
    return () => ipcRenderer.removeListener("live-pk:capture-status", handler);
  },

  // 微信机器人
  getWeixinBotStatus: () => ipcRenderer.invoke("weixin-bot:status"),
  getWeixinBotMessages: () => ipcRenderer.invoke("weixin-bot:messages"),
  getWeixinBotSettings: (accountId) => ipcRenderer.invoke("weixin-bot:settings", accountId),
  startWeixinBotLogin: () => ipcRenderer.invoke("weixin-bot:login"),
  cancelWeixinBotLogin: () => ipcRenderer.invoke("weixin-bot:login-cancel"),
  startWeixinBot: (accountId) => ipcRenderer.invoke("weixin-bot:start", accountId),
  stopWeixinBot: (accountId) => ipcRenderer.invoke("weixin-bot:stop", accountId),
  disconnectWeixinBot: (accountId) => ipcRenderer.invoke("weixin-bot:disconnect", accountId),
  setActiveWeixinBotAccount: (accountId) => ipcRenderer.invoke("weixin-bot:set-active-account", accountId),
  sendWeixinBotMessage: (payload) => ipcRenderer.invoke("weixin-bot:send", payload),
  saveWeixinBotSettings: (payload) => ipcRenderer.invoke("weixin-bot:save-settings", payload),
  clearWeixinBotMessages: () => ipcRenderer.invoke("weixin-bot:clear-messages"),
  onWeixinBotStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("weixin-bot:status-changed", handler);
    return () => ipcRenderer.removeListener("weixin-bot:status-changed", handler);
  },
  onWeixinBotMessage: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("weixin-bot:message", handler);
    return () => ipcRenderer.removeListener("weixin-bot:message", handler);
  },
  onWeixinBotMessagesCleared: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("weixin-bot:messages-cleared", handler);
    return () => ipcRenderer.removeListener("weixin-bot:messages-cleared", handler);
  },
  getQqBotStatus: () => ipcRenderer.invoke("qq-bot:status"),
  getQqBotMessages: () => ipcRenderer.invoke("qq-bot:messages"),
  getQqBotSettings: () => ipcRenderer.invoke("qq-bot:settings"),
  saveQqBotSettings: (payload) => ipcRenderer.invoke("qq-bot:save-settings", payload),
  connectQqBot: () => ipcRenderer.invoke("qq-bot:connect"),
  disconnectQqBot: () => ipcRenderer.invoke("qq-bot:disconnect"),
  clearQqBotMessages: () => ipcRenderer.invoke("qq-bot:clear-messages"),
  onQqBotStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("qq-bot:status-changed", handler);
    return () => ipcRenderer.removeListener("qq-bot:status-changed", handler);
  },
  onQqBotMessage: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("qq-bot:message", handler);
    return () => ipcRenderer.removeListener("qq-bot:message", handler);
  },
  onQqBotMessagesCleared: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("qq-bot:messages-cleared", handler);
    return () => ipcRenderer.removeListener("qq-bot:messages-cleared", handler);
  },

  // 数据
  getAnchors: () => ipcRenderer.invoke("data:getAnchors"),
  getFamilyTree: () => ipcRenderer.invoke("data:getFamilyTree"),
  getRosterBySurname: (surname) => ipcRenderer.invoke("data:getRosterBySurname", surname),
  exportFamilyRoster: () => ipcRenderer.invoke("data:exportFamilyRoster"),
  getDashboardSummary: () => ipcRenderer.invoke("data:getDashboardSummary"),
  getStartupHealth: () => ipcRenderer.invoke("data:getStartupHealth"),
  getWaveRanking: (limit) => ipcRenderer.invoke("data:getWaveRanking", limit),
  getWaveTrendByGender: () => ipcRenderer.invoke("data:getWaveTrendByGender"),

  importWave: (date, rows, meta) => ipcRenderer.invoke("data:importWave", date, rows, meta),
  importDuration: (date, rows, meta) =>
    ipcRenderer.invoke("data:importDuration", date, rows, meta),
  getImportPreview: (kind, date, anchorIds, meta) =>
    ipcRenderer.invoke("data:getImportPreview", kind, date, anchorIds, meta),
  exportWave: (date) => ipcRenderer.invoke("data:exportWave", date),
  exportDuration: (date) => ipcRenderer.invoke("data:exportDuration", date),
  exportAnchors: () => ipcRenderer.invoke("data:exportAnchors"),
  addAnchor: (payload) => ipcRenderer.invoke("data:addAnchor", payload),
  batchImportAnchors: (rows) => ipcRenderer.invoke("data:batchImportAnchors", rows),
  mergeAccounts: (payload) => ipcRenderer.invoke("data:mergeAccounts", payload),
  deleteAnchors: (personIds) => ipcRenderer.invoke("data:deleteAnchors", personIds),
  findDuplicateAnchors: () => ipcRenderer.invoke("data:findDuplicateAnchors"),
  getWaveTrendTotal: () => ipcRenderer.invoke("data:getWaveTrendTotal"),
  getAnchorCountTrend: () => ipcRenderer.invoke("data:getAnchorCountTrend"),
  updateAnchorName: (payload) => ipcRenderer.invoke("data:updateAnchorName", payload),
  updateAnchorInfo: (payload) => ipcRenderer.invoke("data:updateAnchorInfo", payload),
  updateAnchorMaster: (payload) => ipcRenderer.invoke("data:updateAnchorMaster", payload),
  getAnchorDailySnapshot: (anchorId, date) =>
    ipcRenderer.invoke("data:getAnchorDailySnapshot", anchorId, date),
  saveAnchorDailySnapshot: (payload) => ipcRenderer.invoke("data:saveAnchorDailySnapshot", payload),
  getAnchorWaveTrend: (anchorId) => ipcRenderer.invoke("data:getAnchorWaveTrend", anchorId),
  getAnchorsWaveTrend: (anchorIds) => ipcRenderer.invoke("data:getAnchorsWaveTrend", anchorIds),
  getFlowingFlag: (personId) => ipcRenderer.invoke("data:getFlowingFlag", personId),
  getFlagGroups: (period) => ipcRenderer.invoke("data:getFlagGroups", period),
  settleFlagScores: (period) => ipcRenderer.invoke("data:settleFlagScores", period),
  getTierRules: () => ipcRenderer.invoke("data:getTierRules"),
  saveTierRules: (rules) => ipcRenderer.invoke("data:saveTierRules", rules),
  getDailyWaveReport: (date, gender) => ipcRenderer.invoke("data:getDailyWaveReport", date, gender),
  getPkRoster: (period, groupSize) => ipcRenderer.invoke("data:getPkRoster", period, groupSize),
  buildPkGroups: (payload) => ipcRenderer.invoke("data:buildPkGroups", payload),
  getStarBattleScores: (period) => ipcRenderer.invoke("data:getStarBattleScores", period),
  saveStarBattleScore: (payload) => ipcRenderer.invoke("data:saveStarBattleScore", payload),
  getFlagWinner: (period) => ipcRenderer.invoke("data:getFlagWinner", period),
  getRewardReport: (period, config) => ipcRenderer.invoke("data:getRewardReport", period, config),

  // ── 应用密码锁 ──
  verifyAppPassword: (password) => ipcRenderer.invoke("auth:verifyPassword", password),
  hasAppPassword: () => ipcRenderer.invoke("auth:hasPassword"),

  // ── 自动更新 ──
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  downloadUpdate: () => ipcRenderer.invoke("updater:download"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  getUpdateStatus: () => ipcRenderer.invoke("updater:status"),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("updater:status-changed", handler);
    return () => ipcRenderer.removeListener("updater:status-changed", handler);
  },
});
