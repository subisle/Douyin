"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/** 从源码抽出 formatWave（桌面 TS / electron JS 共用断言）。 */
function loadFormatWave(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const m = src.match(/(?:export\s+)?function formatWave\([\s\S]*?^}/m);
  assert.ok(m, `formatWave not found in ${filePath}`);
  const body = m[0]
    .replace(/export\s+function formatWave\(value:\s*number\):\s*string/, "function formatWave(value)")
    .replace(/:\s*number/g, "")
    .replace(/:\s*string/g, "");
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return formatWave;`)();
}

const CASES = [
  [0, "0"],
  [200, "200"],
  [999, "999"],
  [5000, "5,000"],
  [9999, "9,999"],
  [10_000, "1 万"],
  [15_000, "1.5 万"],
  [50_000, "5 万"],
  [123_456, "12.3 万"],
  [100_000_000, "1 亿"],
];

const FILES = [
  path.join(__dirname, "format.ts"),
  path.join(__dirname, "../../../electron/weixin-bot-report.js"),
  path.join(__dirname, "../../../electron/weixin-bot-daily-push.js"),
  path.join(__dirname, "../../../electron/weixin-bot-commands.js"),
  path.join(__dirname, "../../../electron/weixin-bot-analytics.js"),
];

test("formatWave：低于一万直接数字 · 各副本一致", () => {
  for (const file of FILES) {
    const formatWave = loadFormatWave(file);
    for (const [n, expect] of CASES) {
      assert.equal(formatWave(n), expect, `${path.basename(file)}(${n})`);
    }
    // 源码必须有 <10000 分支，防止回退成一律「万」
    const src = fs.readFileSync(file, "utf8");
    assert.match(src, /n < 1_0000|number < 10_000/);
  }
});
