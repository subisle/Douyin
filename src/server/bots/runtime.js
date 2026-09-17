"use strict";

const fs = require("fs");
const path = require("path");
const { createProjectBots } = require("../../../electron/project-bots.js");
const { resolveRuntimeDir } = require("../../../electron/local-paths.js");
const { resolveBuiltinConfigDir } = require("../../../electron/builtin-config.js");
const { discoverQqBotConfigs } = require("../../../electron/qq-bot-configs.js");
const { encryptToken, decryptToken } = require("./store-crypto.js");

let starting = null;
let state = null;

/**
 * Bot 存储文件解析（服务器侧）：
 * 优先 env 指定 → 内置配置目录 data/builtin（凭据随程序分发）→ 运行时目录。
 * 服务器以前只看运行时目录，导致镜像里内置的微信/QQ 凭据读不到、Bot 起不来。
 */
function resolveBotStorePath(kind, { env = process.env, runtimeDir } = {}) {
  const envKey = kind === "qq" ? "QQ_BOT_STORE" : "WEIXIN_BOT_STORE";
  const fromEnv = String(env[envKey] || "").trim();
  if (fromEnv) return path.resolve(fromEnv);

  const fileName = kind === "qq" ? "qq-bot.v1.json" : "weixin-bot.v1.json";
  try {
    const builtinFile = path.join(resolveBuiltinConfigDir(), fileName);
    if (fs.existsSync(builtinFile)) return builtinFile;
  } catch {
    // 内置目录不可解析时退回运行时目录
  }
  return path.join(runtimeDir, fileName);
}

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
  if (shouldSkipProjectBots(options.env || process.env)) {    console.log("[project-bots] skipped (desktop or PROJECT_BOTS=0)");
    return null;
  }

  starting = (async () => {
    const { applyBuiltInDbEnv } = require("../../../electron/db-config.js");
    applyBuiltInDbEnv();
    const runtimeDir = resolveRuntimeDir();
    const env = options.env || process.env;
    const builtinDir = resolveBuiltinConfigDir();
    const { configs: qqConfigs, skipped } = discoverQqBotConfigs({ env, builtinDir, runtimeDir });
    for (const item of skipped) {
      console.log(`[project-bots] 跳过 QQ 配置 ${item.file}：${item.reason}`);
    }
    if (!qqConfigs.length) {
      console.log("[project-bots] 未发现 QQ 多机器人配置，退回单机器人存储");
    }
    const bots = createProjectBots({
      weixinStoragePath: () => resolveBotStorePath("weixin", { env, runtimeDir }),
      qqStoragePath: () => resolveBotStorePath("qq", { env, runtimeDir }),
      qqBots: () => (qqConfigs.length
        ? qqConfigs
        : [{ key: "default", label: "default", storagePath: resolveBotStorePath("qq", { env, runtimeDir }) }]),
      encryptToken: (plain) => encryptToken(plain),
      decryptToken: (payload) => decryptToken(payload),
      db: require("../../../electron/db.js"),
      renderReportPng: require("../../../electron/weixin-bot-report.js").renderDailyReportPng,
      runner: "server",
      runnerOwnerId: `${require("os").hostname()}:${process.pid}`,
      logger: console,
    });
    await bots.initialize({ autoStart: options.autoStart !== false });
    state = bots;    console.log(
      `[project-bots] weixin + ${bots.qqBots.length} 个 QQ 机器人已启动`
    );
    return state;
  })();

  try {
    return await starting;
  } catch (error) {
    starting = null;    console.error("[project-bots] start failed", error?.message || error);
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
  state = null;  starting = null;
  if (current) await current.shutdown();
}

module.exports = {
  shouldSkipProjectBots,
  startProjectBots,
  getProjectBots,
  stopProjectBots,
  resolveBotStorePath,
};
