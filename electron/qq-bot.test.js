"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { QqBotService } = require("./qq-bot");
const { EventEmitter } = require("events");

class FakeWs extends EventEmitter {
  static OPEN = 1;
  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWs.OPEN;
    this.sent = [];
    queueMicrotask(() => {
      // hello
      this.emit("message", JSON.stringify({ op: 10, d: { heartbeat_interval: 50000 } }));
    });
  }
  send(data) {
    this.sent.push(String(data));
    const packet = JSON.parse(String(data));
    if (packet.op === 2) {
      queueMicrotask(() => {
        this.emit("message", JSON.stringify({
          op: 0,
          t: "READY",
          s: 1,
          d: { session_id: "sess-1" },
        }));
      });
    }
  }
  close() {
    this.readyState = 3;
    this.emit("close", 1000, "test");
  }
}

test("QqBotService connect + handle group @ via commandHandler", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qq-bot-"));
  const storage = path.join(dir, "qq.json");
  const replies = [];

  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.includes("getAppAccessToken")) {
      return {
        ok: true,
        async text() {
          return JSON.stringify({ access_token: "tok-x", expires_in: 7200 });
        },
      };
    }
    if (u.endsWith("/gateway")) {
      return { ok: true, async json() { return { url: "ws://fake" }; } };
    }
    if (u.includes("/v2/groups/")) {
      replies.push({ url: u, body: JSON.parse(init.body) });
      return { ok: true, async json() { return { id: "out-1" }; } };
    }
    throw new Error(`unexpected fetch ${u}`);
  };

  const bot = new QqBotService({
    storagePath: storage,
    fetchImpl,
    WebSocketImpl: FakeWs,
  });
  bot.saveSettings({
    appId: "1001",
    clientSecret: "secret",
    accessMode: "open",
  });
  bot.setCommandHandler(async (args) => {
    if (/帮助|help/i.test(args.text || "")) {
      await args.replyText("QQ帮助菜单");
      return { handled: true };
    }
    return { handled: false };
  });

  await bot.connect();
  assert.equal(bot.getStatus().phase, "ready");
  assert.equal(bot.getStatus().connected, true);

  // inject inbound group event through private packet handler
  await bot._onPacket({
    op: 0,
    t: "GROUP_AT_MESSAGE_CREATE",
    s: 2,
    d: {
      id: "in-99",
      group_openid: "G-1",
      content: "<@!bot> 帮助",
      author: { member_openid: "U-1" },
    },
  });

  // allow async queue
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(replies.length >= 1, "should send reply");
  assert.equal(replies[0].body.content, "QQ帮助菜单");
  assert.equal(replies[0].body.msg_id, "in-99");

  await bot.disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});
