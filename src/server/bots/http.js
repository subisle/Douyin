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
  const [, channel, action, extra] = path;
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
      },
    };
  }

  if (channel === "weixin") {
    const bot = bots.weixinBot;
    const accountId = body.accountId ?? searchParams?.get?.("accountId");
    if (verb === "GET" && !action) return { status: 200, body: bot.getStatus() };
    if (verb === "GET" && action === "messages") return { status: 200, body: bot.getMessages() };
    if (verb === "GET" && action === "settings") return { status: 200, body: bot.getSettings(accountId) };
    if (verb === "POST" && action === "login" && extra === "cancel") {
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
    if (verb === "POST" && action === "messages" && extra === "clear") {
      return { status: 200, body: bot.clearMessages() };
    }
  }

  if (channel === "qq") {
    const bot = bots.qqBot;
    if (verb === "GET" && !action) return { status: 200, body: bot.getStatus() };
    if (verb === "GET" && action === "messages") return { status: 200, body: bot.getMessages() };
    if (verb === "GET" && action === "settings") return { status: 200, body: bot.getSettings() };
    if (verb === "POST" && action === "settings") return { status: 200, body: bot.saveSettings(body || {}) };
    if (verb === "POST" && action === "connect") return { status: 200, body: await bot.connect() };
    if (verb === "POST" && action === "disconnect") return { status: 200, body: await bot.disconnect() };
    if (verb === "POST" && action === "messages" && extra === "clear") {
      return { status: 200, body: bot.clearMessages() };
    }
  }

  return { status: 404, body: { error: `接口不存在：${verb} /api/v1/${path.join("/")}` } };
}

module.exports = {
  handleBotsRequest,
};
