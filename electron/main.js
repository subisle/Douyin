const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const db = require("./db");
const { createUpdater } = require("./updater");

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:3000";
const APP_ICON_PNG = path.join(__dirname, "..", "assets", "icon.png");

/** @type {BrowserWindow | null} */
let mainWindow = null;
const updater = createUpdater({
  isDev,
  sendStatus: (status) => mainWindow?.webContents.send("updater:status-changed", status),
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    resizable: false,
    maximizable: false,
    fullScreenable: false,
    minWidth: 1280,
    minHeight: 800,
    maxWidth: 1280,
    maxHeight: 800,
    frame: false,
    backgroundColor: "#f5f3ee",
    icon: APP_ICON_PNG,
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

  // 安全加固：禁止应用内导航到非白名单地址，禁止打开新窗口。
  // 应用只应加载本地静态产物（file://）或开发期 localhost，
  // 任何指向外部 URL 的跳转/弹窗都拒绝，避免渲染进程被诱导加载外部内容。
  const isAllowedUrl = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol === "file:") return true;
      if (isDev && u.origin === new URL(DEV_URL).origin) return true;
      return false;
    } catch {
      return false;
    }
  };

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "out", "index.html"));
  }
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(APP_ICON_PNG);
  }
  createWindow();

  // 初始化自动更新（生产环境）
  updater.init();

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
ipcMain.handle("app:getInfo", () => ({
  name: app.getName(),
  version: app.getVersion(),
  productName: "抖音数据管理",
  isPackaged: app.isPackaged,
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  updateProxy: "github.akams.cn 节点测速",
}));

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
ipcMain.handle("data:getStartupHealth", wrap(() => db.getStartupHealth()));
ipcMain.handle("data:getWaveRanking", wrap((limit) => db.getWaveRanking(limit)));
ipcMain.handle("data:getWaveTrendByGender", wrap(() => db.getWaveTrendByGender()));

ipcMain.handle(
  "data:importWave",
  wrap((date, rows, meta) => db.importWaveSnapshots(date, rows, meta))
);
ipcMain.handle(
  "data:importDuration",
  wrap((date, rows, meta) => db.importDurationSnapshots(date, rows, meta))
);
ipcMain.handle(
  "data:getImportPreview",
  wrap((kind, date, anchorIds, meta) => db.getImportPreview(kind, date, anchorIds, meta))
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
  "data:updateAnchorInfo",
  wrap((payload) => db.updateAnchorInfo(payload))
);
ipcMain.handle(
  "data:updateAnchorMaster",
  wrap((payload) => db.updateAnchorMaster(payload))
);
ipcMain.handle(
  "data:getAnchorDailySnapshot",
  wrap((anchorId, date) => db.getAnchorDailySnapshot(anchorId, date))
);
ipcMain.handle(
  "data:saveAnchorDailySnapshot",
  wrap((payload) => db.saveAnchorDailySnapshot(payload))
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
ipcMain.handle(
  "data:getFlagWinner",
  wrap((period) => db.getFlagWinner(period))
);
ipcMain.handle(
  "data:getRewardReport",
  wrap((period, config) => db.getRewardReport(period, config))
);

// ── 自动更新 IPC ──────────────────────────────────────────
ipcMain.handle("updater:check", async () => {
  try {
    return { success: true, data: await updater.check() };
  } catch (error) {
    console.error("[updater] 手动检查更新失败:", error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("updater:download", async () => {
  try {
    return { success: true, data: await updater.download() };
  } catch (error) {
    console.error("[updater] 下载更新失败:", error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("updater:install", async () => {
  try {
    return { success: true, data: updater.install() };
  } catch (error) {
    console.error("[updater] 安装更新失败:", error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("updater:status", async () => {
  return { success: true, data: updater.getStatus() };
});
