"use strict";

const fs = require("fs");
const path = require("path");
const { createProjectBots } = require("../../../electron/project-bots.js");
const { resolveRuntimeDir } = require("../../../electron/local-paths.js");
const { resolveBuiltinConfigDir } = require("../../../electron/builtin-config.js");
const { discoverQqBotConfigs } = require("../../../electron/qq-bot-configs.js");
const { encryptToken, decryptToken } = require("./store-crypto.js");

/**
 * Next 会把本模块分别打进 instrumentation 与各 route chunk，形成多份副本。
 * 若各自持有 state，就会各建一套机器人（重复连接微信/QQ）。用 globalThis 共享单例。
 */
const GLOBAL_KEY = Symbol.for("douyin.project-bots.runtime");

function sharedState() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = { starting: null, state: null };
  }
  return globalThis[GLOBAL_KEY];
}

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
  const shared = sharedState();
  if (shared.state) return shared.state;
  if (shared.starting) return shared.starting;

  if (shouldSkipProjectBots(options.env || process.env)) {
    console.log("[project-bots] skipped (desktop 或 PROJECT_BOTS=0)");
    return null;
  }

  shared.starting = (async () => {
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

    const weixinStore = resolveBotStorePath("weixin", { env, runtimeDir });
    const qqStore = resolveBotStorePath("qq", { env, runtimeDir });
    // 启动诊断：机器人起不来时，先看这行就能定位是配置目录 / 存储路径的问题
    console.log(
      `[project-bots] 诊断 cwd=${process.cwd()} runtimeDir=${runtimeDir} builtinDir=${builtinDir} ` +
      `微信存储=${weixinStore} QQ 配置=${qqConfigs.length} 个`
    );

    const bots = createProjectBots({
      weixinStoragePath: () => weixinStore,
      qqStoragePath: () => qqStore,
      qqBots: () => (qqConfigs.length
        ? qqConfigs
        : [{ key: "default", label: "default", storagePath: qqStore }]),
      encryptToken: (plain) => encryptToken(plain),
      decryptToken: (payload) => decryptToken(payload),
      db: require("../../../electron/db.js"),
      renderReportPng: require("../../../electron/weixin-bot-report.js").renderDailyReportPng,
      runner: "server",
      runnerOwnerId: `${require("os").hostname()}:${process.pid}`,
      logger: console,
    });

    await bots.initialize({ autoStart: options.autoStart !== false });
    shared.state = bots;
    console.log(`[project-bots] weixin + ${bots.qqBots.length} 个 QQ 机器人已启动`);
    return shared.state;
  })();

  try {
    return await shared.starting;
  } catch (error) {
    shared.starting = null;
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
  const shared = sharedState();
  if (shared.state) return shared.state;
  return startProjectBots();
}

async function stopProjectBots() {
  const shared = sharedState();
  const current = shared.state;
  shared.state = null;
  shared.starting = null;
  if (current) await current.shutdown();
}

module.exports = {
  shouldSkipProjectBots,
  startProjectBots,
  getProjectBots,
  stopProjectBots,
  resolveBotStorePath,
};
