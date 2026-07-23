"use strict";

const REQUIRED_DB_ENV_KEYS = Object.freeze([
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
]);

function requiredValue(env, key, { preserveWhitespace = false } = {}) {
  const raw = String(env[key] ?? "");
  if (!raw.trim()) return "";
  return preserveWhitespace ? raw : raw.trim();
}

function resolveDbConfig(env = process.env) {
  const values = {
    DB_HOST: requiredValue(env, "DB_HOST"),
    DB_PORT: requiredValue(env, "DB_PORT"),
    DB_USER: requiredValue(env, "DB_USER"),
    DB_PASSWORD: requiredValue(env, "DB_PASSWORD", { preserveWhitespace: true }),
    DB_NAME: requiredValue(env, "DB_NAME"),
  };
  const missing = REQUIRED_DB_ENV_KEYS.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`缺少数据库环境变量: ${missing.join(", ")}`);
  }

  const port = Number(values.DB_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("DB_PORT 必须是 1-65535 的整数");
  }

  return {
    host: values.DB_HOST,
    port,
    user: values.DB_USER,
    password: values.DB_PASSWORD,
    database: values.DB_NAME,
  };
}

// 保留旧函数名兼容 Electron 启动入口；现在仅校验并规范化显式配置。
function applyBuiltInDbEnv(env = process.env) {
  const config = resolveDbConfig(env);
  Object.assign(env, {
    DB_HOST: config.host,
    DB_PORT: String(config.port),
    DB_USER: config.user,
    DB_PASSWORD: config.password,
    DB_NAME: config.database,
  });
  return config;
}

module.exports = {
  REQUIRED_DB_ENV_KEYS,
  applyBuiltInDbEnv,
  resolveDbConfig,
};
