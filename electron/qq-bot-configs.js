"use strict";

/**
 * QQ 多机器人配置发现。
 *
 * 一份 .json 文件 = 一个 QQ 官方机器人。文件结构与旧 qq-bot.v1.json 完全一致
 * （QqBotService 的存储格式），因此可以把配置文件本身直接当作该实例的 storagePath，
 * 服务既从它读 appId/clientSecret，也把运行态（绑定用户、开关）写回同一个文件。
 *
 * 查找顺序（先命中先取，同一 appId 只保留第一份，避免重复连接）：
 *   1. QQ_BOTS_DIR 环境变量指定目录
 *   2. <builtinConfigDir>/qq-bots/*.json
 *   3. <builtinConfigDir>/qq-bot.v1.json      ← 兼容单机器人
 *   4. <runtimeDir>/qq-bots/*.json
 *   5. <runtimeDir>/qq-bot.v1.json            ← 兼容单机器人
 *
 * 跳过规则：JSON 解析失败 / 缺 appId 或 clientSecret / enabled 显式为 false /
 * 与已入选实例 appId 重复。跳过原因会一并返回，便于日志排查。
 */

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILE_RE = /\.json$/i;
const LEGACY_FILE_NAME = "qq-bot.v1.json";
const BOTS_SUBDIR = "qq-bots";

function listJsonFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && CONFIG_FILE_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en"))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function readConfig(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const appId = String(raw?.appId || "").trim();
  const clientSecret = String(raw?.clientSecret || "").trim();
  return { raw, appId, clientSecret };
}

function candidateFiles({ env = process.env, builtinDir = "", runtimeDir = "" } = {}) {
  const files = [];
  const envDir = String(env.QQ_BOTS_DIR || "").trim();
  if (envDir) files.push(...listJsonFiles(path.resolve(envDir)));
  if (builtinDir) {
    files.push(...listJsonFiles(path.join(builtinDir, BOTS_SUBDIR)));
    files.push(path.join(builtinDir, LEGACY_FILE_NAME));
  }
  if (runtimeDir) {
    files.push(...listJsonFiles(path.join(runtimeDir, BOTS_SUBDIR)));
    files.push(path.join(runtimeDir, LEGACY_FILE_NAME));
  }
  return files;
}

/**
 * @returns {{ configs: Array<{key:string,label:string,storagePath:string,appId:string}>, skipped: Array<{file:string,reason:string}> }}
 */
function discoverQqBotConfigs(options = {}) {
  const configs = [];
  const skipped = [];
  const seenAppIds = new Set();

  for (const file of candidateFiles(options)) {
    if (!fs.existsSync(file)) continue;
    let parsed;
    try {
      parsed = readConfig(file);
    } catch (error) {
      skipped.push({ file, reason: `配置读取失败：${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const { raw, appId, clientSecret } = parsed;
    if (!appId || !clientSecret) {
      skipped.push({ file, reason: "缺少 appId 或 clientSecret" });
      continue;
    }
    if (raw?.enabled === false) {
      skipped.push({ file, reason: "配置 enabled=false" });
      continue;
    }
    if (seenAppIds.has(appId)) {
      skipped.push({ file, reason: `appId ${appId} 已由其它配置占用` });
      continue;
    }
    seenAppIds.add(appId);
    const key = path.basename(file, path.extname(file));
    configs.push({
      key,
      label: String(raw?.label || raw?.name || key).trim() || key,
      storagePath: file,
      appId,
    });
  }

  return { configs, skipped };
}

module.exports = {
  discoverQqBotConfigs,
  candidateFiles,
  BOTS_SUBDIR,
  LEGACY_FILE_NAME,
};
