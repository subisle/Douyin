"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  createWeixinUserMemory,
  emptyProfile,
  normalizeQuery,
} = require("./weixin-bot-user-memory");

function tempMemory(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-user-memory-"));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const filePath = path.join(dir, "memory.json");
  return createWeixinUserMemory({
    filePath,
    now: options.now || (() => 1_700_000_000_000),
    isEnabled: options.isEnabled,
  });
}

test("user memory persists thread across instances", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-user-memory-"));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const filePath = path.join(dir, "memory.json");
  const a = createWeixinUserMemory({ filePath, now: () => 100 });
  a.saveThread("u1", [
    { role: "user", content: "查小张" },
    { role: "assistant", content: "好的" },
  ]);

  const b = createWeixinUserMemory({ filePath, now: () => 200 });
  const thread = b.getThread("u1");
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages[0].content, "查小张");
});

test("user memory learns anchors from successful wave tool only", (t) => {
  const memory = tempMemory(t);
  memory.learnFromTool("u1", "get_anchor_wave_profile", { query: "小张" }, { ok: true });
  memory.learnFromTool("u1", "get_anchor_wave_profile", { query: "小张" }, { ok: false, error: "x" });
  memory.learnFromTool("u1", "rag_search", { query: "帮助" }, { ok: true });

  const profile = memory.getProfile("u1");
  assert.equal(profile.topAnchors.length, 1);
  assert.equal(profile.topAnchors[0].query, "小张");
  assert.equal(profile.topAnchors[0].count, 1);
  assert.equal(profile.preferMetric, "wave");
});

test("user memory summary is empty without habits", (t) => {
  const memory = tempMemory(t);
  assert.equal(memory.formatProfileSummary(emptyProfile()), "");
  memory.learnFromTool("u1", "get_anchor_duration", { query: "小李" }, { ok: true });
  const summary = memory.formatProfileSummary(memory.getProfile("u1"));
  assert.match(summary, /常查：小李/);
  assert.match(summary, /时长/);
});

test("clearThread keeps profile", (t) => {
  const memory = tempMemory(t);
  memory.saveThread("u1", [{ role: "user", content: "hi" }]);
  memory.learnFromTool("u1", "get_anchor_wave_profile", { query: "小张" }, { ok: true });
  memory.learnFromTool("u1", "export_wave_file", { date: "2026-07-26" }, { ok: true });
  memory.clearThread("u1");
  assert.deepEqual(memory.getThread("u1").messages, []);
  assert.equal(memory.getProfile("u1").topAnchors[0].query, "小张");
  assert.equal(memory.getProfile("u1").preferArtifact, "file");
});

test("profiles are isolated by key", (t) => {
  const memory = tempMemory(t);
  memory.learnFromTool("u1", "get_anchor_wave_profile", { query: "甲" }, { ok: true });
  memory.learnFromTool("u2", "get_anchor_duration", { query: "乙" }, { ok: true });
  assert.equal(memory.getProfile("u1").topAnchors[0].query, "甲");
  assert.equal(memory.getProfile("u2").topAnchors[0].query, "乙");
});

test("disabled memory is no-op", (t) => {
  const memory = tempMemory(t, { isEnabled: () => false });
  memory.saveThread("u1", [{ role: "user", content: "x" }]);
  memory.learnFromTool("u1", "get_anchor_wave_profile", { query: "小张" }, { ok: true });
  assert.deepEqual(memory.getThread("u1").messages, []);
  assert.equal(memory.getProfile("u1").topAnchors.length, 0);
});

test("normalizeQuery filters noise and keeps short anchor ids", () => {
  assert.equal(normalizeQuery("  小张  "), "小张");
  assert.equal(normalizeQuery("帮助"), "");
  assert.equal(normalizeQuery("每日报告"), "");
  assert.equal(normalizeQuery("清空对话"), "");
  assert.equal(normalizeQuery("清除习惯"), "");
  assert.equal(normalizeQuery("！"), "");
  assert.equal(normalizeQuery("..."), "");
  assert.equal(normalizeQuery("123456"), "123456");
  assert.equal(normalizeQuery("1".repeat(30)), "");
});

test("noise query does not enter topAnchors", (t) => {
  const memory = tempMemory(t);
  memory.learnFromTool("u1", "get_anchor_wave_profile", { query: "帮助" }, { ok: true });
  memory.learnFromTool("u1", "get_anchor_wave_profile", { query: "清除习惯" }, { ok: true });
  memory.learnFromTool("u1", "get_anchor_wave_profile", { query: "！" }, { ok: true });
  assert.equal(memory.getProfile("u1").topAnchors.length, 0);
  // 仍可学到 metric 偏好
  assert.equal(memory.getProfile("u1").preferMetric, "wave");
});

test("clearProfile removes habits but keeps thread", (t) => {
  const memory = tempMemory(t);
  memory.saveThread("u1", [{ role: "user", content: "hi" }]);
  memory.learnFromTool("u1", "get_anchor_wave_profile", { query: "小张" }, { ok: true });
  memory.learnFromTool("u1", "export_wave_file", { date: "2026-07-26" }, { ok: true });
  memory.clearProfile("u1");
  assert.equal(memory.getProfile("u1").topAnchors.length, 0);
  assert.equal(memory.getProfile("u1").preferArtifact, null);
  assert.equal(memory.getThread("u1").messages.length, 1);
});

test("learnFromTool fills query from observation anchor name", (t) => {
  const memory = tempMemory(t);
  memory.learnFromTool(
    "u1",
    "get_anchor_wave_profile",
    {},
    { ok: true, anchor: { name: "小王" } }
  );
  assert.equal(memory.getProfile("u1").topAnchors[0].query, "小王");

  memory.learnFromTool(
    "u1",
    "search_anchors",
    { query: "" },
    { ok: true, anchors: [{ name: "小赵" }] }
  );
  assert.ok(memory.getProfile("u1").topAnchors.some((row) => row.query === "小赵"));
});

test("learnFromTool skips anchors on unmatched observation", (t) => {
  const memory = tempMemory(t);
  memory.learnFromTool(
    "u1",
    "get_anchor_wave_profile",
    { query: "不存在" },
    { ok: true, unmatched: true }
  );
  memory.learnFromTool(
    "u1",
    "get_anchor_wave_profile",
    { query: "错误名" },
    { ok: true, error: "not found" }
  );
  assert.equal(memory.getProfile("u1").topAnchors.length, 0);
  assert.equal(memory.getProfile("u1").preferMetric, "wave");
});
