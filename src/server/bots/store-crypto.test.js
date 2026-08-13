"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { encryptToken, decryptToken } = require("./store-crypto");

test("store-crypto roundtrip", () => {
  const secret = "unit-test-secret";
  const encoded = encryptToken("hello-token", secret);
  assert.match(encoded, /^v1:/);
  assert.equal(decryptToken(encoded, secret), "hello-token");
});

test("store-crypto rejects other secret", () => {
  const encoded = encryptToken("hello-token", "secret-a");
  assert.throws(() => decryptToken(encoded, "secret-b"));
});
