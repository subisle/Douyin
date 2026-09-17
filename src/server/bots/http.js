"use strict";

const { getProjectBots, shouldSkipProjectBots } = require("./runtime.js");

function skippedPayload() {
  return {
    error: "当前由桌面端托管机器人，网站进程未启动 Bot",
    code: "BOTS_SKIPPED",
  };
}

async function handleBotsRequest({ method, path = [], body = {}, searchParams }) {
  const verb = String(method || "GET").toUpperCase();
  // path 形如 ["bots","qq","messages","clear"]，这里剥掉首段
  const segments = Array.isArray(path) ? path.slice(1).filter(Boolean) : [];
  const [channel, action, ...rest] = segments;
  if (shouldSkipProjectBots()) {
    return { status: 409, body: skippedPayload() };
  }

  const bots = await getProjectBots();
  if (!bots) {
    return { status: 409, body: skippedPayload() };
  }

  if (!channel) {
    if (verb !== "GET") return { status: 405, body: { error: "方法不允许" } };
    return {
      status: 200,
      body: {
        weixin: bots.weixinBot.getStatus(),
        qq: bots.qqBot.getStatus(),
        qqBots: typeof bots.listQqBotStatuses === "function" ? bots.listQqBotStatuses() : [],
      },
    };
  }

  if (channel === "weixin") {
    const bot = bots.weixinBot;
    const accountId = body.accountId ?? searchParams?.get?.("accountId");
    if (verb === "GET" && !action) return { status: 200, body: bot.getStatus() };
    if (verb === "GET" && action === "messages") return { status: 200, body: bot.getMessages() };
    if (verb === "GET" && action === "settings") return { status: 200, body: bot.getSettings(accountId) };
    if (verb === "POST" && action === "login" && rest[0] === "cancel") {
      return { status: 200, body: await bot.cancelLogin() };
    }
    if (verb === "POST" && action === "login") return { status: 200, body: await bot.startLogin() };
    if (verb === "POST" && action === "start") return { status: 200, body: await bot.startMonitoring(accountId) };
    if (verb === "POST" && action === "stop") return { status: 200, body: await bot.stopMonitoring(accountId) };
    if (verb === "POST" && action === "disconnect") return { status: 200, body: await bot.disconnect(accountId) };
    if (verb === "POST" && action === "active-account") {
      return { status: 200, body: await bot.setActiveAccount(accountId) };
    }
    if (verb === "POST" && action === "send") return { status: 200, body: await bot.sendText(body) };
    if (verb === "POST" && action === "settings") return { status: 200, body: bot.saveSettings(body) };
    if (verb === "POST" && action === "messages" && rest[0] === "clear") {
      return { status: 200, body: bot.clearMessages() };
    }
  }

  if (channel === "qq") {
    const qqBotList = Array.isArray(bots.qqBots) ? bots.qqBots : [];
    const findBot = (key) => qqBotList.find((item) => String(item.key) === String(key))?.service || null;

    // 多机器人：/qq/bots 列出全部；/qq/bots/<key>[/connect|/disconnect|/settings] 单独操作
    if (action === "bots") {
      if (!rest[0]) {
        if (verb !== "GET") return { status: 405, body: { error: "方法不允许" } };
        return {
          status: 200,
          body: typeof bots.listQqBotStatuses === "function" ? bots.listQqBotStatuses() : [],
        };
      }
      const target = findBot(rest[0]);
      if (!target) return { status: 404, body: { error: `未找到 QQ 机器人：${rest[0]}` } };
      return await handleSingleQqBot({ verb, target, sub: rest[1], tail: rest[2], body });
    }

    return await handleSingleQqBot({ verb, target: bots.qqBot, sub: action, tail: rest[0], body });
  }

  return { status: 404, body: { error: `接口不存在：${verb} /api/v1/${path.join("/")}` } };
}

/** 单个 QQ 机器人实例的读写，多实例与默认实例共用同一套动作 */
async function handleSingleQqBot({ verb, target, sub, tail, body = {} }) {
  if (verb === "GET" && !sub) return { status: 200, body: target.getStatus() };
  if (verb === "GET" && sub === "messages") return { status: 200, body: target.getMessages() };
  if (verb === "GET" && sub === "settings") return { status: 200, body: target.getSettings() };
  if (verb === "POST" && sub === "settings") return { status: 200, body: target.saveSettings(body || {}) };
  if (verb === "POST" && sub === "connect") return { status: 200, body: await target.connect() };
  if (verb === "POST" && sub === "disconnect") return { status: 200, body: await target.disconnect() };
  // 兼容两种写法：POST /qq/messages/clear 与 POST /qq/messages {clear:true}
  if (verb === "POST" && sub === "messages" && (tail === "clear" || body?.clear === true)) {
    return { status: 200, body: target.clearMessages() };
  }
  return { status: 404, body: { error: `QQ 机器人动作不存在：${verb} ${sub || ""}`.trim() } };
}

module.exports = {
  handleBotsRequest,
};
