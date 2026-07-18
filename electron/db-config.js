const BUILT_IN_DB = Object.freeze({
  host: "mysql7.sqlpub.com",
  port: 3312,
  user: "douyinxs",
  password: "WABZfpfGGlPSxlrs",
  database: "douyinxs",
});

function nonEmpty(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535
    ? port
    : BUILT_IN_DB.port;
}

function resolveDbConfig(env = process.env) {
  return {
    host: nonEmpty(env.DB_HOST, BUILT_IN_DB.host),
    port: validPort(env.DB_PORT),
    user: nonEmpty(env.DB_USER, BUILT_IN_DB.user),
    password: nonEmpty(env.DB_PASSWORD, BUILT_IN_DB.password),
    database: nonEmpty(env.DB_NAME, BUILT_IN_DB.database),
  };
}

function applyBuiltInDbEnv(env = process.env) {
  const config = resolveDbConfig(env);
  const resolvedEnv = {
    DB_HOST: config.host,
    DB_PORT: String(config.port),
    DB_USER: config.user,
    DB_PASSWORD: config.password,
    DB_NAME: config.database,
  };

  Object.assign(env, resolvedEnv);

  return config;
}

module.exports = {
  BUILT_IN_DB,
  applyBuiltInDbEnv,
  resolveDbConfig,
};
