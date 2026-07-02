const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const db = require("./db");

// ── 自动更新 ──────────────────────────────────────────────
const { autoUpdater } = require("electron-updater");

// GitHub 代理前缀，用于加速国内访问
const GITHUB_PROXY = "https://github.akams.cn/";
// 发布仓库地址（原始 GitHub URL）
const REPO_URL = "https://github.com/subisle/douyin-updater";
// 通过代理访问的 release URL
const PROXY_REPO_URL = GITHUB_PROXY + REPO_URL;

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:3000";

/** 当前更新状态，供渲染进程查询 */
let updateStatus = {
  status: "idle", // idle | checking | available | not-available | downloading | downloaded | error
  info: null, // 更新信息（版本号等）
  progress: null, // 下载进度 { percent, transferred, total, bytesPerSecond }
  error: null, // 错误信息
};

/** 将更新状态发送到渲染进程 */
function sendUpdateStatus() {
  mainWindow?.webContents.send("updater:status-changed", { ...updateStatus });
}

/** 设置更新状态并通知渲染进程 */
function setUpdateStatus(partial) {
  updateStatus = { ...updateStatus, ...partial };
  sendUpdateStatus();
}

/** 初始化自动更新 */
function initAutoUpdater() {
  if (isDev) {
    console.log("[updater] 开发模式，跳过自动更新初始化");
    return;
  }

  // 使用 generic provider，URL 指向代理地址
  autoUpdater.setFeedURL({
    provider: "generic",
    url: PROXY_REPO_URL + "/releases/latest/download",
  });

  // 不自动下载，由用户确认
  autoUpdater.autoDownload = true;
  // 不自动安装，由用户确认
  autoUpdater.autoInstallOnAppQuit = false;

  // ── 事件监听 ──
  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] 正在检查更新…");
    setUpdateStatus({ status: "checking", info: null, error: null });
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] 发现新版本:", info.version);
    setUpdateStatus({
      status: "available",
      info: { version: info.version, releaseDate: info.releaseDate, releaseNotes: info.releaseNotes },
      error: null,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("[updater] 当前已是最新版本");
    setUpdateStatus({ status: "not-available", info: null, error: null });
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`[updater] 下载进度: ${progress.percent.toFixed(1)}%`);
    setUpdateStatus({
      status: "downloading",
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      },
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] 更新已下载，等待安装");
    setUpdateStatus({
      status: "downloaded",
      info: { version: info.version, releaseDate: info.releaseDate, releaseNotes: info.releaseNotes },
      error: null,
    });
  });

  autoUpdater.on("error", (error) => {
    console.error("[updater] 更新错误:", error?.message || error);
    setUpdateStatus({ status: "error", error: error?.message || String(error) });
  });

  // 启动时延迟检查更新（等待网络就绪）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[updater] 检查更新失败:", err?.message || err);
    });
  }, 5000);

  // 每小时定时检查更新
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error("[updater] 定时检查更新失败:", err?.message || err);
      });
    },
    60 * 60 * 1000
  );
}

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
  createWindow();

  // 初始化自动更新（生产环境）
  initAutoUpdater();

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
ipcMain.handle(
  "data:getFlagWinner",
  wrap((period) => db.getFlagWinner(period))
);

// ── 自动更新 IPC ──────────────────────────────────────────
ipcMain.handle("updater:check", async () => {
  try {
    if (isDev) {
      return { success: true, data: { status: "idle" } };
    }
    await autoUpdater.checkForUpdates();
    return { success: true, data: { status: updateStatus.status } };
  } catch (error) {
    console.error("[updater] 手动检查更新失败:", error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("updater:download", async () => {
  try {
    if (isDev) {
      return { success: true, data: { status: "idle" } };
    }
    await autoUpdater.downloadUpdate();
    return { success: true, data: { status: updateStatus.status } };
  } catch (error) {
    console.error("[updater] 下载更新失败:", error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("updater:install", async () => {
  try {
    if (isDev) {
      return { success: true, data: { status: "idle" } };
    }
    // 退出前安装更新
    autoUpdater.quitAndInstall();
    return { success: true, data: { status: "installing" } };
  } catch (error) {
    console.error("[updater] 安装更新失败:", error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("updater:status", async () => {
  return { success: true, data: { ...updateStatus } };
});
