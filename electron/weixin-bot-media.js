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

function normalizeCdnBaseUrl(value = CDN_BASE_URL) {
  const url = new URL(String(value || CDN_BASE_URL));
  if (url.protocol !== "https:") throw new Error("微信媒体地址必须使用 HTTPS");
  if (url.hostname !== "novac2c.cdn.weixin.qq.com") {
    throw new Error("微信媒体地址不在受信任白名单");
  }
  if (url.port || url.username || url.password || url.search || url.hash) {
    throw new Error("微信媒体地址包含不受支持的端口、凭据或参数");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname !== "/c2c") throw new Error("微信媒体地址路径无效");
  return `${url.origin}${pathname}`;
}

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

async function fetchWithTimeout(
  fetchImpl,
  url,
  options = {},
  timeoutMs = MEDIA_TIMEOUT_MS,
  consumeResponse = null
) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  let timedOut = false;
  let rejectInterrupted;
  const interrupted = new Promise((_, reject) => {
    rejectInterrupted = reject;
  });
  const onAbort = () => {
    controller.abort(externalSignal?.reason);
    const error = externalSignal?.reason instanceof Error
      ? externalSignal.reason
      : new Error("微信媒体请求已中止");
    if (!error.name || error.name === "Error") error.name = "AbortError";
    rejectInterrupted(error);
  };
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  if (externalSignal?.aborted) onAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectInterrupted(new Error("微信媒体请求超时"));
  }, timeoutMs);
  try {
    const request = (async () => {
      const response = await fetchImpl(url, {
        ...options,
        signal: controller.signal,
        redirect: "manual",
      });
      return typeof consumeResponse === "function"
        ? consumeResponse(response, controller.signal)
        : response;
    })();
    return await Promise.race([request, interrupted]);
  } catch (error) {
    if (timedOut) throw new Error("微信媒体请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

async function readResponseBodyLimited(response, maxBytes) {
  const chunks = [];
  let total = 0;
  const append = (value) => {
    const chunk = Buffer.from(value || []);
    total += chunk.length;
    if (total > maxBytes) throw new Error("微信媒体文件过大");
    chunks.push(chunk);
  };

  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        append(value);
      }
    } catch (error) {
      if (/文件过大/.test(String(error?.message || ""))) {
        await reader.cancel().catch(() => undefined);
      }
      throw error;
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, total);
  }

  if (response?.body && typeof response.body[Symbol.asyncIterator] === "function") {
    for await (const chunk of response.body) append(chunk);
    return Buffer.concat(chunks, total);
  }

  if (typeof response?.arrayBuffer !== "function") {
    throw new Error("微信媒体响应缺少文件内容");
  }
  append(await response.arrayBuffer());
  return Buffer.concat(chunks, total);
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
  timeoutMs = MEDIA_TIMEOUT_MS,
  signal,
}) {
  if (typeof fetchImpl !== "function") throw new Error("微信媒体下载缺少 fetch");
  const descriptor = mediaDescriptor(item);
  const query = String(descriptor?.media?.encrypt_query_param || "").trim();
  if (!descriptor || !query) throw new Error("微信消息未包含可下载的媒体");

  const url = `${normalizeCdnBaseUrl(cdnBaseUrl)}/download?encrypted_query_param=${encodeURIComponent(query)}`;
  const key = descriptor.aesKey ? parseAesKey(descriptor.aesKey) : null;
  const encryptedLimit = key ? aesEcbPaddedSize(maxBytes) : maxBytes;
  const encrypted = await fetchWithTimeout(
    fetchImpl,
    url,
    { signal },
    timeoutMs,
    async (response) => {
      if (!response?.ok) throw new Error(`微信媒体下载失败 (${response?.status || 0})`);
      const contentLength = Number(headerValue(response.headers, "content-length"));
      if (Number.isFinite(contentLength) && contentLength > encryptedLimit) {
        throw new Error("微信媒体文件过大");
      }
      return readResponseBodyLimited(response, encryptedLimit);
    }
  );
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
  signal,
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
  const uploadUrl = `${normalizeCdnBaseUrl(cdnBaseUrl)}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(prepared.filekey)}`;
  let lastError = null;
  let downloadParam = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: ciphertext,
        signal,
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
      if (signal?.aborted) throw error;
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
  normalizeCdnBaseUrl,
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
