"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createIlinkTextTransport,
  loadTransportConfig,
} = require("./ilink-text-transport");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("loadTransportConfig disabled by default", () => {
  const config = loadTransportConfig({ env: {} });
  assert.equal(config.enabled, false);
  assert.equal(config.token, "");
});

test("loadTransportConfig reads env flags and token", () => {
  const config = loadTransportConfig({
    env: {
      BOT_ILINK_ENABLED: "true",
      BOT_ILINK_TOKEN: "tok-1",
      BOT_ILINK_BASE_URL: "https://ilinkai.weixin.qq.com",
      BOT_ILINK_ACCOUNT_ID: "acc-1",
      BOT_ILINK_ACK_TEXT: "pong",
    },
  });
  assert.equal(config.enabled, true);
  assert.equal(config.token, "tok-1");
  assert.equal(config.accountId, "acc-1");
  assert.equal(config.ackText, "pong");
});

test("poll once handles text message, sends ack, advances cursor", async () => {
  const calls = [];
  const adapter = {
    async getUpdates(options) {
      calls.push({ type: "getUpdates", options });
      if (calls.filter((c) => c.type === "getUpdates").length === 1) {
        return {
          errcode: 0,
          get_updates_buf: "cursor-2",
          msgs: [{
            message_type: 1,
            from_user_id: "user-a",
            context_token: "ctx-1",
            message_id: "m1",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          }],
        };
      }
      // second call: hang until aborted
      return new Promise((_, reject) => {
        const signal = options.signal;
        if (signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true }
        );
      });
    },
    async sendMessage(options) {
      calls.push({ type: "sendMessage", options });
      return { errcode: 0 };
    },
  };

  const events = [];
  const transport = createIlinkTextTransport({
    adapter,
    config: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      accountId: "acc",
      updatesBuf: "cursor-1",
      ackText: "收到",
    },
    onEvent: (event) => events.push(event),
    sleep: async () => {},
  });

  const startPromise = transport.start();
  await delay(30);
  await transport.stop();
  await startPromise;

  const sent = calls.find((c) => c.type === "sendMessage");
  assert.ok(sent, "should send ack");
  assert.equal(sent.options.msg.item_list[0].text_item.text, "收到");
  assert.equal(sent.options.msg.to_user_id, "user-a");
  assert.equal(sent.options.msg.context_token, "ctx-1");
  assert.equal(transport.getState().updatesBuf, "cursor-2");
  assert.equal(transport.getState().receivedCount, 1);
  assert.equal(transport.getState().sentCount, 1);
  assert.equal(transport.getState().phase, "stopped");
});

test("session expired stops polling and reports session_expired", async () => {
  const { IlinkSessionExpiredError } = require("../shared/ilink-adapter");
  const adapter = {
    async getUpdates() {
      throw new IlinkSessionExpiredError({ errcode: -14 });
    },
    async sendMessage() {
      throw new Error("should not send");
    },
  };
  const transport = createIlinkTextTransport({
    adapter,
    config: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      updatesBuf: "",
      ackText: "收到",
    },
    sleep: async () => {},
  });
  // start() returns immediately (background poll loop)
  const p = transport.start();
  await delay(50);
  assert.equal(transport.getState().phase, "session_expired");
  await transport.stop();
  await p;
});

test("stop aborts in-flight getUpdates", async () => {
  let aborted = false;
  const adapter = {
    async getUpdates(options) {
      return new Promise((_, reject) => {
        const signal = options.signal;
        if (signal.aborted) {
          aborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    },
    async sendMessage() {
      return { errcode: 0 };
    },
  };
  const transport = createIlinkTextTransport({
    adapter,
    config: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      updatesBuf: "",
      ackText: "",
    },
    sleep: async () => {},
  });
  const p = transport.start();
  await delay(20);
  await transport.stop();
  await p;
  assert.equal(aborted, true);
  assert.equal(transport.getState().phase, "stopped");
});

test("persistBatch success advances cursor and receives staged messages", async () => {
  const batches = [];
  let pollCount = 0;
  const adapter = {
    async getUpdates(options) {
      pollCount += 1;
      if (pollCount === 1) {
        return {
          errcode: 0,
          get_updates_buf: "cursor-2",
          msgs: [{
            message_type: 1,
            from_user_id: "user-a",
            context_token: "ctx-1",
            message_id: "m1",
            group_id: "g1",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          }],
        };
      }
      return new Promise((_, reject) => {
        const signal = options.signal;
        const onAbort = () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    async sendMessage() {
      return { errcode: 0 };
    },
  };

  const transport = createIlinkTextTransport({
    adapter,
    config: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      updatesBuf: "cursor-1",
      ackText: "收到",
    },
    sleep: async () => {},
    async persistBatch(batch) {
      batches.push(batch);
    },
  });

  const p = transport.start();
  await delay(40);
  await transport.stop();
  await p;

  assert.equal(batches.length, 1);
  assert.equal(batches[0].updatesBuf, "cursor-2");
  assert.equal(batches[0].messages.length, 1);
  assert.equal(batches[0].messages[0].text, "hello");
  assert.equal(batches[0].messages[0].fromUserId, "user-a");
  assert.equal(batches[0].messages[0].upstreamMessageId, "m1");
  assert.equal(batches[0].messages[0].groupId, "g1");
  assert.equal(batches[0].messages[0].contextToken, "ctx-1");
  assert.equal(transport.getState().updatesBuf, "cursor-2");
});

test("persistBatch failure keeps cursor and records lastError", async () => {
  let pollCount = 0;
  const adapter = {
    async getUpdates(options) {
      pollCount += 1;
      if (pollCount === 1) {
        return {
          errcode: 0,
          get_updates_buf: "cursor-2",
          msgs: [{
            message_type: 1,
            from_user_id: "user-a",
            context_token: "ctx-1",
            message_id: "m1",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          }],
        };
      }
      return new Promise((_, reject) => {
        const signal = options.signal;
        const onAbort = () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    async sendMessage() {
      return { errcode: 0 };
    },
  };

  const transport = createIlinkTextTransport({
    adapter,
    config: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      updatesBuf: "cursor-1",
      ackText: "收到",
    },
    sleep: async () => {},
    async persistBatch() {
      throw new Error("db down");
    },
  });

  const p = transport.start();
  await delay(40);
  await transport.stop();
  await p;

  assert.equal(transport.getState().updatesBuf, "cursor-1");
  assert.match(String(transport.getState().lastError || ""), /db down/);
});

test("sendOutbound hook replaces adapter.sendMessage", async () => {
  const outbound = [];
  let sendMessageCalls = 0;
  let pollCount = 0;
  const adapter = {
    async getUpdates(options) {
      pollCount += 1;
      if (pollCount === 1) {
        return {
          errcode: 0,
          get_updates_buf: "cursor-2",
          msgs: [{
            message_type: 1,
            from_user_id: "user-a",
            context_token: "ctx-1",
            message_id: "m1",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          }],
        };
      }
      return new Promise((_, reject) => {
        const signal = options.signal;
        const onAbort = () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    async sendMessage() {
      sendMessageCalls += 1;
      return { errcode: 0 };
    },
  };

  const transport = createIlinkTextTransport({
    adapter,
    config: {
      enabled: true,
      token: "tok",
      baseUrl: "https://ilinkai.weixin.qq.com",
      updatesBuf: "cursor-1",
      ackText: "收到",
    },
    sleep: async () => {},
    async sendOutbound(payload) {
      outbound.push(payload);
      return { enqueued: true };
    },
  });

  const p = transport.start();
  await delay(40);
  await transport.stop();
  await p;

  assert.equal(sendMessageCalls, 0);
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].text, "收到");
  assert.equal(outbound[0].toUserId, "user-a");
  assert.equal(outbound[0].contextToken, "ctx-1");
  assert.ok(outbound[0].clientId);
  assert.equal(transport.getState().sentCount, 1);
});
