const crypto = require("crypto");

const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 30_000;
const MEDIA_TYPE = Object.freeze({
  image: 1,
  video: 2,
  file: 3,
  voice: 4,
});

function aesEcbPaddedSize(size) {
  return Math.ceil((Number(size) + 1) / 16) * 16;
}

function encryptAesEcb(plaintext, key) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function decryptAesEcb(ciphertext, key) {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function parseAesKey(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const decoded = Buffer.from(text, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  if (/^[0-9a-fA-F]{32}$/.test(text)) return Buffer.from(text, "hex");
  throw new Error("微信媒体密钥格式无效");
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return String(value || "");
  }
  return "";
}

function safeFileName(value, fallback = "weixin-file.bin") {
  const text = String(value || "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  return (text || fallback).slice(0, 180);
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = MEDIA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("微信媒体请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mediaDescriptor(item) {
  if (item?.type === 2) {
    return {
      kind: "image",
      media: item.image_item?.media,
      aesKey: item.image_item?.aeskey
        ? Buffer.from(String(item.image_item.aeskey), "hex").toString("base64")
        : item.image_item?.media?.aes_key,
      fileName: "weixin-image.jpg",
    };
  }
  if (item?.type === 3) {
    return {
      kind: "voice",
      media: item.voice_item?.media,
      aesKey: item.voice_item?.media?.aes_key,
      fileName: "weixin-voice.silk",
    };
  }
  if (item?.type === 4) {
    return {
      kind: "file",
      media: item.file_item?.media,
      aesKey: item.file_item?.media?.aes_key,
      fileName: safeFileName(item.file_item?.file_name),
    };
  }
  if (item?.type === 5) {
    return {
      kind: "video",
      media: item.video_item?.media,
      aesKey: item.video_item?.media?.aes_key,
      fileName: "weixin-video.mp4",
    };
  }
  return null;
}

async function downloadInboundMedia({
  fetchImpl,
  item,
  cdnBaseUrl = CDN_BASE_URL,
  maxBytes = MAX_MEDIA_BYTES,
}) {
  if (typeof fetchImpl !== "function") throw new Error("微信媒体下载缺少 fetch");
  const descriptor = mediaDescriptor(item);
  const query = String(descriptor?.media?.encrypt_query_param || "").trim();
  if (!descriptor || !query) throw new Error("微信消息未包含可下载的媒体");

  const url = `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(fetchImpl, url);
  if (!response?.ok) throw new Error(`微信媒体下载失败 (${response?.status || 0})`);
  const contentLength = Number(headerValue(response.headers, "content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes * 2) {
    throw new Error("微信媒体文件过大");
  }
  const encrypted = Buffer.from(await response.arrayBuffer());
  if (encrypted.length > maxBytes * 2) throw new Error("微信媒体文件过大");

  const key = descriptor.aesKey ? parseAesKey(descriptor.aesKey) : null;
  const buffer = key ? decryptAesEcb(encrypted, key) : encrypted;
  if (buffer.length > maxBytes) throw new Error("微信媒体文件过大");
  return {
    kind: descriptor.kind,
    fileName: descriptor.fileName,
    buffer,
  };
}

function prepareUpload(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const aeskey = crypto.randomBytes(16);
  return {
    buffer: data,
    rawsize: data.length,
    rawfilemd5: crypto.createHash("md5").update(data).digest("hex"),
    filesize: aesEcbPaddedSize(data.length),
    filekey: crypto.randomBytes(16).toString("hex"),
    aeskey,
  };
}

async function uploadMediaBuffer({
  fetchImpl,
  getUploadUrl,
  buffer,
  toUserId,
  mediaKind,
  fileName,
  cdnBaseUrl = CDN_BASE_URL,
  maxBytes = MAX_MEDIA_BYTES,
}) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length > maxBytes) throw new Error("待发送媒体文件过大");
  const prepared = prepareUpload(buffer);
  const mediaType = MEDIA_TYPE[mediaKind];
  if (!mediaType) throw new Error(`不支持的微信媒体类型: ${mediaKind}`);

  const uploadResponse = await getUploadUrl({
    filekey: prepared.filekey,
    media_type: mediaType,
    to_user_id: String(toUserId || ""),
    rawsize: prepared.rawsize,
    rawfilemd5: prepared.rawfilemd5,
    filesize: prepared.filesize,
    no_need_thumb: true,
    aeskey: prepared.aeskey.toString("hex"),
  });
  const uploadParam = String(uploadResponse?.upload_param || "").trim();
  if (!uploadParam) throw new Error("微信接口未返回媒体上传参数");

  const ciphertext = encryptAesEcb(prepared.buffer, prepared.aeskey);
  const uploadUrl = `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(prepared.filekey)}`;
  let lastError = null;
  let downloadParam = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: ciphertext,
      });
      if (!response?.ok || response.status !== 200) {
        const detail = headerValue(response?.headers, "x-error-message");
        throw new Error(`微信媒体上传失败 (${response?.status || 0})${detail ? `: ${detail}` : ""}`);
      }
      downloadParam = headerValue(response.headers, "x-encrypted-param");
      if (!downloadParam) throw new Error("微信媒体上传缺少下载参数");
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= 3) throw error;
    }
  }
  if (!downloadParam) throw lastError || new Error("微信媒体上传失败");

  return {
    filekey: prepared.filekey,
    downloadEncryptedQueryParam: downloadParam,
    aeskey: prepared.aeskey.toString("hex"),
    rawfilemd5: prepared.rawfilemd5,
    fileSize: prepared.rawsize,
    fileSizeCiphertext: ciphertext.length,
    fileName: safeFileName(fileName, mediaKind === "image" ? "report.png" : "data.csv"),
  };
}

function buildMediaItem(mediaKind, uploaded) {
  const media = {
    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
    aes_key: Buffer.from(uploaded.aeskey, "utf8").toString("base64"),
    encrypt_type: 1,
  };
  if (mediaKind === "image") {
    return {
      type: 2,
      image_item: {
        media,
        mid_size: uploaded.fileSizeCiphertext,
        hd_size: uploaded.fileSizeCiphertext,
      },
    };
  }
  return {
    type: 4,
    file_item: {
      media,
      file_name: uploaded.fileName,
      md5: uploaded.rawfilemd5,
      len: String(uploaded.fileSize),
    },
  };
}

module.exports = {
  CDN_BASE_URL,
  MAX_MEDIA_BYTES,
  MEDIA_TIMEOUT_MS,
  MEDIA_TYPE,
  aesEcbPaddedSize,
  encryptAesEcb,
  decryptAesEcb,
  parseAesKey,
  mediaDescriptor,
  downloadInboundMedia,
  prepareUpload,
  uploadMediaBuffer,
  buildMediaItem,
  safeFileName,
};
