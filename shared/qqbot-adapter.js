"use strict";

/**
 * 官方 QQ 机器人 OpenAPI 适配（bot.q.qq.com / api.sgroup.qq.com）
 * 不依赖 Electron；可被桌面与脚本共用。
 *
 * 文档要点（2024–2025 开放平台）：
 * - token: POST /app/getAppAccessToken { appId, clientSecret }
 * - 鉴权头: Authorization: QQBot {access_token} + X-Union-Appid
 * - 事件: WebSocket gateway；群 @ = GROUP_AT_MESSAGE_CREATE；私聊 = C2C_MESSAGE_CREATE
 * - 被动回复需带 msg_id，并在有效窗口内
 */

const DEFAULT_API_BASE = "https://api.sgroup.qq.com";
const DEFAULT_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";

/** 群聊与 C2C 相关 Intent（官方 SDK / 文档常用位） */
const INTENT_GROUP_AND_C2C = 1 << 25; // 33554432

const MSG_TYPE = Object.freeze({
  TEXT: 0,
 // 7 = media（图/富媒体），需先 files 接口拿 file_info
  MEDIA: 7,
});

const FILE_TYPE = Object.freeze({
  IMAGE: 1,
  VIDEO: 2,
  VOICE: 3,
  FILE: 4,
});

function trimStr(value) {
  return String(value ?? "").trim();
}

function normalizeApiBase(value) {
  const raw = trimStr(value) || DEFAULT_API_BASE;
  return raw.replace(/\/+$/, "");
}

function buildAuthHeaders(accessToken, appId) {
  const token = trimStr(accessToken);
  const id = trimStr(appId);
  if (!token) throw new Error("缺少 QQ Bot access_token");
  if (!id) throw new Error("缺少 QQ Bot appId");
  return {
    Authorization: `QQBot ${token}`,
    "X-Union-Appid": id,
    "Content-Type": "application/json",
  };
}

/**
 * @param {{ appId: string, clientSecret: string, tokenUrl?: string, fetchImpl?: typeof fetch }} input
 */
async function fetchAppAccessToken(input = {}) {
  const appId = trimStr(input.appId);
  const clientSecret = trimStr(input.clientSecret);
  if (!appId) throw new Error("请填写 QQ 机器人 AppID");
  if (!clientSecret) throw new Error("请填写 QQ 机器人 ClientSecret");
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持 fetch");

  const tokenUrl = trimStr(input.tokenUrl) || DEFAULT_TOKEN_URL;
  const res = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret }),
    signal: input.signal,
  });
  const rawText = await res.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { raw: rawText };
  }
  if (!res.ok) {
    const msg =
      data.message || data.msg || data.error || rawText || `HTTP ${res.status}`;
    throw new Error(`获取 QQ Bot token 失败：${msg}`);
  }
  const accessToken = trimStr(data.access_token);
  if (!accessToken) {
    // 官方 token 接口常返回 HTTP 200 + 业务错误码（如 100016 invalid appid or secret）
    const bizMsg = data.message || data.msg || data.error || rawText || "响应无 access_token";
    const codeBit = data.code != null ? `（code ${data.code}）` : "";
    throw new Error(`获取 QQ Bot token 失败：${bizMsg}${codeBit}`);
  }
  const expiresIn = Math.max(60, Number(data.expires_in) || 7200);
  return {
    accessToken,
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000,
    raw: data,
  };
}

/**
 * @param {{ accessToken: string, appId: string, apiBase?: string, fetchImpl?: typeof fetch }} input
 */
async function fetchGatewayUrl(input = {}) {
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const apiBase = normalizeApiBase(input.apiBase);
  const res = await fetchImpl(`${apiBase}/gateway`, {
    method: "GET",
    headers: buildAuthHeaders(input.accessToken, input.appId),
    signal: input.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `获取 QQ Bot gateway 失败：${data.message || data.msg || res.status}`
    );
  }
  const url = trimStr(data.url);
  if (!url) throw new Error("QQ Bot gateway 响应缺少 url");
  return url;
}

function nextMsgSeq() {
  // 官方要求同一 msg_id 下 seq 唯一；用时间+随机足够
  return Math.floor(Date.now() % 1_000_000) * 100 + Math.floor(Math.random() * 90) + 10;
}

/**
 * 发群消息（被动回复请带 msgId）
 */
async function sendGroupMessage(input = {}) {
  const groupOpenid = trimStr(input.groupOpenid || input.groupId);
  if (!groupOpenid) throw new Error("缺少 group_openid");
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const apiBase = normalizeApiBase(input.apiBase);
  const body = {
    content: input.content != null ? String(input.content) : undefined,
    msg_type: Number(input.msgType ?? MSG_TYPE.TEXT),
    msg_id: trimStr(input.msgId) || undefined,
    event_id: trimStr(input.eventId) || undefined,
    msg_seq: Number(input.msgSeq) || nextMsgSeq(),
  };
  if (input.media) body.media = input.media;
  if (input.markdown) body.markdown = input.markdown;

  const res = await fetchImpl(`${apiBase}/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, {
    method: "POST",
    headers: buildAuthHeaders(input.accessToken, input.appId),
    body: JSON.stringify(body),
    signal: input.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `QQ 群消息发送失败：${data.message || data.msg || data.code || res.status}`
    );
  }
  return data;
}

/**
 * 发 C2C 私聊消息
 */
async function sendC2cMessage(input = {}) {
  const openid = trimStr(input.openid || input.userOpenid || input.userId);
  if (!openid) throw new Error("缺少 user openid");
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const apiBase = normalizeApiBase(input.apiBase);
  const body = {
    content: input.content != null ? String(input.content) : undefined,
    msg_type: Number(input.msgType ?? MSG_TYPE.TEXT),
    msg_id: trimStr(input.msgId) || undefined,
    event_id: trimStr(input.eventId) || undefined,
    msg_seq: Number(input.msgSeq) || nextMsgSeq(),
  };
  if (input.media) body.media = input.media;

  const res = await fetchImpl(`${apiBase}/v2/users/${encodeURIComponent(openid)}/messages`, {
    method: "POST",
    headers: buildAuthHeaders(input.accessToken, input.appId),
    body: JSON.stringify(body),
    signal: input.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `QQ 私聊发送失败：${data.message || data.msg || data.code || res.status}`
    );
  }
  return data;
}

/**
 * 上传群文件/图片，拿 file_info（可用于 msg_type=7）
 * 支持 url 或 fileData(base64)
 */
async function uploadGroupFile(input = {}) {
  const groupOpenid = trimStr(input.groupOpenid || input.groupId);
  if (!groupOpenid) throw new Error("缺少 group_openid");
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const apiBase = normalizeApiBase(input.apiBase);
  const body = {
    file_type: Number(input.fileType ?? FILE_TYPE.IMAGE),
    srv_send_msg: Boolean(input.srvSendMsg),
  };
  if (trimStr(input.url)) body.url = trimStr(input.url);
  if (input.fileData) {
    body.file_data =
      typeof input.fileData === "string"
        ? input.fileData
        : Buffer.from(input.fileData).toString("base64");
  }
  if (!body.url && !body.file_data) throw new Error("上传文件需要 url 或 file_data");

  const res = await fetchImpl(`${apiBase}/v2/groups/${encodeURIComponent(groupOpenid)}/files`, {
    method: "POST",
    headers: buildAuthHeaders(input.accessToken, input.appId),
    body: JSON.stringify(body),
    signal: input.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `QQ 群文件上传失败：${data.message || data.msg || data.code || res.status}`
    );
  }
  return data;
}

async function uploadC2cFile(input = {}) {
  const openid = trimStr(input.openid || input.userOpenid || input.userId);
  if (!openid) throw new Error("缺少 user openid");
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const apiBase = normalizeApiBase(input.apiBase);
  const body = {
    file_type: Number(input.fileType ?? FILE_TYPE.IMAGE),
    srv_send_msg: Boolean(input.srvSendMsg),
  };
  if (trimStr(input.url)) body.url = trimStr(input.url);
  if (input.fileData) {
    body.file_data =
      typeof input.fileData === "string"
        ? input.fileData
        : Buffer.from(input.fileData).toString("base64");
  }
  if (!body.url && !body.file_data) throw new Error("上传文件需要 url 或 file_data");

  const res = await fetchImpl(`${apiBase}/v2/users/${encodeURIComponent(openid)}/files`, {
    method: "POST",
    headers: buildAuthHeaders(input.accessToken, input.appId),
    body: JSON.stringify(body),
    signal: input.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `QQ 私聊文件上传失败：${data.message || data.msg || data.code || res.status}`
    );
  }
  return data;
}

/**
 * 从官方事件 payload 归一化为内部入站结构
 */
function normalizeInboundEvent(eventType, payload = {}) {
  const type = trimStr(eventType);
  const d = payload && typeof payload === "object" ? payload : {};
  const isGroup = type === "GROUP_AT_MESSAGE_CREATE" || Boolean(d.group_openid);
  const isC2c = type === "C2C_MESSAGE_CREATE" || (!isGroup && (d.author?.user_openid || d.author?.id));

  const msgId = trimStr(d.id);
  // 富媒体消息 content 可能是 file:// 前缀或空，不当作正文文本
  let content = trimStr(d.content).replace(/^\/\s*/, ""); // 部分环境带 /
  content = content.replace(/^file:\/\/[^\s]*/, "").trim();
  // 去掉 @bot 占位（常见 <@!xxxx> 或 <@xxx>）
  const text = content.replace(/<@!?[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const author = d.author && typeof d.author === "object" ? d.author : {};
  const fromUserId = trimStr(
    author.member_openid || author.user_openid || author.id || d.author?.id
  );
  const groupId = trimStr(d.group_openid || "");
  const conversationId = isGroup
    ? `group:${groupId || "unknown"}`
    : `c2c:${fromUserId || msgId || "unknown"}`;

  const attachments = Array.isArray(d.attachments)
    ? d.attachments
        .filter((att) => att && typeof att === "object" && trimStr(att.url))
        .map((att) => ({
          url: trimStr(att.url),
          fileName: trimStr(att.filename) || `qq-file-${msgId}`,
          contentType: trimStr(att.content_type),
          size: Number(att.size) > 0 ? Number(att.size) : null,
        }))
    : [];

  return {
    channel: "qqbot",
    eventType: type,
    chatType: isGroup ? "group" : "c2c",
    msgId,
    eventId: trimStr(d.event_id || payload.event_id || ""),
    text,
    rawContent: content,
    fromUserId,
    groupId: groupId || null,
    conversationId,
    attachments,
    timestamp: d.timestamp || null,
    raw: d,
  };
}

const DEFAULT_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * 下载官方事件里带 rkey 鉴权参数的附件直链（无需 Authorization 头）。
 * 协议相对 URL（//…）自动补 https。流式读取并强制大小上限。
 */
async function downloadAttachment(input = {}) {
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持 fetch");
  const maxBytes = Number(input.maxBytes) > 0 ? Number(input.maxBytes) : DEFAULT_MAX_DOWNLOAD_BYTES;
  let url = trimStr(input.url);
  if (!url) throw new Error("缺少附件下载地址");
  if (url.startsWith("//")) url = `https:${url}`;

  const res = await fetchImpl(url, { signal: input.signal });
  if (!res.ok) throw new Error(`附件下载失败：HTTP ${res.status}`);

  const declared = Number(res.headers?.get?.("content-length") || 0);
  if (declared > maxBytes) {
    throw new Error(`附件超过大小上限（${Math.round(declared / 1024 / 1024)}MB > ${Math.round(maxBytes / 1024 / 1024)}MB）`);
  }
  if (!res.body) {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("附件超过大小上限");
    return {
      buffer,
      fileName: trimStr(input.fileName) || "qq-file.bin",
      contentType: trimStr(input.contentType),
      size: buffer.length,
    };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maxBytes) throw new Error(`附件超过大小上限（${Math.round(maxBytes / 1024 / 1024)}MB）`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  return {
    buffer: Buffer.concat(chunks, total),
    fileName: trimStr(input.fileName) || "qq-file.bin",
    contentType: trimStr(input.contentType),
    size: total,
  };
}

function buildIdentifyPayload({ accessToken, intents, shard = [0, 1] }) {
  return {
    op: 2,
    d: {
      token: `QQBot ${trimStr(accessToken)}`,
      intents: Number(intents) || INTENT_GROUP_AND_C2C,
      shard,
    },
  };
}

function buildResumePayload({ accessToken, sessionId, seq }) {
  return {
    op: 6,
    d: {
      token: `QQBot ${trimStr(accessToken)}`,
      session_id: trimStr(sessionId),
      seq: Number(seq) || 0,
    },
  };
}

module.exports = {
  DEFAULT_API_BASE,
  DEFAULT_TOKEN_URL,
  INTENT_GROUP_AND_C2C,
  MSG_TYPE,
  FILE_TYPE,
  normalizeApiBase,
  buildAuthHeaders,
  fetchAppAccessToken,
  fetchGatewayUrl,
  nextMsgSeq,
  sendGroupMessage,
  sendC2cMessage,
  uploadGroupFile,
  uploadC2cFile,
  downloadAttachment,
  normalizeInboundEvent,
  buildIdentifyPayload,
  buildResumePayload,
};
