"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  appendSession,
  getSession,
  runSessionExclusive,
} = require("./weixin-bot-session-store");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function useSessionStore(t, prefix = "weixin-agent-session-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, "sessions.json");
  const envKeys = [
    "AGENT_SESSION_PATH",
    "AGENT_SESSION_MAX_BYTES",
    "AGENT_SESSION_MAX_SESSIONS",
    "AGENT_SESSION_LOCK_TIMEOUT_MS",
  ];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.AGENT_SESSION_PATH = file;
  delete process.env.AGENT_SESSION_MAX_BYTES;
  delete process.env.AGENT_SESSION_MAX_SESSIONS;
  delete process.env.AGENT_SESSION_LOCK_TIMEOUT_MS;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete Object.prototype.messages;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, file };
}

test("same-session turns stay exclusive while the owner heartbeats", async (t) => {
  useSessionStore(t);

  const sessionId = "concurrent-session";
  const histories = [];
  let active = 0;
  let maxActive = 0;
  let notifyFirstEntered;
  const firstEntered = new Promise((resolve) => {
    notifyFirstEntered = resolve;
  });
  const lockOptions = { timeoutMs: 2_000, staleMs: 120, heartbeatMs: 25 };

  async function runTurn(message, workMs) {
    return runSessionExclusive(sessionId, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      histories.push(getSession(sessionId).messages.map((item) => `${item.role}:${item.content}`));
      if (message === "first") notifyFirstEntered();
      await delay(workMs);
      appendSession(sessionId, "user", message);
      appendSession(sessionId, "assistant", `reply-${message}`);
      active -= 1;
    }, lockOptions);
  }

  const first = runTurn("first", 300);
  await firstEntered;
  const second = runTurn("second", 10);
  await Promise.all([first, second]);

  assert.equal(maxActive, 1);
  assert.deepEqual(histories, [
    [],
    ["user:first", "assistant:reply-first"],
  ]);
  assert.deepEqual(
    getSession(sessionId).messages.map((item) => `${item.role}:${item.content}`),
    ["user:first", "assistant:reply-first", "user:second", "assistant:reply-second"]
  );
});
