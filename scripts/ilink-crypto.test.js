"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntimeCrypto } = require("./ilink-crypto");

test("encrypt/decrypt roundtrip", () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const sealed = cryptoApi.encrypt("hello-cursor");
  assert.equal(sealed.keyId, "v1");
  assert.ok(sealed.ciphertext.includes("."));
  assert.equal(cryptoApi.decrypt(sealed.ciphertext, sealed.keyId), "hello-cursor");
});

test("sha256Hex stable", () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  assert.equal(cryptoApi.sha256Hex("a"), cryptoApi.sha256Hex("a"));
  assert.equal(cryptoApi.sha256Hex("a").length, 64);
});

test("rejects short secret", () => {
  assert.throws(() => createRuntimeCrypto({ secret: "short" }), /BOT_RUNTIME_SECRET/);
});

test("rejects unknown keyId", () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const sealed = cryptoApi.encrypt("hello-cursor");
  assert.throws(() => cryptoApi.decrypt(sealed.ciphertext, "v0"), /keyId|v1/);
});

test("rejects tampered ciphertext", () => {
  const cryptoApi = createRuntimeCrypto({ secret: "test-secret-16chars" });
  const sealed = cryptoApi.encrypt("hello-cursor");
  const parts = sealed.ciphertext.split(".");
  // Flip a character in the data segment so GCM auth fails.
  const data = Buffer.from(parts[2], "base64");
  data[0] = data[0] ^ 0xff;
  const tampered = `${parts[0]}.${parts[1]}.${data.toString("base64")}`;
  assert.throws(() => cryptoApi.decrypt(tampered, sealed.keyId));
});
