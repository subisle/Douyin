"use strict";

// 内置数据库配置——打包后 .env 可能读不到，这里作为 fallback 保证正常启动
const BUILTIN_DB_CONFIG = Object.freeze({
  DB_HOST: "mysql7.sqlpub.com",
  DB_PORT: "3312",
  DB_USER: "douyinxs",
  DB_PASSWORD: "WABZfpfGGlPSxlrs",
  DB_NAME: "douyinxs",
});

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
  // 环境变量缺失时用内置配置兜底
  const fallback = BUILTIN_DB_CONFIG;
  const values = {
    DB_HOST: requiredValue(env, "DB_HOST") || fallback.DB_HOST,
    DB_PORT: requiredValue(env, "DB_PORT") || fallback.DB_PORT,
    DB_USER: requiredValue(env, "DB_USER") || fallback.DB_USER,
    DB_PASSWORD: (env["DB_PASSWORD"] || "").trim() || fallback.DB_PASSWORD,
    DB_NAME: requiredValue(env, "DB_NAME") || fallback.DB_NAME,
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
  // 环境变量缺失时先写入内置配置
  for (const key of REQUIRED_DB_ENV_KEYS) {
    if (!String(env[key] || "").trim()) {
      env[key] = BUILTIN_DB_CONFIG[key];
    }
  }
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
