"use strict";

/**
 * Pure policy helpers for iLink media (CDN allowlist, size, MIME sniff).
 * Shared by future Worker Artifact pipeline; mirrors desktop weixin-bot-media rules.
 */

const CDN_HOST = "novac2c.cdn.weixin.qq.com";
const CDN_PATH_PREFIX = "/c2c/";
const DEFAULT_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);
const ALLOWED_FILE_MIMES = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/octet-stream",
]);

function validateCdnUrl(urlString, { method = "GET" } = {}) {
  let url;
  try {
    url = new URL(String(urlString || ""));
  } catch {
    return { ok: false, error: "invalid media URL", code: "BAD_URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "media URL must be HTTPS", code: "BAD_PROTOCOL" };
  }
  if (url.hostname !== CDN_HOST) {
    return { ok: false, error: "media host not allowlisted", code: "BAD_HOST" };
  }
  if (url.port && url.port !== "443") {
    return { ok: false, error: "media port not allowed", code: "BAD_PORT" };
  }
  if (url.username || url.password || url.hash) {
    return { ok: false, error: "media URL has forbidden components", code: "BAD_URL" };
  }
  const pathname = url.pathname || "";
  const allowedPaths =
    method.toUpperCase() === "POST"
      ? pathname === "/c2c/upload" || pathname.startsWith("/c2c/upload")
      : pathname === "/c2c/download" || pathname.startsWith("/c2c/download");
  // Desktop uses /c2c as base; download/upload are path suffixes in practice.
  if (!pathname.startsWith("/c2c")) {
    return { ok: false, error: "media path not allowlisted", code: "BAD_PATH" };
  }
  return { ok: true, url: url.toString() };
}

function assertByteLimit(size, maxBytes, label = "payload") {
  const n = Number(size);
  const max = Number(maxBytes);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: `invalid ${label} size`, code: "BAD_SIZE" };
  }
  if (n > max) {
    return {
      ok: false,
      error: `${label} exceeds limit (${n} > ${max})`,
      code: "TOO_LARGE",
    };
  }
  return { ok: true };
}

/**
 * Minimal magic-byte sniff for png/jpeg/gif and text-ish CSV.
 */
function sniffMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) {
    return "application/octet-stream";
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  // UTF-8 BOM or printable → treat as text/csv candidate
  const sample = buffer.subarray(0, Math.min(64, buffer.length)).toString("utf8");
  if (/^[\x09\x0a\x0d\x20-\x7e一-鿿,]+$/m.test(sample) && sample.includes(",")) {
    return "text/csv";
  }
  if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(sample)) {
    return "text/plain";
  }
  return "application/octet-stream";
}

function validateOutboundMedia({ kind, mimeType, byteSize, maxBytes } = {}) {
  const mediaKind = kind === "image" ? "image" : "file";
  const limit =
    Number(maxBytes) > 0
      ? Number(maxBytes)
      : mediaKind === "image"
        ? DEFAULT_MAX_UPLOAD_BYTES
        : DEFAULT_MAX_UPLOAD_BYTES;
  const sizeCheck = assertByteLimit(byteSize, limit, "outbound media");
  if (!sizeCheck.ok) return sizeCheck;

  const mime = String(mimeType || "").toLowerCase();
  if (mediaKind === "image" && !ALLOWED_IMAGE_MIMES.has(mime)) {
    return { ok: false, error: `image mime not allowed: ${mime}`, code: "BAD_MIME" };
  }
  if (mediaKind === "file" && mime && !ALLOWED_FILE_MIMES.has(mime) && !mime.startsWith("text/")) {
    // allow generic octet-stream for csv exports
    if (mime !== "application/octet-stream") {
      return { ok: false, error: `file mime not allowed: ${mime}`, code: "BAD_MIME" };
    }
  }
  return { ok: true, mediaKind, mimeType: mime || "application/octet-stream" };
}

function validateInboundDescriptor(descriptor = {}) {
  const declaredSize = Number(descriptor.byteSize ?? descriptor.size ?? 0);
  const sizeCheck = assertByteLimit(
    declaredSize || 0,
    Number(descriptor.maxBytes) > 0 ? Number(descriptor.maxBytes) : DEFAULT_MAX_DOWNLOAD_BYTES,
    "inbound media"
  );
  if (declaredSize > 0 && !sizeCheck.ok) return sizeCheck;

  if (descriptor.downloadUrl) {
    const urlCheck = validateCdnUrl(descriptor.downloadUrl, { method: "GET" });
    if (!urlCheck.ok) return urlCheck;
  }
  return { ok: true };
}

module.exports = {
  CDN_HOST,
  CDN_PATH_PREFIX,
  DEFAULT_MAX_DOWNLOAD_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_FILE_MIMES,
  validateCdnUrl,
  assertByteLimit,
  sniffMime,
  validateOutboundMedia,
  validateInboundDescriptor,
};
