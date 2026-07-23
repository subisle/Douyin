"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyBuiltInDbEnv,
  resolveDbConfig,
} = require("./db-config");

const COMPLETE_ENV = Object.freeze({
  DB_HOST: "db.example.test",
  DB_PORT: "3307",
  DB_USER: "app",
  DB_PASSWORD: "test-secret",
  DB_NAME: "app_db",
});

test("rejects missing database environment variables", () => {
  assert.throws(
    () => resolveDbConfig({}),
    /DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME/
  );
  assert.throws(
    () => resolveDbConfig({ ...COMPLETE_ENV, DB_PASSWORD: " " }),
    /DB_PASSWORD/
  );
});

test("resolves a complete database configuration", () => {
  assert.deepEqual(resolveDbConfig(COMPLETE_ENV), {
    host: "db.example.test",
    port: 3307,
    user: "app",
    password: "test-secret",
    database: "app_db",
  });
});

test("rejects invalid database ports instead of falling back", () => {
  for (const DB_PORT of ["invalid", "0", "65536", "3306.5"]) {
    assert.throws(
      () => resolveDbConfig({ ...COMPLETE_ENV, DB_PORT }),
      /DB_PORT 必须是 1-65535 的整数/
    );
  }
});

test("normalizes validated values into the target environment", () => {
  const env = {
    ...COMPLETE_ENV,
    DB_HOST: "  db.example.test  ",
    DB_PORT: "03307",
    DB_USER: " app ",
    DB_NAME: " app_db ",
  };

  const config = applyBuiltInDbEnv(env);

  assert.deepEqual(config, {
    host: "db.example.test",
    port: 3307,
    user: "app",
    password: "test-secret",
    database: "app_db",
  });
  assert.deepEqual(env, {
    DB_HOST: "db.example.test",
    DB_PORT: "3307",
    DB_USER: "app",
    DB_PASSWORD: "test-secret",
    DB_NAME: "app_db",
  });
});
