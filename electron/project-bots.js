"use strict";

/**
 * 微信 + QQ 机器人成对装配：同一 Agent / 技能 / 日报，只是传输通道不同。
 * 桌面 Electron 与 Next 网站共用，保证项目启动时两侧一起起来。
 */

const path = require("path");
const { WeixinBotService } = require("./weixin-bot");
const { createWeixinCommandHandler } = require("./weixin-bot-commands");
const { createWeixinBotSkills } = require("./weixin-bot-skills");
const { WeixinBotAgent } = require("./weixin-bot-agent");
const { createWeixinUserMemory } = require("./weixin-bot-user-memory");
const { QqBotService } = require("./qq-bot");
const { resolveUserMemoryPath } = require("./local-paths");

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function compactError(error) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function createProjectBots(options = {}) {
  if (typeof options.weixinStoragePath !== "function") {
    throw new Error("project-bots 缺少 weixinStoragePath");
  }
  if (typeof options.qqStoragePath !== "function") {
    throw new Error("project-bots 缺少 qqStoragePath");
  }
  if (typeof options.encryptToken !== "function" || typeof options.decryptToken !== "function") {
    throw new Error("project-bots 缺少 token 加解密");
  }

  const db = options.db || require("./db");
  const renderReportPng = options.renderReportPng || require("./weixin-bot-report").renderDailyReportPng;
  const logger = options.logger || console;
  const runner = String(options.runner || process.env.BOT_RUNNER || "desktop").trim() || "desktop";

  const weixinBot = new WeixinBotService({
    storagePath: options.weixinStoragePath,
    encryptToken: options.encryptToken,
    decryptToken: options.decryptToken,
    runner,
    runnerOwnerId: options.runnerOwnerId,
    runnerLockFile: options.runnerLockFile,
    db,
    renderReportPng,
  });

  const weixinBotSkills = createWeixinBotSkills({ db, renderReportPng });
  const weixinUserMemory = createWeixinUserMemory({
    storagePath: options.userMemoryPath || (() => resolveUserMemoryPath()),
  });
  const weixinBotAgent = new WeixinBotAgent({
    skills: weixinBotSkills,
    getConfig: () => weixinBot.getAiRuntimeConfig(),
    userMemory: weixinUserMemory,
  });
  const weixinCommandHandler = createWeixinCommandHandler({
    db,
    renderReportPng,
    agent: weixinBotAgent,
    analytics: weixinBotSkills.analytics,
    dailyPush: {
      isAdmin: (userId, accountId) => weixinBot.isDailyPushAdmin(userId, accountId),
      getStatusText: () => weixinBot.getDailyReportPushStatusText(),
      setEnabled: (enabled, meta) => weixinBot.setDailyReportPushEnabled(enabled, meta),
      notifyAfterImport: (date, pushOptions) => weixinBot.notifyDailyReportDataUpdated(date, pushOptions),
    },
  });
  weixinBotAgent.modeStore = weixinCommandHandler.modeStore;
  weixinBot.setDailyPushDependencies({ db, renderReportPng });
  weixinBot.setCommandHandler(weixinCommandHandler);
  if (weixinCommandHandler.modeStore) {
    weixinBot.setModeStore(weixinCommandHandler.modeStore);
  }

  const qqBot = new QqBotService({
    storagePath: options.qqStoragePath,
    getSharedAiSettings: () => weixinBot.getSettings()?.ai || null,
  });
  qqBot.setCommandHandler(weixinCommandHandler);
  if (weixinCommandHandler.modeStore) {
    qqBot.setModeStore(weixinCommandHandler.modeStore);
  }

  let midnightReminderTimer = null;
  let lastMidnightCheckDay = "";

  function setupMidnightReminder() {
    if (midnightReminderTimer) return;
    lastMidnightCheckDay = localDayKey();
    const tick = () => {
      const day = localDayKey();
      if (day === lastMidnightCheckDay) return;
      lastMidnightCheckDay = day;
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() < 1) return;
      const remind = (label, promise) => {
        Promise.resolve(promise)
          .then((result) => logger.log?.(`[midnight-reminder] ${label}`, JSON.stringify(result)))
          .catch((error) => logger.warn?.(`[midnight-reminder] ${label} failed`, compactError(error)));
      };
      remind("weixin", weixinBot.sendMidnightReminder());
      remind("qq", qqBot.sendMidnightReminder());
    };
    midnightReminderTimer = setInterval(tick, 60_000);
    if (typeof midnightReminderTimer.unref === "function") midnightReminderTimer.unref();
  }

  function stopMidnightReminder() {
    if (!midnightReminderTimer) return;
    clearInterval(midnightReminderTimer);
    midnightReminderTimer = null;
  }

  async function initialize({ autoStart = true, midnightReminder = true } = {}) {
    const results = await Promise.allSettled([
      weixinBot.initialize({ autoStart }),
      qqBot.initialize({ autoStart }),
    ]);
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const label = index === 0 ? "weixin" : "qq";
        logger.error?.(`[project-bots] ${label} 初始化失败`, compactError(result.reason));
      }
    });
    if (midnightReminder) setupMidnightReminder();
    return {
      weixin: weixinBot.getStatus(),
      qq: qqBot.getStatus(),
    };
  }

  async function shutdown() {
    stopMidnightReminder();
    await Promise.allSettled([
      weixinBot.shutdown?.() || Promise.resolve(),
      qqBot.shutdown?.() || Promise.resolve(),
    ]);
  }

  return {
    weixinBot,
    qqBot,
    weixinBotAgent,
    weixinCommandHandler,
    initialize,
    shutdown,
    setupMidnightReminder,
    stopMidnightReminder,
    storageHint: {
      weixin: typeof options.weixinStoragePath === "function" ? options.weixinStoragePath() : "",
      qq: typeof options.qqStoragePath === "function" ? options.qqStoragePath() : "",
    },
  };
}

function resolveProjectBotStoreDir(env = process.env) {
  const { resolveRuntimeDir } = require("./local-paths");
  return path.join(resolveRuntimeDir(env), "bots");
}

module.exports = {
  createProjectBots,
  resolveProjectBotStoreDir,
  localDayKey,
};
