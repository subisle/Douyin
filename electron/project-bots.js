"use strict";

/**
 * 微信 + QQ（可多实例）机器人装配。
 * 桌面 Electron 与 Next 网站共用，保证两侧启动时一起起来。
 * 产品已移除 AI：不再装配 agent / skills / 用户记忆，只有确定性指令处理。
 */

const path = require("path");
const { WeixinBotService } = require("./weixin-bot");
const { createWeixinCommandHandler } = require("./weixin-bot-commands");
const { QqBotService } = require("./qq-bot");

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function compactError(error) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

/**
 * 归一化 QQ 机器人实例定义。
 * 优先用 options.qqBots() 给出的多份配置；否则退回单实例 options.qqStoragePath()。
 */
function resolveQqBotDefs(options) {
  let defs = null;
  if (typeof options.qqBots === "function") {
    try {
      defs = options.qqBots();
    } catch (error) {
      (options.logger || console).warn?.("[project-bots] qqBots() 读取失败", compactError(error));
      defs = null;
    }
  }
  if (Array.isArray(defs) && defs.length) {
    return defs
      .filter((item) => item && (typeof item.storagePath === "string" || typeof item.storagePath === "function"))
      .map((item, index) => ({
        key: String(item.key || `qq-${index + 1}`).trim() || `qq-${index + 1}`,
        label: String(item.label || item.key || `qq-${index + 1}`).trim(),
        appId: String(item.appId || "").trim(),
        storagePath: item.storagePath,
      }));
  }
  return [{ key: "default", label: "default", appId: "", storagePath: options.qqStoragePath() }];
}

function createProjectBots(options = {}) {
  if (typeof options.weixinStoragePath !== "function") {
    throw new Error("project-bots 缺少 weixinStoragePath");
  }
  if (typeof options.qqStoragePath !== "function" && typeof options.qqBots !== "function") {
    throw new Error("project-bots 缺少 qqStoragePath 或 qqBots");
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

  const weixinCommandHandler = createWeixinCommandHandler({
    db,
    renderReportPng,
    dailyPush: {
      isAdmin: (userId, accountId) => weixinBot.isDailyPushAdmin(userId, accountId),
      getStatusText: () => weixinBot.getDailyReportPushStatusText(),
      setEnabled: (enabled, meta) => weixinBot.setDailyReportPushEnabled(enabled, meta),
      notifyAfterImport: (date, pushOptions) => weixinBot.notifyDailyReportDataUpdated(date, pushOptions),
    },
  });
  weixinBot.setDailyPushDependencies({ db, renderReportPng });
  weixinBot.setCommandHandler(weixinCommandHandler);

  // QQ：一份配置一个实例，各自独立连接 / 独立状态
  const qqBots = resolveQqBotDefs(options).map((def) => {
    const service = new QqBotService({ storagePath: def.storagePath });
    service.setCommandHandler(weixinCommandHandler);
    return {
      key: def.key,
      label: def.label,
      appId: def.appId,
      storagePath: typeof def.storagePath === "function" ? def.storagePath() : def.storagePath,
      service,
    };
  });
  /** 兼容旧调用：qqBot 始终指向第一个实例 */
  const qqBot = qqBots[0].service;

  function listQqBotStatuses() {
    return qqBots.map((item) => {
      let status = {};
      try {
        status = item.service.getStatus() || {};
      } catch (error) {
        status = { error: compactError(error) };
      }
      return { key: item.key, label: item.label, appId: item.appId, ...status };
    });
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
      for (const item of qqBots) {
        remind(`qq:${item.key}`, item.service.sendMidnightReminder());
      }
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
    const tasks = [
      { label: "weixin", run: () => weixinBot.initialize({ autoStart }) },
      ...qqBots.map((item) => ({ label: `qq:${item.key}`, run: () => item.service.initialize({ autoStart }) })),
    ];
    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error?.(`[project-bots] ${tasks[index].label} 初始化失败`, compactError(result.reason));
      }
    });
    if (midnightReminder) setupMidnightReminder();
    return { weixin: weixinBot.getStatus(), qq: qqBot.getStatus(), qqBots: listQqBotStatuses() };
  }

  async function shutdown() {
    stopMidnightReminder();
    await Promise.allSettled([
      weixinBot.shutdown?.() || Promise.resolve(),
      ...qqBots.map((item) => item.service.shutdown?.() || Promise.resolve()),
    ]);
  }

  return {
    weixinBot,
    /** 兼容旧调用：第一个 QQ 实例 */
    qqBot,
    /** 多机器人：全部实例 */
    qqBots,
    listQqBotStatuses,
    weixinCommandHandler,
    initialize,
    shutdown,
    setupMidnightReminder,
    stopMidnightReminder,
    storageHint: {
      weixin: typeof options.weixinStoragePath === "function" ? options.weixinStoragePath() : "",
      qq: qqBots.map((item) => item.storagePath),
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
