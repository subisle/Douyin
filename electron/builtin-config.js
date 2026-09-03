"use strict";

/**
 * 内置 Bot 配置目录解析（微信 / QQ 参数随程序分发，不依赖 userData）。
 *
 * 设计目的：QQ / 微信的 AppID、ClientSecret、登录令牌等参数"编译进程序"，
 * 启动时直接从这里加载，避免开发态(douyin)与打包态(抖音数据管理) userData 分家
 * 导致配置对不上 / bot 不启动。
 *
 * 目录选择：
 * - 开发模式：项目根 data/builtin（项目盘，可写，随仓库/打包源分发）
 * - 打包模式：resources/builtin-config（electron-builder extraResources 输出，asar 外可写）
 */

const fs = require("node:fs");
const path = require("node:path");

function uniquePaths(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function builtinConfigCandidates({
  isPackaged = false,
  projectDir = path.resolve(__dirname, ".."),
  resourcesPath = process.resourcesPath,
} = {}) {
  if (isPackaged) {
    return uniquePaths([
      resourcesPath && path.join(resourcesPath, "builtin-config"),
      resourcesPath && path.join(resourcesPath, "..", "builtin-config"),
    ]);
  }
  return uniquePaths([
    path.join(projectDir, "data", "builtin"),
  ]);
}

/**
 * 返回内置配置目录。优先返回已存在的候选（打包后资源已解包）；
 * 都不存在时返回首选路径（调用方按需创建）。
 */
function resolveBuiltinConfigDir(options = {}) {
  const candidates = builtinConfigCandidates(options);
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  if (existing.length > 0) return existing[0];
  return candidates[0];
}

function resolveBuiltinBotFile(kind, options = {}) {
  const dir = resolveBuiltinConfigDir(options);
  const name = kind === "qq" ? "qq-bot.v1.json" : "weixin-bot.v1.json";
  return path.join(dir, name);
}

module.exports = {
  builtinConfigCandidates,
  resolveBuiltinConfigDir,
  resolveBuiltinBotFile,
};
