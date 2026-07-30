"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  fetchAppAccessToken,
  sendGroupMessage,
  normalizeInboundEvent,
  buildIdentifyPayload,
  INTENT_GROUP_AND_C2C,
  buildAuthHeaders,
} = require("./qqbot-adapter");

test("buildAuthHeaders formats QQBot token", () => {
  const h = buildAuthHeaders("tok_abc", "11");
  assert.equal(h.Authorization, "QQBot tok_abc");
  assert.equal(h["X-Union-Appid"], "11");
});

test("fetchAppAccessToken posts credentials", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      async text() {
        return JSON.stringify({ access_token: "at-1", expires_in: 7200 });
      },
    };
  };
  const token = await fetchAppAccessToken({
    appId: "app1",
    clientSecret: "sec1",
    fetchImpl,
  });
  assert.equal(token.accessToken, "at-1");
  assert.equal(calls.length, 1);
  assert.match(String(calls[0].url), /getAppAccessToken/);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { appId: "app1", clientSecret: "sec1" });
});

test("sendGroupMessage posts v2 group path", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, async json() { return { id: "m1" }; } };
  };
  await sendGroupMessage({
    accessToken: "t",
    appId: "a",
    groupOpenid: "g-open",
    content: "hello",
    msgId: "in-1",
    fetchImpl,
  });
  assert.match(seen.url, /\/v2\/groups\/g-open\/messages$/);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.content, "hello");
  assert.equal(body.msg_id, "in-1");
  assert.equal(body.msg_type, 0);
});

test("normalizeInboundEvent strips at-tag for group", () => {
  const inbound = normalizeInboundEvent("GROUP_AT_MESSAGE_CREATE", {
    id: "mid",
    group_openid: "G1",
    content: "<@!12345> 查 浩阳",
    author: { member_openid: "U1" },
  });
  assert.equal(inbound.chatType, "group");
  assert.equal(inbound.groupId, "G1");
  assert.equal(inbound.fromUserId, "U1");
  assert.equal(inbound.text, "查 浩阳");
  assert.equal(inbound.conversationId, "group:G1");
});

test("normalizeInboundEvent c2c", () => {
  const inbound = normalizeInboundEvent("C2C_MESSAGE_CREATE", {
    id: "m2",
    content: "帮助",
    author: { user_openid: "U9" },
  });
  assert.equal(inbound.chatType, "c2c");
  assert.equal(inbound.fromUserId, "U9");
  assert.equal(inbound.conversationId, "c2c:U9");
});

test("buildIdentifyPayload uses group/c2c intent", () => {
  const packet = buildIdentifyPayload({ accessToken: "tok", intents: INTENT_GROUP_AND_C2C });
  assert.equal(packet.op, 2);
  assert.equal(packet.d.token, "QQBot tok");
  assert.equal(packet.d.intents, INTENT_GROUP_AND_C2C);
});
