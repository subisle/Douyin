const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.BOT_LOCK_PATH = path.join(os.tmpdir(), `weixin-bot-test-runner-${process.pid}.lock`);

const {
  WeixinBotService,
  extractMessagePreview,
  normalizeBaseUrl,
} = require("./weixin-bot");
const { normalizeCdnBaseUrl } = require("./weixin-bot-media");

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
  assert.throws(() => normalizeBaseUrl("https://other.weixin.qq.com"), /非受信任/);
  assert.throws(() => normalizeBaseUrl("https://ilinkai.weixin.qq.com:444"), /不受支持/);
});

test("media CDN accepts only the fixed Weixin HTTPS endpoint", () => {
  assert.equal(
    normalizeCdnBaseUrl("https://novac2c.cdn.weixin.qq.com/c2c/"),
    "https://novac2c.cdn.weixin.qq.com/c2c"
  );
  assert.throws(() => normalizeCdnBaseUrl("http://novac2c.cdn.weixin.qq.com/c2c"), /HTTPS/);
  assert.throws(() => normalizeCdnBaseUrl("https://example.com/c2c"), /白名单/);
  assert.throws(
    () => normalizeCdnBaseUrl("https://novac2c.cdn.weixin.qq.com:444/c2c"),
    /不受支持/
  );
  assert.throws(
    () => normalizeCdnBaseUrl("https://novac2c.cdn.weixin.qq.com/other"),
    /路径无效/
  );
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
        assert.equal(options.redirect, "manual");
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

test("command handlers can reply with text and encrypted image media", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-media-command-"));
  const storeFile = path.join(tempDir, "weixin-bot.v1.json");
  const token = "BOT_MEDIA_TOKEN";
  const sentRequests = [];
  let updatesCalls = 0;

  const fetchImpl = async (url, options = {}) => {
    if (url.includes("get_bot_qrcode")) {
      return jsonResponse({ qrcode: "QR_MEDIA", qrcode_img_content: "https://weixin.qq.com/x/media" });
    }
    if (url.includes("get_qrcode_status")) {
      return jsonResponse({
        status: "confirmed",
        bot_token: token,
        ilink_bot_id: "media@im.bot",
        ilink_user_id: "owner@im.wechat",
        baseurl: "https://ilinkai.weixin.qq.com",
      });
    }
    if (url.includes("getupdates")) {
      updatesCalls += 1;
      if (updatesCalls === 1) {
        return jsonResponse({
          ret: 0,
          get_updates_buf: "MEDIA_CURSOR",
          msgs: [{
            message_id: 202,
            from_user_id: "sender@im.wechat",
            message_type: 1,
            context_token: "MEDIA_CONTEXT",
            item_list: [{ type: 1, text_item: { text: "每日报告" } }],
          }],
        });
      }
      return waitForAbort(options.signal);
    }
    if (url.includes("getuploadurl")) {
      const request = JSON.parse(options.body);
      assert.equal(request.media_type, 1);
      assert.equal(request.to_user_id, "sender@im.wechat");
      return jsonResponse({ ret: 0, upload_param: "UPLOAD_MEDIA_PARAM" });
    }
    if (url.includes("novac2c.cdn.weixin.qq.com/c2c/upload")) {
      assert.ok(Buffer.from(options.body).length > 3);
      assert.equal(options.redirect, "manual");
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === "x-encrypted-param" ? "DOWNLOAD_MEDIA_PARAM" : null },
      };
    }
    if (url.includes("sendmessage")) {
      sentRequests.push(JSON.parse(options.body));
      return jsonResponse({ ret: 0 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const service = new WeixinBotService({
    fetchImpl,
    storagePath: () => storeFile,
    encryptToken: (value) => Buffer.from(`sealed:${value}`, "utf8").toString("base64"),
    decryptToken: (value) => Buffer.from(value, "base64").toString("utf8").replace(/^sealed:/, ""),
    generateQrDataUrl: async () => "data:image/png;base64,MEDIA",
  });
  service.saveSettings({ accessMode: "open" });
  service.setCommandHandler(async (args) => {
    assert.equal(args.text, "每日报告");
    await args.replyText("报告已生成");
    await args.replyImage({ buffer: Buffer.from("PNG", "utf8"), fileName: "report.png" });
    return { handled: true };
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const textReply = waitForEvent(service, "message", (value) => value.direction === "outbound" && value.kind === "text");
  const imageReply = waitForEvent(service, "message", (value) => value.direction === "outbound" && value.kind === "image");
  await service.startLogin();
  await Promise.all([textReply, imageReply]);

  assert.equal(sentRequests.length, 2);
  assert.equal(sentRequests[0].msg.item_list[0].type, 1);
  assert.equal(sentRequests[1].msg.item_list[0].type, 2);
  assert.equal(sentRequests[1].msg.context_token, "MEDIA_CONTEXT");
  assert.equal(sentRequests[1].msg.item_list[0].image_item.media.encrypt_query_param, "DOWNLOAD_MEDIA_PARAM");
});

test("concurrent inbound work stays bound to its Weixin account", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-multi-account-"));
  const storeFile = path.join(tempDir, "weixin-bot.v1.json");
  const requests = [];
  const handlerCalls = [];
  let markAStarted;
  let releaseA;
  const aStarted = new Promise((resolve) => { markAStarted = resolve; });
  const aGate = new Promise((resolve) => { releaseA = resolve; });

  const fetchImpl = async (url, options = {}) => {
    const auth = String(options.headers?.Authorization || "");
    if (url.includes("getuploadurl")) {
      requests.push({ kind: "getuploadurl", url, auth, body: JSON.parse(options.body) });
      return jsonResponse({ ret: 0, upload_param: "UPLOAD_A" });
    }
    if (url.includes("novac2c.cdn.weixin.qq.com/c2c/upload")) {
      requests.push({ kind: "cdn-upload", url, auth });
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === "x-encrypted-param" ? "DOWNLOAD_A" : null },
      };
    }
    if (url.includes("sendmessage")) {
      requests.push({ kind: "sendmessage", url, auth, body: JSON.parse(options.body) });
      return jsonResponse({ ret: 0 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const service = new WeixinBotService({
    fetchImpl,
    storagePath: () => storeFile,
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
  });
  const addAccount = (accountId, token, baseUrl) => {
    service.accounts.set(accountId, {
      accountId,
      credentials: { token, accountId, userId: `${accountId}-owner`, baseUrl, savedAt: new Date().toISOString() },
      encryptedToken: `sealed:${token}`,
      updatesBuf: "",
      monitorController: null,
      monitorPromise: null,
      phase: "stopped",
      lastPollAt: null,
      error: null,
      receivedCount: 0,
      sentCount: 0,
    });
  };
  addAccount("account-a@im.bot", "TOKEN_A", "https://ilinkai.weixin.qq.com");
  addAccount("account-b@im.bot", "TOKEN_B", "https://edge.weixin.qq.com");
  service.activeAccountId = "account-a@im.bot";
  service.saveSettings({ accountId: "account-a@im.bot", accessMode: "open" });
  service.saveSettings({ accountId: "account-b@im.bot", accessMode: "open" });
  service.setCommandHandler(async (args) => {
    handlerCalls.push(args.accountId);
    if (args.accountId === "account-a@im.bot") {
      markAStarted();
      await aGate;
      await args.replyText("reply-a");
      await args.replyImage({ buffer: Buffer.from("PNG-A"), fileName: "a.png" });
    } else {
      await args.replyText("reply-b");
    }
    return { handled: true };
  });
  t.after(async () => {
    releaseA();
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const inbound = (contextToken) => ({
    message_id: 777,
    from_user_id: "shared-user@im.wechat",
    message_type: 1,
    context_token: contextToken,
    create_time_ms: 1_750_000_000_000,
    item_list: [{ type: 1, text_item: { text: "same message" } }],
  });
  const accountA = service.accounts.get("account-a@im.bot");
  const accountB = service.accounts.get("account-b@im.bot");

  const handlingA = service._handleInboundMessage(inbound("CONTEXT_A"), accountA);
  await aStarted;
  await service.setActiveAccount("account-b@im.bot");
  let bFinishedBeforeA = false;
  const handlingB = service._handleInboundMessage(inbound("CONTEXT_B"), accountB)
    .then(() => { bFinishedBeforeA = true; });
  await Promise.race([
    handlingB,
    new Promise((resolve) => setTimeout(resolve, 100)),
  ]);
  releaseA();
  await Promise.all([handlingA, handlingB]);

  assert.equal(bFinishedBeforeA, true, "different accounts must not share a session queue");
  assert.deepEqual(handlerCalls, ["account-a@im.bot", "account-b@im.bot"]);
  assert.equal(service.activeAccountId, "account-b@im.bot", "inbound work must not change the UI selection");

  const sends = requests.filter((item) => item.kind === "sendmessage");
  const replyA = sends.find((item) => item.body.msg.item_list[0]?.text_item?.text === "reply-a");
  const replyB = sends.find((item) => item.body.msg.item_list[0]?.text_item?.text === "reply-b");
  const imageA = sends.find((item) => item.body.msg.item_list[0]?.type === 2);
  const uploadA = requests.find((item) => item.kind === "getuploadurl");
  assert.equal(replyA.auth, "Bearer TOKEN_A");
  assert.match(replyA.url, /^https:\/\/ilinkai\.weixin\.qq\.com\//);
  assert.equal(replyA.body.msg.context_token, "CONTEXT_A");
  assert.equal(replyB.auth, "Bearer TOKEN_B");
  assert.match(replyB.url, /^https:\/\/edge\.weixin\.qq\.com\//);
  assert.equal(replyB.body.msg.context_token, "CONTEXT_B");
  assert.equal(uploadA.auth, "Bearer TOKEN_A");
  assert.match(uploadA.url, /^https:\/\/ilinkai\.weixin\.qq\.com\//);
  assert.equal(imageA.auth, "Bearer TOKEN_A");
  assert.equal(imageA.body.msg.context_token, "CONTEXT_A");

  await service.sendText({
    accountId: "account-a@im.bot",
    conversationId: "shared-user@im.wechat",
    text: "manual-a",
  });
  await service.sendText({ conversationId: "shared-user@im.wechat", text: "manual-active" });
  const manualA = requests.find((item) => item.body?.msg?.item_list?.[0]?.text_item?.text === "manual-a");
  const manualActive = requests.find((item) => item.body?.msg?.item_list?.[0]?.text_item?.text === "manual-active");
  assert.equal(manualA.auth, "Bearer TOKEN_A");
  assert.equal(manualA.body.msg.context_token, "CONTEXT_A");
  assert.equal(manualActive.auth, "Bearer TOKEN_B");
  assert.equal(manualActive.body.msg.context_token, "CONTEXT_B");

  await service._handleInboundMessage(inbound("CONTEXT_A_DUPLICATE"), accountA);
  assert.deepEqual(handlerCalls, ["account-a@im.bot", "account-b@im.bot"]);
  const status = service.getStatus();
  const statusA = status.accounts.find((item) => item.accountId === "account-a@im.bot");
  const statusB = status.accounts.find((item) => item.accountId === "account-b@im.bot");
  assert.deepEqual(
    { received: statusA.receivedCount, sent: statusA.sentCount },
    { received: 1, sent: 3 }
  );
  assert.deepEqual(
    { received: statusB.receivedCount, sent: statusB.sentCount },
    { received: 1, sent: 2 }
  );
  assert.deepEqual(
    new Set(service.getMessages().map((message) => message.accountId)),
    new Set(["account-a@im.bot", "account-b@im.bot"])
  );
  assert.deepEqual(
    service.getContacts().map((contact) => contact.accountId).sort(),
    ["account-a@im.bot", "account-b@im.bot"]
  );
});

test("account ACLs are isolated and file imports require an explicit user allowlist", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-account-acl-"));
  const handlerCalls = [];
  const sentTexts = [];
  const service = new WeixinBotService({
    fetchImpl: async (url, options = {}) => {
      if (!url.includes("sendmessage")) throw new Error(`Unexpected URL: ${url}`);
      const body = JSON.parse(options.body);
      sentTexts.push(body.msg.item_list[0]?.text_item?.text || "");
      return jsonResponse({ ret: 0 });
    },
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
  });
  const addAccount = (accountId) => service.accounts.set(accountId, {
    accountId,
    credentials: {
      token: `TOKEN_${accountId}`,
      accountId,
      userId: `${accountId}-owner`,
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
    encryptedToken: `sealed:TOKEN_${accountId}`,
    updatesBuf: "",
    monitorController: null,
    monitorPromise: null,
    phase: "stopped",
    lastPollAt: null,
    error: null,
    receivedCount: 0,
    sentCount: 0,
  });
  addAccount("acl-a@im.bot");
  addAccount("acl-b@im.bot");
  service.activeAccountId = "acl-a@im.bot";
  service.saveSettings({
    accountId: "acl-a@im.bot",
    accessMode: "allowlist",
    allowUserIds: ["shared-user@im.wechat"],
  });
  service.setCommandHandler(async (args) => {
    handlerCalls.push({ accountId: args.accountId, kind: args.items[0]?.type || 1 });
    return { handled: true };
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const inbound = (messageId, item, contextToken) => ({
    message_id: messageId,
    from_user_id: "shared-user@im.wechat",
    message_type: 1,
    context_token: contextToken,
    create_time_ms: Date.now(),
    item_list: [item],
  });
  await service._handleInboundMessage(
    inbound(1, { type: 1, text_item: { text: "help" } }, "CTX_A"),
    service.accounts.get("acl-a@im.bot")
  );
  await service._handleInboundMessage(
    inbound(2, { type: 1, text_item: { text: "help" } }, "CTX_B"),
    service.accounts.get("acl-b@im.bot")
  );
  assert.deepEqual(handlerCalls, [{ accountId: "acl-a@im.bot", kind: 1 }]);
  assert.match(sentTexts.at(-1), /无权限/);

  service.saveSettings({
    accountId: "acl-a@im.bot",
    accessMode: "open",
    allowUserIds: [],
  });
  await service._handleInboundMessage(
    inbound(3, { type: 4, file_item: { file_name: "data.csv" } }, "CTX_FILE"),
    service.accounts.get("acl-a@im.bot")
  );
  assert.equal(handlerCalls.length, 1, "unauthorized files must be rejected before command handling");
  assert.match(sentTexts.at(-1), /文件导入权限/);
});

test("manual sends cannot bypass a runner lease held elsewhere", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-manual-lease-"));
  let fetchCalls = 0;
  const service = new WeixinBotService({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ ret: 0 });
    },
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
    runnerLock: {
      acquire: () => ({ ok: false, error: "lease occupied" }),
      renew: () => ({ ok: false }),
      release: () => ({ ok: true }),
    },
  });
  const accountId = "paused@im.bot";
  service.accounts.set(accountId, {
    accountId,
    credentials: {
      token: "TOKEN_PAUSED",
      accountId,
      userId: "owner",
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
    encryptedToken: "sealed:TOKEN_PAUSED",
    updatesBuf: "",
    monitorController: null,
    monitorPromise: null,
    phase: "stopped",
    lastPollAt: null,
    error: null,
    receivedCount: 0,
    sentCount: 0,
  });
  service.activeAccountId = accountId;
  service.contexts.set(JSON.stringify([accountId, "user@im.wechat"]), {
    accountId,
    contextToken: "CTX",
    toUserId: "user@im.wechat",
    groupId: "",
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await assert.rejects(
    service.sendText({ conversationId: "user@im.wechat", text: "blocked" }),
    /lease occupied/
  );
  assert.equal(fetchCalls, 0);
});

test("overlapping manual sends hold the shared runner lease until both finish", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-overlap-lease-"));
  const responses = [];
  const calls = { acquire: 0, release: 0 };
  const service = new WeixinBotService({
    fetchImpl: async (url) => {
      if (!url.includes("sendmessage")) throw new Error(`Unexpected URL: ${url}`);
      return new Promise((resolve) => responses.push(resolve));
    },
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
    runnerLock: {
      acquire: () => {
        calls.acquire += 1;
        return { ok: true, file: "LOCK_FILE", lease: { ownerId: "SERVICE_OWNER" } };
      },
      renew: () => ({ ok: true }),
      release: () => {
        calls.release += 1;
        return { ok: true };
      },
    },
  });
  const accountId = "overlap@im.bot";
  service.accounts.set(accountId, {
    accountId,
    credentials: {
      token: "TOKEN_OVERLAP",
      accountId,
      userId: "owner",
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
    encryptedToken: "sealed:TOKEN_OVERLAP",
    updatesBuf: "",
    monitorController: null,
    monitorPromise: null,
    phase: "stopped",
    lastPollAt: null,
    error: null,
    receivedCount: 0,
    sentCount: 0,
  });
  service.activeAccountId = accountId;
  service.contexts.set(JSON.stringify([accountId, "user@im.wechat"]), {
    accountId,
    contextToken: "CTX",
    toUserId: "user@im.wechat",
    groupId: "",
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const first = service.sendText({ conversationId: "user@im.wechat", text: "first" });
  const second = service.sendText({ conversationId: "user@im.wechat", text: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.acquire, 1);
  assert.equal(service.outboundControllers.size, 2);

  responses.shift()(jsonResponse({ ret: 0 }));
  assert.equal((await first).status, "sent");
  assert.equal(calls.release, 0);
  assert.ok(service.runnerLease);

  responses.shift()(jsonResponse({ ret: 0 }));
  assert.equal((await second).status, "sent");
  assert.equal(calls.release, 1);
  assert.equal(service.runnerLease, null);
});

test("runner lease loss aborts an in-flight command before it can reply", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-command-lease-loss-"));
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  let sendCalls = 0;
  const service = new WeixinBotService({
    fetchImpl: async (url) => {
      if (url.includes("sendmessage")) sendCalls += 1;
      throw new Error(`Unexpected URL: ${url}`);
    },
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
  });
  const accountId = "command-loss@im.bot";
  service.accounts.set(accountId, {
    accountId,
    credentials: {
      token: "TOKEN_COMMAND_LOSS",
      accountId,
      userId: "owner",
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
    encryptedToken: "sealed:TOKEN_COMMAND_LOSS",
    updatesBuf: "",
    monitorController: null,
    monitorPromise: null,
    phase: "stopped",
    lastPollAt: null,
    error: null,
    receivedCount: 0,
    sentCount: 0,
  });
  service.saveSettings({ accountId, accessMode: "open", allowUserIds: [] });
  service.runnerLease = { file: "LOCK_FILE", ownerId: "SERVICE_OWNER" };
  service.setCommandHandler(async (args) => {
    entered();
    await waitForAbort(args.signal);
    return { handled: true };
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const pending = service._handleInboundMessage({
    message_id: "command-loss-1",
    from_user_id: "user@im.wechat",
    message_type: 1,
    context_token: "CTX_COMMAND_LOSS",
    item_list: [{ type: 1, text_item: { text: "帮助" } }],
  }, service.accounts.get(accountId));
  await enteredPromise;
  service._handleRunnerLeaseFailure("taken over");

  await assert.rejects(pending, /aborted|租约失效/);
  assert.equal(sendCalls, 0);
  assert.equal(service.getMessages().some((message) => message.status === "sent"), false);
});

test("an old handler cannot reply through a newly acquired runner lease", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-stale-handler-"));
  let entered;
  let resume;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  let sendCalls = 0;
  let leaseNumber = 0;
  const service = new WeixinBotService({
    fetchImpl: async (url) => {
      if (url.includes("sendmessage")) sendCalls += 1;
      return jsonResponse({ ret: 0 });
    },
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
    runnerLock: {
      acquire: () => ({
        ok: true,
        file: "LOCK_FILE",
        lease: { ownerId: `SERVICE_OWNER_${++leaseNumber}` },
      }),
      renew: () => ({ ok: true }),
      release: () => ({ ok: true }),
    },
  });
  const accountId = "stale-handler@im.bot";
  service.accounts.set(accountId, {
    accountId,
    credentials: {
      token: "TOKEN_STALE_HANDLER",
      accountId,
      userId: "owner",
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
    encryptedToken: "sealed:TOKEN_STALE_HANDLER",
    updatesBuf: "",
    monitorController: null,
    monitorPromise: null,
    phase: "stopped",
    lastPollAt: null,
    error: null,
    receivedCount: 0,
    sentCount: 0,
  });
  service.saveSettings({ accountId, accessMode: "open" });
  service._acquireRunnerLease();
  service.setCommandHandler(async (args) => {
    entered();
    await gate;
    await args.replyText("stale reply");
    return { handled: true };
  });
  t.after(async () => {
    resume();
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const pending = service._handleInboundMessage({
    message_id: "stale-handler-1",
    from_user_id: "user@im.wechat",
    message_type: 1,
    context_token: "CTX_STALE_HANDLER",
    item_list: [{ type: 1, text_item: { text: "帮助" } }],
  }, service.accounts.get(accountId));
  await enteredPromise;
  service._handleRunnerLeaseFailure("taken over");
  service._acquireRunnerLease();
  resume();

  await assert.rejects(pending, /租约.*失效/);
  assert.equal(sendCalls, 0);
  assert.equal(leaseNumber, 2);
});

test("stopping an account fences a handler that ignores AbortSignal", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-stop-handler-"));
  let entered;
  let resume;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  let pollCount = 0;
  let releaseCalls = 0;
  const service = new WeixinBotService({
    fetchImpl: async (url, options = {}) => {
      if (url.includes("sendmessage")) return jsonResponse({ ret: 0 });
      if (!url.includes("getupdates")) throw new Error(`Unexpected URL: ${url}`);
      pollCount += 1;
      if (pollCount === 1) {
        return jsonResponse({
          ret: 0,
          get_updates_buf: "CURSOR_AFTER_STOP",
          msgs: [{
            message_id: "stop-handler-1",
            from_user_id: "user@im.wechat",
            message_type: 1,
            context_token: "CTX_STOP_HANDLER",
            item_list: [{ type: 1, text_item: { text: "慢任务" } }],
          }],
        });
      }
      return waitForAbort(options.signal);
    },
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
    runnerLock: {
      acquire: () => ({ ok: true, file: "LOCK_FILE", lease: { ownerId: "SERVICE_OWNER" } }),
      renew: () => ({ ok: true }),
      release: () => {
        releaseCalls += 1;
        return { ok: true };
      },
    },
  });
  const accountId = "stop-handler@im.bot";
  service.accounts.set(accountId, {
    accountId,
    credentials: {
      token: "TOKEN_STOP_HANDLER",
      accountId,
      userId: "owner",
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
    encryptedToken: "sealed:TOKEN_STOP_HANDLER",
    updatesBuf: "",
    monitorController: null,
    monitorPromise: null,
    phase: "stopped",
    lastPollAt: null,
    error: null,
    receivedCount: 0,
    sentCount: 0,
  });
  service.saveSettings({ accountId, accessMode: "open" });
  service.setCommandHandler(async () => {
    entered();
    await gate;
    return { handled: true };
  });
  t.after(async () => {
    resume();
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await service.startMonitoring(accountId);
  await enteredPromise;
  const stopResult = await Promise.race([
    service.stopMonitoring(accountId),
    new Promise((_, reject) => setTimeout(() => reject(new Error("stop timed out")), 100)),
  ]);

  assert.equal(stopResult.monitoring, false);
  assert.equal(service.runnerLease, null);
  assert.equal(releaseCalls, 1);
  assert.equal(service.runnerWorkOperations.size, 1, "stale work remains tracked until it settles");
  assert.equal([...service.runnerWorkOperations.values()][0].controller.signal.aborted, true);

  service.setCommandHandler(async (args) => {
    await args.replyText("new monitor reply");
    return { handled: true };
  });
  const nextMessage = service._handleInboundMessage({
    message_id: "stop-handler-2",
    from_user_id: "user@im.wechat",
    message_type: 1,
    context_token: "CTX_STOP_HANDLER_NEXT",
    item_list: [{ type: 1, text_item: { text: "新任务" } }],
  }, service.accounts.get(accountId));
  await assert.doesNotReject(nextMessage);
  resume();
});

test("runner lease loss fences an in-flight text send", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-send-lease-loss-"));
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const service = new WeixinBotService({
    fetchImpl: async (url, options = {}) => {
      if (!url.includes("sendmessage")) throw new Error(`Unexpected URL: ${url}`);
      entered();
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
  });
  const accountId = "send-loss@im.bot";
  service.accounts.set(accountId, {
    accountId,
    credentials: {
      token: "TOKEN_SEND_LOSS",
      accountId,
      userId: "owner",
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
    encryptedToken: "sealed:TOKEN_SEND_LOSS",
    updatesBuf: "",
    monitorController: null,
    monitorPromise: null,
    phase: "stopped",
    lastPollAt: null,
    error: null,
    receivedCount: 0,
    sentCount: 0,
  });
  service.activeAccountId = accountId;
  service.contexts.set(JSON.stringify([accountId, "user@im.wechat"]), {
    accountId,
    contextToken: "CTX_SEND_LOSS",
    toUserId: "user@im.wechat",
    groupId: "",
  });
  service.runnerLease = { file: "LOCK_FILE", ownerId: "SERVICE_OWNER" };
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const pending = service.sendText({ conversationId: "user@im.wechat", text: "会被中止" });
  await enteredPromise;
  service._handleRunnerLeaseFailure("taken over");

  await assert.rejects(pending, /租约.*失效/);
  assert.equal(service.getMessages().some((message) => message.status === "sent"), false);
  assert.equal(service.outboundControllers.size, 0);
});

test("runner lease loss prevents media upload from reaching sendmessage", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-media-lease-loss-"));
  let uploadEntered;
  const uploadEnteredPromise = new Promise((resolve) => { uploadEntered = resolve; });
  let sendCalls = 0;
  const service = new WeixinBotService({
    fetchImpl: async (url, options = {}) => {
      if (url.includes("getuploadurl")) return jsonResponse({ ret: 0, upload_param: "UPLOAD_PARAM" });
      if (url.includes("/c2c/upload")) {
        uploadEntered();
        return new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      }
      if (url.includes("sendmessage")) {
        sendCalls += 1;
        return jsonResponse({ ret: 0 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
  });
  const accountId = "media-loss@im.bot";
  const account = {
    accountId,
    credentials: {
      token: "TOKEN_MEDIA_LOSS",
      accountId,
      userId: "owner",
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
    encryptedToken: "sealed:TOKEN_MEDIA_LOSS",
    updatesBuf: "",
    monitorController: null,
    monitorPromise: null,
    phase: "stopped",
    lastPollAt: null,
    error: null,
    receivedCount: 0,
    sentCount: 0,
  };
  service.accounts.set(accountId, account);
  service.runnerLease = { file: "LOCK_FILE", ownerId: "SERVICE_OWNER" };
  const context = {
    accountId,
    contextToken: "CTX_MEDIA_LOSS",
    toUserId: "user@im.wechat",
    groupId: "",
  };
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const pending = service._sendMediaWithContext(
    "user@im.wechat",
    { buffer: Buffer.from("media"), fileName: "report.png", mediaKind: "image" },
    context,
    account
  );
  await uploadEnteredPromise;
  service._handleRunnerLeaseFailure("taken over");

  await assert.rejects(pending, /租约.*失效/);
  assert.equal(sendCalls, 0);
  assert.equal(service.outboundControllers.size, 0);
});

test("runner lease is shared, renewed, and released after the last monitor stops", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-runner-lifecycle-"));
  const calls = { acquire: 0, renew: 0, release: 0 };
  const runnerLock = {
    acquire(options) {
      calls.acquire += 1;
      return { ok: true, file: "LOCK_FILE", lease: { ownerId: "SERVICE_OWNER", ...options } };
    },
    renew() {
      calls.renew += 1;
      return { ok: true };
    },
    release(options) {
      calls.release += 1;
      assert.equal(options.file, "LOCK_FILE");
      assert.equal(options.ownerId, "SERVICE_OWNER");
      return { ok: true };
    },
  };
  const service = new WeixinBotService({
    fetchImpl: async (_url, options = {}) => waitForAbort(options.signal),
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
    runnerLock,
    runnerHeartbeatMs: 10,
    runnerLeaseTtlMs: 50,
  });
  for (const accountId of ["lease-a@im.bot", "lease-b@im.bot"]) {
    service.accounts.set(accountId, {
      accountId,
      credentials: {
        token: `TOKEN_${accountId}`,
        accountId,
        userId: "owner",
        baseUrl: "https://ilinkai.weixin.qq.com",
        savedAt: new Date().toISOString(),
      },
      encryptedToken: `sealed:TOKEN_${accountId}`,
      updatesBuf: "",
      monitorController: null,
      monitorPromise: null,
      phase: "stopped",
      lastPollAt: null,
      error: null,
      receivedCount: 0,
      sentCount: 0,
    });
  }
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await service.startMonitoring("lease-a@im.bot");
  await service.startMonitoring("lease-b@im.bot");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(calls.acquire, 1);
  assert.ok(calls.renew >= 1);

  await service.stopMonitoring("lease-a@im.bot");
  assert.equal(calls.release, 0);
  assert.equal(service.accounts.get("lease-b@im.bot").phase, "running");
  await service.stopMonitoring("lease-b@im.bot");
  assert.equal(calls.release, 1);
  assert.equal(service.runnerHeartbeat, null);
});

test("runner lease renewal failure stops every account monitor", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-runner-failure-"));
  let renewCalls = 0;
  let releaseCalls = 0;
  const service = new WeixinBotService({
    fetchImpl: async (_url, options = {}) => waitForAbort(options.signal),
    storagePath: () => path.join(tempDir, "store.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
    runnerHeartbeatMs: 10,
    runnerLeaseTtlMs: 50,
    runnerLock: {
      acquire: () => ({ ok: true, file: "LOCK_FILE", lease: { ownerId: "SERVICE_OWNER" } }),
      renew: () => {
        renewCalls += 1;
        return { ok: false, error: "lease taken over" };
      },
      release: () => {
        releaseCalls += 1;
        return { ok: true };
      },
    },
  });
  for (const accountId of ["failure-a@im.bot", "failure-b@im.bot"]) {
    service.accounts.set(accountId, {
      accountId,
      credentials: {
        token: `TOKEN_${accountId}`,
        accountId,
        userId: "owner",
        baseUrl: "https://ilinkai.weixin.qq.com",
        savedAt: new Date().toISOString(),
      },
      encryptedToken: `sealed:TOKEN_${accountId}`,
      updatesBuf: "",
      monitorController: null,
      monitorPromise: null,
      phase: "stopped",
      lastPollAt: null,
      error: null,
      receivedCount: 0,
      sentCount: 0,
    });
  }
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const failed = waitForEvent(
    service,
    "status",
    (status) => status.error?.includes("lease taken over") && status.monitoring === false
  );
  await service.startMonitoring("failure-a@im.bot");
  await service.startMonitoring("failure-b@im.bot");
  await failed;
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(renewCalls >= 1);
  assert.equal(releaseCalls, 0, "a lease owned by another runner must not be released");
  for (const account of service.getStatus().accounts) {
    assert.equal(account.monitoring, false);
    assert.equal(account.phase, "error");
    assert.match(account.error, /lease taken over/);
  }
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

test("typed iLink session expiry stops polling and marks the account expired", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-bot-typed-expired-"));
  const service = new WeixinBotService({
    fetchImpl: async () => jsonResponse({ ret: -14, errmsg: "expired" }),
    storagePath: () => path.join(tempDir, "weixin-bot.v1.json"),
    encryptToken: (value) => `sealed:${value}`,
    decryptToken: (value) => String(value).replace(/^sealed:/, ""),
  });
  const accountId = "typed-expired@im.bot";
  service.accounts.set(accountId, {
    accountId,
    credentials: {
      token: "EXPIRED_TOKEN",
      accountId,
      userId: "owner@im.wechat",
      baseUrl: "https://ilinkai.weixin.qq.com",
      savedAt: new Date().toISOString(),
    },
    encryptedToken: "sealed:EXPIRED_TOKEN",
    updatesBuf: "",
    monitorController: null,
    monitorPromise: null,
    phase: "stopped",
    lastPollAt: null,
    error: null,
    receivedCount: 0,
    sentCount: 0,
  });
  service.activeAccountId = accountId;
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const expired = waitForEvent(service, "status", (value) => value.phase === "session_expired");
  await service.startMonitoring(accountId);
  const status = await expired;

  assert.equal(status.monitoring, false);
  assert.equal(status.error, "请重新扫码连接");
  assert.equal(status.accounts[0].phase, "session_expired");
});
