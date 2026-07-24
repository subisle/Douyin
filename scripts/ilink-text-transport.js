"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");
const {
  IlinkAdapter,
  isAbortError,
  IlinkSessionExpiredError,
} = require("../shared/ilink-adapter");

function truthy(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function loadTransportConfig({ env = process.env, overrides = {} } = {}) {
  const enabled = overrides.enabled ?? truthy(env.BOT_ILINK_ENABLED);
  const token = String(overrides.token ?? env.BOT_ILINK_TOKEN ?? "").trim();
  const baseUrl = String(
    overrides.baseUrl ?? env.BOT_ILINK_BASE_URL ?? "https://ilinkai.weixin.qq.com"
  ).trim();
  const accountId = String(overrides.accountId ?? env.BOT_ILINK_ACCOUNT_ID ?? "").trim();
  const ackText =
    overrides.ackText !== undefined
      ? String(overrides.ackText)
      : env.BOT_ILINK_ACK_TEXT !== undefined
        ? String(env.BOT_ILINK_ACK_TEXT)
        : "收到";
  const cursorPath = String(overrides.cursorPath ?? env.BOT_ILINK_CURSOR_PATH ?? "").trim();
  let updatesBuf = String(overrides.updatesBuf ?? env.BOT_ILINK_CURSOR ?? "").trim();
  if (!updatesBuf && cursorPath && fs.existsSync(cursorPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cursorPath, "utf8"));
      updatesBuf = String(parsed?.updatesBuf || "");
    } catch {
      // ignore corrupt cursor file; start empty
    }
  }
  const pollTimeoutMs =
    Number(overrides.pollTimeoutMs ?? env.BOT_ILINK_POLL_TIMEOUT_MS) || 35_000;
  return {
    enabled,
    token,
    baseUrl,
    accountId,
    updatesBuf,
    cursorPath,
    ackText,
    pollTimeoutMs,
  };
}

function extractText(message) {
  const items = Array.isArray(message?.item_list) ? message.item_list : [];
  for (const item of items) {
    if (Number(item?.type) === 1) {
      const text = String(item?.text_item?.text || "").trim();
      if (text) return text;
    }
  }
  return "";
}

function createIlinkTextTransport(options = {}) {
  const loaded = loadTransportConfig({
    env: options.env,
    overrides: options.config || {},
  });
  const config = { ...loaded, ...(options.config || {}) };
  const adapter =
    options.adapter ||
    new IlinkAdapter({
      fetchImpl: options.fetchImpl,
      timeoutMs: config.pollTimeoutMs,
    });
  const sleep =
    options.sleep ||
    ((ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        const timer = setTimeout(resolve, ms);
        const onAbort = () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      }));
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
  const onText =
    typeof options.onText === "function"
      ? options.onText
      : async () => (config.ackText ? config.ackText : "");

  let controller = null;
  let loopPromise = null;
  let state = {
    phase: "stopped",
    updatesBuf: config.updatesBuf || "",
    accountId: config.accountId || null,
    lastPollAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastError: null,
    receivedCount: 0,
    sentCount: 0,
  };

  function snapshot() {
    return { ...state };
  }

  function setState(patch) {
    state = { ...state, ...patch };
    onEvent({ type: "state", state: snapshot() });
    return snapshot();
  }

  function persistCursor() {
    if (!config.cursorPath) return;
    const absolute = path.resolve(config.cursorPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const tmp = `${absolute}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ updatesBuf: state.updatesBuf }, null, 2),
      { mode: 0o600 }
    );
    fs.renameSync(tmp, absolute);
  }

  async function sendText({ toUserId, contextToken, groupId, text }) {
    const clientId = `worker-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const msg = {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 1, text_item: { text } }],
      ...(groupId ? { group_id: groupId } : {}),
    };
    const response = await adapter.sendMessage({
      baseUrl: config.baseUrl,
      token: config.token,
      msg,
      signal: controller?.signal,
      timeoutMs: Math.min(config.pollTimeoutMs, 15_000),
    });
    const code = Number(response?.errcode ?? response?.ret ?? 0);
    if (code !== 0) {
      throw new Error(
        `微信发送消息失败 (${code}): ${String(response?.errmsg || "未知错误")}`
      );
    }
    setState({
      sentCount: state.sentCount + 1,
      lastOutboundAt: new Date().toISOString(),
    });
    return response;
  }

  async function handleMessage(raw) {
    if (Number(raw?.message_type) !== 1) return;
    const fromUserId = String(raw.from_user_id || "").trim();
    if (!fromUserId) return;
    const text = extractText(raw);
    if (!text) return;
    const contextToken = String(raw.context_token || "").trim();
    const groupId = String(raw.group_id || "").trim();
    setState({
      receivedCount: state.receivedCount + 1,
      lastInboundAt: new Date().toISOString(),
    });
    onEvent({ type: "inbound", text, fromUserId, groupId });
    if (!contextToken) return;
    const reply = await onText({
      text,
      fromUserId,
      groupId,
      contextToken,
      raw,
      sendText,
    });
    const out = String(reply ?? "").trim();
    if (!out) return;
    await sendText({
      toUserId: fromUserId,
      contextToken,
      groupId: groupId || undefined,
      text: out,
    });
  }

  async function pollLoop() {
    let consecutiveFailures = 0;
    let timeoutMs = config.pollTimeoutMs;
    while (controller && !controller.signal.aborted) {
      try {
        const response = await adapter.getUpdates({
          baseUrl: config.baseUrl,
          token: config.token,
          cursor: state.updatesBuf || "",
          signal: controller.signal,
          timeoutMs,
          allowTimeout: true,
        });
        if (controller.signal.aborted) break;
        if (!response) {
          setState({ lastPollAt: new Date().toISOString() });
          continue;
        }
        const code = Number(response.errcode ?? response.ret ?? 0);
        if (code === -14) throw new IlinkSessionExpiredError(response);
        if (code !== 0) {
          throw new Error(
            `微信收取消息失败 (${code}): ${String(response.errmsg || "未知错误")}`
          );
        }

        consecutiveFailures = 0;
        const suggested = Number(response.longpolling_timeout_ms);
        if (Number.isFinite(suggested) && suggested > 0) {
          timeoutMs = Math.min(65_000, Math.max(5_000, suggested + 3_000));
        }

        for (const message of Array.isArray(response.msgs) ? response.msgs : []) {
          if (controller.signal.aborted) break;
          await handleMessage(message);
        }

        const nextBuf = String(response.get_updates_buf || "");
        if (nextBuf && nextBuf !== state.updatesBuf) {
          setState({
            updatesBuf: nextBuf,
            lastPollAt: new Date().toISOString(),
            lastError: null,
          });
          try {
            persistCursor();
          } catch {
            // best-effort
          }
        } else {
          setState({ lastPollAt: new Date().toISOString(), lastError: null });
        }
      } catch (error) {
        if (controller?.signal.aborted || isAbortError(error)) break;
        if (error instanceof IlinkSessionExpiredError || error?.code === -14) {
          setState({ phase: "session_expired", lastError: error.message });
          break;
        }
        consecutiveFailures += 1;
        const backoffMs = consecutiveFailures >= 3 ? 30_000 : 2_000;
        if (consecutiveFailures >= 3) consecutiveFailures = 0;
        setState({ lastError: error.message || String(error) });
        try {
          await sleep(backoffMs, controller.signal);
        } catch {
          break;
        }
      }
    }
    if (state.phase === "polling") setState({ phase: "stopped" });
  }

  async function start() {
    if (!config.enabled) {
      return setState({ phase: "disabled" });
    }
    if (!config.token) {
      return setState({ phase: "not_configured", lastError: "缺少 BOT_ILINK_TOKEN" });
    }
    if (loopPromise) return snapshot();
    controller = new AbortController();
    setState({ phase: "polling", lastError: null });
    loopPromise = pollLoop().finally(() => {
      loopPromise = null;
      controller = null;
    });
    // start returns immediately; poll loop runs in background
    await Promise.resolve();
    return snapshot();
  }

  async function stop() {
    if (controller) controller.abort();
    if (loopPromise) {
      try {
        await loopPromise;
      } catch {
        // ignore
      }
    }
    if (state.phase === "polling" || state.phase === "starting") {
      setState({ phase: "stopped" });
    }
    return snapshot();
  }

  return {
    start,
    stop,
    getState: snapshot,
    sendText,
  };
}

module.exports = {
  createIlinkTextTransport,
  loadTransportConfig,
  extractText,
};
