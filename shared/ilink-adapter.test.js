"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_MAX_RESPONSE_BYTES,
  IlinkAdapter,
  IlinkHttpError,
  IlinkResponseTooLargeError,
  IlinkSessionExpiredError,
  buildApiUrl,
  normalizeBaseUrl,
} = require("./ilink-adapter");

function jsonResponse(body, status = 200, headers = {}) {
  const text = JSON.stringify(body);
  const allHeaders = { "content-length": String(Buffer.byteLength(text)), ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 302 ? "Found" : "",
    headers: {
      get(name) {
        return allHeaders[String(name).toLowerCase()] ?? null;
      },
    },
    text: async () => text,
  };
}

function textResponse(text, status = 200, headers = {}) {
  const allHeaders = { "content-length": String(Buffer.byteLength(text)), ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return allHeaders[String(name).toLowerCase()] ?? null;
      },
    },
    text: async () => text,
  };
}

test("normalizeBaseUrl validates trusted HTTPS hosts and preserves legacy path", () => {
  assert.equal(normalizeBaseUrl("https://ilinkai.weixin.qq.com/"), "https://ilinkai.weixin.qq.com");
  assert.equal(
    normalizeBaseUrl("https://edge.weixin.qq.com/legacy/base/"),
    "https://edge.weixin.qq.com/legacy/base"
  );
  assert.throws(() => normalizeBaseUrl("http://ilinkai.weixin.qq.com"), /HTTPS/);
  assert.throws(() => normalizeBaseUrl("https://example.com"), /受信任/);
  assert.throws(() => normalizeBaseUrl("https://edge.weixin.qq.com:444"), /不受支持/);
  assert.throws(() => normalizeBaseUrl("https://user:pass@edge.weixin.qq.com"), /不受支持/);
  assert.throws(() => normalizeBaseUrl("https://edge.weixin.qq.com/?x=1"), /不受支持/);
});

test("buildApiUrl preserves a legacy base path and appends one canonical API suffix", () => {
  assert.equal(
    buildApiUrl("https://edge.weixin.qq.com/legacy/prefix/", "getupdates"),
    "https://edge.weixin.qq.com/legacy/prefix/ilink/bot/getupdates"
  );
  assert.equal(
    buildApiUrl("https://ilinkai.weixin.qq.com", "/ilink/bot/get_qrcode_status", { qrcode: "a/b" }),
    "https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=a%2Fb"
  );
  assert.throws(() => buildApiUrl("https://edge.weixin.qq.com", "../sendmessage"), /路由/);
});

test("POST protocol has an exact route, base_info, byte Content-Length, auth and manual redirect", async () => {
  const calls = [];
  const adapter = new IlinkAdapter({
    randomUin: () => "UIN_FIXTURE",
    channelVersion: "test-channel",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ret: 0 });
    },
  });

  await adapter.postJson("https://edge.weixin.qq.com/legacy", "sendmessage", {
    msg: { item_list: [{ type: 1, text_item: { text: "中文" } }] },
    base_info: { keep: "yes" },
  }, {
    token: "TOKEN",
    headers: {
      "content-length": "1",
      "CONTENT-LENGTH": "2",
      authorization: "Bearer wrong",
    },
  });

  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, "https://edge.weixin.qq.com/legacy/ilink/bot/sendmessage");
  assert.equal(options.method, "POST");
  assert.equal(options.redirect, "manual");
  assert.equal(options.headers.Authorization, "Bearer TOKEN");
  assert.equal(options.headers.AuthorizationType, "ilink_bot_token");
  assert.equal(options.headers["X-WECHAT-UIN"], "UIN_FIXTURE");
  assert.equal(
    Object.keys(options.headers).filter((key) => key.toLowerCase() === "content-length").length,
    1
  );
  assert.equal(
    Object.keys(options.headers).filter((key) => key.toLowerCase() === "authorization").length,
    1
  );
  const body = JSON.parse(options.body);
  assert.deepEqual(body.base_info, { keep: "yes", channel_version: "test-channel" });
  assert.equal(options.headers["Content-Length"], String(Buffer.byteLength(options.body)));
  assert.equal(options.headers["Content-Length"], String(Buffer.byteLength(JSON.stringify(body))));
});

test("GET and POST route/method/query allowlist rejects confused deputy URLs", async () => {
  const adapter = new IlinkAdapter({
    baseUrl: "https://edge.weixin.qq.com",
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(
    adapter.fetchJson("https://edge.weixin.qq.com/ilink/bot/getupdates", { method: "GET" }),
    /不允许使用 GET/
  );
  await assert.rejects(
    adapter.fetchJson("https://edge.weixin.qq.com/ilink/bot/get_bot_qrcode?next=https://example.com", { method: "GET" }),
    /查询参数/
  );
  await assert.rejects(
    adapter.fetchJson("https://edge.weixin.qq.com/legacy/ilink/bot/get_bot_qrcode", { method: "GET" }),
    /路径/
  );
  await adapter.fetchJson("https://edge.weixin.qq.com/legacy/ilink/bot/get_bot_qrcode?bot_type=3", {
    method: "GET",
    baseUrl: "https://edge.weixin.qq.com/legacy",
  });
  await assert.rejects(
    adapter.fetchJson("https://edge.weixin.qq.com/other/ilink/bot/get_bot_qrcode", {
      method: "GET",
      baseUrl: "https://edge.weixin.qq.com/legacy",
    }),
    /路径/
  );
  await assert.rejects(
    adapter.postJson("https://edge.weixin.qq.com", "get_bot_qrcode", {}),
    /不允许使用 POST/
  );
  await assert.rejects(
    adapter.fetchJson("https://edge.weixin.qq.com/ilink/bot/getupdates?x=1", { method: "POST", body: "{}" }),
    /查询参数/
  );
  await assert.rejects(
    adapter.fetchJson("https://edge.weixin.qq.com/ilink/bot/get_qrcode_status", { method: "GET" }),
    /缺少必需查询参数/
  );
  await assert.rejects(
    adapter.fetchJson("https://edge.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=2", { method: "GET" }),
    /bot_type/
  );
  await assert.rejects(
    adapter.fetchJson("https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3", { method: "GET" }),
    /origin 与 baseUrl 不匹配/
  );
});

test("high-level methods use protocol payloads and encode QR query values", async () => {
  const calls = [];
  const adapter = new IlinkAdapter({
    baseUrl: "https://ilinkai.weixin.qq.com/legacy",
    randomUin: () => "UIN",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ret: 0, qrcode: "QR", qrcode_img_content: "fixture" });
    },
  });

  await adapter.getBotQrCode();
  await adapter.getQrCodeStatus("QR /?x");
  await adapter.getUpdates({ token: "T", cursor: "CUR", baseUrl: "https://edge.weixin.qq.com/path" });
  await adapter.getUpdates("https://edge.weixin.qq.com/path", "T", "POSITIONAL_CURSOR");
  await adapter.getUploadUrl("https://edge.weixin.qq.com", "T", { file_size: 3 });
  await adapter.sendMessage({ baseUrl: "https://edge.weixin.qq.com", token: "T", msg: { client_id: "C" } });
  await adapter.sendMessage("https://edge.weixin.qq.com", "T", { client_id: "POSITIONAL" });

  assert.equal(calls[0].url, "https://ilinkai.weixin.qq.com/legacy/ilink/bot/get_bot_qrcode?bot_type=3");
  assert.equal(new URL(calls[1].url).pathname, "/legacy/ilink/bot/get_qrcode_status");
  assert.equal(new URL(calls[1].url).searchParams.get("qrcode"), "QR /?x");
  assert.equal(JSON.parse(calls[2].options.body).get_updates_buf, "CUR");
  assert.equal(JSON.parse(calls[3].options.body).get_updates_buf, "POSITIONAL_CURSOR");
  assert.equal(JSON.parse(calls[4].options.body).file_size, 3);
  assert.deepEqual(JSON.parse(calls[5].options.body).msg, { client_id: "C" });
  assert.deepEqual(JSON.parse(calls[6].options.body).msg, { client_id: "POSITIONAL" });
  for (const call of calls) assert.match(new URL(call.url).pathname, /\/ilink\/bot\/[^/]+$/);
});

test("response Content-Length and actual streamed body are bounded", async () => {
  const declaredTooLarge = new IlinkAdapter({ maxResponseBytes: 4, fetchImpl: async () => textResponse("{}", 200, { "content-length": "5" }) });
  await assert.rejects(declaredTooLarge.getBotQrCode(), IlinkResponseTooLargeError);

  const actualTooLarge = new IlinkAdapter({
    maxResponseBytes: 4,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from("{");
          yield Buffer.from("12345");
        },
      },
    }),
  });
  await assert.rejects(actualTooLarge.getBotQrCode(), IlinkResponseTooLargeError);

  const defaultLimit = new IlinkAdapter({ fetchImpl: async () => textResponse("{}") });
  assert.equal(defaultLimit.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
});

test("timeout covers fetch and response body; allowTimeout only suppresses adapter timeout", async () => {
  const fetchPending = new IlinkAdapter({ timeoutMs: 15, fetchImpl: async (_url, options) => {
    await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
  } });
  await assert.rejects(fetchPending.getBotQrCode(), (error) => error.name === "AbortError" && error.code === "ILINK_TIMEOUT");
  assert.equal(await fetchPending.getBotQrCode({ allowTimeout: true }), null);

  const bodyPending = new IlinkAdapter({ timeoutMs: 15, fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => new Promise(() => {}),
  }) });
  assert.equal(await bodyPending.getBotQrCode({ allowTimeout: true }), null);

  const parent = new AbortController();
  const parentAdapter = new IlinkAdapter({ timeoutMs: 100, fetchImpl: async (_url, options) => {
    await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
  } });
  const pending = parentAdapter.getBotQrCode({ signal: parent.signal, allowTimeout: true });
  parent.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError" && error.code !== "ILINK_TIMEOUT");
});

test("session error -14 is a typed error with a stable code", async () => {
  const adapter = new IlinkAdapter({ fetchImpl: async () => jsonResponse({ errcode: -14, errmsg: "expired" }) });
  await assert.rejects(adapter.getUpdates({ token: "T", cursor: "" }), (error) => {
    assert.equal(error instanceof IlinkSessionExpiredError, true);
    assert.equal(error.code, -14);
    assert.equal(error.errcode, -14);
    assert.match(error.message, /登录已过期/);
    return true;
  });
});

test("either iLink error field can signal session expiry", async () => {
  const adapter = new IlinkAdapter({
    fetchImpl: async () => jsonResponse({ errcode: 0, ret: -14, errmsg: "expired" }),
  });
  await assert.rejects(adapter.getUpdates({ token: "T", cursor: "" }), (error) => {
    assert.equal(error instanceof IlinkSessionExpiredError, true);
    assert.equal(error.ret, -14);
    assert.equal(error.response.ret, -14);
    return true;
  });
});

test("HTTP session error bodies also become typed expiry errors", async () => {
  const adapter = new IlinkAdapter({
    fetchImpl: async () => jsonResponse({ ret: -14, errmsg: "expired" }, 401),
  });
  await assert.rejects(adapter.getUpdates({ token: "T", cursor: "" }), (error) => {
    assert.equal(error instanceof IlinkSessionExpiredError, true);
    assert.equal(error.code, -14);
    assert.equal(error.status, undefined);
    return true;
  });
});

test("HTTP and JSON protocol errors remain readable without exposing credentials", async () => {
  const http = new IlinkAdapter({ fetchImpl: async () => textResponse("redirect", 302) });
  await assert.rejects(http.getBotQrCode(), (error) => {
    assert.equal(error instanceof IlinkHttpError, true);
    assert.match(error.message, /HTTP 302/);
    return true;
  });

  const invalid = new IlinkAdapter({ fetchImpl: async () => textResponse("not-json") });
  await assert.rejects(invalid.getBotQrCode(), /无效 JSON/);

  const secret = new IlinkAdapter({ fetchImpl: async () => textResponse("not-json") });
  await assert.rejects(secret.getQrCodeStatus("TOP_SECRET"), (error) => {
    assert.equal(error.message.includes("TOP_SECRET"), false);
    return true;
  });
});

test("parent signal already aborted is rejected before fetch", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const adapter = new IlinkAdapter({ fetchImpl: async () => { calls += 1; return jsonResponse({}); } });
  await assert.rejects(adapter.getBotQrCode({ signal: controller.signal }), (error) => error.name === "AbortError");
  assert.equal(calls, 0);
});
