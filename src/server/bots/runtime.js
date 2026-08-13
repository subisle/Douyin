"use strict";

const path = require("path");
const { createProjectBots } = require("../../../electron/project-bots.js");
const { resolveRuntimeDir } = require("../../../electron/local-paths.js");
const { encryptToken, decryptToken } = require("./store-crypto.js");

let started = false;
let starting = null;
let state = null;

function truthyEnv(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function falsyEnv(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "0" || text === "false" || text === "no" || text === "off";
}

function shouldSkipProjectBots(env = process.env) {
  if (falsyEnv(env.PROJECT_BOTS) || falsyEnv(env.BOT_EMBEDDED)) return true;
  if (truthyEnv(env.ELECTRON)) return true;
  return false;
}

async function startProjectBots(options = {}) {
  if (state) return state;
  if (starting) return starting;
  if (shouldSkipProjectBots(options.env || process.env)) {
    started = true;
    console.log("[project-bots] skipped (desktop or PROJECT_BOTS=0)");
    return null;
  }

  starting = (async () => {
    const { applyBuiltInDbEnv } = require("../../../electron/db-config.js");
    applyBuiltInDbEnv();
    const runtimeDir = resolveRuntimeDir();
    const bots = createProjectBots({
      weixinStoragePath: () => path.join(runtimeDir, "weixin-bot.v1.json"),
      qqStoragePath: () => path.join(runtimeDir, "qq-bot.v1.json"),
      encryptToken: (plain) => encryptToken(plain),
      decryptToken: (payload) => decryptToken(payload),
      db: require("../../../electron/db.js"),
      renderReportPng: require("../../../electron/weixin-bot-report.js").renderDailyReportPng,
      runner: "server",
      runnerOwnerId: `${require("os").hostname()}:${process.pid}`,
      logger: console,
    });
    await bots.initialize({ autoStart: options.autoStart !== false });
    state = bots;
    started = true;
    console.log("[project-bots] weixin + qq started");
    return state;
  })();

  try {
    return await starting;
  } catch (error) {
    starting = null;
    started = false;
    console.error("[project-bots] start failed", error?.message || error);
    throw error;
  }
}

async function getProjectBots() {
  if (shouldSkipProjectBots()) {
    const error = new Error("当前由桌面端托管机器人，网站进程未启动 Bot");
    error.code = "BOTS_SKIPPED";
    throw error;
  }
  if (state) return state;
  return startProjectBots();
}

async function stopProjectBots() {
  const current = state;
  state = null;
  started = false;
  starting = null;
  if (current) await current.shutdown();
}

module.exports = {
  shouldSkipProjectBots,
  startProjectBots,
  getProjectBots,
  stopProjectBots,
};
