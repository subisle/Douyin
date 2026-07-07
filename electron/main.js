const { app, BrowserWindow, WebContentsView, ipcMain, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const { createUpdater } = require("./updater");
const { LivePkWatcher } = require("./live-pk-watcher");
const {
  captureSignedUserProfile,
  captureLivePkSnapshot,
  captureDouyinLiveOptions,
  describeCookieInjection,
  detectLoginPrompt,
  getCookieHeader,
  injectCookieHeader,
  normalizeLiveRoomUrl,
  scanOpenWebSockets,
} = require("./live-pk-capture");

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:3000";
const APP_ICON_PNG = path.join(__dirname, "..", "assets", "icon.png");
for (const envPath of [path.join(__dirname, "..", ".env.local"), path.join(__dirname, "..", ".env")]) {
  if (fs.existsSync(envPath)) {
    require("dotenv").config({ path: envPath, quiet: true });
  }
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
const updater = createUpdater({
  isDev,
  sendStatus: (status) => sendToMainWindow("updater:status-changed", status),
});
const livePkWatcher = new LivePkWatcher();
/** @type {WebContentsView | null} */
let embeddedLiveView = null;
let embeddedLiveUrl = "";
let embeddedLiveMuted = true;
let embeddedLiveScanTimer = null;
let embeddedLiveTimeoutTimer = null;
let embeddedLiveDebuggerHandler = null;
let embeddedLiveCaptureToken = 0;
let embeddedLiveBounds = null;
let hiddenLiveCaptureWindow = null;
let embeddedLiveCookieState = null;
let embeddedLoginPromptReported = false;

function sendToMainWindow(channel, ...args) {
  const webContents = mainWindow?.webContents;
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send(channel, ...args);
  } catch {
    // 窗口退出时 webContents 可能刚好被销毁，忽略清理期消息。
  }
}

livePkWatcher.on("status", (status) => {
  sendToMainWindow("live-pk:status-changed", status);
});
livePkWatcher.on("rank", (payload) => {
  sendToMainWindow("live-pk:rank", payload);
});
livePkWatcher.on("gift", (payload) => {
  sendToMainWindow("live-pk:gift", payload);
});
livePkWatcher.on("member", (payload) => {
  sendToMainWindow("live-pk:member", payload);
});
livePkWatcher.on("chat", (payload) => {
  sendToMainWindow("live-pk:chat", payload);
});
livePkWatcher.on("event", (payload) => {
  sendToMainWindow("live-pk:event", payload);
});
livePkWatcher.on("error-message", (message) => {
  sendToMainWindow("live-pk:error", message);
});

function sendLivePkCaptureStatus(message) {
  sendToMainWindow("live-pk:capture-status", message);
}

function sendLivePkError(message) {
  sendToMainWindow("live-pk:error", message);
}

function sendLivePkEmbeddedState(payload = {}) {
  sendToMainWindow("live-pk:embed-state", {
    embedded: Boolean(embeddedLiveView && !embeddedLiveView.webContents.isDestroyed()),
    liveRoomUrl: embeddedLiveUrl,
    ...payload,
  });
}

function liveCookieStorePath() {
  return path.join(app.getPath("userData"), "douyin-live-cookie.v1.json");
}

function saveLiveCookie(cookie) {
  const value = String(cookie || "").trim();
  if (!value) throw new Error("Cookie 为空");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统不可用安全存储，未保存 Cookie");
  }
  const encrypted = safeStorage.encryptString(value).toString("base64");
  fs.mkdirSync(path.dirname(liveCookieStorePath()), { recursive: true });
  fs.writeFileSync(
    liveCookieStorePath(),
    JSON.stringify({ version: 1, encrypted, updatedAt: new Date().toISOString() }, null, 2)
  );
  return { saved: true, updatedAt: new Date().toISOString() };
}

function readLiveCookie() {
  const file = liveCookieStorePath();
  if (!fs.existsSync(file)) return { saved: false, cookie: "", updatedAt: null };
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data?.encrypted) return { saved: false, cookie: "", updatedAt: null };
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统不可用安全存储，无法读取 Cookie");
  }
  const cookie = safeStorage.decryptString(Buffer.from(data.encrypted, "base64"));
  return { saved: true, cookie, updatedAt: data.updatedAt || null };
}

function clearLiveCookie() {
  const file = liveCookieStorePath();
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  return { saved: false };
}

function getDefaultLiveCookie() {
  try {
    const stored = readLiveCookie();
    if (stored.cookie) return stored.cookie;
  } catch {
    // ignore secure storage read errors and fall back to env
  }
  return String(process.env.DOUYIN_LIVE_COOKIE || "").trim();
}

function normalizeEmbeddedBounds(bounds) {
  return {
    x: Math.max(0, Math.round(Number(bounds?.x || 0))),
    y: Math.max(0, Math.round(Number(bounds?.y || 0))),
    width: Math.max(0, Math.round(Number(bounds?.width || 0))),
    height: Math.max(0, Math.round(Number(bounds?.height || 0))),
  };
}

function cleanupEmbeddedLiveCapture() {
  if (embeddedLiveScanTimer) clearInterval(embeddedLiveScanTimer);
  if (embeddedLiveTimeoutTimer) clearTimeout(embeddedLiveTimeoutTimer);
  embeddedLiveScanTimer = null;
  embeddedLiveTimeoutTimer = null;

  const webContents = embeddedLiveView?.webContents;
  if (!webContents || webContents.isDestroyed()) return;
  try {
    if (embeddedLiveDebuggerHandler) {
      webContents.debugger.removeListener("message", embeddedLiveDebuggerHandler);
    }
    embeddedLiveDebuggerHandler = null;
    if (webContents.debugger.isAttached()) webContents.debugger.detach();
  } catch {
    embeddedLiveDebuggerHandler = null;
  }
}

function closeHiddenLiveCaptureWindow() {
  if (!hiddenLiveCaptureWindow) return;
  const win = hiddenLiveCaptureWindow;
  hiddenLiveCaptureWindow = null;
  try {
    if (!win.isDestroyed()) win.close();
  } catch {
    // ignore close errors
  }
}

function signedProfileLookupFromTarget(target) {
  return async (secUid) => {
    try {
      return await captureSignedUserProfile(target, secUid);
    } catch {
      return null;
    }
  };
}

function livePkSnapshotLookupFromTarget(target) {
  return async () => {
    try {
      return await captureLivePkSnapshot(target);
    } catch {
      return null;
    }
  };
}

function blockEmbeddedLivePointerEvents(view) {
  const webContents = view?.webContents;
  if (!webContents || webContents.isDestroyed()) return;
  webContents.insertCSS(`
    html, body, body * {
      cursor: default !important;
      -webkit-user-select: none !important;
      user-select: none !important;
    }
  `).catch(() => {});
  webContents.executeJavaScript(`
    (() => {
      if (window.__douyinMonitorPointerBlockerInstalled) return;
      window.__douyinMonitorPointerBlockerInstalled = true;
      const block = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        return false;
      };
      [
        "auxclick",
        "click",
        "contextmenu",
        "dblclick",
        "mousedown",
        "mouseup",
        "pointerdown",
        "pointerup",
        "touchend",
        "touchstart"
      ].forEach((name) => window.addEventListener(name, block, true));
    })()
  `, true).catch(() => {});
}

function ensureEmbeddedLiveView() {
  if (!mainWindow) throw new Error("主窗口未就绪");
  if (embeddedLiveView && !embeddedLiveView.webContents.isDestroyed()) return embeddedLiveView;

  const view = new WebContentsView({
    webPreferences: {
      partition: "persist:live-pk-capture",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  embeddedLiveView = view;
  mainWindow.contentView.addChildView(view);
  view.setBackgroundColor("#000000");
  view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  view.setVisible(false);
  view.webContents.setAudioMuted(embeddedLiveMuted);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("did-start-loading", () => {
    sendLivePkCaptureStatus("直播画面正在加载");
  });
  view.webContents.on("dom-ready", () => {
    blockEmbeddedLivePointerEvents(view);
    sendLivePkCaptureStatus("直播页面 DOM 已就绪，正在监听 WebSocket");
  });
  view.webContents.on("did-finish-load", () => {
    blockEmbeddedLivePointerEvents(view);
    sendLivePkCaptureStatus("直播画面已加载，正在监听 WebSocket");
    const checkLoginPrompt = async () => {
      if (embeddedLoginPromptReported || embeddedLiveView !== view || view.webContents.isDestroyed()) return;
      const result = await detectLoginPrompt(view).catch(() => null);
      if (!result?.hasLoginText) return;
      embeddedLoginPromptReported = true;
      const prefix = embeddedLiveCookieState?.authPresent?.length
        ? "页面仍显示“登录”，Cookie 可能已过期或未生效"
        : "页面显示“登录”，当前未检测到有效登录 Cookie";
      sendLivePkCaptureStatus(`${prefix}；普通观众真实 ID 可能只能拿到脱敏信息`);
    };
    setTimeout(() => void checkLoginPrompt(), 1200);
    setTimeout(() => void checkLoginPrompt(), 3500);
  });
  view.webContents.on("did-fail-load", (_event, code, description) => {
    sendLivePkCaptureStatus(`直播画面加载失败: ${description || code}`);
  });
  view.webContents.once("destroyed", () => {
    if (embeddedLiveView !== view) return;
    cleanupEmbeddedLiveCapture();
    embeddedLiveView = null;
    sendLivePkEmbeddedState({ embedded: false });
  });
  sendLivePkEmbeddedState({ embedded: true });
  return view;
}

function setEmbeddedLiveBounds(bounds) {
  if (!embeddedLiveView || embeddedLiveView.webContents.isDestroyed()) return;
  embeddedLiveBounds = normalizeEmbeddedBounds(bounds);
  if (embeddedLiveBounds.width <= 1 || embeddedLiveBounds.height <= 1) {
    embeddedLiveView.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    embeddedLiveView.setVisible(false);
    return;
  }
  mainWindow?.contentView.addChildView(embeddedLiveView);
  embeddedLiveView.setBounds(embeddedLiveBounds);
  embeddedLiveView.setVisible(true);
}

function closeEmbeddedLiveView({ stopMonitor = false } = {}) {
  embeddedLiveCaptureToken += 1;
  embeddedLiveCookieState = null;
  embeddedLoginPromptReported = false;
  cleanupEmbeddedLiveCapture();
  embeddedLiveUrl = "";
  if (embeddedLiveView) {
    const view = embeddedLiveView;
    embeddedLiveView = null;
    try {
      view.setVisible(false);
      view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
      mainWindow?.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) {
        view.webContents.stop();
        view.webContents.destroy();
      }
    } catch {
      // ignore remove errors
    }
  }
  if (stopMonitor) livePkWatcher.stop();
  sendLivePkEmbeddedState({ embedded: false });
  return livePkWatcher.getStatus();
}

async function startHiddenLiveCaptureMonitor(liveRoomUrl, cookie, includeRaw) {
  closeHiddenLiveCaptureWindow();
  sendLivePkCaptureStatus("正在打开可移动采集窗口");
  const capture = captureDouyinLiveOptions(liveRoomUrl, {
    parentWindow: mainWindow,
    onStatus: sendLivePkCaptureStatus,
    cookie,
    show: true,
    keepAlive: true,
  });
  hiddenLiveCaptureWindow = capture.window;
  try {
    const options = await capture.promise;
    if (cookie) options.cookie = cookie;
    await livePkWatcher.start({ ...options, includeRaw: Boolean(includeRaw) });
  } catch (error) {
    if (hiddenLiveCaptureWindow === capture.window) closeHiddenLiveCaptureWindow();
    throw error;
  } finally {
    if (hiddenLiveCaptureWindow === capture.window && capture.window.isDestroyed()) hiddenLiveCaptureWindow = null;
  }
}

async function attachEmbeddedLiveCapture(view, url, cookieFallback, includeRaw) {
  const token = embeddedLiveCaptureToken;
  let settled = false;

  const finish = async (websocketUrl) => {
    if (settled || token !== embeddedLiveCaptureToken || !websocketUrl) return;
    settled = true;
    cleanupEmbeddedLiveCapture();
    try {
      sendLivePkCaptureStatus("已获取连接，正在启动监控");
      const cookie = await getCookieHeader(view.webContents.session, url);
      await livePkWatcher.start({
        websocketUrl,
        cookie: cookie || cookieFallback || "",
        includeRaw: Boolean(includeRaw),
        profileLookup: signedProfileLookupFromTarget(view),
        linkmicSnapshotLookup: livePkSnapshotLookupFromTarget(view),
      });
    } catch (error) {
      sendLivePkError(error?.message || String(error));
    }
  };

  try {
    if (!view.webContents.debugger.isAttached()) view.webContents.debugger.attach("1.3");
    await view.webContents.debugger.sendCommand("Network.enable").catch(() => {});
    await view.webContents.debugger.sendCommand("Runtime.enable").catch(() => {});
  } catch (error) {
    throw new Error(`无法启动内嵌采集器：${error?.message || error}`);
  }

  embeddedLiveDebuggerHandler = (_event, method, params) => {
    const requestUrl = params?.url || params?.request?.url;
    if (
      (method === "Network.webSocketCreated" || method === "Network.requestWillBeSent") &&
      typeof requestUrl === "string" &&
      requestUrl.includes("webcast/im/push")
    ) {
      void finish(requestUrl);
    }
  };
  view.webContents.debugger.on("message", embeddedLiveDebuggerHandler);

  embeddedLiveScanTimer = setInterval(async () => {
    if (settled || token !== embeddedLiveCaptureToken || view.webContents.isDestroyed()) return;
    const websocketUrl = await scanOpenWebSockets(view.webContents.debugger).catch(() => "");
    if (websocketUrl) void finish(websocketUrl);
  }, 1500);

  embeddedLiveTimeoutTimer = setTimeout(() => {
    if (settled || token !== embeddedLiveCaptureToken) return;
    settled = true;
    cleanupEmbeddedLiveCapture();
    sendLivePkError("内嵌画面未获取到直播间 WebSocket，正在切换隐藏采集");
    startHiddenLiveCaptureMonitor(url, cookieFallback, includeRaw).catch((fallbackError) => {
      sendLivePkError(`隐藏采集也失败: ${fallbackError?.message || fallbackError}`);
    });
  }, 30000);
}

async function openEmbeddedLiveMonitor(payload) {
  const liveRoomUrl = normalizeLiveRoomUrl(payload?.liveRoomUrl);
  const cookie = String(payload?.cookie || "").trim() || getDefaultLiveCookie();
  const view = ensureEmbeddedLiveView();
  const bounds = normalizeEmbeddedBounds(payload?.bounds || {});

  embeddedLiveCaptureToken += 1;
  cleanupEmbeddedLiveCapture();
  livePkWatcher.stop();
  embeddedLiveUrl = liveRoomUrl;
  setEmbeddedLiveBounds(bounds);

  const injected = await injectCookieHeader(view.webContents.session, liveRoomUrl, cookie);
  embeddedLiveCookieState = injected;
  sendLivePkCaptureStatus(describeCookieInjection(injected, "，正在打开直播间"));

  await attachEmbeddedLiveCapture(view, liveRoomUrl, cookie, payload?.includeRaw);
  view.webContents.loadURL(liveRoomUrl).catch((error) => {
    sendLivePkError(`直播画面打开失败: ${error?.message || error}`);
    closeEmbeddedLiveView({ stopMonitor: false });
    startHiddenLiveCaptureMonitor(liveRoomUrl, cookie, payload?.includeRaw).catch((fallbackError) => {
      sendLivePkError(`隐藏采集也失败: ${fallbackError?.message || fallbackError}`);
    });
  });
  return {
    ...livePkWatcher.getStatus(),
    embedded: true,
    liveRoomUrl,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    resizable: false,
    maximizable: false,
    fullScreenable: false,
    minWidth: 1440,
    minHeight: 900,
    maxWidth: 1440,
    maxHeight: 900,
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
    closeEmbeddedLiveView({ stopMonitor: true });
    closeHiddenLiveCaptureWindow();
  });

  const emitMaximizeState = () => {
    sendToMainWindow(
      "window:maximized-changed",
      mainWindow?.isMaximized() ?? false
    );
  };
  mainWindow.on("maximize", emitMaximizeState);
  mainWindow.on("unmaximize", emitMaximizeState);
  mainWindow.on("move", () => {
    if (embeddedLiveBounds) setEmbeddedLiveBounds(embeddedLiveBounds);
  });

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

ipcMain.handle("live-pk:start", wrap((payload) => livePkWatcher.start(payload)));
ipcMain.handle("live-pk:cookie-save", wrap((cookie) => saveLiveCookie(cookie)));
ipcMain.handle("live-pk:cookie-read", wrap(() => readLiveCookie()));
ipcMain.handle("live-pk:cookie-clear", wrap(() => clearLiveCookie()));
ipcMain.handle("live-pk:embed-open", wrap((payload) => openEmbeddedLiveMonitor(payload)));
ipcMain.handle("live-pk:embed-bounds", wrap((bounds) => {
  setEmbeddedLiveBounds(bounds);
  return { embedded: Boolean(embeddedLiveView), liveRoomUrl: embeddedLiveUrl };
}));
ipcMain.handle("live-pk:embed-close", wrap((payload) => closeEmbeddedLiveView({
  stopMonitor: Boolean(payload?.stopMonitor),
})));
ipcMain.handle("live-pk:embed-reload", wrap(async () => {
  if (!embeddedLiveView || embeddedLiveView.webContents.isDestroyed()) {
    throw new Error("直播画面未打开");
  }
  await embeddedLiveView.webContents.reload();
  return { embedded: true, liveRoomUrl: embeddedLiveUrl };
}));
ipcMain.handle("live-pk:embed-muted", wrap((muted) => {
  embeddedLiveMuted = Boolean(muted);
  if (embeddedLiveView && !embeddedLiveView.webContents.isDestroyed()) {
    embeddedLiveView.webContents.setAudioMuted(embeddedLiveMuted);
  }
  return { muted: embeddedLiveMuted };
}));
ipcMain.handle("live-pk:start-from-url", wrap(async (payload) => {
  const liveRoomUrl = payload?.liveRoomUrl;
  const cookie = String(payload?.cookie || "").trim() || getDefaultLiveCookie();
  closeEmbeddedLiveView({ stopMonitor: false });
  closeHiddenLiveCaptureWindow();
  livePkWatcher.stop();
  sendToMainWindow("live-pk:capture-status", "正在打开可移动采集窗口");
  const capture = captureDouyinLiveOptions(liveRoomUrl, {
    parentWindow: mainWindow,
    onStatus: (message) => sendToMainWindow("live-pk:capture-status", message),
    cookie,
    show: true,
    keepAlive: true,
  });
  hiddenLiveCaptureWindow = capture.window;
  try {
    const options = await capture.promise;
    if (cookie) options.cookie = cookie;
    sendToMainWindow("live-pk:capture-status", "已获取连接，正在启动监控");
    return livePkWatcher.start({ ...options, includeRaw: Boolean(payload?.includeRaw) });
  } catch (error) {
    if (hiddenLiveCaptureWindow === capture.window) closeHiddenLiveCaptureWindow();
    throw error;
  } finally {
    if (hiddenLiveCaptureWindow === capture.window && capture.window.isDestroyed()) hiddenLiveCaptureWindow = null;
  }
}));
ipcMain.handle("live-pk:stop", wrap(() => {
  closeHiddenLiveCaptureWindow();
  return closeEmbeddedLiveView({ stopMonitor: true });
}));
ipcMain.handle("live-pk:status", wrap(() => livePkWatcher.getStatus()));

// 数据 IPC：统一返回 { success, data?, error? }
function wrap(fn) {
  return async (_event, ...args) => {
    try {
      return { success: true, data: await fn(...args) };
    } catch (error) {
      console.error("[ipc]", error?.message || String(error));
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
  "data:getStarBattleScores",
  wrap((period) => db.getStarBattleScores(period))
);
ipcMain.handle(
  "data:saveStarBattleScore",
  wrap((payload) => db.saveStarBattleScore(payload))
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
