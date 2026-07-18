const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BUILT_IN_DB,
  applyBuiltInDbEnv,
  resolveDbConfig,
} = require("./db-config");

test("uses the built-in database when DB environment variables are absent", () => {
  assert.deepEqual(resolveDbConfig({}), BUILT_IN_DB);
});

test("prefers complete environment overrides", () => {
  assert.deepEqual(
    resolveDbConfig({
      DB_HOST: "db.example.test",
      DB_PORT: "3307",
      DB_USER: "app",
      DB_PASSWORD: "secret",
      DB_NAME: "app_db",
    }),
    {
      host: "db.example.test",
      port: 3307,
      user: "app",
      password: "secret",
      database: "app_db",
    }
  );
});

test("falls back per field for blank values and invalid ports", () => {
  assert.deepEqual(
    resolveDbConfig({
      DB_HOST: " ",
      DB_PORT: "invalid",
      DB_USER: "custom-user",
      DB_PASSWORD: "",
      DB_NAME: "custom-db",
    }),
    {
      ...BUILT_IN_DB,
      user: "custom-user",
      database: "custom-db",
    }
  );
});

test("applies defaults without replacing non-empty overrides", () => {
  const env = { DB_USER: "custom-user", DB_PORT: "70000" };

  const config = applyBuiltInDbEnv(env);

  assert.equal(env.DB_HOST, BUILT_IN_DB.host);
  assert.equal(env.DB_PORT, String(BUILT_IN_DB.port));
  assert.equal(env.DB_USER, "custom-user");
  assert.equal(env.DB_PASSWORD, BUILT_IN_DB.password);
  assert.equal(env.DB_NAME, BUILT_IN_DB.database);
  assert.equal(config.user, "custom-user");
});
