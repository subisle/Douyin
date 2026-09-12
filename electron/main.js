const { app, BrowserWindow, WebContentsView, ipcMain, safeStorage, session } = require("electron");
const fs = require("fs");
const path = require("path");

// 强制下载保存到 ~/Downloads，不弹保存对话框
function setupDownloadPath() {
  const downloadsDir = app.getPath("downloads") || path.join(app.getPath("home"), "Downloads");
  const ses = session.defaultSession;
  ses.on("will-download", (_event, item) => {
    const filename = item.getFilename();
    if (!filename) return;
    item.setSavePath(path.join(downloadsDir, filename));
  });
}
const { applyBuiltInDbEnv } = require("./db-config");
const { loadRuntimeEnvironment } = require("./runtime-env");

// 先加载环境变量，再加载 db，避免缺 DB_* 时过早失败
const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:3000";
const APP_ICON_PNG = path.join(__dirname, "..", "assets", "icon.png");
const runtimeEnvPath = loadRuntimeEnvironment({
  isPackaged: app.isPackaged,
  projectDir: path.join(__dirname, ".."),
  resourcesPath: process.resourcesPath,
  userDataPath: app.getPath("userData"),
  execPath: process.execPath,
});
if (app.isPackaged && !String(process.env.BOT_STORAGE_DIR || "").trim()) {
  process.env.BOT_STORAGE_DIR = path.join(app.getPath("userData"), "runtime");
}

// 保证主进程后续加载的所有模块都能读到完整数据库配置。
applyBuiltInDbEnv();
if (runtimeEnvPath) console.log(`[config] loaded ${runtimeEnvPath}`);

const db = require("./db");
const { createUpdater } = require("./updater");
const pkLayoutSnapshot = require("./pk-layout-snapshot");
const pkGroupsPresets = require("./pk-groups-presets");
const { LivePkWatcher } = require("./live-pk-watcher");
const { renderDailyReportPng } = require("./weixin-bot-report");
const { createProjectBots } = require("./project-bots");
const { resolveBuiltinBotFile } = require("./builtin-config");

/**
 * Bot 日报图片渲染器：通过渲染进程 Canvas 绘制，与桌面端"导出图片"完全一致。
 * 降级：如果渲染进程未就绪（窗口未加载），回退到 SVG 渲染。
 */
const rendererReportPng = Object.assign(
  async function renderReportPngFallback(report, options = {}) {
    // 降级到 SVG 渲染
    return renderDailyReportPng(report, options);
  },
  {
    async renderPages(report, options = {}) {
      try {
        // 通过渲染进程 Canvas 渲染（与桌面端导出一致）
        const pages = await renderDailyReportViaRenderer(report);
        if (pages && pages.length) return pages;
      } catch (err) {
        console.warn("[report] Canvas 渲染失败，降级到 SVG:", err?.message || err);
      }
      // 降级到 SVG 渲染
      const { renderDailyReportPngPages } = require("./weixin-bot-report");
      return renderDailyReportPngPages(report, options);
    },
  }
);
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
const { resolveDouyinLiveOptions } = require("./live-pk-protocol");
const { LivePkMultiMonitor } = require("./live-pk-multi-monitor");

/** @type {BrowserWindow | null} */
let mainWindow = null;

// 单实例：已有进程在跑时，把焦点还给现有窗口，不再新开一个。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // 常见于上次异常退出后残留 SingletonLock：新实例拿不到锁就静默退出，表现为“启动了但没窗口”
  console.error("[app] 已有实例占用单例锁，本进程退出。若看不到窗口，请结束残留 Electron/清理 userData 下 SingletonLock 后重试。");
  app.quit();
}

function logWindowState(tag) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log(`[window] ${tag}: mainWindow missing`);
    return;
  }
  try {
    const bounds = mainWindow.getBounds();
    console.log(
      `[window] ${tag}: visible=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} minimized=${mainWindow.isMinimized()} bounds=${JSON.stringify(bounds)}`
    );
  } catch (error) {
    console.warn(`[window] ${tag}: state read failed`, error?.message || error);
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  // 开发期偶发 show:false + ready-to-show 丢失，强制拉回前台
  mainWindow.center();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === "darwin") {
    if (app.dock) app.dock.show();
    app.focus({ steal: true });
  }
  // macOS / Windows：短暂置顶，避免被 Chrome 等窗口挡住（表现为“启动了但没显示”）
  try {
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.moveTop();
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        mainWindow.setAlwaysOnTop(false);
        mainWindow.focus();
      } catch {
        // ignore
      }
    }, 400);
  } catch {
    // ignore
  }
  logWindowState("focusMainWindow");
  return true;
}

/**
 * 通过渲染进程 Canvas 渲染日报图片，与桌面端"导出图片"完全一致。
 * 渲染进程 shell.tsx 注册了 window.__renderDailyReportPng 全局函数。
 * @returns {Promise<Array<{ buffer: Buffer, pageIndex, pageCount, fileNameSuffix }>>}
 */
async function renderDailyReportViaRenderer(report) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("主窗口未就绪，无法渲染日报图片");
  }
  const wc = mainWindow.webContents;
  // 等待渲染进程加载完成
  if (wc.isLoading()) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待渲染进程超时")), 15000);
      wc.once("did-finish-load", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  const pages = await wc.executeJavaScript(
    `window.__renderDailyReportPng(${JSON.stringify(report)})`,
    true
  );
  if (!Array.isArray(pages) || !pages.length) {
    throw new Error("渲染进程返回空结果");
  }
  return pages.map((p) => ({
    buffer: Buffer.from(p.dataUrl.split(",")[1], "base64"),
    pageIndex: p.pageIndex,
    pageCount: p.pageCount,
    fileNameSuffix: p.fileNameSuffix || "",
  }));
}

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!focusMainWindow()) {
      // 主窗口已被关掉（例如 macOS dock 仍在）时重建
      if (app.isReady()) createWindow();
    }
  });
}

const updater = createUpdater({
  isDev,
  sendStatus: (status) => sendToMainWindow("updater:status-changed", status),
});
const livePkWatcher = new LivePkWatcher();

function createProtocolCaptureLiveOptions(liveRoomUrl, options = {}) {
  // Multi-monitor adapter: protocol first, optional CDP fallback.
  // Always returns a Promise of watcher options (no long-lived BrowserWindow).
  const {
    cookie = "",
    onStatus,
    bootstrapMode = "score",
    shareGiftList = false,
    allowBrowserFallback = true,
    show = false,
    parentWindow,
    scoreOnly = true,
  } = options;
  return (async () => {
    try {
      const resolved = await resolveDouyinLiveOptions(liveRoomUrl, {
        cookie,
        onStatus,
        bootstrapMode: scoreOnly ? "score" : bootstrapMode,
        shareGiftList: scoreOnly ? false : shareGiftList,
      });
      if (cookie) resolved.cookie = cookie;
      resolved.scoreOnly = scoreOnly !== false;
      return resolved;
    } catch (protocolError) {
      if (!allowBrowserFallback) throw protocolError;
      onStatus?.(`协议进房失败，回退浏览器: ${protocolError?.message || protocolError}`);
      const capture = captureDouyinLiveOptions(liveRoomUrl, {
        parentWindow: parentWindow || mainWindow,
        onStatus,
        cookie,
        show: Boolean(show),
        // Multi-room never keeps capture windows alive — close after options resolve.
        keepAlive: false,
      });
      try {
        const captured = await capture.promise;
        if (cookie) captured.cookie = cookie;
        captured.source = captured.source || "capture";
        captured.keepCaptureWindow = false;
        captured.scoreOnly = scoreOnly !== false;
        return captured;
      } finally {
        try {
          if (capture.window && !capture.window.isDestroyed?.()) capture.window.close();
        } catch {
          // ignore
        }
      }
    }
  })();
}

const livePkMultiMonitor = new LivePkMultiMonitor({
  createWatcher: () => new LivePkWatcher(),
  captureLiveOptions: (liveRoomUrl, options) => createProtocolCaptureLiveOptions(liveRoomUrl, options),
  getParentWindow: () => mainWindow,
  getDefaultCookie: () => getDefaultLiveCookie(),
  maxRooms: 32,
  captureConcurrency: 8,
  preferProtocol: true,
  scoreOnly: true,
});
livePkMultiMonitor.on("status", (status) => {
  sendToMainWindow("live-pk:multi-status", status);
});

const projectBots = createProjectBots({
  weixinStoragePath: () => resolveBuiltinBotFile("weixin", {
    isPackaged: app.isPackaged,
    projectDir: path.join(__dirname, ".."),
    resourcesPath: process.resourcesPath,
  }),
  qqStoragePath: () => resolveBuiltinBotFile("qq", {
    isPackaged: app.isPackaged,
    projectDir: path.join(__dirname, ".."),
    resourcesPath: process.resourcesPath,
  }),
  encryptToken: (token) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统不可用安全存储，未保存微信令牌");
    }
    return safeStorage.encryptString(String(token)).toString("base64");
  },
  decryptToken: (encrypted) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统不可用安全存储，无法读取微信令牌");
    }
    return safeStorage.decryptString(Buffer.from(String(encrypted), "base64"));
  },
  db,
  renderReportPng: rendererReportPng,
  runner: "desktop",
});
const weixinBot = projectBots.weixinBot;
const qqBot = projectBots.qqBot;

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

weixinBot.on("status", (status) => {
  sendToMainWindow("weixin-bot:status-changed", status);
});
weixinBot.on("message", (message) => {
  sendToMainWindow("weixin-bot:message", message);
});
weixinBot.on("messages-cleared", () => {
  sendToMainWindow("weixin-bot:messages-cleared");
});
qqBot.on("status", (status) => {
  sendToMainWindow("qq-bot:status-changed", status);
});
qqBot.on("message", (message) => {
  sendToMainWindow("qq-bot:message", message);
});
qqBot.on("messages-cleared", () => {
  sendToMainWindow("qq-bot:messages-cleared");
});

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

/**
 * Prefer pure-protocol enter (no BrowserWindow). Fall back to CDP capture only
 * when room/web/enter or WSS signing fails.
 */
async function resolveLiveMonitorOptions(liveRoomUrl, {
  cookie = "",
  onStatus,
  allowBrowserFallback = true,
  show = true,
  keepAlive = true,
  bootstrapMode = "full",
  shareGiftList = true,
} = {}) {
  const notify = typeof onStatus === "function" ? onStatus : () => {};
  try {
    notify("协议进房中…");
    const options = await resolveDouyinLiveOptions(liveRoomUrl, {
      cookie,
      onStatus: notify,
      bootstrapMode,
      shareGiftList,
    });
    if (cookie) options.cookie = cookie;
    return { options, source: "protocol", window: null };
  } catch (protocolError) {
    const reason = protocolError?.message || String(protocolError);
    if (!allowBrowserFallback) throw protocolError;
    notify(`协议进房失败，回退浏览器采集: ${reason}`);
  }

  const capture = captureDouyinLiveOptions(liveRoomUrl, {
    parentWindow: mainWindow,
    onStatus: notify,
    cookie,
    show,
    keepAlive,
  });
  const options = await capture.promise;
  if (cookie) options.cookie = cookie;
  return { options, source: "capture", window: capture.window || null };
}

async function startHiddenLiveCaptureMonitor(liveRoomUrl, cookie, includeRaw) {
  closeHiddenLiveCaptureWindow();
  sendLivePkCaptureStatus("协议进房中…");
  let captureWindow = null;
  try {
    const resolved = await resolveLiveMonitorOptions(liveRoomUrl, {
      cookie,
      onStatus: sendLivePkCaptureStatus,
      allowBrowserFallback: true,
      show: true,
      keepAlive: true,
    });
    captureWindow = resolved.window;
    if (captureWindow) hiddenLiveCaptureWindow = captureWindow;
    sendLivePkCaptureStatus(
      resolved.source === "protocol"
        ? "协议进房完成，正在启动监控"
        : "已获取连接，正在启动监控"
    );
    await livePkWatcher.start({ ...resolved.options, includeRaw: Boolean(includeRaw) });
  } catch (error) {
    if (captureWindow && hiddenLiveCaptureWindow === captureWindow) {
      closeHiddenLiveCaptureWindow();
    }
    throw error;
  } finally {
    if (captureWindow && hiddenLiveCaptureWindow === captureWindow && captureWindow.isDestroyed?.()) {
      hiddenLiveCaptureWindow = null;
    }
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

const SPLASH_MIN_MS = 2300;
const SPLASH_FALLBACK_MS = 12000;
const APP_BACKGROUND = "#f5f3ee";

function splashHtmlPath() {
  return path.join(__dirname, "splash.html");
}

function createWindow() {
  const splashStartedAt = Date.now();
  let appContentLoading = false;
  let appContentReady = false;
  let splashFinished = false;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    resizable: true,
    maximizable: true,
    fullScreenable: true,
    minWidth: 1280,
    minHeight: 800,
    frame: false,
    backgroundColor: APP_BACKGROUND,
    icon: APP_ICON_PNG,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 固定尺寸窗口在多屏/异常退出后可能落在屏幕外，创建后先居中。
  mainWindow.center();
  console.log("[window] BrowserWindow created");
  logWindowState("created");

  const loadAppContent = () => {
    if (appContentLoading || !mainWindow || mainWindow.isDestroyed()) return;
    appContentLoading = true;
    if (isDev) {
      mainWindow.loadURL(DEV_URL);
    } else {
      mainWindow.loadFile(path.join(__dirname, "..", "out", "index.html"));
    }
  };

  const maybeEnterApp = () => {
    if (splashFinished || !mainWindow || mainWindow.isDestroyed()) return;
    const elapsed = Date.now() - splashStartedAt;
    if (elapsed < SPLASH_MIN_MS) {
      setTimeout(maybeEnterApp, SPLASH_MIN_MS - elapsed);
      return;
    }
    if (!appContentReady && Date.now() - splashStartedAt < SPLASH_FALLBACK_MS) {
      return;
    }
    splashFinished = true;
    console.log("[window] enter app content");
    focusMainWindow();
  };

  mainWindow.once("ready-to-show", () => {
    // 先展示启动 UI，再切到业务页面。
    console.log("[window] ready-to-show");
    focusMainWindow();
  });

  // 兜底：部分环境 ready-to-show 不触发时，仍保证窗口可见。
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      console.warn("[window] force show after timeout (ready-to-show missed?)");
      focusMainWindow();
    } else {
      logWindowState("visible-check");
    }
  }, 1500);

  mainWindow.webContents.on("did-finish-load", () => {
    const url = mainWindow?.webContents.getURL() || "";
    if (url.includes("splash.html")) {
      const waitMs = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStartedAt));
      setTimeout(loadAppContent, waitMs);
      return;
    }
    appContentReady = true;
    maybeEnterApp();
  });

  // 启动页加载失败时，直接进入业务页。
  mainWindow.webContents.once("did-fail-load", (_event, _code, _desc, validatedURL) => {
    if (String(validatedURL || "").includes("splash.html")) {
      loadAppContent();
    }
  });

  // 兜底：超时后强制进入业务页。
  setTimeout(() => {
    if (!appContentLoading) loadAppContent();
    appContentReady = true;
    maybeEnterApp();
  }, SPLASH_FALLBACK_MS);

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

  mainWindow.loadFile(splashHtmlPath()).catch(() => {
    loadAppContent();
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  setupDownloadPath();

  try {
    const { logStorageReport } = require("./local-paths");
    logStorageReport(process.env, console);
  } catch (error) {
    console.warn("[storage] doctor failed", error?.message || error);
  }

  if (process.platform === "darwin" && app.dock) {
    app.dock.show();
    app.dock.setIcon(APP_ICON_PNG);
  }
  createWindow();
  // 再保险：创建后主动抢一次前台，避免 macOS 开发态启动后窗口在后台
  setTimeout(() => {
    focusMainWindow();
  }, 300);

  // 初始化自动更新（生产环境）
  updater.init();
  void projectBots.initialize().catch((error) => {
    console.error("[project-bots] 初始化失败", error?.message || String(error));
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    // 已最小化或被遮挡时，点 Dock/任务栏图标恢复前台
    focusMainWindow();
  });
});

app.on("window-all-closed", () => {
  // Windows/Linux：关掉主窗口即退出；最小化只进任务栏，不触发这里
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void projectBots.shutdown();
});

// 窗口控制 IPC
// 最小化：系统默认进任务栏（不隐藏、不托盘常驻）
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
  const forceBrowser = Boolean(payload?.forceBrowser);
  closeEmbeddedLiveView({ stopMonitor: false });
  closeHiddenLiveCaptureWindow();
  livePkWatcher.stop();
  const onStatus = (message) => sendToMainWindow("live-pk:capture-status", message);
  onStatus(forceBrowser ? "正在打开浏览器采集窗口" : "协议进房中…");
  let captureWindow = null;
  try {
    const resolved = forceBrowser
      ? await (async () => {
          const capture = captureDouyinLiveOptions(liveRoomUrl, {
            parentWindow: mainWindow,
            onStatus,
            cookie,
            show: true,
            keepAlive: true,
          });
          const options = await capture.promise;
          if (cookie) options.cookie = cookie;
          return { options, source: "capture", window: capture.window || null };
        })()
      : await resolveLiveMonitorOptions(liveRoomUrl, {
          cookie,
          onStatus,
          allowBrowserFallback: payload?.allowBrowserFallback !== false,
          show: true,
          keepAlive: true,
        });
    captureWindow = resolved.window;
    if (captureWindow) hiddenLiveCaptureWindow = captureWindow;
    onStatus(
      resolved.source === "protocol"
        ? "协议进房完成，正在启动监控"
        : "已获取连接，正在启动监控"
    );
    return livePkWatcher.start({ ...resolved.options, includeRaw: Boolean(payload?.includeRaw) });
  } catch (error) {
    if (captureWindow && hiddenLiveCaptureWindow === captureWindow) {
      closeHiddenLiveCaptureWindow();
    }
    throw error;
  } finally {
    if (captureWindow && hiddenLiveCaptureWindow === captureWindow && captureWindow.isDestroyed?.()) {
      hiddenLiveCaptureWindow = null;
    }
  }
}));
ipcMain.handle("live-pk:stop", wrap(() => {
  closeHiddenLiveCaptureWindow();
  try {
    livePkMultiMonitor.stop({ emit: false });
  } catch {
    // multi monitor may already be idle
  }
  return closeEmbeddedLiveView({ stopMonitor: true });
}));
ipcMain.handle("live-pk:status", wrap(() => livePkWatcher.getStatus()));

// Multi-room protocol monitor: high concurrency enter, adaptive PK poll, no browser windows.
ipcMain.handle("live-pk:multi-start", wrap((payload) => {
  closeEmbeddedLiveView({ stopMonitor: false });
  closeHiddenLiveCaptureWindow();
  livePkWatcher.stop();
  // 多主播默认只监控音浪，不强制 Cookie。
  const cookie = String(payload?.cookie || "").trim();
  return livePkMultiMonitor.start({
    rooms: Array.isArray(payload?.rooms) ? payload.rooms : [],
    cookie,
    captureConcurrency: payload?.captureConcurrency,
    preferProtocol: payload?.preferProtocol !== false,
    scoreOnly: payload?.scoreOnly !== false,
  });
}));
ipcMain.handle("live-pk:multi-stop", wrap((payload) => {
  return livePkMultiMonitor.stop({
    sessionId: String(payload?.sessionId || "").trim(),
  });
}));
ipcMain.handle("live-pk:multi-status", wrap(() => livePkMultiMonitor.getStatus()));

// 微信 iLink Bot IPC：令牌和消息上下文只在主进程内处理。
ipcMain.handle("weixin-bot:status", wrap(() => weixinBot.getStatus()));
ipcMain.handle("weixin-bot:messages", wrap(() => weixinBot.getMessages()));
ipcMain.handle("weixin-bot:settings", wrap((accountId) => weixinBot.getSettings(accountId)));
ipcMain.handle("weixin-bot:login", wrap(() => weixinBot.startLogin()));
ipcMain.handle("weixin-bot:login-cancel", wrap(() => weixinBot.cancelLogin()));
ipcMain.handle("weixin-bot:start", wrap((accountId) => weixinBot.startMonitoring(accountId)));
ipcMain.handle("weixin-bot:stop", wrap((accountId) => weixinBot.stopMonitoring(accountId)));
ipcMain.handle("weixin-bot:disconnect", wrap((accountId) => weixinBot.disconnect(accountId)));
ipcMain.handle("weixin-bot:set-active-account", wrap((accountId) => weixinBot.setActiveAccount(accountId)));
ipcMain.handle("weixin-bot:send", wrap((payload) => weixinBot.sendText(payload)));
ipcMain.handle("weixin-bot:save-settings", wrap((payload) => weixinBot.saveSettings(payload)));
ipcMain.handle("weixin-bot:clear-messages", wrap(() => weixinBot.clearMessages()));

ipcMain.handle("qq-bot:status", wrap(() => qqBot.getStatus()));
ipcMain.handle("qq-bot:messages", wrap(() => qqBot.getMessages()));
ipcMain.handle("qq-bot:settings", wrap(() => qqBot.getSettings()));
ipcMain.handle("qq-bot:save-settings", wrap((payload) => qqBot.saveSettings(payload || {})));
ipcMain.handle("qq-bot:connect", wrap(() => qqBot.connect()));
ipcMain.handle("qq-bot:disconnect", wrap(() => qqBot.disconnect()));
ipcMain.handle("qq-bot:clear-messages", wrap(() => qqBot.clearMessages()));

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
ipcMain.handle("data:getRosterBySurname", wrap((_, surname) => db.getRosterBySurname(surname)));
ipcMain.handle("data:exportFamilyRoster", wrap(() => db.exportFamilyRoster()));
ipcMain.handle("data:getDashboardSummary", wrap(() => db.getDashboardSummary()));
ipcMain.handle("data:getStartupHealth", wrap(() => db.getStartupHealth()));
ipcMain.handle("data:getWaveRanking", wrap((limit) => db.getWaveRanking(limit)));
ipcMain.handle("data:getWaveTrendByGender", wrap(() => db.getWaveTrendByGender()));

ipcMain.handle(
  "data:importWave",
  wrap(async (date, rows, meta) => {
    const result = await db.importWaveSnapshots(date, rows, meta);
    try {
      void weixinBot.notifyDailyReportDataUpdated(date);
    } catch (error) {
      console.warn("[weixin-daily-push] schedule failed", error);
    }
    return result;
  })
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
  "data:getMonthlyReport",
  wrap((month, gender) => db.getMonthlyReport(month, gender))
);
ipcMain.handle(
  "data:getPkRoster",
  wrap((period, groupSize) => db.getPkRoster(period, groupSize))
);
ipcMain.handle(
  "data:buildPkGroups",
  wrap((payload) => {
    const { buildPkGroups } = require("./pk-group-engine");
    return buildPkGroups(payload || {});
  })
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

// ── 主播收入 IPC ────────────────────────────────────────
ipcMain.handle("data:getAnchorIncome", wrap((period) => db.getAnchorIncome(period)));
ipcMain.handle("data:getIncomePeriods", wrap(() => db.getIncomePeriods()));
ipcMain.handle("data:importAnchorIncome", wrap((payload) => db.importAnchorIncome(payload)));
ipcMain.handle("data:saveAnchorIncomeProfile", wrap((payload) => db.saveAnchorIncomeProfile(payload)));
ipcMain.handle("data:deleteAnchorIncome", wrap((period, personIds) => db.deleteAnchorIncome(period, personIds)));

// ── 应用密码锁 ──────────────────────────────────────────
ipcMain.handle("auth:verifyPassword", wrap((password) => db.verifyAppPassword(password)));
ipcMain.handle("auth:hasPassword", wrap(() => db.hasAppPassword()));

// bot 日报图片渲染：通过渲染进程 Canvas 绘制，与桌面端导出完全一致
ipcMain.handle("report:render-png", async (_event, report) => {
  return renderDailyReportViaRenderer(report);
});

// ── PK 分组快照（供微信/QQ bot 命令出图）──────────────────
ipcMain.handle("pk:layout-snapshot-save", async (_event, snapshot) => {
  try {
    return { success: true, data: pkLayoutSnapshot.writeLayoutSnapshot(snapshot) };
  } catch (error) {
    console.error("[pk] 分组快照保存失败:", error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
});
ipcMain.handle("pk:layout-snapshot-read", async () => {
  try {
    return { success: true, data: pkLayoutSnapshot.readLayoutSnapshot() };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});
ipcMain.handle("pk:layout-snapshot-clear", async () => {
  try {
    pkLayoutSnapshot.clearLayoutSnapshot();
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// ── PK 命名分组存档（多份，bot 按名出图）──────────────────
ipcMain.handle("pk:groups-presets-save", async (_event, list) => {
  try {
    return { success: true, data: pkGroupsPresets.writePresets(list) };
  } catch (error) {
    console.error("[pk] 分组存档同步失败:", error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
});
ipcMain.handle("pk:groups-presets-read", async () => {
  try {
    return { success: true, data: pkGroupsPresets.readPresets() };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

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
