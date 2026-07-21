const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const QRCode = require("qrcode");
const {
  CDN_BASE_URL,
  buildMediaItem,
  downloadInboundMedia,
  uploadMediaBuffer,
} = require("./weixin-bot-media");

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "1.0.2";
const BOT_TYPE = "3";
const LOGIN_TTL_MS = 5 * 60_000;
const QR_POLL_TIMEOUT_MS = 38_000;
const API_TIMEOUT_MS = 15_000;
const LONG_POLL_TIMEOUT_MS = 38_000;
const HISTORY_LIMIT = 200;
const SEEN_MESSAGE_LIMIT = 500;
const SESSION_EXPIRED_CODE = -14;

const DEFAULT_SETTINGS = Object.freeze({
  autoReplyEnabled: false,
  autoReplyText: "消息已收到。",
});

function compactError(error) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  return message.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 500);
}

function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}

function createAbortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(createAbortError());
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL));
  if (url.protocol !== "https:") throw new Error("微信接口地址必须使用 HTTPS");
  if (url.hostname !== "ilinkai.weixin.qq.com" && !url.hostname.endsWith(".weixin.qq.com")) {
    throw new Error("微信接口返回了非受信任地址");
  }
  return url.toString().replace(/\/$/, "");
}

function randomWechatUin() {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function messageTimestamp(value) {
  const millis = Number(value);
  const date = Number.isFinite(millis) && millis > 0 ? new Date(millis) : new Date();
  return date.toISOString();
}

function extractMessagePreview(message) {
  const parts = [];
  let kind = "unknown";

  for (const item of Array.isArray(message?.item_list) ? message.item_list : []) {
    if (item?.type === 1 && item.text_item?.text) {
      if (kind === "unknown") kind = "text";
      parts.push(String(item.text_item.text));
    } else if (item?.type === 2) {
      if (kind === "unknown") kind = "image";
      parts.push("[图片]");
    } else if (item?.type === 3) {
      if (kind === "unknown") kind = "voice";
      const voiceText = String(item.voice_item?.text || "").trim();
      parts.push(voiceText ? `[语音] ${voiceText}` : "[语音]");
    } else if (item?.type === 4) {
      if (kind === "unknown") kind = "file";
      const fileName = String(item.file_item?.file_name || "").trim();
      parts.push(fileName ? `[文件] ${fileName}` : "[文件]");
    } else if (item?.type === 5) {
      if (kind === "unknown") kind = "video";
      parts.push("[视频]");
    }
  }

  return {
    kind,
    content: parts.join("\n").trim() || "[空消息]",
  };
}

function extractMessageText(message) {
  return (Array.isArray(message?.item_list) ? message.item_list : [])
    .filter((item) => item?.type === 1 && item.text_item?.text != null)
    .map((item) => String(item.text_item.text))
    .join("\n")
    .trim();
}

class WeixinBotService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.storagePath = options.storagePath;
    this.encryptToken = options.encryptToken;
    this.decryptToken = options.decryptToken;
    this.cdnBaseUrl = String(options.cdnBaseUrl || CDN_BASE_URL).replace(/\/$/, "");
    this.commandHandler = null;
    this.generateQrDataUrl = options.generateQrDataUrl || ((content) => QRCode.toDataURL(content, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#17231d", light: "#ffffff" },
    }));

    if (typeof this.fetchImpl !== "function") throw new Error("当前运行环境缺少 fetch");
    if (typeof this.storagePath !== "function") throw new Error("微信机器人缺少存储路径");
    if (typeof this.encryptToken !== "function" || typeof this.decryptToken !== "function") {
      throw new Error("微信机器人缺少安全存储实现");
    }

    this.credentials = null;
    this.encryptedToken = "";
    this.updatesBuf = "";
    this.settings = { ...DEFAULT_SETTINGS };
    this.messages = [];
    this.contexts = new Map();
    this.seenMessageIds = new Set();
    this.seenMessageOrder = [];
    this.loginSession = null;
    this.loginPromise = null;
    this.monitorController = null;
    this.monitorPromise = null;
    this.status = {
      available: true,
      phase: "disconnected",
      connected: false,
      monitoring: false,
      accountId: null,
      userId: null,
      baseUrl: DEFAULT_BASE_URL,
      savedAt: null,
      qrDataUrl: null,
      qrExpiresAt: null,
      statusText: "尚未连接",
      lastPollAt: null,
      lastMessageAt: null,
      error: null,
      receivedCount: 0,
      sentCount: 0,
    };
  }

  async initialize({ autoStart = true } = {}) {
    try {
      this._loadStore();
    } catch (error) {
      this._setStatus({
        phase: "error",
        statusText: "读取微信连接信息失败",
        error: compactError(error),
      });
      return this.getStatus();
    }

    if (!this.credentials) return this.getStatus();

    this._setStatus({
      phase: autoStart ? "connecting" : "stopped",
      connected: true,
      monitoring: false,
      accountId: this.credentials.accountId,
      userId: this.credentials.userId || null,
      baseUrl: this.credentials.baseUrl,
      savedAt: this.credentials.savedAt,
      statusText: autoStart ? "正在恢复连接" : "连接已暂停",
      error: null,
    });
    if (autoStart) await this.startMonitoring();
    return this.getStatus();
  }

  getStatus() {
    return { ...this.status };
  }

  setCommandHandler(handler) {
    if (handler !== null && typeof handler !== "function") {
      throw new Error("微信机器人命令处理器必须是函数");
    }
    this.commandHandler = handler;
  }

  getMessages() {
    return this.messages.map((message) => ({ ...message }));
  }

  clearMessages() {
    this.messages = [];
    this.contexts.clear();
    this.seenMessageIds.clear();
    this.seenMessageOrder = [];
    this._setStatus({
      lastMessageAt: null,
      receivedCount: 0,
      sentCount: 0,
    });
    this.emit("messages-cleared");
    return { cleared: true };
  }

  getSettings() {
    return { ...this.settings };
  }

  saveSettings(input = {}) {
    const autoReplyText = String(input.autoReplyText ?? "").trim().slice(0, 1000);
    const autoReplyEnabled = Boolean(input.autoReplyEnabled);
    if (autoReplyEnabled && !autoReplyText) throw new Error("请填写自动回复内容");
    this.settings = { autoReplyEnabled, autoReplyText };
    this._writeStore();
    return this.getSettings();
  }

  async startLogin() {
    await this.stopMonitoring({ updateStatus: false });
    await this.cancelLogin({ updateStatus: false });

    const controller = new AbortController();
    const session = {
      id: crypto.randomUUID(),
      controller,
      qrcode: "",
      startedAt: Date.now(),
      refreshCount: 0,
    };
    this.loginSession = session;
    this._setStatus({
      phase: "connecting",
      connected: Boolean(this.credentials),
      monitoring: false,
      qrDataUrl: null,
      qrExpiresAt: null,
      statusText: "正在获取登录二维码",
      error: null,
    });

    try {
      await this._refreshLoginQr(session);
    } catch (error) {
      if (this.loginSession === session) this.loginSession = null;
      this._setStatus({
        phase: "error",
        statusText: "获取登录二维码失败",
        error: compactError(error),
      });
      throw error;
    }

    const task = this._pollLogin(session);
    this.loginPromise = task;
    const clearLoginTask = () => {
      if (this.loginPromise === task) this.loginPromise = null;
    };
    void task.then(clearLoginTask, clearLoginTask);
    return this.getStatus();
  }

  async cancelLogin({ updateStatus = true } = {}) {
    const session = this.loginSession;
    this.loginSession = null;
    session?.controller.abort();
    const task = this.loginPromise;
    if (task) await task.catch(() => undefined);
    if (updateStatus) {
      this._setStatus({
        phase: this.credentials ? "stopped" : "disconnected",
        connected: Boolean(this.credentials),
        monitoring: false,
        qrDataUrl: null,
        qrExpiresAt: null,
        statusText: this.credentials ? "连接已暂停" : "尚未连接",
        error: null,
      });
    }
    return this.getStatus();
  }

  async _refreshLoginQr(session) {
    const response = await this._getJson(
      `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`,
      { signal: session.controller.signal, timeoutMs: API_TIMEOUT_MS }
    );
    const qrcode = String(response?.qrcode || "").trim();
    const content = String(response?.qrcode_img_content || "").trim();
    if (!qrcode || !content) throw new Error("微信接口未返回有效二维码");

    session.qrcode = qrcode;
    session.startedAt = Date.now();
    const qrDataUrl = await this.generateQrDataUrl(content);
    if (this.loginSession !== session || session.controller.signal.aborted) return;
    this._setStatus({
      phase: "awaiting_scan",
      qrDataUrl,
      qrExpiresAt: new Date(session.startedAt + LOGIN_TTL_MS).toISOString(),
      statusText: "等待微信扫码",
      error: null,
    });
  }

  async _pollLogin(session) {
    try {
      while (
        this.loginSession === session
        && !session.controller.signal.aborted
        && Date.now() - session.startedAt < LOGIN_TTL_MS
      ) {
        const url = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(session.qrcode)}`;
        const response = await this._getJson(url, {
          signal: session.controller.signal,
          timeoutMs: QR_POLL_TIMEOUT_MS,
          allowTimeout: true,
          headers: { "iLink-App-ClientVersion": "1" },
        }) || { status: "wait" };

        if (this.loginSession !== session || session.controller.signal.aborted) return;
        const phase = String(response.status || "wait");
        if (phase === "scaned") {
          this._setStatus({ phase: "scanned", statusText: "已扫码，等待微信确认", error: null });
        } else if (phase === "expired") {
          session.refreshCount += 1;
          if (session.refreshCount > 3) throw new Error("二维码多次过期，请重新连接");
          this._setStatus({ phase: "connecting", statusText: "二维码已过期，正在刷新" });
          await this._refreshLoginQr(session);
        } else if (phase === "confirmed") {
          await this._completeLogin(session, response);
          return;
        } else {
          this._setStatus({ phase: "awaiting_scan", statusText: "等待微信扫码", error: null });
        }

        await sleep(600, session.controller.signal);
      }

      if (this.loginSession === session) throw new Error("登录二维码已过期，请重新连接");
    } catch (error) {
      if (isAbortError(error) || this.loginSession !== session) return;
      this.loginSession = null;
      this._setStatus({
        phase: "error",
        connected: Boolean(this.credentials),
        monitoring: false,
        qrDataUrl: null,
        qrExpiresAt: null,
        statusText: "微信连接失败",
        error: compactError(error),
      });
    }
  }

  async _completeLogin(session, response) {
    const token = String(response.bot_token || "").trim();
    const accountId = String(response.ilink_bot_id || "").trim();
    if (!token || !accountId) throw new Error("微信确认成功，但连接凭据不完整");

    const credentials = {
      token,
      accountId,
      userId: String(response.ilink_user_id || "").trim(),
      baseUrl: normalizeBaseUrl(response.baseurl || DEFAULT_BASE_URL),
      savedAt: new Date().toISOString(),
    };
    const encryptedToken = this.encryptToken(credentials.token);
    if (!encryptedToken) throw new Error("微信令牌加密失败");

    this.credentials = credentials;
    this.encryptedToken = encryptedToken;
    this.updatesBuf = "";
    this._writeStore();
    this.loginSession = null;
    this._setStatus({
      phase: "connecting",
      connected: true,
      monitoring: false,
      accountId: credentials.accountId,
      userId: credentials.userId || null,
      baseUrl: credentials.baseUrl,
      savedAt: credentials.savedAt,
      qrDataUrl: null,
      qrExpiresAt: null,
      statusText: "登录成功，正在启动机器人",
      error: null,
    });
    await this.startMonitoring();
  }

  async startMonitoring() {
    if (!this.credentials?.token) throw new Error("请先连接微信");
    if (this.monitorPromise) {
      if (this.status.phase !== "session_expired") return this.getStatus();
      await this.stopMonitoring({ updateStatus: false });
    }

    const controller = new AbortController();
    this.monitorController = controller;
    this._setStatus({
      phase: "running",
      connected: true,
      monitoring: true,
      accountId: this.credentials.accountId,
      userId: this.credentials.userId || null,
      baseUrl: this.credentials.baseUrl,
      savedAt: this.credentials.savedAt,
      qrDataUrl: null,
      qrExpiresAt: null,
      statusText: "机器人运行中",
      error: null,
    });

    const task = this._monitorLoop(controller.signal);
    this.monitorPromise = task;
    const clearMonitorTask = () => {
      if (this.monitorPromise !== task) return;
      this.monitorPromise = null;
      this.monitorController = null;
      if (this.status.monitoring) this._setStatus({ monitoring: false });
    };
    void task.then(clearMonitorTask, clearMonitorTask);
    return this.getStatus();
  }

  async stopMonitoring({ updateStatus = true } = {}) {
    const controller = this.monitorController;
    const task = this.monitorPromise;
    controller?.abort();
    if (task) await task.catch(() => undefined);
    if (updateStatus && this.credentials) {
      this._setStatus({
        phase: "stopped",
        connected: true,
        monitoring: false,
        statusText: "机器人已暂停",
        error: null,
      });
    }
    return this.getStatus();
  }

  async disconnect() {
    await this.cancelLogin({ updateStatus: false });
    await this.stopMonitoring({ updateStatus: false });
    this.credentials = null;
    this.encryptedToken = "";
    this.updatesBuf = "";
    this.contexts.clear();
    this._writeStore();
    this._setStatus({
      phase: "disconnected",
      connected: false,
      monitoring: false,
      accountId: null,
      userId: null,
      baseUrl: DEFAULT_BASE_URL,
      savedAt: null,
      qrDataUrl: null,
      qrExpiresAt: null,
      statusText: "尚未连接",
      lastPollAt: null,
      error: null,
    });
    return this.getStatus();
  }

  async shutdown() {
    await this.cancelLogin({ updateStatus: false });
    await this.stopMonitoring({ updateStatus: false });
  }

  async _monitorLoop(signal) {
    let consecutiveFailures = 0;
    let timeoutMs = LONG_POLL_TIMEOUT_MS;

    while (!signal.aborted && this.credentials?.token) {
      try {
        const response = await this._postJson(
          this.credentials.baseUrl,
          "ilink/bot/getupdates",
          { get_updates_buf: this.updatesBuf || "" },
          {
            token: this.credentials.token,
            signal,
            timeoutMs,
            allowTimeout: true,
          }
        );
        if (signal.aborted) return;

        if (!response) {
          this._setStatus({ lastPollAt: new Date().toISOString(), error: null });
          continue;
        }

        const code = Number(response.errcode ?? response.ret ?? 0);
        if (code === SESSION_EXPIRED_CODE) {
          this._markSessionExpired();
          return;
        }
        if (code !== 0) {
          throw new Error(`微信收取消息失败 (${code}): ${String(response.errmsg || "未知错误")}`);
        }

        consecutiveFailures = 0;
        const suggested = Number(response.longpolling_timeout_ms);
        if (Number.isFinite(suggested) && suggested > 0) {
          timeoutMs = Math.min(65_000, Math.max(5_000, suggested + 3_000));
        }

        for (const message of Array.isArray(response.msgs) ? response.msgs : []) {
          await this._handleInboundMessage(message);
        }

        const nextBuf = String(response.get_updates_buf || "");
        if (nextBuf && nextBuf !== this.updatesBuf) {
          this.updatesBuf = nextBuf;
          this._writeStore();
        }
        this._setStatus({
          phase: "running",
          monitoring: true,
          statusText: "机器人运行中",
          lastPollAt: new Date().toISOString(),
          error: null,
        });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        if (/微信接口 HTTP (401|403)/.test(String(error?.message || ""))) {
          this._markSessionExpired();
          return;
        }
        consecutiveFailures += 1;
        const backoffMs = consecutiveFailures >= 3 ? 30_000 : 2_000;
        if (consecutiveFailures >= 3) consecutiveFailures = 0;
        this._setStatus({
          phase: "running",
          monitoring: true,
          statusText: "连接波动，正在重试",
          error: compactError(error),
        });
        try {
          await sleep(backoffMs, signal);
        } catch (sleepError) {
          if (isAbortError(sleepError)) return;
          throw sleepError;
        }
      }
    }
  }

  async _handleInboundMessage(rawMessage) {
    if (Number(rawMessage?.message_type) !== 1) return;
    const fromUserId = String(rawMessage.from_user_id || "").trim();
    if (!fromUserId) return;

    const groupId = String(rawMessage.group_id || "").trim();
    const conversationId = groupId || fromUserId;
    const contextToken = String(rawMessage.context_token || "").trim();
    const rawId = String(rawMessage.message_id || rawMessage.client_id || "").trim();
    const fallbackId = crypto
      .createHash("sha1")
      .update(`${conversationId}|${rawMessage.create_time_ms || ""}|${JSON.stringify(rawMessage.item_list || [])}`)
      .digest("hex");
    const id = `in-${rawId || fallbackId}`;
    if (this._hasSeenMessage(id)) return;

    if (contextToken) {
      this.contexts.set(conversationId, { contextToken, toUserId: fromUserId, groupId });
    }
    const preview = extractMessagePreview(rawMessage);
    this._addMessage({
      id,
      direction: "inbound",
      conversationId,
      userId: fromUserId,
      groupId: groupId || null,
      kind: preview.kind,
      content: preview.content,
      createdAt: messageTimestamp(rawMessage.create_time_ms),
      status: "received",
    });

    const context = { contextToken, toUserId: fromUserId, groupId };
    let commandHandled = false;
    if (this.commandHandler && contextToken) {
      try {
        const result = await this.commandHandler({
          text: extractMessageText(rawMessage),
          items: Array.isArray(rawMessage.item_list) ? rawMessage.item_list : [],
          rawMessage,
          conversationId,
          fromUserId,
          groupId: groupId || null,
          replyText: (text) => this._sendTextWithContext(conversationId, String(text).slice(0, 4000), context),
          replyImage: (input) => this._sendMediaWithContext(
            conversationId,
            { ...input, mediaKind: "image" },
            context
          ),
          replyFile: (input) => this._sendMediaWithContext(
            conversationId,
            { ...input, mediaKind: "file" },
            context
          ),
          downloadMedia: (requestedItem) => {
            const mediaItem = requestedItem || (Array.isArray(rawMessage.item_list) ? rawMessage.item_list : [])
              .find((item) => [2, 3, 4, 5].includes(Number(item?.type)));
            return downloadInboundMedia({
              fetchImpl: this.fetchImpl,
              item: mediaItem,
              cdnBaseUrl: this.cdnBaseUrl,
            });
          },
        });
        commandHandled = Boolean(result?.handled);
      } catch (error) {
        commandHandled = true;
        const message = `命令执行失败：${compactError(error)}`;
        try {
          await this._sendTextWithContext(conversationId, message, context);
        } catch (sendError) {
          this._setStatus({ error: `${message}；回复失败：${compactError(sendError)}` });
        }
      }
    }

    if (!commandHandled && this.settings.autoReplyEnabled && this.settings.autoReplyText && contextToken) {
      try {
        await this._sendTextWithContext(conversationId, this.settings.autoReplyText, context);
      } catch (error) {
        this._setStatus({ error: `自动回复失败: ${compactError(error)}` });
      }
    }
  }

  async sendText(input = {}) {
    const conversationId = String(input.conversationId || "").trim();
    const text = String(input.text || "").trim();
    if (!conversationId) throw new Error("请选择一个微信会话");
    if (!text) throw new Error("消息内容为空");
    if (text.length > 4000) throw new Error("单条消息最多 4000 个字符");
    const context = this.contexts.get(conversationId);
    if (!context?.contextToken) throw new Error("当前会话缺少上下文，请等待对方发送新消息");
    return this._sendTextWithContext(conversationId, text, context);
  }

  async _sendTextWithContext(conversationId, text, context) {
    if (!this.credentials?.token) throw new Error("微信尚未连接");
    const clientId = `douyin-${crypto.randomUUID()}`;
    const msg = {
      from_user_id: "",
      to_user_id: context.toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: context.contextToken,
      item_list: [{ type: 1, text_item: { text } }],
      ...(context.groupId ? { group_id: context.groupId } : {}),
    };

    try {
      const response = await this._postJson(
        this.credentials.baseUrl,
        "ilink/bot/sendmessage",
        { msg },
        { token: this.credentials.token, timeoutMs: API_TIMEOUT_MS }
      );
      const code = Number(response?.errcode ?? response?.ret ?? 0);
      if (code === SESSION_EXPIRED_CODE) {
        this._markSessionExpired();
        throw new Error("微信登录已过期，请重新扫码连接");
      }
      if (code !== 0) {
        throw new Error(`微信发送消息失败 (${code}): ${String(response?.errmsg || "未知错误")}`);
      }

      const sent = {
        id: clientId,
        direction: "outbound",
        conversationId,
        userId: context.toUserId,
        groupId: context.groupId || null,
        kind: "text",
        content: text,
        createdAt: new Date().toISOString(),
        status: "sent",
      };
      this._addMessage(sent);
      return { ...sent };
    } catch (error) {
      if (/微信接口 HTTP (401|403)/.test(String(error?.message || ""))) {
        this._markSessionExpired();
      }
      const failed = {
        id: clientId,
        direction: "outbound",
        conversationId,
        userId: context.toUserId,
        groupId: context.groupId || null,
        kind: "text",
        content: text,
        createdAt: new Date().toISOString(),
        status: "failed",
      };
      this._addMessage(failed);
      throw error;
    }
  }

  async _sendMediaWithContext(conversationId, input, context) {
    if (!this.credentials?.token) throw new Error("微信尚未连接");
    const mediaKind = input.mediaKind === "image" ? "image" : "file";
    const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer || []);
    if (!buffer.length) throw new Error("待发送媒体内容为空");
    const fileName = String(input.fileName || (mediaKind === "image" ? "report.png" : "data.csv"));
    const clientId = `douyin-${crypto.randomUUID()}`;
    const content = mediaKind === "image" ? `[图片] ${fileName}` : `[文件] ${fileName}`;

    try {
      const uploaded = await uploadMediaBuffer({
        fetchImpl: this.fetchImpl,
        buffer,
        fileName,
        mediaKind,
        toUserId: context.toUserId,
        cdnBaseUrl: this.cdnBaseUrl,
        getUploadUrl: async (payload) => {
          const response = await this._postJson(
            this.credentials.baseUrl,
            "ilink/bot/getuploadurl",
            payload,
            { token: this.credentials.token, timeoutMs: API_TIMEOUT_MS }
          );
          const code = Number(response?.errcode ?? response?.ret ?? 0);
          if (code === SESSION_EXPIRED_CODE) {
            this._markSessionExpired();
            throw new Error("微信登录已过期，请重新扫码连接");
          }
          if (code !== 0) {
            throw new Error(`微信获取上传地址失败 (${code}): ${String(response?.errmsg || "未知错误")}`);
          }
          return response;
        },
      });
      const item = buildMediaItem(mediaKind, uploaded);
      const msg = {
        from_user_id: "",
        to_user_id: context.toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: context.contextToken,
        item_list: [item],
        ...(context.groupId ? { group_id: context.groupId } : {}),
      };
      const response = await this._postJson(
        this.credentials.baseUrl,
        "ilink/bot/sendmessage",
        { msg },
        { token: this.credentials.token, timeoutMs: API_TIMEOUT_MS }
      );
      const code = Number(response?.errcode ?? response?.ret ?? 0);
      if (code === SESSION_EXPIRED_CODE) {
        this._markSessionExpired();
        throw new Error("微信登录已过期，请重新扫码连接");
      }
      if (code !== 0) {
        throw new Error(`微信发送媒体失败 (${code}): ${String(response?.errmsg || "未知错误")}`);
      }

      const sent = {
        id: clientId,
        direction: "outbound",
        conversationId,
        userId: context.toUserId,
        groupId: context.groupId || null,
        kind: mediaKind,
        content,
        createdAt: new Date().toISOString(),
        status: "sent",
      };
      this._addMessage(sent);
      return { ...sent };
    } catch (error) {
      if (/微信接口 HTTP (401|403)/.test(String(error?.message || ""))) {
        this._markSessionExpired();
      }
      const failed = {
        id: clientId,
        direction: "outbound",
        conversationId,
        userId: context.toUserId,
        groupId: context.groupId || null,
        kind: mediaKind,
        content,
        createdAt: new Date().toISOString(),
        status: "failed",
      };
      this._addMessage(failed);
      throw error;
    }
  }

  _addMessage(message) {
    this._rememberMessage(message.id);
    this.messages.push(message);
    if (this.messages.length > HISTORY_LIMIT) this.messages.splice(0, this.messages.length - HISTORY_LIMIT);
    const inbound = message.direction === "inbound";
    const delivered = message.direction === "outbound" && message.status === "sent";
    this._setStatus({
      lastMessageAt: message.createdAt,
      receivedCount: this.status.receivedCount + (inbound ? 1 : 0),
      sentCount: this.status.sentCount + (delivered ? 1 : 0),
    });
    this.emit("message", { ...message });
  }

  _hasSeenMessage(id) {
    return this.seenMessageIds.has(id);
  }

  _rememberMessage(id) {
    if (this.seenMessageIds.has(id)) return;
    this.seenMessageIds.add(id);
    this.seenMessageOrder.push(id);
    if (this.seenMessageOrder.length <= SEEN_MESSAGE_LIMIT) return;
    const expired = this.seenMessageOrder.shift();
    if (expired) this.seenMessageIds.delete(expired);
  }

  async _getJson(url, options = {}) {
    return this._fetchJson(url, {
      method: "GET",
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      allowTimeout: options.allowTimeout,
    });
  }

  async _postJson(baseUrl, endpoint, body, options = {}) {
    const payload = { ...body, base_info: { channel_version: CHANNEL_VERSION } };
    const bodyText = JSON.stringify(payload);
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(bodyText, "utf8")),
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": randomWechatUin(),
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const url = `${normalizeBaseUrl(baseUrl)}/${endpoint.replace(/^\//, "")}`;
    return this._fetchJson(url, {
      method: "POST",
      headers,
      body: bodyText,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      allowTimeout: options.allowTimeout,
    });
  }

  async _fetchJson(url, options = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1000, Number(options.timeoutMs) || API_TIMEOUT_MS));

    try {
      const response = await this.fetchImpl(url, {
        method: options.method || "GET",
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`微信接口 HTTP ${response.status}`);
      }
      if (!text.trim()) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("微信接口返回了无效 JSON");
      }
    } catch (error) {
      if (timedOut && options.allowTimeout && isAbortError(error)) return null;
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  _loadStore() {
    const file = this.storagePath();
    if (!fs.existsSync(file)) return;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed?.version !== 1) throw new Error("微信机器人存储版本不受支持");

    this.settings = {
      autoReplyEnabled: Boolean(parsed.settings?.autoReplyEnabled),
      autoReplyText: String(parsed.settings?.autoReplyText ?? DEFAULT_SETTINGS.autoReplyText).slice(0, 1000),
    };
    this.updatesBuf = typeof parsed.updatesBuf === "string" ? parsed.updatesBuf : "";

    const stored = parsed.credentials;
    if (!stored?.encryptedToken || !stored?.accountId) return;
    const token = this.decryptToken(String(stored.encryptedToken));
    if (!token) throw new Error("微信令牌解密失败");
    this.encryptedToken = String(stored.encryptedToken);
    this.credentials = {
      token,
      accountId: String(stored.accountId),
      userId: String(stored.userId || ""),
      baseUrl: normalizeBaseUrl(stored.baseUrl || DEFAULT_BASE_URL),
      savedAt: String(stored.savedAt || ""),
    };
  }

  _writeStore() {
    const file = this.storagePath();
    const data = {
      version: 1,
      settings: this.settings,
      updatesBuf: this.updatesBuf,
      ...(this.credentials && this.encryptedToken
        ? {
            credentials: {
              encryptedToken: this.encryptedToken,
              accountId: this.credentials.accountId,
              userId: this.credentials.userId,
              baseUrl: this.credentials.baseUrl,
              savedAt: this.credentials.savedAt,
            },
          }
        : {}),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempFile, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows does not implement POSIX file modes.
    }
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.getStatus());
  }

  _markSessionExpired() {
    this._setStatus({
      phase: "session_expired",
      connected: true,
      monitoring: false,
      statusText: "微信登录已过期",
      error: "请重新扫码连接",
    });
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  WeixinBotService,
  extractMessagePreview,
  extractMessageText,
  normalizeBaseUrl,
};
