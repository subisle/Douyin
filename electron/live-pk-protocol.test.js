"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeLiveRoomUrl,
  extractWebRid,
  reshapeGiftList,
  buildUnsignedPushUrl,
  signPushUrl,
} = require("./live-pk-protocol");

describe("live-pk-protocol helpers", () => {
  it("normalizes bare web_rid to live url", () => {
    assert.equal(
      normalizeLiveRoomUrl("724154245800"),
      "https://live.douyin.com/724154245800"
    );
  });

  it("extracts web_rid from full url", () => {
    assert.equal(
      extractWebRid("https://live.douyin.com/724154245800?from=pc"),
      "724154245800"
    );
  });

  it("reshapes gift/list gifts[] into pages[] for watcher", () => {
    const raw = {
      status_code: 0,
      data: {
        pages: [],
        gifts: [
          { id: 1, name: "小心心", diamond_count: 1 },
          { id: 2, name: "玫瑰", diamond_count: 10 },
        ],
      },
    };
    const shaped = reshapeGiftList(raw);
    assert.equal(shaped.data.pages.length, 1);
    assert.equal(shaped.data.pages[0].gifts.length, 2);
    assert.equal(shaped.data.pages[0].page_name, "all");
  });

  it("leaves gift/list with existing pages untouched", () => {
    const raw = {
      data: {
        pages: [{ page_name: "tab", gifts: [{ id: 9 }] }],
        gifts: [{ id: 1 }],
      },
    };
    const shaped = reshapeGiftList(raw);
    assert.equal(shaped.data.pages[0].gifts[0].id, 9);
  });

  it("builds unsigned push url with required sign keys", () => {
    const url = new URL(buildUnsignedPushUrl("751234567890", "7319483754668557238"));
    assert.equal(url.protocol, "wss:");
    assert.match(url.pathname, /\/webcast\/im\/push\/v2\/?$/);
    for (const key of [
      "live_id",
      "aid",
      "version_code",
      "webcast_sdk_version",
      "room_id",
      "did_rule",
      "user_unique_id",
      "device_platform",
      "identity",
    ]) {
      assert.ok(url.searchParams.has(key), `missing ${key}`);
    }
    assert.equal(url.searchParams.get("room_id"), "751234567890");
    assert.equal(url.searchParams.get("user_unique_id"), "7319483754668557238");
  });

  it("signs push url with vendor get_sign", () => {
    const unsigned = buildUnsignedPushUrl("751234567890", "7319483754668557238");
    const signed = signPushUrl(unsigned);
    const url = new URL(signed);
    const signature = url.searchParams.get("signature");
    assert.ok(signature, "signature missing");
    assert.ok(signature.length >= 16, `signature too short: ${signature}`);
    assert.equal(url.searchParams.get("room_id"), "751234567890");
  });
});
