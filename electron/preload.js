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

  // 数据
  getAnchors: () => ipcRenderer.invoke("data:getAnchors"),
  getFamilyTree: () => ipcRenderer.invoke("data:getFamilyTree"),
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
  getFlagWinner: (period) => ipcRenderer.invoke("data:getFlagWinner", period),
  getRewardReport: (period, config) => ipcRenderer.invoke("data:getRewardReport", period, config),

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
