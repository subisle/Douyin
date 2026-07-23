"use strict";

const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

function uniquePaths(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function runtimeEnvCandidates({
  env = process.env,
  isPackaged = false,
  projectDir = path.resolve(__dirname, ".."),
  resourcesPath = process.resourcesPath,
  userDataPath = "",
  execPath = process.execPath,
} = {}) {
  const explicit = String(env.DOUYIN_ENV_PATH || "").trim();
  if (explicit) return [path.resolve(explicit)];

  if (isPackaged) {
    return uniquePaths([
      userDataPath && path.join(userDataPath, "douyin.env"),
      userDataPath && path.join(userDataPath, ".env"),
      execPath && path.join(path.dirname(execPath), "douyin.env"),
      resourcesPath && path.join(resourcesPath, "douyin.env"),
      resourcesPath && path.join(resourcesPath, ".env"),
    ]);
  }

  return uniquePaths([
    path.join(projectDir, ".env.local"),
    path.join(projectDir, ".env"),
  ]);
}

function loadRuntimeEnvironment(options = {}) {
  const env = options.env || process.env;
  const candidates = runtimeEnvCandidates({ ...options, env });
  const explicit = String(env.DOUYIN_ENV_PATH || "").trim();
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  if (existing.length === 0) {
    if (explicit) throw new Error(`DOUYIN_ENV_PATH 指向的文件不存在: ${candidates[0]}`);
    return null;
  }
  // Development composes .env.local over .env by loading the higher-priority
  // file first. Packaged and explicit configurations select exactly one file.
  const selected = options.isPackaged || explicit ? existing.slice(0, 1) : existing;
  for (const file of selected) {
    const result = dotenv.config({ path: file, processEnv: env, quiet: true });
    if (result.error) throw result.error;
  }
  return selected[0];
}

module.exports = {
  loadRuntimeEnvironment,
  runtimeEnvCandidates,
};
