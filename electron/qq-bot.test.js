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

test("QqBotService downloadMedia accepts command-layer file_item wrapper", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qq-bot-dl-"));
  const storage = path.join(dir, "qq.json");
  let capturedDownload = null;

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
    if (u.includes("multimedia.nt.qq.com")) {
      return {
        ok: true,
        headers: { get: () => null },
        body: null,
        async arrayBuffer() {
          return Buffer.from("name,wave\nA,1\n");
        },
      };
    }
    if (u.includes("/v2/users/") || u.includes("/v2/groups/")) {
      return { ok: true, async json() { return { id: "out-2" }; } };
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
    const fileItem = (args.items || []).find((item) => item?.type === 4 && item.file_item);
    assert.ok(fileItem, "should expose type=4 file item");
    capturedDownload = await args.downloadMedia(fileItem);
    await args.replyText(`got:${capturedDownload.fileName}:${capturedDownload.buffer.toString("utf8").trim()}`);
    return { handled: true };
  });

  await bot.connect();
  await bot._onPacket({
    op: 0,
    t: "C2C_MESSAGE_CREATE",
    s: 3,
    d: {
      id: "in-csv",
      content: "file://2026-08-07_音浪.csv",
      author: { user_openid: "U-csv" },
      attachments: [
        {
          url: "//multimedia.nt.qq.com/x.csv?rkey=abc",
          filename: "2026-08-07_音浪.csv",
          content_type: "text/csv",
          size: 12,
        },
      ],
    },
  });

  await new Promise((r) => setTimeout(r, 40));
  assert.ok(capturedDownload, "downloadMedia should run");
  assert.equal(capturedDownload.fileName, "2026-08-07_音浪.csv");
  assert.equal(capturedDownload.buffer.toString("utf8"), "name,wave\nA,1\n");

  await bot.disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("QqBotService default autoConnect + C2C binding + midnight reminder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qq-bot-rm-"));
  const storage = path.join(dir, "qq.json");
  const outbound = [];

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
    if (u.includes("/v2/users/")) {
      outbound.push({ url: u, body: JSON.parse(init.body) });
      return { ok: true, async json() { return { id: "out-rm" }; } };
    }
    throw new Error(`unexpected fetch ${u}`);
  };

  const bot = new QqBotService({
    storagePath: storage,
    fetchImpl,
    WebSocketImpl: FakeWs,
  });
  bot.setCommandHandler(async () => ({ handled: false }));

  // autoConnect 默认开启（有凭据即可在 initialize 时连接）
  assert.equal(bot.getSettings().autoConnect, true);
  assert.equal(bot.getSettings().reminderEnabled, true);

  bot.saveSettings({ appId: "1001", clientSecret: "secret", accessMode: "open" });
  await bot.connect();
  assert.equal(bot.getStatus().connected, true);

  // C2C 用户发消息即记录绑定；不再自动设置管理员
  await bot._onPacket({
    op: 0,
    t: "C2C_MESSAGE_CREATE",
    s: 2,
    d: { id: "in-bind", content: "你好", author: { user_openid: "U-first" } },
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(bot.getSettings().boundUserIds, ["U-first"]);

  // 午夜提醒：发给所有已对接用户；lastReminderDate 防重
  const r1 = await bot.sendMidnightReminder();
  assert.equal(r1.sent, 1);
  assert.equal(r1.fail, 0);
  assert.equal(r1.skipped, null);
  assert.ok(outbound.some((o) => o.body.content === "请发送音浪文件即可"));
  assert.ok(bot.getSettings().lastReminderDate);
  const r2 = await bot.sendMidnightReminder();
  assert.equal(r2.skipped, "already_sent");

  // 通知关闭后不再发送
  bot.saveSettings({ reminderEnabled: false });
  const r3 = await bot.sendMidnightReminder();
  assert.equal(r3.skipped, "disabled");

  // 开放模式：任意用户（含陌生用户）消息都会被处理，无白名单 / 无管理员
  let strangerHandled = false;
  bot.setCommandHandler(async () => { strangerHandled = true; return { handled: true }; });
  await bot._onPacket({
    op: 0,
    t: "C2C_MESSAGE_CREATE",
    s: 4,
    d: { id: "in-stranger", content: "任意消息", author: { user_openid: "U-other" } },
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(strangerHandled, true);

  await bot.disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});
