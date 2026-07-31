"use strict";

const { EventEmitter } = require("events");

const DEFAULT_MAX_ROOMS = 8;
const DEFAULT_CAPTURE_CONCURRENCY = 2;
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

class LivePkMultiMonitor extends EventEmitter {
  constructor({
    createWatcher,
    captureLiveOptions,
    getParentWindow,
    getDefaultCookie,
    maxRooms = DEFAULT_MAX_ROOMS,
    captureConcurrency = DEFAULT_CAPTURE_CONCURRENCY,
    now = () => new Date().toISOString(),
  } = {}) {
    super();
    if (typeof createWatcher !== "function") throw new TypeError("createWatcher is required");
    if (typeof captureLiveOptions !== "function") throw new TypeError("captureLiveOptions is required");
    this.createWatcher = createWatcher;
    this.captureLiveOptions = captureLiveOptions;
    this.getParentWindow = typeof getParentWindow === "function" ? getParentWindow : () => null;
    this.getDefaultCookie = typeof getDefaultCookie === "function" ? getDefaultCookie : () => "";
    this.maxRooms = Math.max(1, Number(maxRooms) || DEFAULT_MAX_ROOMS);
    this.captureConcurrency = Math.max(1, Number(captureConcurrency) || DEFAULT_CAPTURE_CONCURRENCY);
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
      updatedAt: this.now(),
      rooms,
    };
  }

  start({ rooms = [], cookie = "" } = {}) {
    const normalized = Array.isArray(rooms)
      ? rooms.map(normalizeRoom).filter((room) => room.liveRoomUrl)
      : [];
    if (normalized.length === 0) throw new Error("至少选择一个有效直播间");
    if (normalized.length > this.maxRooms) {
      throw new Error(`最多同时监控 ${this.maxRooms} 个主播`);
    }

    this.stop({ emit: false });
    this.generation += 1;
    const generation = this.generation;
    const sessionCookie = text(cookie) || text(this.getDefaultCookie());
    for (const room of normalized) {
      const session = {
        ...room,
        watcher: this.createWatcher(),
        captureWindow: null,
        status: "queued",
        transport: "",
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
        lastMessage: "等待启动",
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
    if (emit) this.emitNow();
    return this.getStatus();
  }

  stopSession(session) {
    if (!session || session.stopped) return;
    session.stopped = true;
    session.status = "idle";
    session.lastMessage = "已停止";
    try {
      session.watcher.stop();
    } catch {
      // A failed watcher is already being torn down.
    }
    const captureWindow = session.captureWindow;
    session.captureWindow = null;
    if (captureWindow && !captureWindow.isDestroyed?.()) {
      try {
        captureWindow.close();
      } catch {
        // Ignore close errors during app shutdown.
      }
    }
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
    await Promise.all(
      Array.from({ length: Math.min(this.captureConcurrency, sessions.length) }, () => worker())
    );
    if (generation === this.generation) this.emitNow();
  }

  async startSession(session, generation, cookie) {
    session.status = "capturing";
    session.lastMessage = "正在获取协议连接";
    this.emitNow();
    let capture;
    try {
      capture = this.captureLiveOptions(session.liveRoomUrl, {
        parentWindow: this.getParentWindow(),
        cookie,
        show: false,
        keepAlive: true,
        onStatus: (message) => {
          if (session.stopped || generation !== this.generation) return;
          session.lastMessage = text(message);
          this.emitLater();
        },
      });
      session.captureWindow = capture?.window || null;
      const options = await capture?.promise;
      if (session.stopped || generation !== this.generation) return;
      if (!options || (!options.websocketUrl && !options.fetchUrl)) {
        throw new Error("未获取到直播间协议连接");
      }
      session.transport = options.websocketUrl ? "websocket" : "fetch";
      session.status = "connecting";
      session.lastMessage = session.transport === "websocket" ? "WebSocket 已连接，开始采集" : "HTTP 协议已就绪，开始轮询";
      this.emitNow();
      await session.watcher.start({ ...options, includeRaw: false });
    } catch (error) {
      if (session.stopped || generation !== this.generation) return;
      session.status = "error";
      session.lastError = error?.message || String(error);
      session.lastMessage = "启动失败";
      this.closeCaptureWindow(session);
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
      if (scores.length > 0) session.scores = scores;
      touch();
      this.emitLater();
    });
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
      const scores = scoreRowsFromPayload(payload);
      if (scores.length > 0) session.scores = scores;
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
};
