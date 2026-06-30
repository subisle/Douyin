const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const db = require("./db");

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:3000";

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: "#f5f3ee",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const emitMaximizeState = () => {
    mainWindow?.webContents.send(
      "window:maximized-changed",
      mainWindow?.isMaximized() ?? false
    );
  };
  mainWindow.on("maximize", emitMaximizeState);
  mainWindow.on("unmaximize", emitMaximizeState);

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "out", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 窗口控制 IPC
ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle("window:close", () => mainWindow?.close());
ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);

// 数据 IPC：统一返回 { success, data?, error? }
function wrap(fn) {
  return async (_event, ...args) => {
    try {
      return { success: true, data: await fn(...args) };
    } catch (error) {
      console.error("[ipc]", error);
      return { success: false, error: error?.message || String(error) };
    }
  };
}

ipcMain.handle("data:getAnchors", wrap(() => db.getAnchors()));
ipcMain.handle("data:getFamilyTree", wrap(() => db.getFamilyTree()));
ipcMain.handle("data:getDashboardSummary", wrap(() => db.getDashboardSummary()));
ipcMain.handle("data:getWaveRanking", wrap((limit) => db.getWaveRanking(limit)));
ipcMain.handle("data:getWaveTrendByGender", wrap(() => db.getWaveTrendByGender()));

ipcMain.handle(
  "data:importWave",
  wrap((date, rows) => db.importWaveSnapshots(date, rows))
);
ipcMain.handle(
  "data:importDuration",
  wrap((date, rows) => db.importDurationSnapshots(date, rows))
);
ipcMain.handle(
  "data:exportWave",
  wrap((date) => db.exportWaveSnapshots(date))
);
ipcMain.handle(
  "data:exportDuration",
  wrap((date) => db.exportDurationSnapshots(date))
);
ipcMain.handle("data:exportAnchors", wrap(() => db.exportAnchors()));
ipcMain.handle("data:addAnchor", wrap((payload) => db.addAnchor(payload)));
ipcMain.handle("data:batchImportAnchors", wrap((rows) => db.batchImportAnchors(rows)));
ipcMain.handle(
  "data:mergeAccounts",
  wrap((payload) => db.mergeAccounts(payload))
);
ipcMain.handle(
  "data:deleteAnchors",
  wrap((personIds) => db.deleteAnchors(personIds))
);
ipcMain.handle(
  "data:findDuplicateAnchors",
  wrap(() => db.findDuplicateAnchors())
);
ipcMain.handle("data:getWaveTrendTotal", wrap(() => db.getWaveTrendTotal()));
ipcMain.handle(
  "data:getAnchorCountTrend",
  wrap(() => db.getAnchorCountTrend())
);
ipcMain.handle(
  "data:updateAnchorName",
  wrap((payload) => db.updateAnchorName(payload))
);
ipcMain.handle(
  "data:getAnchorWaveTrend",
  wrap((anchorId) => db.getAnchorWaveTrend(anchorId))
);
ipcMain.handle(
  "data:getAnchorsWaveTrend",
  wrap((anchorIds) => db.getAnchorsWaveTrend(anchorIds))
);
ipcMain.handle(
  "data:getFlowingFlag",
  wrap((personId) => db.getFlowingFlag(personId))
);
ipcMain.handle(
  "data:getFlagGroups",
  wrap((period) => db.getFlagGroups(period))
);
ipcMain.handle(
  "data:settleFlagScores",
  wrap((period) => db.settleFlagScores(period))
);
ipcMain.handle("data:getTierRules", wrap(() => db.getTierRules()));
ipcMain.handle(
  "data:saveTierRules",
  wrap((rules) => db.saveTierRules(rules))
);
ipcMain.handle(
  "data:getDailyWaveReport",
  wrap((date, gender) => db.getDailyWaveReport(date, gender))
);
ipcMain.handle(
  "data:getPkRoster",
  wrap((period, groupSize) => db.getPkRoster(period, groupSize))
);
