const { BrowserWindow } = require("electron");

function normalizeLiveRoomUrl(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("缺少直播间地址");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("直播间地址格式不正确");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("直播间地址必须是 http/https");
  if (!url.hostname.endsWith("douyin.com")) throw new Error("仅支持抖音直播间地址");
  return url.toString();
}

function isPushWebSocket(url) {
  return typeof url === "string" && url.includes("webcast/im/push");
}

function isLiveImFetch(url) {
  return typeof url === "string" && url.includes("/webcast/im/fetch/");
}

const BOOTSTRAP_ENDPOINTS = [
  ["roomEnter", "/webcast/room/web/enter/"],
  ["giftList", "/webcast/gift/list/"],
  ["audienceRank", "/webcast/ranklist/audience/"],
  ["wishList", "/webcast/wish/list/"],
  ["interactionInfo", "/webcast/room/interaction/info/"],
];

function bootstrapKeyForUrl(url) {
  if (typeof url !== "string") return "";
  const item = BOOTSTRAP_ENDPOINTS.find(([, marker]) => url.includes(marker));
  return item?.[0] || "";
}

function parseResponseBody(body, base64Encoded) {
  if (!body) return null;
  const text = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readAnchorSecUidFromRoomEnter(value) {
  const room = value?.data?.data?.[0] || value?.data?.room || null;
  const user = room?.owner || value?.data?.user || null;
  return String(user?.sec_uid || user?.secUid || user?.sec_user_id || "").trim();
}

function compactProfileOtherUser(user) {
  if (!user || typeof user !== "object") return null;
  return {
    userId: String(user.uid || user.uid_str || user.id_str || user.id || ""),
    secUid: String(user.sec_uid || user.secUid || user.sec_user_id || ""),
    uniqueId: String(user.unique_id || user.uniqueId || user.display_id || user.displayId || user.short_id || ""),
    nickname: String(user.nickname || ""),
    ipLocation: String(user.ip_location || user.ipLocation || ""),
    followerCount: Number(user.follower_count || user.followerCount || 0),
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureSignedUserProfile(win, secUid) {
  const key = String(secUid || "").trim();
  if (!key || win.isDestroyed() || win.webContents.isDestroyed()) return null;
  return win.webContents.executeJavaScript(`
    (async () => {
      const secUid = ${JSON.stringify(key)};
      const compact = (user) => user ? ({
        userId: String(user.uid || user.uid_str || user.id_str || user.id || ""),
        secUid: String(user.sec_uid || user.secUid || user.sec_user_id || ""),
        uniqueId: String(user.unique_id || user.uniqueId || user.display_id || user.displayId || user.short_id || ""),
        nickname: String(user.nickname || ""),
        ipLocation: String(user.ip_location || user.ipLocation || ""),
        followerCount: Number(user.follower_count || user.followerCount || 0),
      }) : null;

      try {
        let webpackRequire = null;
        const chunkName = "live_pk_profile_" + Date.now();
        (self.webpackChunkdouyin_live_v2 = self.webpackChunkdouyin_live_v2 || [])
          .push([[chunkName], {}, (req) => { webpackRequire = req; }]);
        if (webpackRequire) {
          const api = webpackRequire(351485);
          const constants = webpackRequire(167675);
          const result = await api.U2(
            "/aweme/v1/web/user/profile/other/",
            { ...constants.COMMON_SEARCH_PARAMS, source: constants.CHANNEL_PC_WEB, sec_user_id: secUid },
            {},
            undefined
          );
          if (result?.status_code === 0 && result?.user) return compact(result.user);
        }
      } catch {
        // Fall through to signed fetch. The page has already installed proxyFetch.
      }

      const url = new URL("https://www.douyin.com/aweme/v1/web/user/profile/other/");
      const params = {
        device_platform: "webapp",
        aid: "6383",
        channel: "channel_pc_web",
        publish_video_strategy_type: "2",
        source: "channel_pc_web",
        update_version_code: "170400",
        pc_client_type: "1",
        version_code: "170400",
        version_name: "17.4.0",
        cookie_enabled: "true",
        browser_language: navigator.language || "zh-CN",
        browser_platform: navigator.platform || "MacIntel",
        browser_name: "Chrome",
        browser_version: "149.0.0.0",
        browser_online: String(navigator.onLine),
        engine_name: "Blink",
        engine_version: "149.0.0.0",
        os_name: "Mac OS",
        os_version: "10.15.7",
        device_memory: String(navigator.deviceMemory || 8),
        platform: "PC",
        downlink: "10",
        effective_type: "4g",
        round_trip_time: "50",
        sec_user_id: secUid,
        msToken: "",
      };
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      const response = await fetch(url.toString(), {
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" },
      });
      const json = await response.json().catch(() => null);
      return json?.status_code === 0 ? compact(json.user) : null;
    })()
  `, true).then(compactProfileOtherUser);
}

function parseCookiePairs(cookieText) {
  return String(cookieText || "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => /^[^=;\s]+=[\s\S]*$/.test(item))
    .map((item) => {
      const index = item.indexOf("=");
      return {
        name: item.slice(0, index).trim(),
        value: item.slice(index + 1).trim(),
      };
    })
    .filter((item) => item.name && item.value && !/[\u0000-\u001f\u007f]/.test(item.value));
}

async function removeExistingCookies(ses, targetUrl, names) {
  const origins = [
    "https://live.douyin.com",
    "https://www.douyin.com",
    new URL(targetUrl).origin,
  ];
  const uniqueNames = Array.from(new Set(names));
  await Promise.all(origins.flatMap((origin) =>
    uniqueNames.map((name) => ses.cookies.remove(origin, name).catch(() => undefined))
  ));
}

function cookieWriteTargets(targetUrl, cookie) {
  const url = new URL(targetUrl);
  return [
    {
      url: "https://www.douyin.com",
      domain: ".douyin.com",
      path: "/",
    },
    {
      url: "https://live.douyin.com",
      domain: ".douyin.com",
      path: "/",
    },
    {
      url: "https://www.douyin.com",
      path: "/",
    },
    {
      url: "https://live.douyin.com",
      path: "/",
    },
    {
      url: url.origin,
      path: "/",
    },
  ].map((target) => ({
    ...target,
    name: cookie.name,
    value: cookie.value,
    secure: true,
    httpOnly: false,
    sameSite: "no_restriction",
  }));
}

async function injectCookieHeader(ses, targetUrl, cookieText) {
  const pairs = parseCookiePairs(cookieText);
  const criticalNames = ["sessionid", "sessionid_ss", "sid_tt", "uid_tt", "uid_tt_ss", "ttwid"];
  if (pairs.length === 0) {
    return { total: 0, set: 0, failed: 0, criticalPresent: [] };
  }

  await removeExistingCookies(ses, targetUrl, pairs.map((item) => item.name));

  let set = 0;
  let failed = 0;
  for (const cookie of pairs) {
    let written = false;
    let attempts = 0;
    try {
      for (const target of cookieWriteTargets(targetUrl, cookie)) {
        attempts += 1;
        await ses.cookies.set(target);
        written = true;
      }
    } catch {
      // Try the remaining cookies even if one cookie has a bad value or unsupported attribute.
    }
    if (written) {
      set += 1;
    } else {
      failed += Math.max(1, attempts);
    }
  }

  const [liveCookies, wwwCookies] = await Promise.all([
    ses.cookies.get({ url: "https://live.douyin.com" }),
    ses.cookies.get({ url: "https://www.douyin.com" }),
  ]);
  const livePresent = new Set(liveCookies.filter((item) => item.value).map((item) => item.name));
  const wwwPresent = new Set(wwwCookies.filter((item) => item.value).map((item) => item.name));
  const present = new Set([...livePresent, ...wwwPresent]);
  return {
    total: pairs.length,
    set,
    failed,
    criticalPresent: criticalNames.filter((name) => present.has(name)),
    criticalLivePresent: criticalNames.filter((name) => livePresent.has(name)),
    criticalWwwPresent: criticalNames.filter((name) => wwwPresent.has(name)),
  };
}

async function getCookieHeader(ses, url) {
  const cookies = await ses.cookies.get({ url });
  return cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function scanOpenWebSockets(debuggerApi) {
  const objectGroup = "live-pk-websocket-scan";
  try {
    const proto = await debuggerApi.sendCommand("Runtime.evaluate", {
      expression: "WebSocket.prototype",
      objectGroup,
      returnByValue: false,
      silent: true,
    });
    const prototypeObjectId = proto.result?.objectId;
    if (!prototypeObjectId) return "";

    const queried = await debuggerApi.sendCommand("Runtime.queryObjects", {
      prototypeObjectId,
      objectGroup,
    });
    const socketsObjectId = queried.objects?.objectId;
    if (!socketsObjectId) return "";

    const result = await debuggerApi.sendCommand("Runtime.callFunctionOn", {
      objectId: socketsObjectId,
      functionDeclaration: `
        function () {
          return Array.from(this)
            .filter(socket => socket.readyState === 1)
            .map(socket => socket.url)
            .filter(url => typeof url === "string" && url.includes("webcast/im/push"));
        }
      `,
      returnByValue: true,
      silent: true,
    });
    const urls = result.result?.value;
    return Array.isArray(urls) ? urls[0] || "" : "";
  } finally {
    await debuggerApi.sendCommand("Runtime.releaseObjectGroup", { objectGroup }).catch(() => {});
  }
}

function captureDouyinLiveOptions(liveRoomUrl, { parentWindow, onStatus, cookie, show = true } = {}) {
  const url = normalizeLiveRoomUrl(liveRoomUrl);
  let settled = false;
  let capturedWebSocketUrl = "";
  let scanTimer = null;
  let timeoutTimer = null;
  let finalizeTimer = null;
  let pendingOptions = null;
  let pendingProfilePromise = null;
  const trackedRequests = new Map();
  const sourceUrl = new URL(url);
  const bootstrap = {
    sourceUrl: url,
    webRid: sourceUrl.pathname.split("/").filter(Boolean)[0] || "",
  };

  const win = new BrowserWindow({
    width: show ? 1120 : 480,
    height: show ? 760 : 854,
    x: show ? undefined : -10000,
    y: show ? undefined : -10000,
    parent: parentWindow || undefined,
    title: "直播监控采集",
    backgroundColor: "#ffffff",
    show: true,
    skipTaskbar: !show,
    focusable: show,
    webPreferences: {
      partition: "persist:live-pk-capture",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/\sElectron\/\S+/g, ""));

  const cleanup = () => {
    if (scanTimer) clearInterval(scanTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (finalizeTimer) clearTimeout(finalizeTimer);
    scanTimer = null;
    timeoutTimer = null;
    finalizeTimer = null;
    try {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    } catch {
      // ignore detach errors
    }
  };

  const promise = new Promise((resolve, reject) => {
    const ensureAnchorProfile = (roomEnter) => {
      if (bootstrap.anchorProfile || pendingProfilePromise) return;
      const secUid = readAnchorSecUidFromRoomEnter(roomEnter);
      if (!secUid) return;
      pendingProfilePromise = captureSignedUserProfile(win, secUid)
        .then((profile) => {
          if (!profile?.uniqueId) return;
          bootstrap.anchorProfile = profile;
          onStatus?.(`已补充主播抖音号: ${profile.uniqueId}`);
        })
        .catch(() => undefined);
    };

    const settle = async () => {
      if (settled) return;
      const options = pendingOptions;
      if (!isPushWebSocket(options?.websocketUrl) && !isLiveImFetch(options?.fetchUrl)) return;
      settled = true;
      try {
        if (pendingProfilePromise && !bootstrap.anchorProfile) {
          onStatus?.("正在补充主播公开资料");
          await Promise.race([pendingProfilePromise, wait(2500)]);
        }
        cleanup();
        onStatus?.("已获取直播间 IM 连接，正在读取 Cookie");
        const cookie = await getCookieHeader(win.webContents.session, url);
        resolve({ ...options, cookie, bootstrap });
        if (!win.isDestroyed()) win.close();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    const finish = (options) => {
      if (settled) return;
      if (!isPushWebSocket(options?.websocketUrl) && !isLiveImFetch(options?.fetchUrl)) return;
      pendingOptions = { ...(pendingOptions || {}), ...options };
      if (finalizeTimer) return;
      onStatus?.("已获取 IM 连接，正在补充房间/礼物/榜单数据");
      finalizeTimer = setTimeout(() => {
        finalizeTimer = null;
        void settle();
      }, 2500);
    };

    const tryFastSettle = () => {
      if (!pendingOptions || !finalizeTimer) return;
      if (!bootstrap.roomEnter || !bootstrap.giftList || !bootstrap.audienceRank) return;
      clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(() => {
        finalizeTimer = null;
        void settle();
      }, 350);
    };

    try {
      win.webContents.debugger.attach("1.3");
      win.webContents.debugger.sendCommand("Network.enable").catch(() => {});
      win.webContents.debugger.sendCommand("Runtime.enable").catch(() => {});
    } catch (error) {
      cleanup();
      reject(new Error(`无法启动内置采集器：${error.message || error}`));
      return;
    }

    win.webContents.debugger.on("message", (_event, method, params) => {
      const requestUrl = params?.url || params?.request?.url;
      const requestId = params?.requestId;
      if ((method === "Network.webSocketCreated" || method === "Network.requestWillBeSent") && isPushWebSocket(requestUrl)) {
        capturedWebSocketUrl = requestUrl;
        finish({ websocketUrl: capturedWebSocketUrl });
      }
      if (method === "Network.requestWillBeSent" && isLiveImFetch(requestUrl)) {
        finish({
          fetchUrl: requestUrl,
          fetchHeaders: params?.request?.headers || {},
        });
      }
      if (method === "Network.requestWillBeSent") {
        const key = bootstrapKeyForUrl(requestUrl);
        if (key && requestId) trackedRequests.set(requestId, { key, url: requestUrl });
      }
      if (method === "Network.loadingFinished" && requestId && trackedRequests.has(requestId)) {
        const info = trackedRequests.get(requestId);
        trackedRequests.delete(requestId);
        win.webContents.debugger.sendCommand("Network.getResponseBody", { requestId })
          .then((bodyResult) => {
            const parsed = parseResponseBody(bodyResult?.body, bodyResult?.base64Encoded);
            if (!parsed) return;
            if (!bootstrap[info.key]) {
              bootstrap[info.key] = parsed;
              if (info.key === "roomEnter") ensureAnchorProfile(parsed);
              onStatus?.(`已补充 ${Object.keys(bootstrap).length} 类首屏数据`);
              tryFastSettle();
            }
          })
          .catch(() => {});
      }
    });

    win.webContents.on("did-finish-load", () => {
      onStatus?.("直播间已打开，正在等待 IM 连接");
    });

    win.on("closed", () => {
      cleanup();
      if (!settled) {
        settled = true;
        reject(new Error("采集窗口已关闭"));
      }
    });

    scanTimer = setInterval(async () => {
      if (settled || !win || win.isDestroyed()) return;
      const websocketUrl = await scanOpenWebSockets(win.webContents.debugger).catch(() => "");
      if (websocketUrl) void finish({ websocketUrl });
    }, 1500);

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      cleanup();
      settled = true;
      reject(new Error("未获取到直播间 IM 连接，请确认直播间正在直播"));
    }, 90000);

    Promise.resolve()
      .then(async () => {
        const injected = await injectCookieHeader(win.webContents.session, url, cookie);
        if (injected.total > 0) {
          const critical = injected.criticalPresent.length
            ? `关键项: ${injected.criticalPresent.join(", ")}`
            : "关键项缺失";
          const liveCritical = injected.criticalLivePresent?.length
            ? `live: ${injected.criticalLivePresent.join(", ")}`
            : "live: 缺失";
          const wwwCritical = injected.criticalWwwPresent?.length
            ? `www: ${injected.criticalWwwPresent.join(", ")}`
            : "www: 缺失";
          onStatus?.(`已注入 Cookie ${injected.set}/${injected.total} 项，${critical}，${liveCritical}，${wwwCritical}，正在打开直播间`);
        } else {
          onStatus?.("正在打开直播间");
        }
        await win.loadURL(url);
      })
      .catch(reject);
  });

  return { window: win, promise };
}

module.exports = {
  captureDouyinLiveOptions,
  getCookieHeader,
  injectCookieHeader,
  normalizeLiveRoomUrl,
  scanOpenWebSockets,
};
