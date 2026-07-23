import assert from "node:assert/strict";
import test from "node:test";
import {
  createLoginRateLimiter,
  loginRateLimitKeys,
} from "./login-rate-limit.mjs";

test("login failures use bounded exponential backoff and clear after success", () => {
  const limiter = createLoginRateLimiter({
    maxFailures: 3,
    windowMs: 10_000,
    baseBackoffMs: 1_000,
    maxBackoffMs: 4_000,
  });
  const keys = ["account:test", "pair:test"];

  assert.equal(limiter.recordFailure(keys, 0).limited, false);
  assert.equal(limiter.recordFailure(keys, 1).limited, false);
  assert.deepEqual(limiter.recordFailure(keys, 2), {
    limited: true,
    retryAfterSeconds: 1,
  });
  assert.equal(limiter.current(keys, 500).limited, true);
  assert.equal(limiter.current(keys, 1_002).limited, false);
  assert.equal(limiter.recordFailure(keys, 1_003).retryAfterSeconds, 2);

  limiter.clear(keys);
  assert.equal(limiter.current(keys, 1_004).limited, false);
  assert.equal(limiter.size, 0);
});

test("login limiter keys do not retain raw account or source values", () => {
  const request = new Request("https://example.test/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.9, 127.0.0.1" },
  });
  const keys = loginRateLimitKeys(request, "Admin@example.test");

  assert.equal(keys.length, 2);
  assert.equal(keys.every((key) => /^[a-z]+:[a-f0-9]{64}$/.test(key)), true);
  assert.equal(keys.join("").includes("Admin"), false);
  assert.deepEqual(keys, loginRateLimitKeys(request, "admin@example.test"));
});

test("login limiter caps retained keys", () => {
  const limiter = createLoginRateLimiter({ maxEntries: 3, windowMs: 60_000 });
  limiter.recordFailure(["one", "two"], 0);
  limiter.recordFailure(["three", "four"], 1);
  assert.equal(limiter.size, 3);
});
