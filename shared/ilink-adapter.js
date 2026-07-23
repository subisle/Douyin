"use strict";

const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_CHANNEL_VERSION = "1.0.2";
const DEFAULT_TIMEOUT_MS = 15_000;
// iLink responses contain message metadata, not media bytes. Keep the parser
// bounded so a compromised endpoint cannot make a worker retain an unbounded
// response body.
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SESSION_EXPIRED_CODE = -14;

const TRUSTED_ILINK_API_HOSTS = new Set([
  "ilinkai.weixin.qq.com",
  "edge.weixin.qq.com",
]);

const API_ROUTES = Object.freeze({
  get_bot_qrcode: Object.freeze({
    method: "GET",
    queryKeys: Object.freeze(["bot_type"]),
    requiredQueryKeys: Object.freeze(["bot_type"]),
  }),
  get_qrcode_status: Object.freeze({
    method: "GET",
    queryKeys: Object.freeze(["qrcode"]),
    requiredQueryKeys: Object.freeze(["qrcode"]),
  }),
  getupdates: Object.freeze({ method: "POST", queryKeys: Object.freeze([]) }),
  getuploadurl: Object.freeze({ method: "POST", queryKeys: Object.freeze([]) }),
  sendmessage: Object.freeze({ method: "POST", queryKeys: Object.freeze([]) }),
});

class IlinkError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

class IlinkProtocolError extends IlinkError {
  constructor(message, options = {}) {
    super(message, options);
    this.code = options.code;
  }
}

class IlinkHttpError extends IlinkError {
  constructor(status, route, options = {}) {
    const suffix = options.statusText ? ` ${String(options.statusText).trim()}` : "";
    super(`微信接口 HTTP ${status}${suffix}`);
    this.status = Number(status);
    this.route = route || null;
    this.response = options.response;
  }
}

class IlinkResponseTooLargeError extends IlinkProtocolError {
  constructor(actualBytes, maxBytes) {
    super(`微信接口响应体超过大小上限（${actualBytes} > ${maxBytes} 字节）`, {
      code: "ILINK_RESPONSE_TOO_LARGE",
    });
    this.actualBytes = actualBytes;
    this.maxBytes = maxBytes;
  }
}

class IlinkSessionExpiredError extends IlinkProtocolError {
  constructor(response = {}) {
    super("微信登录已过期，请重新扫码连接", { code: SESSION_EXPIRED_CODE });
    const safeResponse = isRecord(response)
      ? {
        ...(Object.hasOwn(response, "errcode") ? { errcode: response.errcode } : {}),
        ...(Object.hasOwn(response, "ret") ? { ret: response.ret } : {}),
        errmsg: String(response.errmsg || "").slice(0, 200),
      }
      : {};
    this.errcode = SESSION_EXPIRED_CODE;
    this.ret = SESSION_EXPIRED_CODE;
    this.code = SESSION_EXPIRED_CODE;
    this.response = safeResponse;
  }
}

function createAbortError(message = "微信接口请求已取消") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return Boolean(error && (error.name === "AbortError" || error.code === "ABORT_ERR"));
}

function randomWechatUin() {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function asFinitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function asByteLimit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(String(value || DEFAULT_BASE_URL));
  } catch {
    throw new Error("微信接口地址无效");
  }
  if (url.protocol !== "https:") throw new Error("微信接口地址必须使用 HTTPS");
  if (!TRUSTED_ILINK_API_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("微信接口地址是非受信任的 iLink 主机");
  }
  // URL normalises an explicit :443 to an empty port. Other ports remain
  // visible and are rejected to prevent origin expansion.
  if (url.port || url.username || url.password || url.search || url.hash) {
    throw new Error("微信接口地址包含不受支持的端口、凭据或参数");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeRoute(endpoint) {
  const raw = String(endpoint || "").trim();
  const route = raw.replace(/^\/+/, "");
  const match = route.match(/^(?:ilink\/bot\/)?([^/]+)$/);
  if (!match || !Object.prototype.hasOwnProperty.call(API_ROUTES, match[1])) {
    throw new Error("微信接口路由不在允许列表中");
  }
  return match[1];
}

function basePathFromUrl(value) {
  const url = value instanceof URL ? value : new URL(normalizeBaseUrl(value));
  const path = String(url.pathname || "").replace(/\/+$/, "");
  return path === "/" ? "" : path;
}

function joinApiPath(basePath, route) {
  const prefix = String(basePath || "").replace(/\/+$/, "");
  return `${prefix}/ilink/bot/${route}`;
}

function routeForPath(pathname, expectedBasePath = "") {
  const prefix = String(expectedBasePath || "").replace(/\/+$/, "");
  const suffix = joinApiPath(prefix, "").replace(/\/$/, "");
  const match = String(pathname || "").match(
    new RegExp(`^${escapeRegExp(suffix)}/([^/]+)$`)
  );
  if (!match) throw new Error("微信接口路径不在允许列表中");
  return normalizeRoute(match[1]);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildApiUrl(baseUrl, endpoint, query) {
  const normalized = normalizeBaseUrl(baseUrl);
  const route = normalizeRoute(endpoint);
  const url = new URL(normalized);
  // The returned baseurl may contain a legacy path. Keep that path stable and
  // append only the fixed protocol suffix; callers cannot select another API
  // path through this helper.
  url.pathname = joinApiPath(basePathFromUrl(url), route);
  url.search = "";
  url.hash = "";
  if (query != null) {
    if (!isRecord(query)) throw new Error("微信接口查询参数必须是对象");
    for (const [key, value] of Object.entries(query)) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function headerEntries(headers) {
  if (!headers) return [];
  if (typeof headers.entries === "function") return [...headers.entries()];
  if (isRecord(headers)) return Object.entries(headers);
  return [];
}

function getHeader(headers, name) {
  const wanted = String(name).toLowerCase();
  if (!headers) return null;
  if (typeof headers.get === "function") {
    const value = headers.get(name);
    return value == null ? null : String(value);
  }
  for (const [key, value] of headerEntries(headers)) {
    if (String(key).toLowerCase() === wanted) return value == null ? null : String(value);
  }
  return null;
}

function setHeader(headers, name, value) {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  if (existing && existing !== name) delete headers[existing];
  headers[name] = String(value);
}

function removeHeader(headers, name) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  }
}

function cloneHeaders(headers) {
  const result = {};
  for (const [key, value] of headerEntries(headers)) {
    if (value == null) continue;
    result[String(key)] = String(value);
  }
  return result;
}

function bodyByteLength(body) {
  if (body == null) return 0;
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  if (Buffer.isBuffer(body)) return body.length;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (typeof body.byteLength === "number" && Number.isFinite(body.byteLength)) {
    return Math.max(0, Number(body.byteLength));
  }
  return Buffer.byteLength(String(body), "utf8");
}

function parseContentLength(value) {
  if (value == null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) throw new Error("微信接口响应 Content-Length 无效");
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) throw new Error("微信接口响应 Content-Length 无效");
  return length;
}

function chunkToBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (chunk instanceof ArrayBuffer) return Buffer.from(new Uint8Array(chunk));
  return Buffer.from(String(chunk ?? ""), "utf8");
}

async function readResponseText(response, maxBytes) {
  const declared = parseContentLength(getHeader(response?.headers, "content-length"));
  if (declared != null && declared > maxBytes) {
    try {
      await response?.body?.cancel?.();
    } catch {
      // A size rejection must not be hidden by stream cleanup failures.
    }
    throw new IlinkResponseTooLargeError(declared, maxBytes);
  }

  const chunks = [];
  let total = 0;
  const append = (chunk) => {
    const buffer = chunkToBuffer(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new IlinkResponseTooLargeError(total, maxBytes);
    if (buffer.length) chunks.push(buffer);
  };

  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        append(part.value);
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // The original read/size error is more useful to callers.
      }
      throw error;
    } finally {
      try {
        reader.releaseLock?.();
      } catch {
        // Some test doubles do not implement releaseLock.
      }
    }
  } else if (response?.body && typeof response.body[Symbol.asyncIterator] === "function") {
    try {
      for await (const chunk of response.body) append(chunk);
    } catch (error) {
      throw error;
    }
  } else if (typeof response?.text === "function") {
    append(await response.text());
  } else {
    throw new Error("微信接口响应缺少正文读取方法");
  }

  return Buffer.concat(chunks).toString("utf8");
}

function responseIsOk(response) {
  if (typeof response?.ok === "boolean") return response.ok;
  const status = Number(response?.status);
  return Number.isFinite(status) && status >= 200 && status < 300;
}

function responseStatus(response) {
  const status = Number(response?.status);
  return Number.isFinite(status) && status > 0 ? status : 0;
}

function sessionCode(value) {
  if (value == null || value === "") return null;
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

function throwForSessionExpired(payload) {
  if (!isRecord(payload)) return;
  const errcode = sessionCode(payload.errcode);
  const ret = sessionCode(payload.ret);
  if (errcode === SESSION_EXPIRED_CODE || ret === SESSION_EXPIRED_CODE) {
    throw new IlinkSessionExpiredError(payload);
  }
}

function validateRouteQuery(url, route) {
  const descriptor = API_ROUTES[route];
  const keys = new Set(descriptor.queryKeys);
  const seen = new Set();
  for (const [key] of url.searchParams) {
    if (!keys.has(key) || seen.has(key)) {
      throw new Error("微信接口查询参数不在允许列表中");
    }
    seen.add(key);
  }
  for (const key of descriptor.requiredQueryKeys || []) {
    if (!seen.has(key) || !String(url.searchParams.get(key) || "").trim()) {
      throw new Error("微信接口缺少必需查询参数");
    }
  }
  if (route === "get_bot_qrcode" && url.searchParams.get("bot_type") !== "3") {
    throw new Error("微信二维码 bot_type 不受支持");
  }
}

function validateApiUrl(value, method, expectedBaseUrl = DEFAULT_BASE_URL) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(String(value));
  } catch {
    throw new Error("微信接口 URL 无效");
  }
  const expected = new URL(normalizeBaseUrl(expectedBaseUrl));
  if (url.protocol !== "https:") throw new Error("微信接口请求必须使用 HTTPS");
  if (!TRUSTED_ILINK_API_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("微信接口请求主机不是受信任的 iLink 主机");
  }
  if (url.port || url.username || url.password || url.hash) {
    throw new Error("微信接口请求包含不受支持的端口、凭据或片段");
  }
  if (url.origin !== expected.origin) {
    throw new Error("微信接口请求 origin 与 baseUrl 不匹配");
  }
  const route = routeForPath(url.pathname, basePathFromUrl(expected));
  const expectedMethod = API_ROUTES[route].method;
  if (method !== expectedMethod) {
    throw new Error(`微信接口路由 ${route} 不允许使用 ${method} 方法`);
  }
  validateRouteQuery(url, route);
  return { url, route };
}

function tokenFromOptions(options) {
  return String(options.token ?? options.accessToken ?? "").trim();
}

function baseUrlFromOptions(adapter, options) {
  return options.baseUrl ?? options.baseurl ?? adapter.baseUrl;
}

function normalizeHighLevelOptions(first, second, third, fourth) {
  if (isRecord(first)) return { ...first };
  return {
    baseUrl: first,
    token: second,
    payload: third,
    ...(isRecord(fourth) ? fourth : {}),
  };
}

class IlinkAdapter {
  constructor(options = {}) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") throw new Error("iLink Adapter 需要可用的 fetch 实现");
    this.fetchImpl = fetchImpl;
    this.randomUin = typeof options.randomUin === "function" ? options.randomUin : randomWechatUin;
    this.timeoutMs = asFinitePositive(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.channelVersion = String(options.channelVersion || DEFAULT_CHANNEL_VERSION).trim();
    if (!this.channelVersion) throw new Error("iLink channel version 不能为空");
    this.maxResponseBytes = asByteLimit(
      options.maxResponseBytes ?? options.responseBodyLimitBytes ?? options.maxBodyBytes,
      DEFAULT_MAX_RESPONSE_BYTES
    );
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  }

  async fetchJson(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const expectedBaseUrl = options.baseUrl ?? this.baseUrl;
    const { url: validatedUrl, route } = validateApiUrl(url, method, expectedBaseUrl);
    const parentSignal = options.signal;
    if (parentSignal?.aborted) throw createAbortError("微信接口请求已取消");

    const headers = cloneHeaders(options.headers);
    const body = options.body;
    if (body == null) {
      removeHeader(headers, "content-length");
    } else {
      // Content-Length is always derived from the bytes actually sent. This
      // prevents a caller-supplied value from smuggling a second framing.
      removeHeader(headers, "content-length");
      setHeader(headers, "Content-Length", bodyByteLength(body));
    }

    const controller = new AbortController();
    let timedOut = false;
    let parentAborted = false;
    let timer;
    let removeParentListener = () => {};

    const operation = (async () => {
      const response = await this.fetchImpl(validatedUrl.toString(), {
        method,
        headers,
        ...(body == null ? {} : { body }),
        signal: controller.signal,
        redirect: "manual",
      });
      const maxBytes = asByteLimit(options.maxResponseBytes, this.maxResponseBytes);
      const text = await readResponseText(response, maxBytes);
      let payload;
      let parsed = false;
      if (text.trim()) {
        try {
          payload = JSON.parse(text);
          parsed = true;
        } catch {
          // Preserve the upstream HTTP status for non-2xx responses whose
          // body is not JSON; successful responses still fail as protocol data.
        }
      }
      if (!responseIsOk(response)) {
        if (parsed) throwForSessionExpired(payload);
        throw new IlinkHttpError(responseStatus(response), route, {
          statusText: response?.statusText,
          response,
        });
      }
      if (!text.trim()) return {};
      if (!parsed) {
        throw new IlinkProtocolError("微信接口返回了无效 JSON", { code: "ILINK_INVALID_JSON" });
      }
      throwForSessionExpired(payload);
      return payload;
    })();

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        const error = createAbortError("微信接口请求超时");
        error.code = "ILINK_TIMEOUT";
        try {
          controller.abort(error);
        } catch {
          controller.abort();
        }
        reject(error);
      }, Math.max(1, asFinitePositive(options.timeoutMs, this.timeoutMs)));
    });

    let parentPromise = null;
    if (parentSignal) {
      parentPromise = new Promise((_, reject) => {
        let handled = false;
        const onParentAbort = () => {
          if (handled) return;
          handled = true;
          parentAborted = true;
          const error = createAbortError("微信接口请求已取消");
          try {
            controller.abort(parentSignal.reason || error);
          } catch {
            controller.abort();
          }
          reject(error);
        };
        removeParentListener = () => parentSignal.removeEventListener("abort", onParentAbort);
        parentSignal.addEventListener("abort", onParentAbort, { once: true });
        if (parentSignal.aborted) onParentAbort();
      });
    }

    try {
      const racers = parentPromise ? [operation, timeoutPromise, parentPromise] : [operation, timeoutPromise];
      return await Promise.race(racers);
    } catch (error) {
      if (timedOut) {
        if (options.allowTimeout) return null;
        if (isAbortError(error) || error.code === "ILINK_TIMEOUT") {
          const timeoutError = error.code === "ILINK_TIMEOUT" ? error : createAbortError("微信接口请求超时");
          timeoutError.code = "ILINK_TIMEOUT";
          throw timeoutError;
        }
      }
      if (parentAborted) throw isAbortError(error) ? error : createAbortError("微信接口请求已取消");
      throw error;
    } finally {
      clearTimeout(timer);
      removeParentListener();
      // Abort an in-flight fetch/body read when the other side of the race
      // completed. This is harmless after completion and bounds background IO.
      if (timedOut || parentAborted) {
        try {
          controller.abort();
        } catch {
          // Ignore an already-aborted controller.
        }
      }
    }
  }

  async getJson(url, options = {}) {
    return this.fetchJson(url, {
      ...options,
      method: "GET",
    });
  }

  async postJson(baseUrl, endpoint, body, options = {}) {
    const route = normalizeRoute(endpoint);
    const input = isRecord(body) ? body : {};
    const payload = {
      ...input,
      base_info: {
        ...(isRecord(input.base_info) ? input.base_info : {}),
        channel_version: this.channelVersion,
      },
    };
    let bodyText;
    try {
      bodyText = JSON.stringify(payload);
    } catch {
      throw new Error("微信接口请求体无法序列化为 JSON");
    }
    const headers = cloneHeaders(options.headers);
    removeHeader(headers, "content-length");
    removeHeader(headers, "content-type");
    removeHeader(headers, "authorization");
    removeHeader(headers, "authorizationtype");
    removeHeader(headers, "x-wechat-uin");
    setHeader(headers, "Content-Type", "application/json");
    setHeader(headers, "Content-Length", Buffer.byteLength(bodyText, "utf8"));
    setHeader(headers, "AuthorizationType", "ilink_bot_token");
    setHeader(headers, "X-WECHAT-UIN", this.randomUin());
    const token = tokenFromOptions(options);
    if (token) headers.Authorization = `Bearer ${token}`;
    else removeHeader(headers, "authorization");

    const requestBaseUrl = normalizeBaseUrl(baseUrl ?? this.baseUrl);
    return this.fetchJson(buildApiUrl(requestBaseUrl, route), {
      ...options,
      baseUrl: requestBaseUrl,
      method: "POST",
      headers,
      body: bodyText,
    });
  }

  async getBotQrCode(options = {}) {
    const config = typeof options === "string" ? { baseUrl: options } : { ...options };
    const botType = String(config.botType ?? config.bot_type ?? "3");
    const url = buildApiUrl(baseUrlFromOptions(this, config), "get_bot_qrcode", { bot_type: botType });
    return this.getJson(url, { ...config, baseUrl: baseUrlFromOptions(this, config) });
  }

  async getQrCodeStatus(qrcodeOrOptions, maybeOptions = {}) {
    const config = isRecord(qrcodeOrOptions)
      ? { ...qrcodeOrOptions }
      : { ...maybeOptions, qrcode: qrcodeOrOptions };
    const qrcode = String(config.qrcode ?? config.qrCode ?? "").trim();
    if (!qrcode) throw new Error("微信二维码标识不能为空");
    const url = buildApiUrl(baseUrlFromOptions(this, config), "get_qrcode_status", { qrcode });
    return this.getJson(url, { ...config, baseUrl: baseUrlFromOptions(this, config) });
  }

  async getUpdates(baseUrlOrOptions, token, cursor, options) {
    const config = normalizeHighLevelOptions(baseUrlOrOptions, token, cursor, options);
    const updatesBuf = String(
      config.cursor ?? config.updatesBuf ?? config.get_updates_buf ?? config.payload ?? ""
    );
    return this.postJson(baseUrlFromOptions(this, config), "getupdates", {
      get_updates_buf: updatesBuf,
    }, config);
  }

  async getUploadUrl(baseUrlOrOptions, token, payload, options) {
    const config = normalizeHighLevelOptions(baseUrlOrOptions, token, payload, options);
    const requestPayload = config.payload ?? config.body ?? config.request ?? {};
    return this.postJson(baseUrlFromOptions(this, config), "getuploadurl", requestPayload, config);
  }

  async sendMessage(baseUrlOrOptions, token, message, options) {
    const config = normalizeHighLevelOptions(baseUrlOrOptions, token, message, options);
    const msg = config.msg ?? config.message ?? config.payload;
    if (!isRecord(msg)) throw new Error("微信发送消息缺少有效 msg");
    return this.postJson(baseUrlFromOptions(this, config), "sendmessage", { msg }, config);
  }
}

module.exports = {
  API_ROUTES,
  DEFAULT_BASE_URL,
  DEFAULT_CHANNEL_VERSION,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  IlinkAdapter,
  ILinkAdapter: IlinkAdapter,
  IlinkError,
  IlinkHttpError,
  IlinkProtocolError,
  IlinkResponseTooLargeError,
  IlinkSessionExpiredError,
  ILinkSessionExpiredError: IlinkSessionExpiredError,
  SessionExpiredError: IlinkSessionExpiredError,
  SESSION_EXPIRED_CODE,
  buildApiUrl,
  createAbortError,
  isAbortError,
  normalizeBaseUrl,
  normalizeRoute,
  randomWechatUin,
};
