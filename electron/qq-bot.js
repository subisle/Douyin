"use strict";

/**
 * 官方 QQ 机器人服务（桌面）
 * - 通道：QQ 开放平台 WebSocket + OpenAPI
 * - 业务：复用微信侧 commandHandler / agentHandler（同一 replyApi 契约）
 */

const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const {
  INTENT_GROUP_AND_C2C,
  MSG_TYPE,
  FILE_TYPE,
  fetchAppAccessToken,
  fetchGatewayUrl,
  sendGroupMessage,
  sendC2cMessage,
  uploadGroupFile,
  uploadC2cFile,
  downloadAttachment,
  normalizeInboundEvent,
  buildIdentifyPayload,
  buildResumePayload,
  normalizeApiBase,
  DEFAULT_API_BASE,
} = require("../shared/qqbot-adapter");

const DEFAULT_SETTINGS = Object.freeze({
  appId: "",
  clientSecret: "",
  apiBase: DEFAULT_API_BASE,
  intents: INTENT_GROUP_AND_C2C,
  autoConnect: true,
  autoReplyEnabled: false,
  autoReplyText: "消息已收到。",
  accessMode: "open", // 开放：任意用户 / 任意群
  allowUserIds: [],
  allowGroupIds: [],
  // 绑定记录：任意 C2C 用户发消息即记录，用于午夜提醒触达
  boundUserIds: [],
  reminderEnabled: true,
  lastReminderDate: null,
});

const MAX_MESSAGES = 200;

function compactError(error) {
  if (!error) return "unknown";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const s = String(value || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeSettings(input = {}, fallback = DEFAULT_SETTINGS) {
  const src = input && typeof input === "object" ? input : {};
  // 产品：始终开放访问；allow* 字段仅兼容旧存储读写，不参与权限判断
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  return {
    appId: String(src.appId ?? fallback.appId ?? "").trim(),
    clientSecret: String(src.clientSecret ?? fallback.clientSecret ?? "").trim(),
    apiBase: normalizeApiBase(src.apiBase ?? fallback.apiBase),
    intents: Number(src.intents) > 0 ? Number(src.intents) : INTENT_GROUP_AND_C2C,
    autoConnect: Boolean(src.autoConnect),
    autoReplyEnabled: Boolean(src.autoReplyEnabled),
    autoReplyText: String(src.autoReplyText ?? fallback.autoReplyText).slice(0, 1000),
    accessMode: "open",
    allowUserIds: [],
    allowGroupIds: [],
    boundUserIds: uniqueStrings(src.boundUserIds ?? fallback.boundUserIds),
    reminderEnabled: hasOwn(src, "reminderEnabled")
      ? Boolean(src.reminderEnabled)
      : Boolean(fallback.reminderEnabled),
    lastReminderDate: String(
      hasOwn(src, "lastReminderDate")
        ? src.lastReminderDate
        : fallback.lastReminderDate || ""
    ).trim() || null,
  };
}

function createSessionQueues() {
  const tails = new Map();
  return {
    runSerial(key, task) {
      const k = String(key || "default");
      const prev = tails.get(k) || Promise.resolve();
      const next = prev.catch(() => {}).then(task);
      tails.set(
        k,
        next.finally(() => {
          if (tails.get(k) === next) tails.delete(k);
        })
      );
      return next;
    },
  };
}

class QqBotService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.storagePath =
      typeof options.storagePath === "function"
        ? options.storagePath
        : () => String(options.storagePath || "");
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.WebSocketImpl = options.WebSocketImpl || WebSocket;
    this.commandHandler = null;
    this.agentHandler = null;
    this.modeStore = null;
    this.getSharedAiSettings =
      typeof options.getSharedAiSettings === "function" ? options.getSharedAiSettings : null;
    this.sessionQueues = createSessionQueues();

    this.settings = { ...DEFAULT_SETTINGS };
    this.messages = [];
    this.phase = "idle"; // idle | connecting | ready | reconnecting | error
    this.error = null;
    this.connected = false;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.ws = null;
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = 41250;
    this.sessionId = null;
    this.lastSeq = null;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.manualStop = false;
    this.startedAt = null;
    this._processing = new Set();
  }

  setCommandHandler(handler) {
    this.commandHandler = typeof handler === "function" ? handler : null;
  }

  setAgentHandler(handler) {
    this.agentHandler = typeof handler === "function" ? handler : null;
  }

  setModeStore(store) {
    this.modeStore = store || null;
  }

  getStatus() {
    return {
      channel: "qqbot",
      phase: this.phase,
      connected: this.connected,
      error: this.error,
      appId: this.settings.appId ? `${this.settings.appId.slice(0, 4)}…` : "",
      hasCredentials: Boolean(this.settings.appId && this.settings.clientSecret),
      startedAt: this.startedAt,
      messageCount: this.messages.length,
      sessionId: this.sessionId,
      tokenExpiresAt: this.tokenExpiresAt || null,
    };
  }

  getSettings() {
    return {
      ...this.settings,
      // 前端展示用：不在 getSettings 里明文回传完整 secret 可改为掩码；
      // 桌面本地存储仍需要可编辑，这里保留（与 weixin token 本地类似）。
    };
  }

  getMessages() {
    return this.messages.slice();
  }

  clearMessages() {
    this.messages = [];
    this.emit("messages-cleared");
    this._persist();
    return { cleared: true };
  }

  async initialize({ autoStart = true } = {}) {
    this._load();
    this._setStatus({ phase: this.connected ? "ready" : "idle", error: null });
    if (autoStart && this.settings.autoConnect && this.settings.appId && this.settings.clientSecret) {
      try {
        await this.connect();
      } catch (error) {
        this._setStatus({ phase: "error", error: compactError(error) });
      }
    }
    return this.getStatus();
  }

  async shutdown() {
    this.manualStop = true;
    this._clearReconnect();
    this._closeWs();
    this.connected = false;
    this.phase = "idle";
    this._persist();
    this._emitStatus();
  }

  saveSettings(input = {}) {
    this.settings = normalizeSettings(
      { ...this.settings, ...input },
      this.settings
    );
    this._persist();
    this._emitStatus();
    return this.getSettings();
  }

  /** 记录 C2C 绑定用户（用于午夜提醒等触达）；不再区分管理员 */
  _registerBoundUser(openid) {
    const uid = String(openid || "").trim();
    if (!uid) return;
    const bound = uniqueStrings([...(this.settings.boundUserIds || []), uid]);
    if (bound.length !== (this.settings.boundUserIds || []).length) {
      this.settings = { ...this.settings, boundUserIds: bound };
      this._persist();
    }
  }

  /**
   * 午夜提醒：给所有已对接（C2C 会话过）的用户发「请发送音浪文件」。
   * 由 main.js 调度器每天跨 0 点后调用一次；受 reminderEnabled 与 lastReminderDate 防重。
   */
  async sendMidnightReminder(text = "请发送音浪文件即可") {
    if (!this.settings.reminderEnabled) {
      return { sent: 0, fail: 0, skipped: "disabled", at: null };
    }
    const now = new Date();
    const todayKey = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    if (this.settings.lastReminderDate === todayKey) {
      return { sent: 0, fail: 0, skipped: "already_sent", at: todayKey };
    }

    const targets = this.settings.boundUserIds || [];
    let sent = 0;
    let fail = 0;
    for (const openid of targets) {
      try {
        await this._ensureToken();
        await sendC2cMessage({
          accessToken: this.accessToken,
          appId: this.settings.appId,
          apiBase: this.settings.apiBase,
          fetchImpl: this.fetchImpl,
          openid,
          content: String(text).slice(0, 1000),
          msgType: MSG_TYPE.TEXT,
        });
        this._pushMessage({
          id: `out-reminder-${Date.now()}-${sent}`,
          direction: "out",
          chatType: "c2c",
          conversationId: `c2c:${openid}`,
          fromUserId: openid,
          text: String(text).slice(0, 1000),
          at: new Date().toISOString(),
        });
        sent += 1;
      } catch (error) {
        fail += 1;
        console.warn("[qq-midnight-reminder] send failed", openid, error?.message || error);
      }
    }

    this.settings = {
      ...this.settings,
      lastReminderDate: todayKey,
    };
    this._persist();
    return { sent, fail, skipped: sent ? null : "no_target", at: todayKey };
  }

  async connect() {
    this.manualStop = false;
    if (!this.settings.appId || !this.settings.clientSecret) {
      throw new Error("请先配置 QQ 机器人 AppID 与 ClientSecret");
    }
    this._setStatus({ phase: "connecting", error: null });
    await this._ensureToken();
    const gatewayUrl = await fetchGatewayUrl({
      accessToken: this.accessToken,
      appId: this.settings.appId,
      apiBase: this.settings.apiBase,
      fetchImpl: this.fetchImpl,
    });
    await this._openGateway(gatewayUrl);
    return this.getStatus();
  }

  async disconnect() {
    this.manualStop = true;
    this._clearReconnect();
    this._closeWs();
    this.connected = false;
    this.sessionId = null;
    this.lastSeq = null;
    this.startedAt = null;
    this._setStatus({ phase: "idle", error: null });
    this._persist();
    return this.getStatus();
  }

  async _ensureToken({ force = false } = {}) {
    const stillValid =
      this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt - 60_000;
    if (!force && stillValid) return this.accessToken;
    const token = await fetchAppAccessToken({
      appId: this.settings.appId,
      clientSecret: this.settings.clientSecret,
      fetchImpl: this.fetchImpl,
    });
    this.accessToken = token.accessToken;
    this.tokenExpiresAt = token.expiresAt;
    this._persist();
    return this.accessToken;
  }

  _openGateway(url) {
    return new Promise((resolve, reject) => {
      this._closeWs();
      let settled = false;
      const ws = new this.WebSocketImpl(url);
      this.ws = ws;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(compactError(error)));
      };

      ws.on("open", () => {
        // 等 Hello(op10) 再 Identify
      });

      ws.on("message", (data) => {
        let packet;
        try {
          packet = JSON.parse(String(data));
        } catch {
          return;
        }
        void this._onPacket(packet, {
          onReady: () => {
            if (settled) return;
            settled = true;
            this.connected = true;
            this.reconnectAttempt = 0;
            this.startedAt = this.startedAt || new Date().toISOString();
            this._setStatus({ phase: "ready", error: null });
            resolve(this.getStatus());
          },
          onFatal: (error) => {
            this._setStatus({ phase: "error", error: compactError(error) });
            fail(error);
          },
        });
      });

      ws.on("error", (error) => {
        this._setStatus({ phase: "error", error: compactError(error) });
        fail(error);
      });

      ws.on("close", (code, reason) => {
        this.connected = false;
        this._stopHeartbeat();
        if (this.manualStop) {
          this._setStatus({ phase: "idle", error: null });
          return;
        }
        const why = reason ? String(reason) : `code=${code}`;
        this._setStatus({ phase: "reconnecting", error: `连接关闭：${why}` });
        this._scheduleReconnect();
        if (!settled) fail(new Error(`QQ Bot WS 关闭：${why}`));
      });
    });
  }

  async _onPacket(packet, hooks = {}) {
    if (!packet || typeof packet !== "object") return;
    if (packet.s != null) this.lastSeq = packet.s;
    const op = Number(packet.op);

    // Hello
    if (op === 10) {
      const interval = Number(packet.d?.heartbeat_interval) || 41250;
      this.heartbeatIntervalMs = interval;
      try {
        await this._ensureToken();
        if (this.sessionId && this.lastSeq != null) {
          this._sendWs(buildResumePayload({
            accessToken: this.accessToken,
            sessionId: this.sessionId,
            seq: this.lastSeq,
          }));
        } else {
          this._sendWs(
            buildIdentifyPayload({
              accessToken: this.accessToken,
              intents: this.settings.intents,
            })
          );
        }
        this._startHeartbeat();
      } catch (error) {
        hooks.onFatal?.(error);
      }
      return;
    }

    // Dispatch
    if (op === 0) {
      const t = String(packet.t || "");
      const d = packet.d || {};
      if (t === "READY") {
        this.sessionId = String(d.session_id || this.sessionId || "");
        hooks.onReady?.();
        return;
      }
      if (t === "RESUMED") {
        hooks.onReady?.();
        return;
      }
      if (t === "GROUP_AT_MESSAGE_CREATE" || t === "C2C_MESSAGE_CREATE") {
        const inbound = normalizeInboundEvent(t, d);
        this._pushMessage({
          id: inbound.msgId || `in-${Date.now()}`,
          direction: "in",
          chatType: inbound.chatType,
          conversationId: inbound.conversationId,
          fromUserId: inbound.fromUserId,
          groupId: inbound.groupId,
          text: inbound.text,
          at: new Date().toISOString(),
        });
        void this._handleInbound(inbound).catch((error) => {
          this._setStatus({ error: compactError(error) });
        });
      }
      return;
    }

    // Heartbeat ACK
    if (op === 11) return;

    // Reconnect requested
    if (op === 7) {
      this._scheduleReconnect(0);
      return;
    }

    // Invalid session
    if (op === 9) {
      this.sessionId = null;
      this.lastSeq = null;
      this._scheduleReconnect(500);
    }
  }

  _sendWs(payload) {
    if (!this.ws || this.ws.readyState !== this.WebSocketImpl.OPEN) {
      throw new Error("QQ Bot 未连接");
    }
    this.ws.send(JSON.stringify(payload));
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      try {
        if (!this.ws || this.ws.readyState !== this.WebSocketImpl.OPEN) return;
        this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq }));
      } catch {
        // ignore
      }
    }, Math.max(5000, this.heartbeatIntervalMs));
    if (typeof this.heartbeatTimer.unref === "function") this.heartbeatTimer.unref();
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _closeWs() {
    this._stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _scheduleReconnect(delayMs) {
    if (this.manualStop) return;
    this._clearReconnect();
    this.reconnectAttempt += 1;
    const attempt = this.reconnectAttempt;
    const delay =
      delayMs != null
        ? delayMs
        : Math.min(60_000, 1000 * Math.pow(2, Math.min(6, attempt)));
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((error) => {
        this._setStatus({ phase: "reconnecting", error: compactError(error) });
        this._scheduleReconnect();
      });
    }, delay);
    if (typeof this.reconnectTimer.unref === "function") this.reconnectTimer.unref();
  }

  async _handleInbound(inbound) {
    const dedupeKey = `${inbound.eventType}:${inbound.msgId}`;
    if (inbound.msgId && this._processing.has(dedupeKey)) return;
    if (inbound.msgId) this._processing.add(dedupeKey);

    try {
      // C2C 消息即「绑定」：记录已对接用户；首个绑定用户自动成为管理员
      if (inbound.chatType === "c2c" && inbound.fromUserId) {
        this._registerBoundUser(inbound.fromUserId);
      }

      const replyApi = {
        accountId: `qqbot:${this.settings.appId || "default"}`,
        channel: "qqbot",
        text: inbound.text,
        items: (inbound.attachments || []).map((att) => ({
          type: 4,
          file_item: {
            url: att.url,
            fileName: att.fileName,
            contentType: att.contentType,
            size: att.size,
          },
        })),
        rawMessage: inbound.raw,
        conversationId: inbound.conversationId,
        fromUserId: inbound.fromUserId,
        groupId: inbound.groupId,
        msgId: inbound.msgId,
        settings: {
          // 命令层主要读 customCommands / access；QQ 侧暂不复用微信 customCommands
          autoReplyEnabled: this.settings.autoReplyEnabled,
          autoReplyText: this.settings.autoReplyText,
          accessMode: this.settings.accessMode,
          allowUserIds: this.settings.allowUserIds,
          allowGroupIds: this.settings.allowGroupIds,
          customCommands: [],
          // 与微信共用桌面 AI 偏好；未注入时不伪造 enabled=true 以免误判
          ai: (() => {
            const shared = typeof this.getSharedAiSettings === "function"
              ? this.getSharedAiSettings()
              : null;
            const enabled = shared?.enabled !== false;
            return {
              enabled,
              progressEnabled: shared?.progressEnabled !== false,
            };
          })(),
        },
        signal: undefined,
        assertLease: () => {},
        replyText: (text) => this._replyText(inbound, text),
        replyImage: (input) => this._replyImage(inbound, input),
        replyFile: (input) => this._replyFile(inbound, input),
        downloadMedia: async (requestedItem) => {
          // 命令层传入的是微信同构包装：{ type: 4, file_item: { url, fileName, ... } }
          // 也兼容直接传内层 file_item / attachment 描述。
          const raw = requestedItem && typeof requestedItem === "object" ? requestedItem : {};
          const item =
            raw.file_item && typeof raw.file_item === "object"
              ? raw.file_item
              : raw;
          const url = item.url || item.URL || "";
          if (!url) throw new Error("QQ 消息缺少附件下载地址");
          return downloadAttachment({
            url,
            fileName: item.fileName || item.file_name || item.filename,
            contentType: item.contentType || item.content_type,
            fetchImpl: this.fetchImpl,
          });
        },
      };

      const modeKey =
        this.modeStore?.key?.(replyApi) || inbound.conversationId || inbound.fromUserId;
      const queueKey = `qqbot:${modeKey}`;

      await this.sessionQueues.runSerial(queueKey, async () => {
        let handled = false;
        if (this.commandHandler) {
          try {
            const result = await this.commandHandler(replyApi);
            handled = Boolean(result?.handled);
          } catch (error) {
            handled = true;
            await this._replyText(inbound, `命令执行失败：${compactError(error)}`);
          }
        }
        if (!handled && this.agentHandler) {
          try {
            const result = await this.agentHandler(replyApi);
            handled = Boolean(result?.handled);
          } catch (error) {
            handled = true;
            await this._replyText(inbound, `AI 处理失败：${compactError(error)}`);
          }
        }
        if (!handled && this.settings.autoReplyEnabled && this.settings.autoReplyText) {
          await this._replyText(inbound, this.settings.autoReplyText);
        }
      });
    } finally {
      if (inbound.msgId) {
        setTimeout(() => this._processing.delete(dedupeKey), 30_000).unref?.();
      }
    }
  }

  async _replyText(inbound, text) {
    const content = String(text || "").trim().slice(0, 4000);
    if (!content) return null;
    await this._ensureToken();
    const common = {
      accessToken: this.accessToken,
      appId: this.settings.appId,
      apiBase: this.settings.apiBase,
      fetchImpl: this.fetchImpl,
      content,
      msgType: MSG_TYPE.TEXT,
      msgId: inbound.msgId,
      eventId: inbound.eventId,
    };
    let result;
    if (inbound.chatType === "group" && inbound.groupId) {
      result = await sendGroupMessage({ ...common, groupOpenid: inbound.groupId });
    } else {
      result = await sendC2cMessage({ ...common, openid: inbound.fromUserId });
    }
    this._pushMessage({
      id: `out-${Date.now()}`,
      direction: "out",
      chatType: inbound.chatType,
      conversationId: inbound.conversationId,
      fromUserId: inbound.fromUserId,
      groupId: inbound.groupId,
      text: content,
      at: new Date().toISOString(),
    });
    return result;
  }

  async _replyImage(inbound, input = {}) {
    await this._ensureToken();
    const buffer = await this._toBuffer(input);
    const fileName = String(input.fileName || input.filename || "image.png");
    const uploaded = await this._uploadMedia(inbound, {
      fileType: FILE_TYPE.IMAGE,
      fileData: buffer,
      fileName,
    });
    const fileInfo = uploaded.file_info || uploaded.fileInfo || uploaded.data?.file_info;
    if (!fileInfo) throw new Error("QQ 图片上传成功但缺少 file_info");

    const common = {
      accessToken: this.accessToken,
      appId: this.settings.appId,
      apiBase: this.settings.apiBase,
      fetchImpl: this.fetchImpl,
      msgType: MSG_TYPE.MEDIA,
      media: { file_info: fileInfo },
      msgId: inbound.msgId,
      eventId: inbound.eventId,
    };
    let result;
    if (inbound.chatType === "group" && inbound.groupId) {
      result = await sendGroupMessage({ ...common, groupOpenid: inbound.groupId });
    } else {
      result = await sendC2cMessage({ ...common, openid: inbound.fromUserId });
    }
    this._pushMessage({
      id: `out-img-${Date.now()}`,
      direction: "out",
      chatType: inbound.chatType,
      conversationId: inbound.conversationId,
      text: `[图片] ${fileName}`,
      at: new Date().toISOString(),
    });
    return result;
  }

  async _replyFile(inbound, input = {}) {
    // 官方群文件对任意文件支持有限；优先当图片失败时发文本提示 + 尝试 file_type=4
    await this._ensureToken();
    const buffer = await this._toBuffer(input);
    const fileName = String(input.fileName || input.filename || "file.bin");
    try {
      const uploaded = await this._uploadMedia(inbound, {
        fileType: FILE_TYPE.FILE,
        fileData: buffer,
        fileName,
      });
      const fileInfo = uploaded.file_info || uploaded.fileInfo || uploaded.data?.file_info;
      if (!fileInfo) throw new Error("缺少 file_info");
      const common = {
        accessToken: this.accessToken,
        appId: this.settings.appId,
        apiBase: this.settings.apiBase,
        fetchImpl: this.fetchImpl,
        msgType: MSG_TYPE.MEDIA,
        media: { file_info: fileInfo },
        msgId: inbound.msgId,
        eventId: inbound.eventId,
      };
      if (inbound.chatType === "group" && inbound.groupId) {
        await sendGroupMessage({ ...common, groupOpenid: inbound.groupId });
      } else {
        await sendC2cMessage({ ...common, openid: inbound.fromUserId });
      }
      this._pushMessage({
        id: `out-file-${Date.now()}`,
        direction: "out",
        text: `[文件] ${fileName}`,
        at: new Date().toISOString(),
      });
    } catch (error) {
      await this._replyText(
        inbound,
        `文件「${fileName}」发送失败（${compactError(error)}）。可在桌面端查看导出结果。`
      );
    }
  }

  async _uploadMedia(inbound, { fileType, fileData }) {
    const base = {
      accessToken: this.accessToken,
      appId: this.settings.appId,
      apiBase: this.settings.apiBase,
      fetchImpl: this.fetchImpl,
      fileType,
      fileData,
      srvSendMsg: false,
    };
    if (inbound.chatType === "group" && inbound.groupId) {
      return uploadGroupFile({ ...base, groupOpenid: inbound.groupId });
    }
    return uploadC2cFile({ ...base, openid: inbound.fromUserId });
  }

  async _toBuffer(input = {}) {
    if (Buffer.isBuffer(input)) return input;
    if (Buffer.isBuffer(input.buffer)) return input.buffer;
    if (input.data && Buffer.isBuffer(input.data)) return input.data;
    if (typeof input.base64 === "string") return Buffer.from(input.base64, "base64");
    if (typeof input.path === "string" && input.path) {
      return fs.promises.readFile(input.path);
    }
    if (typeof input.url === "string" && input.url) {
      const res = await this.fetchImpl(input.url);
      if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    throw new Error("无法识别的媒体内容（需要 buffer/path/url/base64）");
  }

  _pushMessage(message) {
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
    this.emit("message", message);
    this._persist();
  }

  _setStatus(patch = {}) {
    if (patch.phase) this.phase = patch.phase;
    if (patch.error !== undefined) this.error = patch.error;
    if (patch.connected != null) this.connected = Boolean(patch.connected);
    this._emitStatus();
  }

  _emitStatus() {
    this.emit("status", this.getStatus());
  }

  _load() {
    try {
      const file = this.storagePath();
      if (!file || !fs.existsSync(file)) return;
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      this.settings = normalizeSettings(raw.settings || {}, DEFAULT_SETTINGS);
      this.messages = Array.isArray(raw.messages) ? raw.messages.slice(-MAX_MESSAGES) : [];
      // 不恢复 accessToken 到内存长期明文之外的用途：重启后重连再取
    } catch (error) {
      this.error = `读取 QQ Bot 配置失败：${compactError(error)}`;
    }
  }

  _persist() {
    try {
      const file = this.storagePath();
      if (!file) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const payload = {
        version: 1,
        settings: this.settings,
        messages: this.messages.slice(-MAX_MESSAGES),
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    } catch (error) {
      this.error = `保存 QQ Bot 配置失败：${compactError(error)}`;
    }
  }
}

module.exports = {
  QqBotService,
  DEFAULT_SETTINGS,
  normalizeSettings,
};
