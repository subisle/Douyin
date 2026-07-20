const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  WeixinBotService,
  extractMessagePreview,
  normalizeBaseUrl,
} = require("./weixin-bot");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function waitForEvent(emitter, eventName, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener(eventName, onEvent);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const onEvent = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      emitter.removeListener(eventName, onEvent);
      resolve(value);
    };
    emitter.on(eventName, onEvent);
  });
}

function waitForAbort(signal) {
  if (signal.aborted) {
    const error = new Error("aborted");
    error.name = "AbortError";
    return Promise.reject(error);
  }
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
}

test("extractMessagePreview supports iLink message item types", () => {
  assert.deepEqual(
    extractMessagePreview({
      item_list: [
        { type: 1, text_item: { text: "你好" } },
        { type: 3, voice_item: { text: "语音转写" } },
        { type: 4, file_item: { file_name: "日报.csv" } },
      ],
    }),
    {
      kind: "text",
      content: "你好\n[语音] 语音转写\n[文件] 日报.csv",
    }
  );
  assert.deepEqual(extractMessagePreview({ item_list: [{ type: 2 }] }), {
    kind: "image",
    content: "[图片]",
  });
});

test("normalizeBaseUrl accepts only trusted Weixin HTTPS hosts", () => {
  assert.equal(normalizeBaseUrl("https://ilinkai.weixin.qq.com/"), "https://ilinkai.weixin.qq.com");
  assert.equal(normalizeBaseUrl("https://edge.weixin.qq.com/path/"), "https://edge.weixin.qq.com/path");
  assert.throws(() => normalizeBaseUrl("http://ilinkai.weixin.qq.com"), /HTTPS/);
  assert.throws(() => normalizeBaseUrl("https://example.com"), /非受信任/);
});

test("QR login, cursor polling, and replies keep secrets in the main process", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-test-"));
  const storeFile = path.join(tempDir, "weixin-bot.v1.json");
  const token = "BOT_TOKEN_SECRET";
  let updatesCalls = 0;
  let sentRequest = null;

  const fetchImpl = async (url, options = {}) => {
    if (url.includes("get_bot_qrcode")) {
      return jsonResponse({
        qrcode: "QR_ID",
        qrcode_img_content: "https://weixin.qq.com/x/fixture",
      });
    }
    if (url.includes("get_qrcode_status")) {
      return jsonResponse({
        status: "confirmed",
        bot_token: token,
        ilink_bot_id: "fixture@im.bot",
        ilink_user_id: "owner@im.wechat",
        baseurl: "https://ilinkai.weixin.qq.com",
      });
    }
    if (url.includes("getupdates")) {
      updatesCalls += 1;
      if (updatesCalls === 1) {
        const request = JSON.parse(options.body);
        assert.equal(request.get_updates_buf, "");
        assert.equal(request.base_info.channel_version, "1.0.2");
        assert.equal(options.headers.Authorization, `Bearer ${token}`);
        assert.match(Buffer.from(options.headers["X-WECHAT-UIN"], "base64").toString("utf8"), /^\d+$/);
        return jsonResponse({
          ret: 0,
          get_updates_buf: "CURSOR_1",
          msgs: [{
            message_id: 101,
            from_user_id: "sender@im.wechat",
            message_type: 1,
            context_token: "CONTEXT_TOKEN",
            create_time_ms: 1_750_000_000_000,
            item_list: [{ type: 1, text_item: { text: "测试消息" } }],
          }],
        });
      }
      return waitForAbort(options.signal);
    }
    if (url.includes("sendmessage")) {
      sentRequest = JSON.parse(options.body);
      return jsonResponse({ ret: 0 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const createService = () => new WeixinBotService({
    fetchImpl,
    storagePath: () => storeFile,
    encryptToken: (value) => Buffer.from(`sealed:${value}`, "utf8").toString("base64"),
    decryptToken: (value) => Buffer.from(value, "base64").toString("utf8").replace(/^sealed:/, ""),
    generateQrDataUrl: async () => "data:image/png;base64,FIXTURE",
  });

  const service = createService();
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const running = waitForEvent(service, "status", (value) => value.phase === "running");
  const polled = waitForEvent(service, "status", (value) => Boolean(value.lastPollAt));
  const inbound = waitForEvent(service, "message", (value) => value.direction === "inbound");
  const loginStatus = await service.startLogin();
  assert.equal(loginStatus.phase, "awaiting_scan");
  assert.match(loginStatus.qrDataUrl, /^data:image\/png/);

  await running;
  const received = await inbound;
  assert.equal(received.content, "测试消息");
  assert.equal(received.conversationId, "sender@im.wechat");
  assert.equal(Object.hasOwn(received, "contextToken"), false);

  const sent = await service.sendText({
    conversationId: received.conversationId,
    text: "收到",
  });
  assert.equal(sent.status, "sent");
  assert.equal(sentRequest.msg.context_token, "CONTEXT_TOKEN");
  assert.equal(sentRequest.msg.to_user_id, "sender@im.wechat");
  assert.equal(sentRequest.msg.item_list[0].text_item.text, "收到");

  await polled;
  await service.stopMonitoring();
  const storedText = fs.readFileSync(storeFile, "utf8");
  const stored = JSON.parse(storedText);
  assert.equal(stored.updatesBuf, "CURSOR_1");
  assert.equal(stored.credentials.accountId, "fixture@im.bot");
  assert.equal(storedText.includes(token), false);

  const restored = createService();
  await restored.initialize({ autoStart: false });
  assert.equal(restored.getStatus().connected, true);
  assert.equal(restored.getStatus().phase, "stopped");
  assert.equal(restored.getStatus().accountId, "fixture@im.bot");
  await restored.shutdown();
});

test("HTTP authentication failures move a restored bot to session_expired", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-expired-"));
  const storeFile = path.join(tempDir, "weixin-bot.v1.json");
  const encrypt = (value) => Buffer.from(`sealed:${value}`, "utf8").toString("base64");
  fs.writeFileSync(storeFile, JSON.stringify({
    version: 1,
    settings: { autoReplyEnabled: false, autoReplyText: "消息已收到。" },
    updatesBuf: "",
    credentials: {
      encryptedToken: encrypt("EXPIRED_TOKEN"),
      accountId: "fixture@im.bot",
      userId: "owner@im.wechat",
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
  }));

  const service = new WeixinBotService({
    fetchImpl: async () => jsonResponse({ message: "expired" }, 401),
    storagePath: () => storeFile,
    encryptToken: encrypt,
    decryptToken: (value) => Buffer.from(value, "base64").toString("utf8").replace(/^sealed:/, ""),
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const expired = waitForEvent(service, "status", (value) => value.phase === "session_expired");
  await service.initialize();
  const status = await expired;
  assert.equal(status.connected, true);
  assert.equal(status.monitoring, false);
  assert.equal(status.error, "请重新扫码连接");
});
