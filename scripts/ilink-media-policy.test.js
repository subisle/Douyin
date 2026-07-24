"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  validateCdnUrl,
  assertByteLimit,
  sniffMime,
  validateOutboundMedia,
  validateInboundDescriptor,
} = require("./ilink-media-policy");

test("validateCdnUrl accepts trusted download host", () => {
  const ok = validateCdnUrl("https://novac2c.cdn.weixin.qq.com/c2c/download?x=1");
  assert.equal(ok.ok, true);
});

test("validateCdnUrl rejects foreign host and http", () => {
  assert.equal(validateCdnUrl("https://evil.example/c2c/download").ok, false);
  assert.equal(validateCdnUrl("http://novac2c.cdn.weixin.qq.com/c2c/download").ok, false);
});

test("assertByteLimit and sniffMime", () => {
  assert.equal(assertByteLimit(10, 100).ok, true);
  assert.equal(assertByteLimit(200, 100).code, "TOO_LARGE");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  assert.equal(sniffMime(png), "image/png");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0, 0]);
  assert.equal(sniffMime(jpeg), "image/jpeg");
  assert.equal(sniffMime(Buffer.from("a,b,c\n1,2,3\n")), "text/csv");
});

test("validateOutboundMedia image and file", () => {
  assert.equal(
    validateOutboundMedia({ kind: "image", mimeType: "image/png", byteSize: 100 }).ok,
    true
  );
  assert.equal(
    validateOutboundMedia({ kind: "image", mimeType: "application/pdf", byteSize: 100 }).ok,
    false
  );
  assert.equal(
    validateOutboundMedia({ kind: "file", mimeType: "text/csv", byteSize: 100 }).ok,
    true
  );
});

test("validateInboundDescriptor", () => {
  assert.equal(
    validateInboundDescriptor({
      byteSize: 100,
      downloadUrl: "https://novac2c.cdn.weixin.qq.com/c2c/download",
    }).ok,
    true
  );
  assert.equal(
    validateInboundDescriptor({
      byteSize: 999999999,
      maxBytes: 10,
    }).ok,
    false
  );
});
