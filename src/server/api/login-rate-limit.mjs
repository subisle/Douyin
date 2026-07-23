import { createHash } from "node:crypto";

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_WINDOW_MS = 15 * 60_000;
const DEFAULT_BASE_BACKOFF_MS = 5_000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sourceAddress(request) {
  const headers = request?.headers;
  const forwarded = headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim();
  return String(
    headers?.get?.("cf-connecting-ip")
      || headers?.get?.("x-real-ip")
      || forwarded
      || "unknown"
  ).slice(0, 256);
}

export function loginRateLimitKeys(request, username) {
  const account = String(username || "").trim().toLowerCase().slice(0, 256) || "<empty>";
  const source = sourceAddress(request);
  return [
    `account:${digest(account)}`,
    `pair:${digest(`${account}\0${source}`)}`,
  ];
}

export function createLoginRateLimiter(options = {}) {
  const maxFailures = positiveInteger(options.maxFailures, DEFAULT_MAX_FAILURES);
  const windowMs = positiveInteger(options.windowMs, DEFAULT_WINDOW_MS);
  const baseBackoffMs = positiveInteger(options.baseBackoffMs, DEFAULT_BASE_BACKOFF_MS);
  const maxBackoffMs = positiveInteger(options.maxBackoffMs, DEFAULT_MAX_BACKOFF_MS);
  const maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const attempts = new Map();
  let lastPruneAt = 0;

  function prune(now, force = false) {
    if (!force && now - lastPruneAt < Math.min(windowMs, 60_000)) return;
    lastPruneAt = now;
    for (const [key, entry] of attempts) {
      const expiresAt = Math.max(entry.firstFailureAt + windowMs, entry.blockedUntil);
      if (expiresAt <= now) attempts.delete(key);
    }
    while (attempts.size > maxEntries) {
      const oldest = attempts.keys().next().value;
      if (oldest === undefined) break;
      attempts.delete(oldest);
    }
  }

  function current(keys, now = Date.now()) {
    prune(now);
    let blockedUntil = 0;
    for (const key of new Set(keys)) {
      const entry = attempts.get(key);
      if (entry?.blockedUntil > blockedUntil) blockedUntil = entry.blockedUntil;
    }
    return {
      limited: blockedUntil > now,
      retryAfterSeconds: blockedUntil > now
        ? Math.max(1, Math.ceil((blockedUntil - now) / 1000))
        : 0,
    };
  }

  function recordFailure(keys, now = Date.now()) {
    prune(now, attempts.size >= maxEntries);
    for (const key of new Set(keys)) {
      const existing = attempts.get(key);
      const entry = !existing || existing.firstFailureAt + windowMs <= now
        ? { failures: 0, firstFailureAt: now, blockedUntil: 0 }
        : existing;
      entry.failures += 1;
      if (entry.failures >= maxFailures) {
        const exponent = Math.min(20, entry.failures - maxFailures);
        entry.blockedUntil = now + Math.min(maxBackoffMs, baseBackoffMs * (2 ** exponent));
      }
      attempts.delete(key);
      attempts.set(key, entry);
    }
    prune(now, true);
    return current(keys, now);
  }

  function clear(keys) {
    for (const key of new Set(keys)) attempts.delete(key);
  }

  return {
    current,
    recordFailure,
    clear,
    get size() {
      return attempts.size;
    },
  };
}

export const loginRateLimiter = createLoginRateLimiter();
