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
  getWaveRanking: (limit) => ipcRenderer.invoke("data:getWaveRanking", limit),
  getWaveTrendByGender: () => ipcRenderer.invoke("data:getWaveTrendByGender"),

  importWave: (date, rows) => ipcRenderer.invoke("data:importWave", date, rows),
  importDuration: (date, rows) =>
    ipcRenderer.invoke("data:importDuration", date, rows),
  exportWave: (date) => ipcRenderer.invoke("data:exportWave", date),
  exportDuration: (date) => ipcRenderer.invoke("data:exportDuration", date),
  exportAnchors: () => ipcRenderer.invoke("data:exportAnchors"),
});
