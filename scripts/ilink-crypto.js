"use strict";

const crypto = require("node:crypto");

const KEY_ID = "v1";
const SCRYPT_SALT = "ilink-runtime-v1";
const SCRYPT_KEYLEN = 32;
const GCM_IV_LEN = 12;
const GCM_TAG_LEN = 16;

/**
 * @param {{ secret: string }} options
 */
function createRuntimeCrypto(options) {
  const secret = String(options?.secret ?? "").trim();
  if (secret.length < 16) {
    throw new Error("BOT_RUNTIME_SECRET must be at least 16 characters");
  }

  const key = crypto.scryptSync(secret, SCRYPT_SALT, SCRYPT_KEYLEN);

  return {
    /**
     * @param {string} plainText
     * @returns {{ ciphertext: string, keyId: string }}
     */
    encrypt(plainText) {
      const iv = crypto.randomBytes(GCM_IV_LEN);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(String(plainText), "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      const ciphertext = [
        iv.toString("base64"),
        tag.toString("base64"),
        encrypted.toString("base64"),
      ].join(".");
      return { ciphertext, keyId: KEY_ID };
    },

    /**
     * @param {string} ciphertext
     * @param {string} keyId
     * @returns {string}
     */
    decrypt(ciphertext, keyId) {
      if (keyId !== KEY_ID) {
        throw new Error(`unsupported keyId: ${keyId} (expected ${KEY_ID})`);
      }
      const parts = String(ciphertext).split(".");
      if (parts.length !== 3) {
        throw new Error("invalid ciphertext format");
      }
      const [ivB64, tagB64, dataB64] = parts;
      const iv = Buffer.from(ivB64, "base64");
      const tag = Buffer.from(tagB64, "base64");
      const data = Buffer.from(dataB64, "base64");
      if (iv.length !== GCM_IV_LEN || tag.length !== GCM_TAG_LEN) {
        throw new Error("invalid ciphertext parts");
      }
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    },

    /**
     * @param {string} text
     * @returns {string}
     */
    sha256Hex(text) {
      return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
    },
  };
}

module.exports = { createRuntimeCrypto };
