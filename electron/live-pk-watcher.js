const { EventEmitter } = require("events");
const path = require("path");
const zlib = require("zlib");
const WebSocket = require("ws");
const protobuf = require("protobufjs");

const PROTO_ROOT = path.join(__dirname, "..", "assets", "live-room-watcher", "proto");

let protobufRootPromise = null;

function loadProtoRoot() {
  if (!protobufRootPromise) {
    protobufRootPromise = new Promise((resolve, reject) => {
      const root = new protobuf.Root();
      root.resolvePath = (_origin, target) => path.join(PROTO_ROOT, target);
      root.load(
        [
          "douyin_hack/webcast/im/PushFrame.proto",
          "douyin_hack/webcast/im/Response.proto",
          "douyin_hack/webcast/im/ChatMessage.proto",
          "douyin_hack/webcast/im/MemberMessage.proto",
          "douyin_hack/webcast/im/RoomRankMessage.proto",
          "douyin_hack/webcast/im/RoomUserSeqMessage.proto",
          "douyin_hack/webcast/im/RoomStatsMessage.proto",
          "douyin_hack/webcast/im/ProfitInteractionScoreMessage.proto",
          "douyin_hack/webcast/im/GiftMessage.proto",
          "douyin_hack/webcast/im/FreeCellGiftMessage.proto",
          "douyin_hack/webcast/im/DoodleGiftMessage.proto",
          "douyin_hack/webcast/im/FreeGiftMessage.proto",
          "douyin_hack/webcast/im/FansclubMessage.proto",
          "douyin_hack/webcast/im/SocialMessage.proto",
          "douyin_hack/webcast/im/LikeMessage.proto",
          "douyin_hack/webcast/im/ContentOpenPicoLikeMessage.proto",
          "douyin_hack/webcast/im/ChatLikeMessage.proto",
          "douyin_hack/webcast/im/RoomMessage.proto",
          "douyin_hack/webcast/im/RoomVerifyMessage.proto",
          "douyin_hack/webcast/im/RoomStartMessage.proto",
          "douyin_hack/webcast/im/ShortTouchAreaMessage.proto",
          "douyin_hack/webcast/im/InRoomBannerMessage.proto",
          "douyin_hack/webcast/im/RanklistHourEntranceMessage.proto",
          "douyin_hack/webcast/im/RankListHourEnterMessage.proto",
          "douyin_hack/webcast/im/GiftUpdateMessage.proto",
          "douyin_hack/webcast/im/LinkmicPlayModeUpdateScoreMessage.proto",
        ],
        { keepCase: false },
        (error, loadedRoot) => {
          if (error) reject(error);
          else resolve(loadedRoot.resolveAll());
        }
      );
    });
  }
  return protobufRootPromise;
}

function parseCookieHeader(cookieText) {
  return String(cookieText || "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => /^[^=;\s]+=[\s\S]*$/.test(item))
    .filter(Boolean)
    .join("; ");
}

function normalizeScore(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value || "").replace(/,/g, "").trim().toLowerCase();
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const base = Number(match[0]);
  if (!Number.isFinite(base)) return 0;
  if (text.includes("亿")) return Math.round(base * 100000000);
  if (text.includes("万") || text.includes("w")) return Math.round(base * 10000);
  if (text.includes("k")) return Math.round(base * 1000);
  return base;
}

function readCount(...values) {
  for (const value of values) {
    const count = Number(value || 0);
    if (Number.isFinite(count) && count > 0) return count;
  }
  return 1;
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function firstValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    return value;
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value || 0);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function toIsoTime(value) {
  const timestamp = toNumber(value);
  return timestamp > 0 ? new Date(timestamp).toISOString() : "";
}

function readText(text) {
  return String(text?.defaultPattern || text?.key || "").trim();
}

function readUserId(user) {
  if (!user) return "";
  const value = firstValue(user.idStr, user.id_str, user.userId, user.user_id, user.id);
  const text = value ? String(value) : "";
  return text === "111111" ? "" : text;
}

function readUniqueId(user) {
  if (!user) return "";
  const shortId = Number(firstValue(user.shortId, user.short_id, 0));
  return (
    firstValue(
      user.uniqueId,
      user.unique_id,
      user.displayId,
      user.display_id,
      user.webRid,
      user.web_rid
    ) || (shortId > 0 ? String(shortId) : "")
  );
}

function hasStrongUserIdentity(user) {
  const userId = String(user?.userId || "").trim();
  return Boolean(user?.uniqueId || user?.secUid || user?.webcastUid || (userId && userId !== "111111"));
}

function userIdentitySource(user, source = "") {
  if (user?.identitySource) return user.identitySource;
  const prefix = source ? `${source}.` : "";
  if (user?.uniqueId) return `${prefix}display_id`;
  if (user?.secUid) return `${prefix}sec_uid`;
  if (user?.webcastUid) return `${prefix}webcast_uid`;
  const userId = String(user?.userId || "").trim();
  if (userId && userId !== "111111") return `${prefix}protobuf_user_id`;
  return "";
}

function isMaskedName(value) {
  const text = String(value || "").trim();
  return (text.startsWith("神秘人") && text.length > 3) || /^dou.{5,}$/i.test(text);
}

function isObscuredName(value) {
  return /[*＊]{2,}/.test(String(value || ""));
}

function isObscuredProfile(profile) {
  return isObscuredName(profile?.displayName) || isObscuredName(profile?.realName);
}

function displayCacheKeys(roomId, displayName) {
  const display = String(displayName || "").trim();
  if (!display) return [];
  const keys = [`display:${display}`];
  if (roomId) keys.unshift(`room:${roomId}:display:${display}`);
  return keys;
}

function readRoomIdFromWebSocketUrl(websocketUrl) {
  try {
    const url = new URL(websocketUrl);
    return url.searchParams.get("room_id") || "";
  } catch {
    return "";
  }
}

function compactImage(image) {
  const urls = image?.urlList || image?.url_list || [];
  return {
    uri: image?.uri || "",
    url: Array.isArray(urls) ? urls[0] || "" : "",
    width: toNumber(image?.width),
    height: toNumber(image?.height),
  };
}

function roomLinkerSummary(room) {
  const linkerMap = room?.linkerMap || room?.linker_map || {};
  const linkerDetail = room?.linkerDetail || room?.linker_detail || {};
  const linkerPlayModes = linkerDetail.linkerPlayModes || linkerDetail.linker_play_modes || [];
  const linkerMapKeys = Object.keys(linkerMap || {});
  const manualOpenUi = toNumber(firstValue(linkerDetail.manualOpenUi, linkerDetail.manual_open_ui));
  const audienceLinkmic = toNumber(firstValue(linkerDetail.enableAudienceLinkmic, linkerDetail.enable_audience_linkmic));
  const isLinked =
    linkerMapKeys.length > 0 ||
    (Array.isArray(linkerPlayModes) && linkerPlayModes.length > 0) ||
    manualOpenUi > 0 ||
    audienceLinkmic > 0;
  return {
    isLinked,
    liveMode: isLinked ? "linkmic" : "single",
    linkerMap,
    linkerSceneKeys: linkerMapKeys,
    linkerPlayModes: Array.isArray(linkerPlayModes) ? linkerPlayModes.map(toNumber) : [],
    manualOpenUi,
    audienceLinkmic,
  };
}

function compactGift(gift, source = "") {
  const giftId = String(firstValue(gift?.id, gift?.giftId, gift?.gift_id));
  if (!giftId) return null;
  return {
    giftId,
    giftName: firstValue(gift?.name, gift?.content),
    diamondCount: toNumber(firstValue(gift?.diamondCount, gift?.diamond_count)),
    giftType: toNumber(gift?.type),
    giftScene: toNumber(firstValue(gift?.giftScene, gift?.gift_scene)),
    describe: gift?.describe || "",
    source: source || gift?.source || "",
    image: compactImage(gift?.image || gift?.icon || gift?.webpImage || gift?.webp_image),
  };
}

function badgeImages(user) {
  return [
    ...(user?.badgeImageList || []),
    ...(user?.badge_image_list || []),
    ...(user?.badgeImageListV2 || []),
    ...(user?.badge_image_list_v2 || []),
    ...(user?.mediaBadgeImageList || []),
    ...(user?.media_badge_image_list || []),
  ];
}

function imageText(image) {
  return [
    image?.content?.alternativeText,
    image?.content?.alternative_text,
    image?.content?.name,
    image?.uri,
    ...(image?.urlList || []),
    ...(image?.url_list || []),
  ].filter(Boolean).join(" ");
}

function extractBadgeLevels(user) {
  const levels = {
    userLevel: toNumber(user?.level),
    badgeLevel: 0,
    wealthLevel: 0,
    fansClubLevel: 0,
    honorLevel: 0,
  };
  for (const badge of badgeImages(user)) {
    const level = toNumber(badge?.content?.level);
    if (!level) continue;
    const text = imageText(badge);
    if (/粉丝团|fansclub|fans_club/i.test(text)) {
      levels.fansClubLevel = Math.max(levels.fansClubLevel, level);
    } else if (/荣誉|财富|user_grade|pay_grade|aweme_pay/i.test(text)) {
      levels.wealthLevel = Math.max(levels.wealthLevel, level);
      levels.honorLevel = Math.max(levels.honorLevel, level);
    } else {
      levels.badgeLevel = Math.max(levels.badgeLevel, level);
    }
  }
  const payGrade = user?.payGrade || user?.pay_grade || {};
  const fansClub = user?.fansClub || user?.fans_club || {};
  const fansClubData = fansClub?.data || {};
  levels.wealthLevel = firstNumber(
    levels.wealthLevel,
    payGrade?.level,
    user?.consumeDiamondLevel,
    user?.consume_diamond_level
  );
  levels.fansClubLevel = firstNumber(
    levels.fansClubLevel,
    fansClubData?.level,
    fansClub?.level
  );
  levels.badgeLevel = firstNumber(levels.badgeLevel, levels.wealthLevel);
  return levels;
}

function normalizeUser(user) {
  if (!user) {
    return {
      userId: "",
      secUid: "",
      uniqueId: "",
      webcastUid: "",
      nickname: "",
      displayName: "",
      realName: "",
      isMystery: false,
      isAnonymous: false,
      mysteryMan: 0,
      userLevel: 0,
      consumeLevel: 0,
      badgeLevel: 0,
      wealthLevel: 0,
      fansClubLevel: 0,
      honorLevel: 0,
      payScore: 0,
      totalRechargeDiamondCount: 0,
      fanTicketCount: 0,
      gender: 0,
      followStatus: 0,
      cacheHit: false,
    };
  }

  const nickname = String(user.nickname || "").trim();
  const displayName = String(firstValue(user.desensitizedNickname, user.desensitized_nickname, nickname)).trim();
  const mysteryMan = Number(firstValue(user.mysteryMan, user.mystery_man, 0));
  const isAnonymous = Boolean(firstValue(user.isAnonymous, user.is_anonymous, false));
  const isMystery =
    isAnonymous ||
    mysteryMan >= 2 ||
    isMaskedName(displayName) ||
    isMaskedName(nickname);
  const realName = nickname || displayName;
  const levels = extractBadgeLevels(user);
  const followInfo = user.followInfo || user.follow_info || {};

  return {
    userId: readUserId(user),
    secUid: firstValue(user.secUid, user.sec_uid, user.secUserId, user.sec_user_id),
    uniqueId: readUniqueId(user),
    webcastUid: firstValue(user.webcastUid, user.webcast_uid, user.webcastUserId, user.webcast_user_id),
    nickname,
    displayName,
    realName,
    isMystery,
    isAnonymous,
    mysteryMan,
    userLevel: levels.userLevel,
    consumeLevel: firstNumber(user.consumeDiamondLevel, user.consume_diamond_level, levels.wealthLevel),
    badgeLevel: levels.badgeLevel,
    wealthLevel: levels.wealthLevel,
    fansClubLevel: levels.fansClubLevel,
    honorLevel: levels.honorLevel,
    payScore: toNumber(firstValue(user.payScore, user.pay_score, user.payScores, user.pay_scores)),
    totalRechargeDiamondCount: toNumber(firstValue(user.totalRechargeDiamondCount, user.total_recharge_diamond_count)),
    fanTicketCount: toNumber(firstValue(user.fanTicketCount, user.fan_ticket_count, user.ticketCount, user.ticket_count)),
    gender: toNumber(user.gender),
    followStatus: toNumber(firstValue(user.followStatus, user.follow_status, followInfo.followStatus, followInfo.follow_status)),
    cacheHit: false,
  };
}

function preferProfileName(next, previous) {
  const nextText = String(next || "").trim();
  const previousText = String(previous || "").trim();
  if (!nextText || nextText === "未知") return previousText;
  if (!previousText || previousText === "未知") return nextText;
  if (isMaskedName(nextText) && !isMaskedName(previousText)) return previousText;
  return nextText;
}

function mergeUserProfiles(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  const merged = {
    ...previous,
    ...next,
    userId: next.userId || previous.userId || "",
    secUid: next.secUid || previous.secUid || "",
    uniqueId: next.uniqueId || previous.uniqueId || "",
    webcastUid: next.webcastUid || previous.webcastUid || "",
    nickname: preferProfileName(next.nickname, previous.nickname),
    displayName: preferProfileName(next.displayName, previous.displayName),
    realName: preferProfileName(next.realName, previous.realName),
    userLevel: Math.max(previous.userLevel || 0, next.userLevel || 0),
    consumeLevel: Math.max(previous.consumeLevel || 0, next.consumeLevel || 0),
    badgeLevel: Math.max(previous.badgeLevel || 0, next.badgeLevel || 0),
    wealthLevel: Math.max(previous.wealthLevel || 0, next.wealthLevel || 0),
    fansClubLevel: Math.max(previous.fansClubLevel || 0, next.fansClubLevel || 0),
    honorLevel: Math.max(previous.honorLevel || 0, next.honorLevel || 0),
    payScore: Math.max(previous.payScore || 0, next.payScore || 0),
    totalRechargeDiamondCount: Math.max(
      previous.totalRechargeDiamondCount || 0,
      next.totalRechargeDiamondCount || 0
    ),
    fanTicketCount: Math.max(previous.fanTicketCount || 0, next.fanTicketCount || 0),
    gender: next.gender || previous.gender || 0,
    followStatus: next.followStatus || previous.followStatus || 0,
    ipLocation: next.ipLocation || previous.ipLocation || "",
    followerCount: Math.max(previous.followerCount || 0, next.followerCount || 0),
    isMystery: Boolean(previous.isMystery || next.isMystery),
    isAnonymous: Boolean(previous.isAnonymous || next.isAnonymous),
    mysteryMan: Math.max(previous.mysteryMan || 0, next.mysteryMan || 0),
    cacheHit: Boolean(previous.cacheHit || next.cacheHit),
    identitySource: next.identitySource || previous.identitySource || "",
  };
  return merged;
}

function hasUserValue(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function mergeUserObjects(primary, ...fallbacks) {
  const merged = {};
  for (const source of [primary, ...fallbacks]) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      if (!hasUserValue(value) || hasUserValue(merged[key])) continue;
      merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : primary;
}

function userEventFields(user, source = "") {
  return {
    nickname: user.realName || user.displayName,
    displayName: user.displayName,
    realName: user.realName,
    userId: user.userId,
    secUid: user.secUid,
    uniqueId: user.uniqueId,
    webcastUid: user.webcastUid,
    hasStrongIdentity: hasStrongUserIdentity(user),
    identitySource: userIdentitySource(user, source),
    isMystery: user.isMystery,
    mysteryMan: user.mysteryMan,
    isAnonymous: user.isAnonymous,
    userLevel: user.userLevel,
    badgeLevel: user.badgeLevel,
    consumeLevel: user.consumeLevel,
    wealthLevel: user.wealthLevel,
    fansClubLevel: user.fansClubLevel,
    honorLevel: user.honorLevel,
    payScore: user.payScore,
    totalRechargeDiamondCount: user.totalRechargeDiamondCount,
    fanTicketCount: user.fanTicketCount,
    gender: user.gender,
    followStatus: user.followStatus,
    ipLocation: user.ipLocation,
    followerCount: user.followerCount,
    cacheHit: user.cacheHit,
  };
}

function memberActionText(action, description = "") {
  const text = String(description || "").trim();
  if (text) return text;
  const code = toNumber(action);
  if (code === 1) return "进场";
  if (code === 2) return "离场";
  if (code === 3) return "禁言";
  if (code === 4) return "取消禁言";
  if (code === 5) return "设为管理";
  if (code === 6) return "取消管理";
  if (code === 7) return "踢出";
  if (code === 8) return "分享";
  if (code === 20) return "关注";
  return code ? `动作 ${code}` : "进场";
}

function toBuffer(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  if (Array.isArray(payload)) return Buffer.concat(payload.map(toBuffer));
  return Buffer.from(payload);
}

function toPlain(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[MaxDepth]";
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value.length > 0 ? { bytes: value.length } : "";
  }
  if (Array.isArray(value)) return value.map((item) => toPlain(item, depth + 1));
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (typeof value.toJSON === "function" && value.constructor?.name === "Long") {
    return value.toString();
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "function") continue;
    out[key] = toPlain(item, depth + 1);
  }
  return out;
}

class LivePkWatcher extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.pingTimer = null;
    this.fetchTimer = null;
    this.pkSnapshotTimer = null;
    this.pkSnapshotIntervalMs = 250;
    this.fetchAbortController = null;
    this.fetchUrl = "";
    this.fetchHeaders = {};
    this.fetchCursor = "";
    this.fetchInternalExt = "";
    this.types = null;
    this.status = "idle";
    this.startedAt = null;
    this.lastError = null;
    this.lastRankAt = null;
    this.userCache = new Map();
    this.displayNameCache = new Map();
    this.profileCache = new Map();
    this.signedProfileCache = new Map();
    this.giftProfileInflight = new Map();
    this.giftProfileResolvedKeys = new Set();
    this.giftCatalog = new Map();
    this.cookieHeader = "";
    this.roomId = "";
    this.includeRaw = false;
    this.profileLookup = null;
    this.linkmicSnapshotLookup = null;
    this.giftProfileInflight.clear();
    this.lastLiveModeKey = "";
    this.lastPkBattleKey = "";
  }

  getStatus() {
    return {
      status: this.status,
      startedAt: this.startedAt,
      lastError: this.lastError,
      lastRankAt: this.lastRankAt,
      cachedUsers: this.userCache.size,
      cachedDisplayNames: this.displayNameCache.size,
      cachedGifts: this.giftCatalog.size,
      roomId: this.roomId,
    };
  }

  async start({ websocketUrl, fetchUrl, fetchHeaders, cookie, includeRaw = false, bootstrap, profileLookup, linkmicSnapshotLookup }) {
    const cleanUrl = String(websocketUrl || "").trim();
    const cleanFetchUrl = String(fetchUrl || "").trim();
    if (cleanFetchUrl) {
      return this.startFetch({ fetchUrl: cleanFetchUrl, fetchHeaders, cookie, includeRaw, bootstrap, profileLookup, linkmicSnapshotLookup });
    }
    if (!cleanUrl) throw new Error("缺少直播间 IM 连接地址");
    if (!/^wss?:\/\//i.test(cleanUrl)) throw new Error("WebSocket 地址格式不正确");

    this.stop();
    this.types = await this.loadTypes();
    this.status = "connecting";
    this.startedAt = new Date().toISOString();
    this.lastError = null;
    this.roomId = readRoomIdFromWebSocketUrl(cleanUrl);
    this.includeRaw = Boolean(includeRaw);
    this.profileLookup = typeof profileLookup === "function" ? profileLookup : null;
    this.linkmicSnapshotLookup = typeof linkmicSnapshotLookup === "function" ? linkmicSnapshotLookup : null;
    this.emit("status", this.getStatus());

    const headers = {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      origin: "https://live.douyin.com",
    };
    const cookieHeader = parseCookieHeader(cookie);
    this.cookieHeader = cookieHeader;
    if (cookieHeader) headers.cookie = cookieHeader;

    this.ws = new WebSocket(cleanUrl, { headers });
    this.ws.binaryType = "arraybuffer";

    this.ws.on("open", () => {
      this.status = "running";
      this.startPing();
      this.emit("status", this.getStatus());
      this.ingestBootstrap(bootstrap)
        .catch((error) => {
          this.emit("error-message", `启动快照解析失败: ${error.message || error}`);
        })
        .finally(() => this.startPkSnapshotPolling(750));
    });

    this.ws.on("message", (data) => {
      this.handleFrame(toBuffer(data)).catch((error) => {
        this.lastError = error.message || String(error);
        this.emit("error-message", this.lastError);
      });
    });

    this.ws.on("close", () => {
      this.stopPing();
      if (this.status !== "idle") this.status = "closed";
      this.emit("status", this.getStatus());
    });

    this.ws.on("error", (error) => {
      this.lastError = error.message || String(error);
      this.status = "error";
      this.emit("error-message", this.lastError);
      this.emit("status", this.getStatus());
    });

    return this.getStatus();
  }

  stop() {
    this.stopPing();
    this.stopFetchPolling();
    this.stopPkSnapshotPolling();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
    }
    this.status = "idle";
    this.startedAt = null;
    this.profileLookup = null;
    this.linkmicSnapshotLookup = null;
    this.lastLiveModeKey = "";
    this.lastPkBattleKey = "";
    this.emit("status", this.getStatus());
    return this.getStatus();
  }

  async startFetch({ fetchUrl, fetchHeaders, cookie, includeRaw = false, bootstrap, profileLookup, linkmicSnapshotLookup }) {
    const cleanUrl = String(fetchUrl || "").trim();
    if (!cleanUrl) throw new Error("缺少直播间 im/fetch 地址");
    if (!/^https?:\/\//i.test(cleanUrl)) throw new Error("im/fetch 地址格式不正确");

    this.stop();
    this.types = await this.loadTypes();
    this.status = "connecting";
    this.startedAt = new Date().toISOString();
    this.lastError = null;
    this.includeRaw = Boolean(includeRaw);
    this.fetchUrl = cleanUrl;

    const url = new URL(cleanUrl);
    this.roomId = url.searchParams.get("room_id") || "";
    this.profileLookup = typeof profileLookup === "function" ? profileLookup : null;
    this.linkmicSnapshotLookup = typeof linkmicSnapshotLookup === "function" ? linkmicSnapshotLookup : null;
    this.fetchCursor = url.searchParams.get("cursor") || "";
    this.fetchInternalExt = url.searchParams.get("internal_ext") || "";

    const cookieHeader = parseCookieHeader(cookie);
    this.cookieHeader = cookieHeader;
    this.fetchHeaders = {
      accept: "application/protobuffer, */*",
      "content-type": "application/x-www-form-urlencoded",
      referer: `https://live.douyin.com/${this.roomId || ""}`,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      ...(fetchHeaders || {}),
    };
    for (const key of Object.keys(this.fetchHeaders)) {
      const lower = key.toLowerCase();
      if (lower !== key) {
        if (this.fetchHeaders[lower] === undefined) this.fetchHeaders[lower] = this.fetchHeaders[key];
        delete this.fetchHeaders[key];
      }
    }
    delete this.fetchHeaders[":authority"];
    delete this.fetchHeaders[":method"];
    delete this.fetchHeaders[":path"];
    delete this.fetchHeaders[":scheme"];
    if (cookieHeader) this.fetchHeaders.cookie = cookieHeader;

    this.status = "running";
    this.emit("status", this.getStatus());
    await this.ingestBootstrap(bootstrap);
    this.startPkSnapshotPolling(750);
    this.scheduleFetchPoll(0);
    return this.getStatus();
  }

  async loadTypes() {
    const root = await loadProtoRoot();
    return {
      PushFrame: root.lookupType("webcast.im.PushFrame"),
      Response: root.lookupType("webcast.im.Response"),
      ChatMessage: root.lookupType("webcast.im.ChatMessage"),
      MemberMessage: root.lookupType("webcast.im.MemberMessage"),
      RoomRankMessage: root.lookupType("webcast.im.RoomRankMessage"),
      RoomUserSeqMessage: root.lookupType("webcast.im.RoomUserSeqMessage"),
      RoomStatsMessage: root.lookupType("webcast.im.RoomStatsMessage"),
      ProfitInteractionScoreMessage: root.lookupType("webcast.im.ProfitInteractionScoreMessage"),
      GiftMessage: root.lookupType("webcast.im.GiftMessage"),
      FreeCellGiftMessage: root.lookupType("webcast.im.FreeCellGiftMessage"),
      DoodleGiftMessage: root.lookupType("webcast.im.DoodleGiftMessage"),
      FreeGiftMessage: root.lookupType("webcast.im.FreeGiftMessage"),
      FansclubMessage: root.lookupType("webcast.im.FansclubMessage"),
      SocialMessage: root.lookupType("webcast.im.SocialMessage"),
      LikeMessage: root.lookupType("webcast.im.LikeMessage"),
      ContentOpenPicoLikeMessage: root.lookupType("webcast.im.ContentOpenPicoLikeMessage"),
      ChatLikeMessage: root.lookupType("webcast.im.ChatLikeMessage"),
      RoomMessage: root.lookupType("webcast.im.RoomMessage"),
      RoomVerifyMessage: root.lookupType("webcast.im.RoomVerifyMessage"),
      RoomStartMessage: root.lookupType("webcast.im.RoomStartMessage"),
      ShortTouchAreaMessage: root.lookupType("webcast.im.ShortTouchAreaMessage"),
      InRoomBannerMessage: root.lookupType("webcast.im.InRoomBannerMessage"),
      RanklistHourEntranceMessage: root.lookupType("webcast.im.RanklistHourEntranceMessage"),
      RankListHourEnterMessage: root.lookupType("webcast.im.RankListHourEnterMessage"),
      GiftUpdateMessage: root.lookupType("webcast.im.GiftUpdateMessage"),
      LinkmicPlayModeUpdateScoreMessage: root.lookupType("webcast.im.LinkmicPlayModeUpdateScoreMessage"),
    };
  }

  rememberGift(gift) {
    const compact = compactGift(gift, gift?.source || "");
    const giftId = compact?.giftId || "";
    if (!giftId) return null;
    const previous = this.giftCatalog.get(giftId) || {};
    const next = {
      giftId,
      giftName: compact.giftName || previous.giftName || "",
      diamondCount: compact.diamondCount || previous.diamondCount || 0,
      giftType: compact.giftType || previous.giftType || 0,
      giftScene: compact.giftScene || previous.giftScene || 0,
      describe: compact.describe || previous.describe || "",
      image: compact.image?.url ? compact.image : previous.image,
      source: compact.source || previous.source || "",
    };
    this.giftCatalog.set(giftId, next);
    return next;
  }

  getGiftMeta(giftId) {
    return this.giftCatalog.get(String(giftId || "")) || null;
  }

  rememberUser(user) {
    const normalized = normalizeUser(user);
    const cachedProfiles = [normalized.userId, normalized.secUid, normalized.uniqueId, normalized.webcastUid]
      .filter(Boolean)
      .map((key) => this.getCachedUser(key))
      .filter(Boolean);
    if (cachedProfiles.length === 0 && isObscuredProfile(normalized)) {
      const cached = this.getCachedDisplayUser(normalized.displayName || normalized.realName);
      if (cached) cachedProfiles.push(cached);
    }
    const profile = cachedProfiles.reduce(
      (merged, cached) => mergeUserProfiles(cached, merged),
      normalized
    );
    const keys = [profile.userId, profile.secUid, profile.uniqueId, profile.webcastUid].filter(Boolean);
    for (const key of keys) {
      this.userCache.set(String(key), profile);
    }
    return profile;
  }

  rememberResolvedUser(profile) {
    const cachedProfiles = [profile.userId, profile.secUid, profile.uniqueId, profile.webcastUid]
      .filter(Boolean)
      .map((key) => this.getCachedUser(key))
      .filter(Boolean);
    const mergedProfile = cachedProfiles.reduce(
      (merged, cached) => mergeUserProfiles(cached, merged),
      profile
    );
    const keys = [mergedProfile.userId, mergedProfile.secUid, mergedProfile.uniqueId, mergedProfile.webcastUid].filter(Boolean);
    for (const key of keys) {
      this.userCache.set(String(key), mergedProfile);
    }
    if (isObscuredName(mergedProfile.displayName) && (mergedProfile.secUid || mergedProfile.uniqueId)) {
      for (const key of displayCacheKeys(this.roomId, mergedProfile.displayName)) {
        this.displayNameCache.set(key, mergedProfile);
      }
    }
    if (mergedProfile.secUid && !mergedProfile.uniqueId) this.prefetchSignedUserProfile(mergedProfile.secUid);
    return mergedProfile;
  }

  getCachedDisplayUser(displayName) {
    for (const key of displayCacheKeys(this.roomId, displayName)) {
      const cached = this.displayNameCache.get(key);
      if (cached) return cached;
    }
    return null;
  }

  applyDisplayCache(profile) {
    if (!isObscuredProfile(profile)) return profile;
    const cached = this.getCachedDisplayUser(profile.displayName || profile.realName);
    if (!cached) return profile;
    return {
      ...profile,
      userId: profile.userId || cached.userId,
      secUid: profile.secUid || cached.secUid,
      uniqueId: profile.uniqueId || cached.uniqueId,
      webcastUid: profile.webcastUid || cached.webcastUid,
      realName: cached.realName || profile.realName,
      ipLocation: cached.ipLocation || profile.ipLocation,
      followerCount: cached.followerCount || profile.followerCount,
      userLevel: profile.userLevel || cached.userLevel,
      badgeLevel: profile.badgeLevel || cached.badgeLevel,
      consumeLevel: profile.consumeLevel || cached.consumeLevel,
      wealthLevel: profile.wealthLevel || cached.wealthLevel,
      fansClubLevel: profile.fansClubLevel || cached.fansClubLevel,
      honorLevel: profile.honorLevel || cached.honorLevel,
      payScore: profile.payScore || cached.payScore,
      totalRechargeDiamondCount: profile.totalRechargeDiamondCount || cached.totalRechargeDiamondCount,
      fanTicketCount: profile.fanTicketCount || cached.fanTicketCount,
      gender: profile.gender || cached.gender,
      followStatus: profile.followStatus || cached.followStatus,
      cacheHit: true,
    };
  }

  getCachedUser(key) {
    if (!key) return null;
    return this.userCache.get(String(key)) || null;
  }

  parseBootstrapJson(value) {
    if (!value) return null;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return typeof value === "object" ? value : null;
  }

  rememberBootstrapUser(user) {
    const profile = this.applyDisplayCache(normalizeUser(user));
    return this.rememberResolvedUser(profile);
  }

  async ingestBootstrap(bootstrap) {
    if (!bootstrap || typeof bootstrap !== "object") return;
    await this.ingestRoomEnter(bootstrap.roomEnter, bootstrap);
    this.ingestGiftList(bootstrap.giftList);
    await this.ingestAudienceRank(bootstrap.audienceRank);
    this.ingestLinkmicList(bootstrap.linkmicList);
    this.ingestWishList(bootstrap.wishList);
    this.ingestInteractionInfo(bootstrap.interactionInfo);
  }

  async ingestRoomEnter(value, bootstrap = {}) {
    const json = this.parseBootstrapJson(value);
    const room = json?.data?.data?.[0] || json?.data?.room || null;
    if (!room) return;
    const at = new Date().toISOString();
    const roomId = String(firstValue(room.idStr, room.id_str, room.id, ""));
    if (roomId) this.roomId = roomId;
    const webRid = String(firstValue(room.webRid, room.web_rid, bootstrap.webRid, ""));
    const ownerSource = room.owner || json?.data?.user || null;
    let owner = ownerSource ? this.rememberBootstrapUser(ownerSource) : null;
    let ownerProfileSource = "";
    if (owner?.secUid) {
      const signedProfile = bootstrap.anchorProfile && (
        !bootstrap.anchorProfile.secUid || bootstrap.anchorProfile.secUid === owner.secUid
      )
        ? bootstrap.anchorProfile
        : null;
      const extra = signedProfile || await this.lookupUserProfile(owner.secUid);
      if (extra) {
        ownerProfileSource = signedProfile ? "page_signed_profile/other.unique_id" : "profile/other.unique_id";
        owner = this.rememberResolvedUser({
          ...owner,
          userId: extra.userId || owner.userId,
          secUid: extra.secUid || owner.secUid,
          realName: extra.nickname || owner.realName,
          uniqueId: extra.uniqueId || owner.uniqueId,
          ipLocation: extra.ipLocation || owner.ipLocation,
          followerCount: extra.followerCount || owner.followerCount,
        });
      }
    }
    const roomStats = room.stats || {};
    const roomViewStats = room.room_view_stats || room.roomViewStats || {};
    const linker = roomLinkerSummary(room);
    this.emit("event", {
      type: "event",
      eventType: "room-info",
      at,
      method: "webcast/room/web/enter",
      ...(owner ? userEventFields(owner) : {}),
      roomId,
      webRid,
      title: room.title || "",
      roomStatus: toNumber(firstValue(room.status, room.status_str)),
      userCountText: firstValue(room.user_count_str, roomStats.user_count_str, roomViewStats.display_short),
      totalUserText: firstValue(roomStats.total_user_str, roomStats.total_user_desp),
      onlineDisplay: firstValue(roomViewStats.display_long, roomViewStats.display_middle, roomStats.user_count_str, room.user_count_str),
      onlineCount: toNumber(firstValue(roomViewStats.display_value, roomStats.user_count_str)),
      likeCount: toNumber(firstValue(room.likeCount, room.like_count, roomStats.like_count)),
      cover: compactImage(room.cover),
      ownerUserId: owner?.userId || "",
      ownerSecUid: owner?.secUid || "",
      ownerDouyinId: owner?.uniqueId || webRid || "",
      ownerDouyinIdSource: owner?.uniqueId ? (ownerProfileSource || "profile/other.unique_id") : (webRid ? "live_url.web_rid" : ""),
      ownerWebRid: webRid,
      ownerNickname: owner?.realName || owner?.displayName || "",
      liveMode: linker.liveMode,
      liveModeSource: "room/web/enter",
      isLinked: linker.isLinked,
      linkerSceneKeys: linker.linkerSceneKeys,
      linkerPlayModes: linker.linkerPlayModes,
      manualOpenUi: linker.manualOpenUi,
      audienceLinkmic: linker.audienceLinkmic,
    });
  }

  ingestGiftList(value) {
    const json = this.parseBootstrapJson(value);
    const pages = json?.data?.pages || [];
    if (!Array.isArray(pages) || pages.length === 0) return;
    const gifts = [];
    const seen = new Set();
    for (const page of pages) {
      const pageName = page?.page_name || page?.pageName || "";
      for (const gift of page?.gifts || []) {
        const compact = compactGift({ ...gift, source: pageName }, pageName);
        if (!compact?.giftId) continue;
        this.rememberGift({ ...gift, source: pageName });
        if (seen.has(compact.giftId)) continue;
        seen.add(compact.giftId);
        gifts.push(compact);
      }
    }
    if (gifts.length === 0) return;
    this.emit("event", {
      type: "event",
      eventType: "gift-catalog",
      at: new Date().toISOString(),
      method: "webcast/gift/list",
      count: gifts.length,
      paidCount: gifts.filter((gift) => gift.diamondCount > 0).length,
      maxDiamond: gifts.reduce((max, gift) => Math.max(max, gift.diamondCount || 0), 0),
      gifts,
    });
    this.emit("status", this.getStatus());
  }

  async ingestAudienceRank(value) {
    const json = this.parseBootstrapJson(value);
    const data = json?.data || {};
    const rawRanks = data.ranks || [];
    if (!Array.isArray(rawRanks) || rawRanks.length === 0) return;
    const convert = (item, index) => {
      const user = this.rememberBootstrapUser(item?.user);
      return {
        rank: toNumber(item?.rank) || index + 1,
        ...userEventFields(user),
        score: toNumber(item?.score),
        scoreText: firstValue(item?.scoreDescription, item?.score_description, item?.exactlyScore, item?.exactly_score, item?.score_description, item?.gapDescription, item?.gap_description),
        rankDelta: toNumber(item?.delta),
        isHidden: Boolean(firstValue(item?.isHidden, item?.is_hidden, false)),
        rankSource: "audience",
      };
    };
    const ranks = rawRanks.map(convert);
    const seats = Array.isArray(data.seats) ? data.seats.map(convert) : [];
    this.lastRankAt = new Date().toISOString();
    this.emit("rank", {
      type: "rank",
      at: this.lastRankAt,
      rankSource: "audience",
      total: toNumber(data.total),
      userCountText: data.user_count_desc || "",
      currency: data.currency || "",
      ranks,
      seats,
    });
    this.emit("status", this.getStatus());
  }

  ingestLinkmicList(value, options = {}) {
    const json = this.parseBootstrapJson(value);
    const data = json?.data || {};
    const snapshotSource = String(options.source || json?.extra?.source || "webcast/linkmic/list");
    const method = snapshotSource === "page-store" ? "page-store/linkmic-snapshot" : "webcast/linkmic/list";
    const periodic = Boolean(options.periodic);
    const users = Array.isArray(data.user) ? data.user : [];
    const battleStats = data.battle_stats || data.battleStats || {};
    const battleSettings = battleStats.battle_settings || battleStats.battleSettings || {};
    const battleScoresRaw = Array.isArray(battleStats.battle_scores)
      ? battleStats.battle_scores
      : Array.isArray(battleStats.battleScores)
        ? battleStats.battleScores
        : [];
    const battleArmiesRaw = Array.isArray(battleStats.battle_armies)
      ? battleStats.battle_armies
      : Array.isArray(battleStats.battleArmies)
        ? battleStats.battleArmies
        : [];
    const isInPkFlag = json?.extra?.isInPK === true || json?.extra?.isInPK === 1 || json?.extra?.isInPK === "1" || json?.extra?.isInPK === "true";
    const hasBattle =
      isInPkFlag ||
      Object.keys(battleSettings || {}).length > 0 ||
      battleScoresRaw.length > 0 ||
      Boolean(firstValue(battleStats.battle_id, battleStats.battleId));
    if (json?.status_code !== 0 && users.length === 0 && !hasBattle) return;

    const at = new Date().toISOString();
    const participants = users.map((item, index) => {
      const profile = this.rememberBootstrapUser(item?.user);
      const content = item?.content?.linkmic_content || item?.content?.linkmicContent || {};
      return {
        index: index + 1,
        ...userEventFields(profile, "linkmic/list"),
        linkmicId: String(firstValue(item?.linkmic_id_str, item?.linkmicIdStr, item?.linkmic_id, "")),
        linkStatus: toNumber(firstValue(item?.link_status, item?.linkStatus)),
        linkType: toNumber(firstValue(item?.link_type, item?.linkType)),
        userPosition: toNumber(firstValue(item?.user_position, item?.userPosition)),
        pkUserRole: toNumber(firstValue(content.pk_user_role, content.pkUserRole)),
        fanTicketText: firstValue(content.fan_ticket, content.fanTicket),
        hostName: firstValue(content.host_name, content.hostName),
        liveRoomMode: toNumber(firstValue(content.live_room_mode, content.liveRoomMode)),
      };
    });

    const participantById = new Map();
    for (const participant of participants) {
      for (const key of [participant.userId, participant.secUid, participant.uniqueId]) {
        if (key) participantById.set(String(key), participant);
      }
    }
    for (const item of users) {
      const rawUser = item?.user || {};
      const profile = this.getCachedUser(firstValue(rawUser.id_str, rawUser.id));
      const participant = profile ? userEventFields(profile, "linkmic/list") : null;
      for (const key of [rawUser.id_str, rawUser.id, rawUser.sec_uid, rawUser.secUid].filter(Boolean)) {
        const existing = participantById.get(String(key));
        if (!existing && participant) participantById.set(String(key), participant);
      }
    }

    const channelId = String(firstValue(
      battleSettings.channel_id,
      battleSettings.channelId,
      battleStats.channel_id,
      battleStats.channelId
    ));
    const battleId = String(firstValue(
      battleSettings.battle_id,
      battleSettings.battleId,
      battleStats.battle_id,
      battleStats.battleId
    ));
    const finished = toNumber(firstValue(battleSettings.finished, battleStats.finished));
    const battleStatus = toNumber(firstValue(battleSettings.battle_status, battleSettings.battleStatus));
    const punishStartMs = toNumber(firstValue(battleSettings.punish_start_time_ms, battleSettings.punishStartTimeMs));
    const duration = toNumber(battleSettings.duration);
    const startTimeMs = toNumber(firstValue(battleSettings.start_time_ms, battleSettings.startTimeMs));
    const isPkActive = isInPkFlag || (hasBattle && finished === 0 && battleStatus !== 3);
    const isLinked = participants.length > 1 || hasBattle;
    const liveMode = isPkActive ? "pk" : isLinked ? "linkmic" : "single";
    const battlePhase = !hasBattle
      ? ""
      : isPkActive
        ? "running"
        : punishStartMs > 0 || battleStatus === 3
          ? "punish"
          : finished > 0
            ? "finished"
            : "unknown";

    const scoresFromBattleStats = battleScoresRaw.map((item, index) => {
      const userId = String(firstValue(item?.user_id_str, item?.userIdStr, item?.user_id, item?.userId));
      const user = participantById.get(userId) || this.getCachedUser(userId) || normalizeUser({ id_str: userId });
      return {
        rank: index + 1,
        anchorId: userId,
        ...userEventFields(user, "linkmic/list.battle_scores"),
        score: toNumber(item?.score),
        scoreText: String(firstValue(item?.score_blur_text, item?.scoreBlurText, item?.score_str, item?.scoreStr, item?.score)),
        scoreVersion: toNumber(firstValue(item?.score_version, item?.scoreVersion)),
        scoreRelative: Boolean(firstValue(item?.score_relative, item?.scoreRelative, false)),
        multiPkTeamScore: toNumber(firstValue(item?.multi_pk_team_score, item?.multiPkTeamScore)),
        multiPkTeamScoreText: String(firstValue(item?.multi_pk_team_score_text, item?.multiPkTeamScoreText)),
      };
    });
    const scoresHaveValue = scoresFromBattleStats.some((item) =>
      item.score > 0 || item.multiPkTeamScore > 0 || normalizeScore(item.scoreText) > 0 || normalizeScore(item.multiPkTeamScoreText) > 0
    );
    const scores = scoresHaveValue
      ? scoresFromBattleStats.filter((item) =>
        item.score > 0 || item.multiPkTeamScore > 0 || normalizeScore(item.scoreText) > 0 || normalizeScore(item.multiPkTeamScoreText) > 0
      )
      : participants
        .map((participant, index) => {
          const score = normalizeScore(participant.fanTicketText);
          if (!participant.userId || score <= 0) return null;
          return {
            rank: index + 1,
            anchorId: participant.userId,
            ...userEventFields(participant, "linkmic/list.participants.fan_ticket"),
            score,
            scoreText: String(participant.fanTicketText),
            scoreVersion: 0,
            scoreRelative: false,
            multiPkTeamScore: 0,
            multiPkTeamScoreText: "",
          };
        })
        .filter(Boolean);

    const contributors = [];
    for (const army of battleArmiesRaw) {
      const anchorId = String(firstValue(army?.anchor_id_str, army?.anchorIdStr, army?.anchor_id, army?.anchorId));
      const anchor = participantById.get(anchorId) || this.getCachedUser(anchorId) || null;
      const anchorName = anchor?.realName || anchor?.displayName || anchor?.nickname || "";
      const rankList = Array.isArray(army?.rank_list)
        ? army.rank_list
        : Array.isArray(army?.rankList)
          ? army.rankList
          : [];
      rankList.forEach((item, index) => {
        const profile = this.rememberBootstrapUser({
          id_str: firstValue(item?.user_id_str, item?.userIdStr, item?.user_id, item?.userId),
          id: firstValue(item?.user_id, item?.userId),
          nickname: item?.nickname,
          sec_uid: firstValue(item?.sec_uid, item?.secUid),
          display_id: firstValue(item?.display_id, item?.displayId),
          unique_id: firstValue(item?.unique_id, item?.uniqueId),
        });
        contributors.push({
          rank: index + 1,
          anchorId,
          anchorName,
          ...userEventFields(profile, "linkmic/list.rank_list"),
          score: toNumber(item?.score),
          scoreText: String(firstValue(item?.score_str, item?.scoreStr, item?.score)),
          rankSource: "pk-contributors",
        });
      });
    }

    const common = {
      roomId: this.roomId,
      channelId,
      battleId,
      liveMode,
      liveModeLabel: liveMode === "pk" ? "正在PK" : liveMode === "linkmic" ? "连麦中" : "单人直播",
      liveModeSource: snapshotSource,
      snapshotSource,
      isLinked,
      isPkActive,
      participantCount: participants.length,
      participants,
      hasBattle,
      battlePhase,
      battleStatus,
      battleFinished: finished > 0,
      battleType: toNumber(firstValue(battleSettings.battle_type, battleSettings.battleType, battleStats.battle_type, battleStats.battleType)),
      matchType: toNumber(firstValue(battleSettings.match_type, battleSettings.matchType)),
      startTime: toIsoTime(startTimeMs),
      duration,
      punishDuration: toNumber(firstValue(battleSettings.punish_duration, battleSettings.punishDuration)),
      punishStartTime: toIsoTime(punishStartMs),
      initiatorId: String(firstValue(battleSettings.initiator_id, battleSettings.initiatorId)),
      pkCountDown: json?.extra?.pkCountDown === undefined ? undefined : toNumber(json.extra.pkCountDown),
      checkedAt: at,
      scores,
    };

    const liveModeKey = JSON.stringify({
      liveMode,
      battleId,
      battlePhase,
      battleStatus,
      participantIds: participants.map((item) => item.userId).join(","),
    });
    const shouldEmitLiveMode = !periodic || liveModeKey !== this.lastLiveModeKey;
    if (shouldEmitLiveMode) {
      this.lastLiveModeKey = liveModeKey;
      this.emit("event", {
        type: "event",
        eventType: "live-mode",
        at,
        method,
        ...common,
      });
    }

    if (hasBattle) {
      const pkBattleKey = JSON.stringify({
        battleId,
        battlePhase,
        battleStatus,
        battleFinished: finished > 0,
        participantCount: participants.length,
      });
      const shouldEmitBattle = !periodic || pkBattleKey !== this.lastPkBattleKey;
      if (shouldEmitBattle) {
        this.lastPkBattleKey = pkBattleKey;
        this.emit("event", {
          type: "event",
          eventType: "pk-battle",
          at,
          method,
          ...common,
        });
      }
    }

    if (hasBattle && scores.length > 0 && options.emitScoreSnapshot !== false) {
      this.emit("event", {
        type: "event",
        eventType: "pk-score-snapshot",
        at,
        method,
        ...common,
      });
    }

    if (contributors.length > 0) {
      this.lastRankAt = at;
      this.emit("rank", {
        type: "rank",
        at,
        rankSource: "pk-contributors",
        channelId,
        battleId,
        ranks: contributors,
      });
    }

    this.emit("status", this.getStatus());
  }

  ingestWishList(value) {
    const json = this.parseBootstrapJson(value);
    const data = json?.data || {};
    const wishes = [
      ...(Array.isArray(data.wish_list) ? data.wish_list : []),
      ...(Array.isArray(data.activity_wish_list) ? data.activity_wish_list : []),
      ...(Array.isArray(data.open_wish) ? data.open_wish : []),
    ];
    if (json?.status_code !== 0 && wishes.length === 0) return;
    this.emit("event", {
      type: "event",
      eventType: "wish-list",
      at: new Date().toISOString(),
      method: "webcast/wish/list",
      count: wishes.length,
      wishSwitch: toNumber(data.wish_switch),
      anchorName: data.anchor_name || "",
      wishes,
    });
  }

  ingestInteractionInfo(value) {
    const json = this.parseBootstrapJson(value);
    const data = json?.data || {};
    if (json?.status_code !== 0 || Object.keys(data).length === 0) return;
    this.emit("event", {
      type: "event",
      eventType: "interaction-info",
      at: new Date().toISOString(),
      method: "webcast/room/interaction/info",
      likeIconCount: Array.isArray(data.like_icon_info?.icons) ? data.like_icon_info.icons.length : 0,
      frequentlyChatCount: Array.isArray(data.frequently_chat_info?.items)
        ? data.frequently_chat_info.items.length
        : 0,
      highlightData: data.highlight_data || null,
    });
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.types) return;
      const bytes = this.types.PushFrame.encode({ payloadType: "hb" }).finish();
      this.ws.send(bytes);
    }, 10000);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  stopFetchPolling() {
    if (this.fetchTimer) clearTimeout(this.fetchTimer);
    this.fetchTimer = null;
    if (this.fetchAbortController) {
      try {
        this.fetchAbortController.abort();
      } catch {
        // ignore abort errors
      }
    }
    this.fetchAbortController = null;
    this.fetchUrl = "";
    this.fetchHeaders = {};
    this.fetchCursor = "";
    this.fetchInternalExt = "";
  }

  stopPkSnapshotPolling() {
    if (this.pkSnapshotTimer) clearTimeout(this.pkSnapshotTimer);
    this.pkSnapshotTimer = null;
  }

  startPkSnapshotPolling(delayMs = this.pkSnapshotIntervalMs) {
    if (typeof this.linkmicSnapshotLookup !== "function") return;
    this.stopPkSnapshotPolling();
    const tick = async () => {
      this.pkSnapshotTimer = null;
      if (this.status !== "running" || typeof this.linkmicSnapshotLookup !== "function") return;
      try {
        const snapshot = await this.linkmicSnapshotLookup();
        if (snapshot) {
          this.ingestLinkmicList(snapshot, {
            periodic: true,
            source: "page-store",
            emitScoreSnapshot: true,
          });
        }
      } catch {
        // The hidden page can be navigating or closed; the IM monitor should keep running.
      } finally {
        if (this.status === "running" && typeof this.linkmicSnapshotLookup === "function") {
          this.pkSnapshotTimer = setTimeout(tick, this.pkSnapshotIntervalMs);
        }
      }
    };
    this.pkSnapshotTimer = setTimeout(tick, Math.max(0, Number(delayMs) || 0));
  }

  scheduleFetchPoll(delayMs) {
    if (this.status !== "running" || !this.fetchUrl) return;
    if (this.fetchTimer) clearTimeout(this.fetchTimer);
    this.fetchTimer = setTimeout(() => {
      this.fetchTimer = null;
      this.pollFetch().catch((error) => {
        this.lastError = error.message || String(error);
        this.emit("error-message", this.lastError);
        if (this.status === "running") this.scheduleFetchPoll(1500);
      });
    }, Math.max(0, Number(delayMs) || 0));
  }

  async pollFetch() {
    if (!this.types || this.status !== "running" || !this.fetchUrl) return;
    const url = new URL(this.fetchUrl);
    if (this.fetchCursor) url.searchParams.set("cursor", this.fetchCursor);
    if (this.fetchInternalExt) url.searchParams.set("internal_ext", this.fetchInternalExt);

    const controller = new AbortController();
    this.fetchAbortController = controller;
    const response = await fetch(url, {
      headers: this.fetchHeaders,
      signal: controller.signal,
    });
    this.fetchAbortController = null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      throw new Error(`im/fetch 请求失败 ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("protobuffer")) {
      const text = bytes.toString("utf8").slice(0, 120);
      if (text.includes("\"status_code\":0")) {
        this.scheduleFetchPoll(1000);
        return;
      }
      throw new Error(`im/fetch 未返回 protobuf: ${text || contentType}`);
    }

    const decoded = this.types.Response.decode(bytes);
    await this.handleResponse(decoded);
    this.fetchCursor = decoded.cursor || this.fetchCursor;
    this.fetchInternalExt = decoded.internalExt || this.fetchInternalExt;
    const interval = Math.min(5000, Math.max(500, toNumber(decoded.fetchInterval) || 1000));
    this.scheduleFetchPoll(interval);
  }

  async handleFrame(frameBytes) {
    if (!this.types || !this.ws) return;
    const pushFrame = this.types.PushFrame.decode(frameBytes);
    const headers = pushFrame.headers || [];
    const gzip = headers.some((item) => item.key === "compress_type" && item.value === "gzip");
    const rawPayload = Buffer.from(pushFrame.payload || []);
    const responseBytes = gzip ? zlib.gunzipSync(rawPayload) : rawPayload;
    const response = this.types.Response.decode(responseBytes);

    if (response.needAck && this.ws.readyState === WebSocket.OPEN) {
      const ack = this.types.PushFrame.encode({
        payloadType: "ack",
        logId: pushFrame.logId,
        payload: Buffer.from(response.internalExt || "", "utf8"),
      }).finish();
      this.ws.send(ack);
    }

    if (pushFrame.payloadType !== "msg") return;
    await this.handleResponse(response);
  }

  async handleResponse(response) {
    for (const message of response.messages || []) {
      await this.handleMessage(message.method, Buffer.from(message.payload || []));
    }
  }

  withRaw(event, method, decoded) {
    if (!this.includeRaw) return event;
    return {
      ...event,
      raw: toPlain(decoded),
      rawMethod: method,
    };
  }

  async lookupUserProfile(secUid) {
    const key = String(secUid || "");
    if (!key || key.length < 10) return null;
    if (this.profileCache.has(key)) return this.profileCache.get(key);

    const promise = (async () => {
      const hosts = ["https://live.douyin.com", "https://www.douyin.com"];
      for (const host of hosts) {
        try {
          const url = new URL(`${host}/aweme/v1/web/user/profile/other/`);
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
            browser_language: "zh-CN",
            browser_platform: "MacIntel",
            browser_name: "Chrome",
            browser_version: "149.0.0.0",
            browser_online: "true",
            engine_name: "Blink",
            engine_version: "149.0.0.0",
            os_name: "Mac OS",
            os_version: "10.15.7",
            device_memory: "16",
            platform: "PC",
            downlink: "10",
            effective_type: "4g",
            round_trip_time: "50",
            sec_user_id: key,
            msToken: "",
          };
          for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

          const headers = {
            accept: "application/json, text/plain, */*",
            "accept-language": "zh-CN,zh;q=0.9",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            referer: `https://live.douyin.com/${this.roomId || ""}`,
          };
          if (this.cookieHeader) headers.cookie = this.cookieHeader;

          const response = await fetch(url, { headers });
          if (!response.ok) continue;
          const text = await response.text();
          if (!text) continue;
          const json = JSON.parse(text);
          const user = json?.user;
          if (!user || json?.status_code !== 0) continue;
          return {
            nickname: user.nickname || "",
            uniqueId: user.unique_id || user.short_id || "",
            userId: user.uid || user.uid_str || "",
            secUid: user.sec_uid || key,
            ipLocation: user.ip_location || "",
            followerCount: Number(user.follower_count || 0),
            source: "profile/other",
          };
        } catch {
          // Try the next host; Douyin may return an empty anti-bot response on one domain.
        }
      }
      return null;
    })();

    this.profileCache.set(key, promise);
    return promise;
  }

  async lookupSignedUserProfile(secUid) {
    const key = String(secUid || "");
    if (!key || key.length < 10 || typeof this.profileLookup !== "function") return null;
    if (this.signedProfileCache.has(key)) return this.signedProfileCache.get(key);

    const promise = Promise.resolve()
      .then(() => this.profileLookup(key))
      .then((profile) => {
        if (!profile) return null;
        return {
          nickname: profile.nickname || "",
          uniqueId: profile.uniqueId || profile.unique_id || profile.short_id || "",
          userId: profile.userId || profile.uid || profile.uid_str || "",
          secUid: profile.secUid || profile.sec_uid || key,
          ipLocation: profile.ipLocation || profile.ip_location || "",
          followerCount: Number(profile.followerCount || profile.follower_count || 0),
          source: "page_signed_profile/other",
        };
      })
      .catch(() => null);

    this.signedProfileCache.set(key, promise);
    const result = await promise;
    if (!result) this.signedProfileCache.delete(key);
    return result;
  }

  patchUserProfile(profile, extra, sourceLabel = "") {
    const label = String(sourceLabel || "").trim();
    const identitySource = [label, extra?.source].filter(Boolean).join(".");
    return {
      ...profile,
      userId: extra?.userId || profile.userId,
      secUid: extra?.secUid || profile.secUid,
      realName:
        extra?.nickname && extra.nickname !== profile.displayName
          ? extra.nickname
          : profile.realName,
      uniqueId: extra?.uniqueId || profile.uniqueId,
      ipLocation: extra?.ipLocation || profile.ipLocation || "",
      followerCount: extra?.followerCount || profile.followerCount || 0,
      identitySource: identitySource || profile.identitySource,
    };
  }

  emitUserProfile(profile, sourceLabel = "资料补齐") {
    if (!profile) return;
    this.emit("event", {
      type: "event",
      eventType: "user-profile",
      at: new Date().toISOString(),
      ...userEventFields(profile, sourceLabel),
    });
  }

  scheduleGiftProfileLookup(profile, sourceLabel = "礼物消息") {
    const secUid = String(profile?.secUid || "");
    if (!secUid || secUid.length < 10) return;
    if (profile.uniqueId || this.giftProfileResolvedKeys.has(secUid)) return;

    const cached = this.getCachedUser(secUid);
    if (cached?.uniqueId) {
      const merged = this.rememberResolvedUser(mergeUserProfiles(cached, profile));
      this.giftProfileResolvedKeys.add(secUid);
      this.emitUserProfile(merged, sourceLabel);
      return;
    }
    if (this.giftProfileInflight.has(secUid)) return;

    const roomId = this.roomId;
    const startedAt = this.startedAt;
    const task = (async () => {
      const extra =
        (typeof this.profileLookup === "function" ? await this.lookupSignedUserProfile(secUid) : null) ||
        await this.lookupUserProfile(secUid);
      if (!extra?.uniqueId) return;
      if (this.status === "idle" || this.roomId !== roomId || this.startedAt !== startedAt) return;

      const currentProfile =
        this.getCachedUser(extra.secUid || secUid) ||
        this.getCachedUser(secUid);
      if (currentProfile?.uniqueId) {
        const merged = this.rememberResolvedUser(mergeUserProfiles(currentProfile, profile));
        this.giftProfileResolvedKeys.add(secUid);
        this.emitUserProfile(merged, sourceLabel);
        return;
      }

      const merged = this.rememberResolvedUser(this.patchUserProfile(currentProfile || profile, extra, sourceLabel));
      this.giftProfileResolvedKeys.add(secUid);
      this.emitUserProfile(merged, sourceLabel);
    })()
      .catch(() => undefined)
      .finally(() => {
        this.giftProfileInflight.delete(secUid);
      });

    this.giftProfileInflight.set(secUid, task);
  }

  prepareGiftUser(rawUser, sourceLabel = "礼物消息") {
    let profile = this.rememberUser(rawUser);
    profile = this.applyDisplayCache(profile);
    profile = this.rememberResolvedUser(profile);
    this.scheduleGiftProfileLookup(profile, sourceLabel);
    return profile;
  }

  prefetchSignedUserProfile(secUid) {
    const key = String(secUid || "");
    if (!key || key.length < 10 || typeof this.profileLookup !== "function") return;
    void this.lookupSignedUserProfile(key)
      .then((extra) => {
        if (!extra?.uniqueId) return;
        const cached = this.getCachedUser(extra.secUid || key) || this.getCachedUser(key);
        if (!cached || cached.uniqueId) return;
        const profile = this.rememberResolvedUser(this.patchUserProfile(cached, extra, "资料补齐"));
        this.emitUserProfile(profile, "资料补齐");
      })
      .catch(() => undefined);
  }

  async enrichUser(user, options = {}) {
    let profile = this.rememberUser(user);
    profile = this.applyDisplayCache(profile);
    const shouldLookup =
      profile.isMystery ||
      isObscuredName(profile.displayName) ||
      isObscuredName(profile.realName) ||
      !profile.uniqueId ||
      !profile.ipLocation ||
      !profile.followerCount;
    if (!shouldLookup || !profile.secUid) return this.rememberResolvedUser(profile);
    const preferSigned = options.preferSignedProfile === true;
    const canSigned = typeof this.profileLookup === "function";
    const extra =
      (preferSigned || canSigned ? await this.lookupSignedUserProfile(profile.secUid) : null) ||
      await this.lookupUserProfile(profile.secUid);
    if (!extra) return this.rememberResolvedUser(profile);

    return this.rememberResolvedUser(this.patchUserProfile(profile, extra, options.sourceLabel));
  }

  async handleMessage(method, payload) {
    if (this.includeRaw) {
      this.emit("raw-message", {
        type: "raw-message",
        at: new Date().toISOString(),
        method,
        payloadBytes: payload.length,
      });
    }

    if (method === "WebcastMemberMessage") {
      const decoded = this.types.MemberMessage.decode(payload);
      const memberUser = mergeUserObjects(
        decoded.user,
        decoded.common?.user,
        decoded.userId ? { id_str: String(decoded.userId), id: decoded.userId } : null
      );
      const user = await this.enrichUser(memberUser, {
        preferSignedProfile: true,
        sourceLabel: memberActionText(decoded.action, decoded.actionDescription),
      });
      const memberAction = toNumber(decoded.action) || 1;
      const actionText = memberActionText(memberAction, decoded.actionDescription);
      this.emit("member", this.withRaw({
        type: "member",
        at: new Date().toISOString(),
        nickname: user.realName || user.displayName,
        displayName: user.displayName,
        realName: user.realName,
        userId: user.userId,
        secUid: user.secUid,
        uniqueId: user.uniqueId,
        webcastUid: user.webcastUid,
        hasStrongIdentity: hasStrongUserIdentity(user),
        identitySource: userIdentitySource(user, actionText),
        isMystery: user.isMystery,
        mysteryMan: user.mysteryMan,
        isAnonymous: user.isAnonymous,
        userLevel: user.userLevel,
        badgeLevel: user.badgeLevel,
        consumeLevel: user.consumeLevel,
        wealthLevel: user.wealthLevel,
        fansClubLevel: user.fansClubLevel,
        honorLevel: user.honorLevel,
        payScore: user.payScore,
        totalRechargeDiamondCount: user.totalRechargeDiamondCount,
        fanTicketCount: user.fanTicketCount,
        gender: user.gender,
        followStatus: user.followStatus,
        ipLocation: user.ipLocation,
        followerCount: user.followerCount,
        cacheHit: user.cacheHit,
        memberAction,
        memberActionText: actionText,
        actionDescription: decoded.actionDescription || "",
        enterType: toNumber(decoded.enterType),
        rankScore: toNumber(decoded.rankScore),
        memberCount: Number(decoded.memberCount || 0),
      }, method, decoded));
      return;
    }

    if (method === "WebcastChatMessage") {
      const decoded = this.types.ChatMessage.decode(payload);
      const user = await this.enrichUser(mergeUserObjects(decoded.user, decoded.common?.user));
      this.emit("chat", this.withRaw({
        type: "chat",
        at: new Date().toISOString(),
        nickname: user.realName || user.displayName,
        displayName: user.displayName,
        realName: user.realName,
        userId: user.userId,
        secUid: user.secUid,
        uniqueId: user.uniqueId,
        webcastUid: user.webcastUid,
        hasStrongIdentity: hasStrongUserIdentity(user),
        identitySource: userIdentitySource(user, "弹幕消息"),
        isMystery: user.isMystery,
        mysteryMan: user.mysteryMan,
        isAnonymous: user.isAnonymous,
        userLevel: user.userLevel,
        badgeLevel: user.badgeLevel,
        consumeLevel: user.consumeLevel,
        wealthLevel: user.wealthLevel,
        fansClubLevel: user.fansClubLevel,
        honorLevel: user.honorLevel,
        payScore: user.payScore,
        totalRechargeDiamondCount: user.totalRechargeDiamondCount,
        fanTicketCount: user.fanTicketCount,
        gender: user.gender,
        followStatus: user.followStatus,
        ipLocation: user.ipLocation,
        followerCount: user.followerCount,
        cacheHit: user.cacheHit,
        content: decoded.content || "",
        eventTime: decoded.eventTime ? new Date(toNumber(decoded.eventTime)).toISOString() : "",
        chatBy: decoded.chatBy ? String(decoded.chatBy) : "",
        priorityLevel: toNumber(decoded.priorityLevel),
        modelInfo: decoded.modelInfo || {},
      }, method, decoded));
      return;
    }

    if (method === "WebcastRoomRankMessage") {
      const decoded = this.types.RoomRankMessage.decode(payload);
      const ranks = await Promise.all((decoded.ranks || []).map(async (rank, index) => {
        const user = await this.enrichUser(rank.user);
        return {
          rank: index + 1,
          nickname: user.realName || user.displayName,
          displayName: user.displayName,
          realName: user.realName,
          userId: user.userId,
          secUid: user.secUid,
          uniqueId: user.uniqueId,
          hasStrongIdentity: hasStrongUserIdentity(user),
          identitySource: userIdentitySource(user, "贡献榜消息"),
          isMystery: user.isMystery,
          mysteryMan: user.mysteryMan,
          isAnonymous: user.isAnonymous,
          userLevel: user.userLevel,
          badgeLevel: user.badgeLevel,
          consumeLevel: user.consumeLevel,
          wealthLevel: user.wealthLevel,
          fansClubLevel: user.fansClubLevel,
          honorLevel: user.honorLevel,
          payScore: user.payScore,
          totalRechargeDiamondCount: user.totalRechargeDiamondCount,
          fanTicketCount: user.fanTicketCount,
          gender: user.gender,
          followStatus: user.followStatus,
          ipLocation: user.ipLocation,
          followerCount: user.followerCount,
          cacheHit: user.cacheHit,
          scoreText: rank.scoreStr || "",
          score: normalizeScore(rank.scoreStr),
        };
      }));
      this.lastRankAt = new Date().toISOString();
      this.emit("rank", this.withRaw({
        type: "rank",
        at: this.lastRankAt,
        ranks,
      }, method, decoded));
      return;
    }

    if (method === "WebcastRoomUserSeqMessage") {
      const decoded = this.types.RoomUserSeqMessage.decode(payload);
      const readContributor = async (item, index) => {
        const user = await this.enrichUser(item.user);
        return {
          rank: toNumber(item.rank) || index + 1,
          ...userEventFields(user, "在线榜消息"),
          score: toNumber(item.score),
          scoreText: item.scoreDescription || item.exactlyScore || (item.score ? String(item.score) : ""),
          rankDelta: toNumber(item.delta),
          isHidden: Boolean(item.isHidden),
          exactlyScore: item.exactlyScore || "",
        };
      };
      const ranks = await Promise.all((decoded.ranks || []).map(readContributor));
      const seats = await Promise.all((decoded.seats || []).map(readContributor));
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "room-user-seq",
        at: new Date().toISOString(),
        method,
        total: toNumber(decoded.total),
        totalText: decoded.totalStr || "",
        totalUser: toNumber(decoded.totalUser),
        totalUserText: decoded.totalUserStr || "",
        popularity: toNumber(decoded.popularity),
        popularityText: decoded.popStr || "",
        onlineUserForAnchor: decoded.onlineUserForAnchor || "",
        totalPvForAnchor: decoded.totalPvForAnchor || "",
        upRightStatsText: decoded.upRightStatsStr || "",
        upRightStatsFullText: decoded.upRightStatsStrComplete || "",
        ranks,
        seats,
      }, method, decoded));
      return;
    }

    if (method === "WebcastRoomStatsMessage") {
      const decoded = this.types.RoomStatsMessage.decode(payload);
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "room-stats",
        at: new Date().toISOString(),
        method,
        displayShort: decoded.displayShort || "",
        displayMiddle: decoded.displayMiddle || "",
        displayLong: decoded.displayLong || "",
        displayValue: toNumber(decoded.displayValue),
        displayVersion: toNumber(decoded.displayVersion),
        incremental: Boolean(decoded.incremental),
        isHidden: Boolean(decoded.isHidden),
        total: toNumber(decoded.total),
        displayType: toNumber(decoded.displayType),
      }, method, decoded));
      return;
    }

    if (method === "WebcastGiftMessage") {
      const decoded = this.types.GiftMessage.decode(payload);
      const user = this.prepareGiftUser(mergeUserObjects(decoded.user, decoded.common?.user));
      const gift = decoded.gift || {};
      const knownGift = this.rememberGift(gift) || {};
      const diamondCount = toNumber(gift.diamondCount) || toNumber(knownGift.diamondCount);
      const count = readCount(decoded.totalCount, decoded.count, decoded.comboCount, decoded.repeatCount, decoded.groupCount);
      const baseScore = diamondCount * count;
      const fanTicket = toNumber(decoded.fanTicketCount) || baseScore;
      const bonusScore = Math.max(0, fanTicket - baseScore);
      const bonusRate = baseScore > 0 ? fanTicket / baseScore : 1;
      this.emit("gift", this.withRaw({
        type: "gift",
        at: new Date().toISOString(),
        nickname: user.realName || user.displayName,
        displayName: user.displayName,
        realName: user.realName,
        userId: user.userId,
        secUid: user.secUid,
        uniqueId: user.uniqueId,
        webcastUid: user.webcastUid,
        hasStrongIdentity: hasStrongUserIdentity(user),
        identitySource: userIdentitySource(user, "礼物消息"),
        isMystery: user.isMystery,
        mysteryMan: user.mysteryMan,
        isAnonymous: user.isAnonymous,
        userLevel: user.userLevel,
        badgeLevel: user.badgeLevel,
        consumeLevel: user.consumeLevel,
        wealthLevel: user.wealthLevel,
        fansClubLevel: user.fansClubLevel,
        honorLevel: user.honorLevel,
        payScore: user.payScore,
        totalRechargeDiamondCount: user.totalRechargeDiamondCount,
        fanTicketCount: user.fanTicketCount,
        gender: user.gender,
        followStatus: user.followStatus,
        ipLocation: user.ipLocation,
        followerCount: user.followerCount,
        cacheHit: user.cacheHit,
        giftId: String(decoded.giftId || gift.id || ""),
        giftName: gift.name || knownGift.giftName || "",
        giftKind: "paid",
        giftType: toNumber(gift.type) || knownGift.giftType || 0,
        giftScene: toNumber(gift.giftScene) || knownGift.giftScene || 0,
        giftDescribe: gift.describe || knownGift.describe || "",
        diamondCount,
        count,
        comboCount: toNumber(decoded.comboCount),
        repeatCount: toNumber(decoded.repeatCount),
        groupCount: toNumber(decoded.groupCount),
        totalCount: toNumber(decoded.totalCount),
        baseScore,
        bonusScore,
        bonusRate,
        fanTicket,
        roomFanTicketCount: toNumber(decoded.roomFanTicketCount),
        repeatEnd: toNumber(decoded.repeatEnd),
        groupId: decoded.groupId ? String(decoded.groupId) : "",
        logId: decoded.logId || "",
        traceId: decoded.traceId || "",
        sendType: toNumber(decoded.sendType),
        sendTime: decoded.sendTime ? new Date(toNumber(decoded.sendTime)).toISOString() : "",
        clientGiftSource: toNumber(decoded.clientGiftSource),
        multiSendEffectLevel: toNumber(decoded.multiSendEffectLevel),
        useRoomMessage: Boolean(decoded.useRoomMessage),
      }, method, decoded));
      return;
    }

    if (method === "WebcastFreeCellGiftMessage") {
      const decoded = this.types.FreeCellGiftMessage.decode(payload);
      const user = this.prepareGiftUser(mergeUserObjects(decoded.user, decoded.common?.user));
      const giftId = String(decoded.giftId || "");
      const knownGift = this.getGiftMeta(giftId) || {};
      const diamondCount = toNumber(knownGift.diamondCount);
      const count = readCount(decoded.comboCount, decoded.repeatCount, decoded.groupCount);
      const baseScore = diamondCount * count;
      const fanTicket = toNumber(decoded.fanTicketCount) || baseScore;
      this.emit("gift", this.withRaw({
        type: "gift",
        at: new Date().toISOString(),
        ...userEventFields(user, "礼物消息"),
        giftId,
        giftName: knownGift.giftName || (giftId ? `免费格子礼物${giftId}` : "免费格子礼物"),
        giftKind: "free-cell",
        giftType: knownGift.giftType || 0,
        giftScene: knownGift.giftScene || 0,
        giftDescribe: knownGift.describe || "",
        diamondCount,
        count,
        comboCount: toNumber(decoded.comboCount),
        repeatCount: toNumber(decoded.repeatCount),
        groupCount: toNumber(decoded.groupCount),
        baseScore,
        bonusScore: Math.max(0, fanTicket - baseScore),
        bonusRate: baseScore > 0 ? fanTicket / baseScore : 1,
        fanTicket,
        roomFanTicketCount: toNumber(decoded.roomFanTicketCount),
        logId: decoded.logId || "",
        freeCell: {
          timeNow: toIsoTime(decoded.freeCell?.timeNowMs),
          timeStart: toIsoTime(decoded.freeCell?.timeStartMs),
          timeFreezeEnd: toIsoTime(decoded.freeCell?.timeFreezeEndMs),
          timeDoubleEnd: toIsoTime(decoded.freeCell?.timeDoubleEndMs),
          timeEnd: toIsoTime(decoded.freeCell?.timeEndMs),
          freeCellLength: toNumber(decoded.freeCell?.freeCellLength),
          isFreeze: Boolean(decoded.freeCell?.isFreeze),
          isDouble: Boolean(decoded.freeCell?.isDouble),
          contributeMostCoins: toNumber(decoded.freeCell?.contributeMostCoins),
          distanceFromPreviousOne: toNumber(decoded.freeCell?.distanceFromPreviousOne),
          indexInDayRanklist: toNumber(decoded.freeCell?.indexInDayRanklist),
        },
      }, method, decoded));
      return;
    }

    if (method === "WebcastDoodleGiftMessage") {
      const decoded = this.types.DoodleGiftMessage.decode(payload);
      const user = this.prepareGiftUser(mergeUserObjects(decoded.user, decoded.common?.user));
      const giftId = String(decoded.giftId || "");
      const knownGift = this.getGiftMeta(giftId) || {};
      const diamondCount = toNumber(knownGift.diamondCount);
      const baseScore = diamondCount;
      const fanTicket = toNumber(decoded.fanTicketCount) || baseScore;
      this.emit("gift", this.withRaw({
        type: "gift",
        at: new Date().toISOString(),
        ...userEventFields(user, "礼物消息"),
        giftId,
        giftName: readText(decoded.trayDisplayText) || knownGift.giftName || (giftId ? `涂鸦礼物${giftId}` : "涂鸦礼物"),
        giftKind: "doodle",
        giftType: knownGift.giftType || 0,
        giftScene: knownGift.giftScene || 0,
        giftDescribe: knownGift.describe || "",
        diamondCount,
        count: 1,
        baseScore,
        bonusScore: Math.max(0, fanTicket - baseScore),
        bonusRate: baseScore > 0 ? fanTicket / baseScore : 1,
        fanTicket,
        roomFanTicketCount: toNumber(decoded.roomFanTicketCount),
        logId: decoded.logId || "",
        compose: decoded.compose || "",
        trayText: readText(decoded.trayDisplayText),
      }, method, decoded));
      return;
    }

    if (method === "WebcastFreeGiftMessage") {
      const decoded = this.types.FreeGiftMessage.decode(payload);
      const user = this.prepareGiftUser(mergeUserObjects(decoded.user, decoded.common?.user));
      const gift = decoded.freeGift || {};
      const giftId = String(gift.id || "");
      const knownGift = this.getGiftMeta(giftId) || {};
      const count = readCount(gift.count, gift.repeatCount);
      const fanTicket = toNumber(gift.fanTickets);
      this.emit("gift", this.withRaw({
        type: "gift",
        at: new Date().toISOString(),
        ...userEventFields(user, "礼物消息"),
        giftId,
        giftName: gift.content || knownGift.giftName || (giftId ? `免费礼物${giftId}` : "免费礼物"),
        giftKind: "free",
        giftType: knownGift.giftType || 0,
        giftScene: knownGift.giftScene || 0,
        giftDescribe: knownGift.describe || "",
        diamondCount: 0,
        count,
        repeatCount: toNumber(gift.repeatCount),
        groupCount: toNumber(gift.groupId),
        baseScore: 0,
        bonusScore: fanTicket,
        bonusRate: 1,
        fanTicket,
        roomFanTicketCount: 0,
      }, method, decoded));
      return;
    }

    if (method === "WebcastFansclubMessage") {
      const decoded = this.types.FansclubMessage.decode(payload);
      const user = await this.enrichUser(mergeUserObjects(decoded.user, decoded.common?.user));
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "fansclub",
        at: new Date().toISOString(),
        method,
        ...userEventFields(user),
        action: toNumber(decoded.action),
        content: decoded.content || "",
        leftDiamond: toNumber(decoded.leftDiamond),
        upgradePrivilege: decoded.upgradePrivilege ? {
          content: decoded.upgradePrivilege.content || "",
          description: decoded.upgradePrivilege.description || "",
          buttonType: toNumber(decoded.upgradePrivilege.buttonType),
        } : null,
      }, method, decoded));
      return;
    }

    if (method === "WebcastSocialMessage") {
      const decoded = this.types.SocialMessage.decode(payload);
      const user = await this.enrichUser(mergeUserObjects(decoded.user, decoded.common?.user));
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "social",
        at: new Date().toISOString(),
        method,
        ...userEventFields(user),
        shareType: toNumber(decoded.shareType),
        action: toNumber(decoded.action),
        shareTarget: decoded.shareTarget || "",
        followCount: toNumber(decoded.followCount),
        shareTotalCount: toNumber(decoded.shareTotalCount),
      }, method, decoded));
      return;
    }

    if (method === "WebcastLikeMessage") {
      const decoded = this.types.LikeMessage.decode(payload);
      const user = await this.enrichUser(mergeUserObjects(decoded.user, decoded.common?.user));
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "like",
        at: new Date().toISOString(),
        method,
        ...userEventFields(user),
        count: toNumber(decoded.count),
        total: toNumber(decoded.total),
        color: toNumber(decoded.color),
        icon: decoded.icon || "",
        linkmicGuestUid: decoded.linkmicGuestUid ? String(decoded.linkmicGuestUid) : "",
        scene: decoded.scene || "",
      }, method, decoded));
      return;
    }

    if (method === "WebcastContentOpenPicoLikeMessage") {
      const decoded = this.types.ContentOpenPicoLikeMessage.decode(payload);
      const user = await this.enrichUser(mergeUserObjects(decoded.user, decoded.common?.user));
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "pico-like",
        at: new Date().toISOString(),
        method,
        ...userEventFields(user),
        count: toNumber(decoded.count),
        emoji: decoded.emoji || "",
        totalCount: toNumber(decoded.totalCount),
        totalCountText: decoded.totalCountDesc || "",
      }, method, decoded));
      return;
    }

    if (method === "WebcastChatLikeMessage") {
      const decoded = this.types.ChatLikeMessage.decode(payload);
      const entries = Object.entries(decoded.totalMsgData || {}).map(([messageId, item]) => ({
        messageId,
        count: toNumber(item?.count),
        version: toNumber(item?.version),
      }));
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "chat-like",
        at: new Date().toISOString(),
        method,
        count: entries.reduce((sum, item) => sum + item.count, 0),
        entries,
      }, method, decoded));
      return;
    }

    if (method === "WebcastRoomMessage") {
      const decoded = this.types.RoomMessage.decode(payload);
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "room-message",
        at: new Date().toISOString(),
        method,
        content: decoded.content || "",
        roomMessageType: toNumber(decoded.roomMessageType),
        systemTopMessage: Boolean(decoded.systemTopMsg),
        forcedGuarantee: Boolean(decoded.forcedGuarantee),
        bizScene: decoded.bizScene || "",
      }, method, decoded));
      return;
    }

    if (method === "WebcastShortTouchAreaMessage") {
      const decoded = this.types.ShortTouchAreaMessage.decode(payload);
      const area = decoded.shortTouchAreaData || {};
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "short-touch-area",
        at: new Date().toISOString(),
        method,
        messageType: toNumber(decoded.messageType),
        areaType: toNumber(area.type),
        priority: toNumber(area.priority),
        minWebcastSdkVersion: toNumber(area.minWebcastSdkVersion),
        shortTouchType: toNumber(area.shortTouchType),
        containerPayload: area.containerPayload || "",
        loadType: toNumber(area.loadType),
        name: area.name || "",
        hideMode: toNumber(area.hideMode),
        enhancedTouch: toNumber(area.enhancedTouch),
        dynamicPriority: toNumber(area.dynamicPriority),
        enableInPc: Boolean(area.enableInPc),
      }, method, decoded));
      return;
    }

    if (method === "WebcastInRoomBannerMessage") {
      const decoded = this.types.InRoomBannerMessage.decode(payload);
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "in-room-banner",
        at: new Date().toISOString(),
        method,
        extra: decoded.extra || "",
        position: toNumber(decoded.position),
        actionType: toNumber(decoded.actionType),
        containerUrl: decoded.containerUrl || "",
        lynxContainerUrl: decoded.lynxContainerUrl || "",
        containerType: toNumber(decoded.containerType),
        opType: toNumber(decoded.opType),
      }, method, decoded));
      return;
    }

    if (method === "WebcastRanklistHourEntranceMessage") {
      const decoded = this.types.RanklistHourEntranceMessage.decode(payload);
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "ranklist-hour-entrance",
        at: new Date().toISOString(),
        method,
        infoBytes: decoded.info?.length || 0,
      }, method, decoded));
      return;
    }

    if (method === "WebcastRankListHourEnterMessage") {
      const decoded = this.types.RankListHourEnterMessage.decode(payload);
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "rank-list-hour-enter",
        at: new Date().toISOString(),
        method,
        infoBytes: decoded.hourEnterInfo?.length || 0,
      }, method, decoded));
      return;
    }

    if (method === "WebcastGiftUpdateMessage") {
      const decoded = this.types.GiftUpdateMessage.decode(payload);
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "gift-update",
        at: new Date().toISOString(),
        method,
        updateType: toNumber(decoded.updateType),
        updateGiftIds: (decoded.updateGiftIds || []).map(String),
        updateAssetIds: (decoded.updateAssetIds || []).map(String),
      }, method, decoded));
      return;
    }

    if (method === "WebcastRoomVerifyMessage") {
      const decoded = this.types.RoomVerifyMessage.decode(payload);
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "room-verify",
        at: new Date().toISOString(),
        method,
        action: toNumber(decoded.action),
        content: decoded.content || "",
        noticeType: toNumber(decoded.noticeType),
        closeRoom: Boolean(decoded.closeRoom),
        unableStyle: toNumber(decoded.unableStyle),
        tipContent: decoded.tipContent || "",
        anchorSwitch: toNumber(decoded.anchorSwitch),
        switchStatusTipMessage: decoded.switchStatusTipMsg || "",
        switchStatusAnchorTipMessage: decoded.switchStatusAnchorTipMsg || "",
      }, method, decoded));
      return;
    }

    if (method === "WebcastRoomStartMessage") {
      const decoded = this.types.RoomStartMessage.decode(payload);
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "room-start",
        at: new Date().toISOString(),
        method,
        content: decoded.content || "",
        imageUrl: decoded.imageUrl || "",
        instationPushType: toNumber(decoded.instationPushType),
      }, method, decoded));
      return;
    }

    if (method === "WebcastLinkmicPlayModeUpdateScoreMessage") {
      const decoded = this.types.LinkmicPlayModeUpdateScoreMessage.decode(payload);
      const fromUser = await this.enrichUser(decoded.fromUser);
      const toUser = await this.enrichUser(decoded.toUser);
      const anchorId = String(firstValue(decoded.anchorId, decoded.anchorOpenId));
      const anchorOpenId = String(firstValue(decoded.anchorOpenId));
      const fromRaw = decoded.fromUser || {};
      const toRaw = decoded.toUser || {};
      const fromRawId = String(firstValue(fromRaw.idStr, fromRaw.id, decoded.fromUserId));
      const toRawId = String(firstValue(toRaw.idStr, toRaw.id, decoded.toUserId));
      const fromOpenId = String(firstValue(fromRaw.userOpenId, fromRaw.user_open_id, decoded.fromUserOpenId));
      const toOpenId = String(firstValue(toRaw.userOpenId, toRaw.user_open_id, decoded.toUserOpenId));
      const anchorUser =
        (anchorId && fromRawId === anchorId) || (anchorOpenId && fromOpenId === anchorOpenId)
          ? fromUser
          : (anchorId && toRawId === anchorId) || (anchorOpenId && toOpenId === anchorOpenId)
            ? toUser
            : null;
      this.emit("event", this.withRaw({
        type: "event",
        eventType: "linkmic-score",
        at: new Date().toISOString(),
        method,
        anchorId,
        ...(anchorUser ? userEventFields(anchorUser, "linkmic-score") : {}),
        score: toNumber(decoded.hotScore),
        scoreText: decoded.hotScore ? String(decoded.hotScore) : "",
        liveId: decoded.liveId ? String(decoded.liveId) : "",
        appId: decoded.appId ? String(decoded.appId) : "",
        roomId: decoded.roomId ? String(decoded.roomId) : "",
        fromUserId: decoded.fromUserId ? String(decoded.fromUserId) : "",
        toUserId: decoded.toUserId ? String(decoded.toUserId) : "",
        scoreSource: toNumber(decoded.scoreSource),
        hotScore: toNumber(decoded.hotScore),
        idempotentId: decoded.idempotentId || "",
        messageTime: toIsoTime(decoded.msgTMs),
        extra: decoded.extra || "",
        userLinkmicUniqueId: decoded.userLinkmicUniqueId || "",
        fromUser: userEventFields(fromUser),
        toUser: userEventFields(toUser),
        anchorOpenId,
        fromUserOpenId: decoded.fromUserOpenId || "",
        toUserOpenId: decoded.toUserOpenId || "",
      }, method, decoded));
      return;
    }

    if (method === "WebcastProfitInteractionScoreMessage") {
      const decoded = this.types.ProfitInteractionScoreMessage.decode(payload);
      const entries = Object.entries(decoded.anchorInfos || decoded.openAnchorInfos || {});
      const ranks = entries.map(([anchorId, info], index) => {
        const userId = String(anchorId || "");
        const user = this.getCachedUser(userId);
        return {
          rank: index + 1,
          nickname: user?.realName || user?.displayName || "",
          displayName: user?.displayName || "",
          realName: user?.realName || "",
          userId,
          secUid: user?.secUid || "",
          uniqueId: user?.uniqueId || "",
          webcastUid: user?.webcastUid || "",
          isMystery: Boolean(user?.isMystery),
          mysteryMan: user?.mysteryMan || 0,
          isAnonymous: Boolean(user?.isAnonymous),
          userLevel: user?.userLevel || 0,
          badgeLevel: user?.badgeLevel || 0,
          consumeLevel: user?.consumeLevel || 0,
          wealthLevel: user?.wealthLevel || 0,
          fansClubLevel: user?.fansClubLevel || 0,
          honorLevel: user?.honorLevel || 0,
          payScore: user?.payScore || 0,
          totalRechargeDiamondCount: user?.totalRechargeDiamondCount || 0,
          fanTicketCount: user?.fanTicketCount || 0,
          cacheHit: Boolean(user?.cacheHit),
          scoreText: info?.score || "",
          score: normalizeScore(info?.score),
        };
      });
      this.lastRankAt = new Date().toISOString();
      this.emit("rank", this.withRaw({
        type: "rank",
        at: this.lastRankAt,
        interactionScoreStatus: toNumber(decoded.interactionScoreStatus),
        interactionScoreAction: toNumber(decoded.interactionScoreAction),
        channelId: decoded.channelId ? String(decoded.channelId) : "",
        extra: decoded.extra || "",
        gameExtra: decoded.gameExtra || "",
        ranks,
      }, method, decoded));
    }
  }
}

module.exports = {
  LivePkWatcher,
};
