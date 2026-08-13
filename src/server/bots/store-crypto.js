"use strict";

const crypto = require("crypto");

function resolveStoreSecret(env = process.env) {
  return String(
    env.BOT_STORE_SECRET
    || env.SESSION_SECRET
    || env.JWT_SECRET
    || "douyin-local-bot-store"
  );
}

function keyFromSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest();
}

function encryptToken(plain, secret = resolveStoreSecret()) {
  const text = String(plain || "");
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decryptToken(payload, secret = resolveStoreSecret()) {
  const text = String(payload || "");
  if (!text) return "";
  if (!text.startsWith("v1:")) return text;
  const parts = text.split(":");
  if (parts.length !== 4) throw new Error("机器人凭据格式无效");
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFromSecret(secret),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = {
  resolveStoreSecret,
  encryptToken,
  decryptToken,
};
