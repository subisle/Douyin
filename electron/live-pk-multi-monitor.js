"use strict";

const { EventEmitter } = require("events");

const DEFAULT_MAX_ROOMS = 32;
const DEFAULT_CAPTURE_CONCURRENCY = 8;
const STATUS_EMIT_INTERVAL_MS = 250;

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstText(...values) {
  for (const value of values) {
    const next = text(value);
    if (next) return next;
  }
  return "";
}

function scoreRowsFromPayload(payload) {
  const source = Array.isArray(payload?.scores)
    ? payload.scores
    : Array.isArray(payload?.ranks)
      ? payload.ranks
      : [];
  return source
    .map((score, index) => {
      const scoreValue = number(score?.score);
      return {
        rank: number(score?.rank) || index + 1,
        anchorId: firstText(score?.anchorId, score?.userId, score?.user_id, score?.id),
        name: firstText(score?.realName, score?.nickname, score?.displayName, score?.anchorName),
        uniqueId: firstText(score?.uniqueId, score?.douyinId),
        score: scoreValue,
        scoreText: firstText(score?.scoreText, scoreValue ? String(scoreValue) : "0"),
      };
    })
    .filter((score) => score.anchorId || score.name || score.score > 0);
}

function normalizeRoom(room, index) {
  const input = room && typeof room === "object" ? room : {};
  const roomId = firstText(input.liveRoomUrl, input.url, input.roomUrl);
  const anchorId = firstText(input.anchorId, input.douyinNo, input.personId, input.id);
  const baseKey = firstText(input.personId, input.id, input.anchorId, input.douyinNo, index + 1);
  return {
    sessionId: `multi-${baseKey}-${index + 1}`,
    anchorId,
    personId: firstText(input.personId, input.id),
    name: firstText(input.name, input.anchorName, input.douyinNo, input.anchorId) || `主播 ${index + 1}`,
    douyinNo: firstText(input.douyinNo),
    liveRoomUrl: roomId,
  };
}

function publicSession(session) {
  return {
    sessionId: session.sessionId,
    anchorId: session.anchorId,
    personId: session.personId,
    name: session.name,
    douyinNo: session.douyinNo,
    liveRoomUrl: session.liveRoomUrl,
    status: session.status,
    transport: session.transport,
    source: session.source,
    roomId: session.roomId,
    title: session.title,
    ownerNickname: session.ownerNickname,
    onlineText: session.onlineText,
    fanTicket: session.fanTicket,
    giftEvents: session.giftEvents,
    chatEvents: session.chatEvents,
    memberEvents: session.memberEvents,
    eventCount: session.eventCount,
    scores: session.scores,
    startedAt: session.startedAt,
    lastEventAt: session.lastEventAt,
    lastMessage: session.lastMessage,
    lastError: session.lastError,
  };
}

/**
 * Multi-room live monitor — 默认只监控音浪。
 *
 * Protocol path (default): pure HTTP enter + signed WSS per room.
 * Capture path: optional BrowserWindow+CDP fallback when protocol fails.
 *
 * Resource rules:
 * - enter concurrency is capped (default 8) so TLS/DNS don't stampede
 * - no keep-alive browser windows in protocol mode
 * - bootstrapMode=score：不拉 gift catalog，只拉 linkmic 分
 * - watcher scoreOnly：丢弃礼物/弹幕/进场，只解析音浪相关消息
 * - watcher-side PK poll is adaptive (idle 8s / linked 2.5s / pk 1s)
 */
class LivePkMultiMonitor extends EventEmitter {
  constructor({
    createWatcher,
    captureLiveOptions,
    getParentWindow,
    getDefaultCookie,
    maxRooms = DEFAULT_MAX_ROOMS,
    captureConcurrency = DEFAULT_CAPTURE_CONCURRENCY,
    preferProtocol = true,
    scoreOnly = true,
    now = () => new Date().toISOString(),
  } = {}) {
    super();
    if (typeof createWatcher !== "function") throw new TypeError("createWatcher is required");
    if (typeof captureLiveOptions !== "function") throw new TypeError("captureLiveOptions is required");
    this.setMaxListeners(64);
    this.createWatcher = createWatcher;
    this.captureLiveOptions = captureLiveOptions;
    this.getParentWindow = typeof getParentWindow === "function" ? getParentWindow : () => null;
    this.getDefaultCookie = typeof getDefaultCookie === "function" ? getDefaultCookie : () => "";
    this.maxRooms = Math.max(1, Number(maxRooms) || DEFAULT_MAX_ROOMS);
    this.captureConcurrency = Math.max(1, Number(captureConcurrency) || DEFAULT_CAPTURE_CONCURRENCY);
    this.preferProtocol = preferProtocol !== false;
    this.scoreOnly = scoreOnly !== false;
    this.now = now;
    this.sessions = new Map();
    this.generation = 0;
    this.emitTimer = null;
  }

  getStatus() {
    const rooms = [...this.sessions.values()].map(publicSession);
    const runningCount = rooms.filter((room) => room.status === "running").length;
    const pendingCount = rooms.filter((room) => ["queued", "capturing", "connecting"].includes(room.status)).length;
    const errorCount = rooms.filter((room) => room.status === "error").length;
    let status = "idle";
    if (pendingCount > 0) status = "starting";
    else if (runningCount === rooms.length && runningCount > 0) status = "running";
    else if (runningCount > 0 || errorCount > 0) status = "partial";
    else if (errorCount > 0) status = "error";
    return {
      status,
      roomCount: rooms.length,
      runningCount,
      pendingCount,
      errorCount,
      maxRooms: this.maxRooms,
      captureConcurrency: this.captureConcurrency,
      preferProtocol: this.preferProtocol,
      scoreOnly: this.scoreOnly,
      updatedAt: this.now(),
      rooms,
    };
  }

  start({ rooms = [], cookie = "", captureConcurrency, preferProtocol, scoreOnly } = {}) {
    const normalized = Array.isArray(rooms)
      ? rooms.map(normalizeRoom).filter((room) => room.liveRoomUrl)
      : [];
    if (normalized.length === 0) throw new Error("至少选择一个有效直播间");
    if (normalized.length > this.maxRooms) {
      throw new Error(`最多同时监控 ${this.maxRooms} 个主播`);
    }

    if (captureConcurrency != null) {
      this.captureConcurrency = Math.max(1, Number(captureConcurrency) || this.captureConcurrency);
    }
    if (preferProtocol != null) this.preferProtocol = preferProtocol !== false;
    if (scoreOnly != null) this.scoreOnly = scoreOnly !== false;

    this.stop({ emit: false });
    this.generation += 1;
    const generation = this.generation;
    // 音浪模式默认空 cookie：协议 ttwid 自取，不强制本机登录态。
    const sessionCookie = text(cookie) || (this.scoreOnly ? "" : text(this.getDefaultCookie()));
    for (const room of normalized) {
      const session = {
        ...room,
        watcher: this.createWatcher(),
        captureWindow: null,
        status: "queued",
        transport: "",
        source: "",
        roomId: "",
        title: "",
        ownerNickname: room.name,
        onlineText: "",
        fanTicket: 0,
        giftEvents: 0,
        chatEvents: 0,
        memberEvents: 0,
        eventCount: 0,
        scores: [],
        startedAt: null,
        lastEventAt: "",
        lastMessage: this.scoreOnly ? "等待音浪监控" : "等待启动",
        lastError: "",
        stopped: false,
      };
      this.sessions.set(session.sessionId, session);
      this.bindWatcher(session);
    }
    this.emitNow();
    void this.runQueue([...this.sessions.values()], generation, sessionCookie);
    return this.getStatus();
  }

  stop({ sessionId = "", emit = true } = {}) {
    if (!sessionId) this.generation += 1;
    const targets = sessionId
      ? [...this.sessions.values()].filter((session) => session.sessionId === sessionId)
      : [...this.sessions.values()];
    for (const session of targets) this.stopSession(session);
    if (!sessionId) this.sessions.clear();
    if (emit) this.emitNow();
    return this.getStatus();
  }

  stopSession(session) {
    if (!session || session.stopped) return;
    session.stopped = true;
    session.status = "idle";
    session.lastMessage = "已停止";
    try {
      session.watcher.removeAllListeners();
      session.watcher.stop();
    } catch {
      // A failed watcher is already being torn down.
    }
    this.closeCaptureWindow(session);
  }

  async runQueue(sessions, generation, cookie) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < sessions.length) {
        const index = cursor;
        cursor += 1;
        const session = sessions[index];
        if (!session || generation !== this.generation || session.stopped) continue;
        await this.startSession(session, generation, cookie);
      }
    };
    const parallelism = Math.min(this.captureConcurrency, sessions.length);
    await Promise.all(Array.from({ length: parallelism }, () => worker()));
    if (generation === this.generation) this.emitNow();
  }

  async startSession(session, generation, cookie) {
    const maxAttempts = 3;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (session.stopped || generation !== this.generation) return;
      session.status = "capturing";
      session.lastMessage =
        attempt > 1
          ? `进房重试 ${attempt}/${maxAttempts}…`
          : this.scoreOnly
            ? "协议进房 · 音浪"
            : this.preferProtocol
              ? "协议进房中…"
              : "正在获取协议连接";
      this.emitNow();
      let capture;
      try {
        const captureResult = this.captureLiveOptions(session.liveRoomUrl, {
          parentWindow: this.getParentWindow(),
          cookie,
          show: false,
          keepAlive: false,
          // 音浪模式：bootstrapMode=score，不拉 gift catalog。
          bootstrapMode: this.scoreOnly ? "score" : "lean",
          shareGiftList: !this.scoreOnly,
          preferProtocol: this.preferProtocol,
          allowBrowserFallback: this.preferProtocol,
          scoreOnly: this.scoreOnly,
          onStatus: (message) => {
            if (session.stopped || generation !== this.generation) return;
            session.lastMessage = text(message);
            this.emitLater();
          },
        });
        // Support:
        // 1) Promise of options (protocol)
        // 2) { window, promise } (legacy CDP)
        // 3) plain options / resolveLiveMonitorOptions shape
        if (captureResult && typeof captureResult.then === "function") {
          capture = { window: null, promise: captureResult };
        } else if (captureResult && captureResult.promise) {
          capture = captureResult;
        } else if (captureResult && (captureResult.websocketUrl || captureResult.fetchUrl || captureResult.options)) {
          if (captureResult.options) {
            capture = {
              window: captureResult.window || null,
              promise: Promise.resolve({
                ...captureResult.options,
                source: captureResult.source || captureResult.options.source,
              }),
            };
          } else {
            capture = { window: null, promise: Promise.resolve(captureResult) };
          }
        } else {
          throw new Error("captureLiveOptions 返回值无效");
        }
        session.captureWindow = capture?.window || null;
        const options = await capture?.promise;
        // Protocol path never keeps a BrowserWindow; close any accidental capture window ASAP.
        if ((!options?.source || options.source === "protocol") && session.captureWindow) {
          this.closeCaptureWindow(session);
        }
        if (session.stopped || generation !== this.generation) return;
        if (!options || (!options.websocketUrl && !options.fetchUrl)) {
          throw new Error("未获取到直播间协议连接");
        }
        session.transport = options.websocketUrl ? "websocket" : "fetch";
        session.source = text(options.source) || (session.captureWindow ? "capture" : "protocol");
        session.roomId = firstText(options.roomId, options.bootstrap?.roomId, session.roomId);
        session.status = "connecting";
        session.lastError = "";
        session.lastMessage = session.source === "protocol"
          ? this.scoreOnly
            ? "音浪通道已就绪"
            : "协议 WebSocket 已就绪"
          : session.transport === "websocket"
            ? "WebSocket 已连接，开始采集"
            : "HTTP 协议已就绪，开始轮询";
        this.emitNow();
        await session.watcher.start({
          ...options,
          includeRaw: false,
          scoreOnly: this.scoreOnly,
          // 音浪模式不挂 profile 补齐，降低并发占用。
          profileLookup: this.scoreOnly ? null : options.profileLookup,
        });
        // After watcher owns the socket, any CDP window is pure waste — drop it.
        if (session.source === "protocol" || !options.keepCaptureWindow) {
          this.closeCaptureWindow(session);
        }
        return;
      } catch (error) {
        lastError = error;
        this.closeCaptureWindow(session);
        if (session.stopped || generation !== this.generation) return;
        session.lastError = error?.message || String(error);
        if (attempt < maxAttempts) {
          session.status = "capturing";
          session.lastMessage = `进房失败，${450 * attempt}ms 后重试 ${attempt}/${maxAttempts - 1}`;
          this.emitNow();
          await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
          continue;
        }
        session.status = "error";
        session.lastMessage = "启动失败";
        this.emitNow();
      }
    }
    if (lastError && session.status !== "error" && !session.stopped && generation === this.generation) {
      session.status = "error";
      session.lastError = lastError?.message || String(lastError);
      session.lastMessage = "启动失败";
      this.emitNow();
    }
  }

  bindWatcher(session) {
    const touch = () => {
      session.lastEventAt = this.now();
      session.eventCount += 1;
    };
    session.watcher.on("status", (status) => {
      if (session.stopped) return;
      session.status = status?.status === "running"
        ? "running"
        : status?.status === "error"
          ? "error"
          : status?.status === "closed"
            ? "closed"
            : session.status;
      session.startedAt = status?.startedAt || session.startedAt;
      session.roomId = firstText(status?.roomId, session.roomId);
      session.lastError = firstText(status?.lastError, session.lastError);
      this.emitNow();
    });
    session.watcher.on("rank", (payload) => {
      if (session.stopped) return;
      const scores = scoreRowsFromPayload(payload);
      if (scores.length > 0) {
        session.scores = scores;
        session.lastMessage = "音浪已更新";
      }
      touch();
      this.emitLater();
    });
    // 音浪模式不订阅 gift/chat/member，避免无用事件刷状态。
    if (!this.scoreOnly) {
      session.watcher.on("gift", (payload) => {
        if (session.stopped) return;
        session.giftEvents += 1;
        session.fanTicket = Math.max(session.fanTicket, number(payload?.roomFanTicketCount));
        touch();
        this.emitLater();
      });
      session.watcher.on("chat", () => {
        if (session.stopped) return;
        session.chatEvents += 1;
        touch();
        this.emitLater();
      });
      session.watcher.on("member", () => {
        if (session.stopped) return;
        session.memberEvents += 1;
        touch();
        this.emitLater();
      });
    }
    session.watcher.on("event", (payload) => {
      if (session.stopped) return;
      const eventType = text(payload?.eventType);
      if (eventType === "room-info") {
        session.roomId = firstText(payload?.roomId, session.roomId);
        session.title = firstText(payload?.title, session.title);
        session.ownerNickname = firstText(payload?.ownerNickname, payload?.nickname, session.ownerNickname);
      }
      if (eventType === "room-stats" || eventType === "room-user-seq") {
        session.onlineText = firstText(
          payload?.displayLong,
          payload?.displayMiddle,
          payload?.displayShort,
          payload?.totalUserText,
          session.onlineText
        );
      }
      // linkmic-score / pk-score-snapshot / live-mode 都可能带 scores
      const scores = scoreRowsFromPayload(payload);
      if (scores.length > 0) {
        session.scores = scores;
        session.lastMessage = "音浪已更新";
      } else if (eventType === "linkmic-score" && number(payload?.score) > 0) {
        // 单条连麦分更新：合并进现有 scores
        const anchorId = firstText(payload?.anchorId, payload?.userId);
        const scoreValue = number(payload?.score);
        if (anchorId || scoreValue) {
          const next = [...(session.scores || [])];
          const idx = next.findIndex(
            (row) => firstText(row.anchorId) === anchorId && anchorId
          );
          const row = {
            rank: idx >= 0 ? next[idx].rank : next.length + 1,
            anchorId: anchorId || firstText(payload?.name),
            name: firstText(payload?.realName, payload?.nickname, payload?.displayName, payload?.name),
            uniqueId: firstText(payload?.uniqueId),
            score: scoreValue,
            scoreText: firstText(payload?.scoreText, String(scoreValue)),
          };
          if (idx >= 0) next[idx] = { ...next[idx], ...row };
          else next.push(row);
          next.sort((a, b) => (b.score || 0) - (a.score || 0));
          session.scores = next.map((item, index) => ({ ...item, rank: index + 1 }));
          session.lastMessage = "音浪已更新";
        }
      }
      touch();
      this.emitLater();
    });
    session.watcher.on("error-message", (message) => {
      if (session.stopped) return;
      session.lastError = text(message);
      session.lastMessage = "采集异常";
      this.emitNow();
    });
  }

  closeCaptureWindow(session) {
    const captureWindow = session.captureWindow;
    session.captureWindow = null;
    if (!captureWindow || captureWindow.isDestroyed?.()) return;
    try {
      captureWindow.close();
    } catch {
      // Ignore close errors.
    }
  }

  emitLater() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit("status", this.getStatus());
    }, STATUS_EMIT_INTERVAL_MS);
    this.emitTimer.unref?.();
  }

  emitNow() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.emit("status", this.getStatus());
  }
}

module.exports = {
  LivePkMultiMonitor,
  scoreRowsFromPayload,
  DEFAULT_MAX_ROOMS,
  DEFAULT_CAPTURE_CONCURRENCY,
};
