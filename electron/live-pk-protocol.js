"use strict";

/**
 * Pure-protocol Douyin live enter client.
 *
 * Replaces BrowserWindow+CDP capture for room enter / IM push discovery:
 *   1. Fetch live page → ttwid cookie
 *   2. GET webcast/room/web/enter (no a_bogus required)
 *   3. Bootstrap gift/list + linkmic/list
 *   4. Build wss://…/webcast/im/push/v2/ and sign with frontierSign (sign.js)
 *   5. Hand websocketUrl + bootstrap to LivePkWatcher
 */

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { URL } = require("url");

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SIGN_PARAM_KEYS = [
  "live_id",
  "aid",
  "version_code",
  "webcast_sdk_version",
  "room_id",
  "sub_room_id",
  "sub_channel_id",
  "did_rule",
  "user_unique_id",
  "device_platform",
  "device_type",
  "ac",
  "identity",
];
const WSS_HOST = "wss://webcast100-ws-web-lq.douyin.com";
const WSS_PATH = "/webcast/im/push/v2/";
const WEBCAST_SDK_VERSION = "1.0.14-beta.0";
const VERSION_CODE = "180800";
const AID = "6383";
const GIFT_LIST_CACHE_TTL_MS = 30 * 60 * 1000;

// Keep-alive agents: multi-room enter reuses sockets instead of one TCP+TLS per request.
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 32,
  maxFreeSockets: 16,
  scheduling: "lifo",
});
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 16,
  maxFreeSockets: 8,
});

let signFnCache = null;
let processUserUniqueId = "";
let sharedGiftListCache = null;
let sharedGiftListAt = 0;
let sharedGiftListInflight = null;

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function md5Hex(value) {
  return crypto.createHash("md5").update(String(value), "utf8").digest("hex");
}

function normalizeLiveRoomUrl(value) {
  const raw = text(value);
  if (!raw) throw new Error("缺少直播间地址");
  let url;
  try {
    if (/^\d{6,}$/.test(raw)) {
      url = new URL(`https://live.douyin.com/${raw}`);
    } else {
      url = new URL(raw);
    }
  } catch {
    throw new Error("直播间地址格式不正确");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("直播间地址必须是 http/https");
  if (!url.hostname.endsWith("douyin.com")) throw new Error("仅支持抖音直播间地址");
  return url.toString();
}

function extractWebRid(liveRoomUrl) {
  const url = new URL(normalizeLiveRoomUrl(liveRoomUrl));
  const seg = url.pathname.split("/").filter(Boolean)[0] || "";
  if (!seg) throw new Error("无法从直播间地址解析 web_rid");
  return seg;
}

function parseSetCookie(setCookie, existing = "") {
  const map = new Map();
  for (const part of String(existing || "").split(";")) {
    const item = part.trim();
    if (!item) continue;
    const index = item.indexOf("=");
    if (index > 0) map.set(item.slice(0, index).trim(), item.slice(index + 1).trim());
  }
  for (const line of setCookie || []) {
    const item = String(line).split(";")[0];
    const index = item.indexOf("=");
    if (index > 0) map.set(item.slice(0, index).trim(), item.slice(index + 1).trim());
  }
  return [...map.entries()]
    .filter(([name, value]) => name && value)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function mergeCookieHeader(base, extra) {
  return parseSetCookie([], [base, extra].filter(Boolean).join("; "));
}

function cookieValue(cookieHeader, name) {
  const target = String(name || "").toLowerCase();
  for (const part of String(cookieHeader || "").split(";")) {
    const item = part.trim();
    const index = item.indexOf("=");
    if (index <= 0) continue;
    if (item.slice(0, index).trim().toLowerCase() === target) {
      return item.slice(index + 1).trim();
    }
  }
  return "";
}

function cleanHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/** 永久失败不重试：地址/rid 明显非法；其余网络/限流/空房暂态可重试 */
function isRetryableEnterError(error) {
  const msg = String(error?.message || error || "");
  if (/缺少直播间|格式不正确|仅支持|无法从直播间地址解析/.test(msg)) return false;
  return true;
}

/**
 * 协议进房瞬态失败重试（限流、空 body、偶发 status_code）。
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{ attempts?: number, baseDelayMs?: number, onRetry?: (error: Error, attempt: number, delayMs: number) => void }} [opts]
 */
async function withEnterRetry(fn, { attempts = 3, baseDelayMs = 450, onRetry } = {}) {
  const max = Math.max(1, Math.min(6, Number(attempts) || 3));
  const base = Math.max(50, Number(baseDelayMs) || 450);
  let lastError;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= max || !isRetryableEnterError(lastError)) throw lastError;
      const delayMs = base * attempt;
      try {
        onRetry?.(lastError, attempt, delayMs);
      } catch {
        // status 回调不得打断重试
      }
      await sleep(delayMs);
    }
  }
  throw lastError || new Error("协议进房重试失败");
}

function requestJsonOrText(url, { method = "GET", headers = {}, body, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isHttp = target.protocol === "http:";
    const lib = isHttp ? http : https;
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        path: target.pathname + target.search,
        method,
        agent: isHttp ? httpAgent : httpsAgent,
        headers: cleanHeaders({
          "user-agent": DEFAULT_UA,
          accept: "*/*",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          ...headers,
        }),
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          resolve({
            status: res.statusCode || 0,
            headers: res.headers || {},
            raw,
            body: raw.toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时: ${target.hostname}`)));
    if (body) req.write(body);
    req.end();
  });
}

function getProcessUserUniqueId() {
  if (processUserUniqueId) return processUserUniqueId;
  // 19-digit style id; stable per process so multi-room shares one did.
  const now = BigInt(Date.now());
  const rand = BigInt(crypto.randomBytes(4).readUInt32BE(0));
  processUserUniqueId = String((now * 10000n + (rand % 10000n)) % 10000000000000000000n);
  if (processUserUniqueId.length < 16) {
    processUserUniqueId = processUserUniqueId.padStart(16, "7");
  }
  return processUserUniqueId;
}

function loadSignFn() {
  if (signFnCache) return signFnCache;
  const signPath = path.join(__dirname, "vendor", "douyin-wss-sign.js");
  if (!fs.existsSync(signPath)) {
    throw new Error(`缺少 WSS 签名脚本: ${signPath}`);
  }
  const code = fs.readFileSync(signPath, "utf8");
  const document = {
    cookie: "",
    referrer: "https://live.douyin.com/",
    location: {
      href: "https://live.douyin.com/",
      protocol: "https:",
      host: "live.douyin.com",
      hostname: "live.douyin.com",
      pathname: "/",
    },
    createElement: () => ({
      style: {},
      setAttribute() {},
      appendChild() {},
      remove() {},
      getContext: () => null,
    }),
    getElementsByTagName: () => [],
    documentElement: { style: {} },
    body: { appendChild() {}, removeChild() {} },
    head: { appendChild() {} },
  };
  const navigator = {
    userAgent: DEFAULT_UA,
    platform: "MacIntel",
    language: "zh-CN",
    languages: ["zh-CN", "zh"],
    webdriver: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    plugins: { length: 0 },
    mimeTypes: { length: 0 },
  };
  const location = document.location;
  const screen = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1080,
    colorDepth: 24,
    pixelDepth: 24,
  };
  const windowObj = {
    document,
    navigator,
    location,
    screen,
    innerWidth: 1920,
    innerHeight: 1080,
    outerWidth: 1920,
    outerHeight: 1080,
    devicePixelRatio: 2,
    history: { length: 1 },
    chrome: { runtime: {} },
    performance: { now: () => Date.now() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    addEventListener() {},
    removeEventListener() {},
  };
  windowObj.window = windowObj;
  windowObj.self = windowObj;
  windowObj.top = windowObj;
  windowObj.parent = windowObj;
  windowObj.globalThis = windowObj;

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    atob: (value) => Buffer.from(String(value), "base64").toString("binary"),
    btoa: (value) => Buffer.from(String(value), "binary").toString("base64"),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: windowObj,
    document,
    navigator,
    location,
    screen,
    self: windowObj,
    top: windowObj,
    parent: windowObj,
    globalThis: windowObj,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 15000, filename: "douyin-wss-sign.js" });
  if (typeof sandbox.get_sign !== "function") {
    throw new Error("WSS 签名脚本未导出 get_sign");
  }
  signFnCache = sandbox.get_sign;
  return signFnCache;
}

function signPushUrl(unsignedUrl) {
  const getSign = loadSignFn();
  const url = new URL(unsignedUrl);
  const stubSource = SIGN_PARAM_KEYS.map((key) => `${key}=${url.searchParams.get(key) || ""}`).join(",");
  const stub = md5Hex(stubSource);
  const signature = getSign(stub);
  if (!signature) throw new Error("WSS signature 生成失败");
  url.searchParams.set("signature", String(signature));
  return url.toString();
}

function buildCommonQuery(extra = {}) {
  return {
    aid: AID,
    app_name: "douyin_web",
    live_id: "1",
    device_platform: "web",
    language: "zh-CN",
    cookie_enabled: "true",
    screen_width: "1920",
    screen_height: "1080",
    browser_language: "zh-CN",
    browser_platform: "MacIntel",
    browser_name: "Chrome",
    browser_version: "126.0.0.0",
    browser_online: "true",
    tz_name: "Asia/Shanghai",
    ...extra,
  };
}

function withQuery(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchTtwid(liveRoomUrl, cookieHeader = "") {
  const response = await requestJsonOrText(liveRoomUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: "https://live.douyin.com/",
      cookie: cookieHeader || undefined,
    },
  });
  const merged = parseSetCookie(response.headers["set-cookie"], cookieHeader);
  if (!cookieValue(merged, "ttwid")) {
    // Some regions set ttwid only on bare origin.
    const origin = await requestJsonOrText("https://live.douyin.com/", {
      headers: {
        accept: "text/html",
        cookie: merged || undefined,
      },
    });
    return parseSetCookie(origin.headers["set-cookie"], merged);
  }
  return merged;
}

async function fetchRoomEnter(webRid, cookieHeader) {
  const url = withQuery("https://live.douyin.com/webcast/room/web/enter/", buildCommonQuery({
    enter_from: "web_live",
    web_rid: String(webRid),
    enter_source: "",
    is_need_double_stream: "false",
    insert_task_id: "",
    live_reason: "",
  }));
  const response = await requestJsonOrText(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: `https://live.douyin.com/${webRid}`,
      origin: "https://live.douyin.com",
      cookie: cookieHeader || undefined,
    },
  });
  const cookie = parseSetCookie(response.headers["set-cookie"], cookieHeader);
  let json = null;
  try {
    json = JSON.parse(response.body || "{}");
  } catch {
    throw new Error(`room/web/enter 返回非 JSON (${response.status})`);
  }
  if (Number(json?.status_code) !== 0) {
    throw new Error(`room/web/enter 失败 status_code=${json?.status_code ?? "unknown"}`);
  }
  const room = json?.data?.data?.[0] || json?.data?.room || null;
  if (!room) throw new Error("room/web/enter 未返回房间数据（可能未开播或 web_rid 无效）");
  return { json, room, cookie };
}

async function fetchWebcastJson(pathname, roomId, webRid, cookieHeader, extra = {}) {
  const url = withQuery(`https://live.douyin.com${pathname}`, buildCommonQuery({
    room_id: String(roomId),
    ...extra,
  }));
  const response = await requestJsonOrText(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: `https://live.douyin.com/${webRid}`,
      origin: "https://live.douyin.com",
      cookie: cookieHeader || undefined,
    },
  });
  if (!response.body) return null;
  try {
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}

function buildUnsignedPushUrl(roomId, userUniqueId) {
  const now = Date.now();
  const cursor = `t-${now}_r-1_d-1_u-1_h-1`;
  const internalExt = [
    "internal_src:dim",
    `wss_push_room_id:${roomId}`,
    `wss_push_did:${userUniqueId}`,
    `first_req_ms:${now}`,
    `fetch_time:${now}`,
    "seq:1",
    `wss_info:0-${now}-0-0`,
    "wrds_v:0",
  ].join("|");
  return withQuery(`${WSS_HOST}${WSS_PATH}`, {
    app_name: "douyin_web",
    version_code: VERSION_CODE,
    webcast_sdk_version: WEBCAST_SDK_VERSION,
    update_version_code: WEBCAST_SDK_VERSION,
    compress: "gzip",
    device_platform: "web",
    cookie_enabled: "true",
    screen_width: "1920",
    screen_height: "1080",
    browser_language: "zh-CN",
    browser_platform: "MacIntel",
    browser_name: "Mozilla",
    browser_version: "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    browser_online: "true",
    tz_name: "Asia/Shanghai",
    cursor,
    internal_ext: internalExt,
    host: "https://live.douyin.com",
    aid: AID,
    live_id: "1",
    did_rule: "3",
    endpoint: "live_pc",
    support_wrds: "1",
    user_unique_id: String(userUniqueId),
    im_path: "/webcast/im/fetch/",
    identity: "audience",
    need_persist_msg_count: "15",
    insert_task_id: "",
    live_reason: "",
    room_id: String(roomId),
    heartbeatDuration: "0",
  });
}

function reshapeGiftList(json) {
  if (!json || typeof json !== "object") return json;
  const data = json.data && typeof json.data === "object" ? json.data : null;
  if (!data) return json;
  const pages = Array.isArray(data.pages) ? data.pages : [];
  if (pages.length > 0) return json;
  const gifts = Array.isArray(data.gifts) ? data.gifts : [];
  if (gifts.length === 0) return json;
  return {
    ...json,
    data: {
      ...data,
      pages: [
        {
          page_name: "all",
          pageName: "all",
          gifts,
        },
      ],
    },
  };
}

async function fetchGiftListShared(roomId, webRid, cookieHeader) {
  const now = Date.now();
  if (sharedGiftListCache && now - sharedGiftListAt < GIFT_LIST_CACHE_TTL_MS) {
    return sharedGiftListCache;
  }
  if (sharedGiftListInflight) return sharedGiftListInflight;
  sharedGiftListInflight = (async () => {
    try {
      const raw = await fetchWebcastJson("/webcast/gift/list/", roomId, webRid, cookieHeader);
      const shaped = reshapeGiftList(raw);
      if (shaped?.data?.pages?.length || shaped?.data?.gifts?.length) {
        sharedGiftListCache = shaped;
        sharedGiftListAt = Date.now();
      }
      return shaped;
    } finally {
      sharedGiftListInflight = null;
    }
  })();
  return sharedGiftListInflight;
}

function createLinkmicSnapshotLookup({ roomId, webRid, cookieHeader }) {
  let cookie = cookieHeader;
  let inflight = null;
  return async () => {
    // Coalesce concurrent ticks from adaptive poller + bootstrap.
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const json = await fetchWebcastJson(
          "/webcast/linkmic/list/",
          roomId,
          webRid,
          cookie,
          {}
        );
        if (!json || Number(json.status_code) !== 0) return null;
        if (!json.extra || typeof json.extra !== "object") json.extra = {};
        json.extra.source = "protocol-linkmic-list";
        json.extra.now = Date.now();
        return json;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}

/**
 * Resolve IM connection options for a live room without opening a browser page.
 * @param {string} liveRoomUrl
 * @param {{
 *   cookie?: string,
 *   onStatus?: (msg: string) => void,
 *   bootstrapMode?: "full" | "lean" | "score",
 *   shareGiftList?: boolean,
 * }} [options]
 * bootstrapMode:
 *   - full: gift/list + linkmic/list + audience rank (single-room default)
 *   - lean: only linkmic/list (+ shared gift catalog). Multi-room legacy.
 *   - score: 只拉 linkmic/list（音浪），不拉 gift/list。多主播默认。
 */
async function resolveDouyinLiveOptions(liveRoomUrl, {
  cookie = "",
  onStatus,
  bootstrapMode = "full",
  shareGiftList = true,
} = {}) {
  const sourceUrl = normalizeLiveRoomUrl(liveRoomUrl);
  const webRid = extractWebRid(sourceUrl);
  const userCookie = text(cookie);
  const scoreOnly = bootstrapMode === "score";
  const lean = bootstrapMode === "lean" || scoreOnly;
  const notify = (message) => {
    try {
      onStatus?.(message);
    } catch {
      // status callbacks must never break enter
    }
  };

  notify("协议进房：获取 ttwid");
  let cookieHeader = await fetchTtwid(sourceUrl, userCookie);
  if (userCookie) cookieHeader = mergeCookieHeader(cookieHeader, userCookie);
  if (!cookieValue(cookieHeader, "ttwid")) {
    throw new Error("协议进房失败：未拿到 ttwid");
  }

  notify(`协议进房：解析房间 ${webRid}`);
  // 进房偶发限流/空数据 → 刷新 ttwid 后重试，避免「有人不能进入」一次定死
  const entered = await withEnterRetry(
    async (attempt) => {
      if (attempt > 1) {
        notify(`协议进房：刷新 ttwid（第 ${attempt} 次）`);
        cookieHeader = await fetchTtwid(sourceUrl, userCookie);
        if (userCookie) cookieHeader = mergeCookieHeader(cookieHeader, userCookie);
        if (!cookieValue(cookieHeader, "ttwid")) {
          throw new Error("协议进房失败：未拿到 ttwid");
        }
      }
      return fetchRoomEnter(webRid, cookieHeader);
    },
    {
      attempts: 3,
      baseDelayMs: 450,
      onRetry: (error, attempt, delayMs) => {
        notify(`协议进房重试 ${attempt}/3：${error.message || error} · ${delayMs}ms`);
      },
    }
  );
  cookieHeader = entered.cookie || cookieHeader;
  if (userCookie) cookieHeader = mergeCookieHeader(cookieHeader, userCookie);
  const room = entered.room;
  const roomId = text(room.id_str || room.id);
  if (!roomId) throw new Error("协议进房失败：缺少 room_id");
  if (Number(room.status) !== 0 && Number(room.status) !== 2) {
    // status 2 = living in current captures; 0 sometimes offline shell
    notify(`房间状态 status=${room.status}，继续尝试连接 IM`);
  }

  notify(
    scoreOnly
      ? "协议进房：音浪快照（连线分）"
      : lean
        ? "协议进房：精简快照（连线）"
        : "协议进房：拉取礼物/连线快照"
  );
  let giftList = null;
  let linkmicList = null;
  let audienceRank = null;
  if (scoreOnly) {
    // 多主播音浪：只需要 linkmic/list 拿分，完全不碰 gift catalog。
    linkmicList = await fetchWebcastJson("/webcast/linkmic/list/", roomId, webRid, cookieHeader);
  } else if (lean) {
    const [gift, linkmic] = await Promise.all([
      shareGiftList
        ? fetchGiftListShared(roomId, webRid, cookieHeader)
        : Promise.resolve(null),
      fetchWebcastJson("/webcast/linkmic/list/", roomId, webRid, cookieHeader),
    ]);
    giftList = gift;
    linkmicList = linkmic;
  } else {
    const [giftListRaw, linkmic, rank] = await Promise.all([
      shareGiftList
        ? fetchGiftListShared(roomId, webRid, cookieHeader)
        : fetchWebcastJson("/webcast/gift/list/", roomId, webRid, cookieHeader).then(reshapeGiftList),
      fetchWebcastJson("/webcast/linkmic/list/", roomId, webRid, cookieHeader),
      fetchWebcastJson("/webcast/ranklist/audience/", roomId, webRid, cookieHeader, {
        rank_type: "30",
      }),
    ]);
    giftList = giftListRaw;
    linkmicList = linkmic;
    audienceRank = rank;
  }

  notify("协议进房：签名 IM WebSocket");
  const userUniqueId = getProcessUserUniqueId();
  const unsigned = buildUnsignedPushUrl(roomId, userUniqueId);
  const websocketUrl = signPushUrl(unsigned);

  // Prefer ttwid (+ optional login cookies) for the socket; full jar is fine.
  const ttwid = cookieValue(cookieHeader, "ttwid");
  const socketCookie = userCookie
    ? cookieHeader
    : ttwid
      ? `ttwid=${ttwid}`
      : cookieHeader;

  const bootstrap = {
    sourceUrl,
    webRid,
    roomId,
    roomEnter: entered.json,
    giftList,
    linkmicList,
    audienceRank,
    protocol: true,
    bootstrapMode: scoreOnly ? "score" : lean ? "lean" : "full",
    scoreOnly,
  };

  notify(`协议进房完成 room_id=${roomId}`);
  return {
    websocketUrl,
    cookie: socketCookie,
    bootstrap,
    profileLookup: null,
    linkmicSnapshotLookup: createLinkmicSnapshotLookup({
      roomId,
      webRid,
      cookieHeader: socketCookie,
    }),
    source: "protocol",
    roomId,
    webRid,
    scoreOnly,
  };
}

module.exports = {
  normalizeLiveRoomUrl,
  extractWebRid,
  resolveDouyinLiveOptions,
  signPushUrl,
  buildUnsignedPushUrl,
  reshapeGiftList,
  fetchGiftListShared,
  isRetryableEnterError,
  withEnterRetry,
};
