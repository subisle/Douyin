"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = __dirname;

test("源码：store 组序主路径 · 打错PK改写 · ≥200 · 只写当前组", () => {
  const store = fs.readFileSync(path.join(root, "pk-tournament-store.ts"), "utf8");
  assert.match(store, /export function isGroupFullyScored/);
  assert.match(store, /export function resolveSequentialPkGroupKey/);
  assert.match(store, /export function nextPkGroupKey/);
  assert.match(store, /export function resolveLiveGroupKey/);
  assert.match(store, /export function resolvePkWriteGroupKey/);
  assert.match(store, /export const MIN_AUTO_PK_SCORE\s*=\s*200/);
  // 仍保留整阶段写入（兼容），但顺序主路径用 applyScoresToGroup
  assert.match(store, /export function applyScoresToGroup/);
  assert.match(store, /export function applyScoresToStage/);
  assert.match(store, /export function isStageFullyScored/);
  assert.match(store, /export function listPkGroupPresetsForMonitor/);
  // 组序主路径：sequential 优先；live 与 sequential 不同才改写（打错 PK）
  const writeAt = store.indexOf("export function resolvePkWriteGroupKey");
  assert.ok(writeAt >= 0);
  const writeFn = store.slice(writeAt, writeAt + 1200);
  assert.match(writeFn, /resolveSequentialPkGroupKey/);
  assert.match(writeFn, /resolveLiveGroupKey/);
  assert.match(writeFn, /liveKey !== sequential|sequential.*liveKey/);
  // 匹配成功后回写 anchorId / douyinNo，避免后续只能靠脱敏昵称
  const helperAt = store.indexOf("function applyScoreRowsToOneGroup");
  assert.ok(helperAt >= 0);
  const helper = store.slice(helperAt, helperAt + 2800);
  assert.match(helper, /member\.anchorId/);
  assert.match(helper, /douyinNos/);
});

test("源码：监控页组序主路径 · 只记PK≥200 · 连麦永不写 · 选分组导入", () => {
  const page = fs.readFileSync(path.join(root, "pk-monitor-page.tsx"), "utf8");
  assert.match(page, /resolvePkWriteGroupKey|resolveLiveGroupKey/);
  assert.match(page, /resolveSequentialPkGroupKey|nextPkGroupKey|isGroupFullyScored/);
  assert.match(page, /applyScoresToGroup/);
  assert.match(page, /MIN_AUTO_PK_SCORE/);
  assert.match(page, /listPkGroupPresetsForMonitor|importPresetId|导入所选/);
  // 组序主路径 · 打错 PK 改写
  assert.match(page, /组序|打错PK|打错 PK/);
  // 监控中可回看历史组：浏览与写分分离
  assert.match(page, /userBrowsingRef|liveWriteGroupKey|回到写分组|回看/);
  // 实时音浪压缩：只展示前 N 名
  assert.match(page, /LIVE_BOARD_LIMIT|liveBoard/);
  // PK 结束信号
  assert.match(page, /battlePhase|battleFinished|punish|finished|isPkActive/);
  // 无手动采终分/结算/分组监控
  assert.doesNotMatch(page, /开本组监控/);
  assert.doesNotMatch(page, /handleCaptureFinalScores/);
  assert.doesNotMatch(page, /采终分/);
  assert.doesNotMatch(page, /结算本阶段/);
  assert.match(page, /idealPromoPool:\s*48/);
});

test("源码：监控页只记 PK 分 · 连麦 linkmic-score 不写入赛程", () => {
  const page = fs.readFileSync(path.join(root, "pk-monitor-page.tsx"), "utf8");
  // 必须能识别 linkmic-score 事件（用于模式徽章），但不得用它写赛程
  assert.match(page, /linkmic-score/);
  // 写分入口：只接受 pk-battle / pk-score-snapshot
  assert.match(
    page,
    /\/\/ 只记 PK 分[\s\S]*?if \(eventType === "pk-battle" \|\| eventType === "pk-score-snapshot"\)/
  );
  // sync 调用附近不得再以 linkmic-score 为条件
  const syncAt = page.indexOf("syncLiveScoresToStage(merged");
  assert.ok(syncAt > 0, "应调用 syncLiveScoresToStage(merged");
  // 从「只记 PK」注释到第一次 sync 之间，不得出现 linkmic-score 作为写分条件
  const gateAt = page.indexOf("// 只记 PK 分");
  assert.ok(gateAt > 0);
  const writeBlock = page.slice(gateAt, syncAt + 80);
  assert.match(writeBlock, /pk-battle/);
  assert.match(writeBlock, /pk-score-snapshot/);
  assert.doesNotMatch(
    writeBlock,
    /eventType === "linkmic-score"/
  );
  // 文案：只记 PK / 连麦不记；落分门槛 ≥200
  assert.match(page, /只记\s*PK|连麦不记/);
  assert.match(page, /score\s*>=\s*MIN_AUTO_PK_SCORE|MIN_AUTO_PK_SCORE/);
});

test("源码：store 导出 applyScoresToStage 与手改优先仍在", () => {
  const store = fs.readFileSync(path.join(root, "pk-tournament-store.ts"), "utf8");
  assert.match(store, /export function applyScoresToStage/);
  const helperAt = store.indexOf("function applyScoreRowsToOneGroup");
  assert.ok(helperAt >= 0);
  const helper = store.slice(helperAt, helperAt + 1800);
  assert.match(helper, /member\.manual && !manual/);
});

test("源码：协议进房重试 · 多房 startSession 重试", () => {
  const protocol = fs.readFileSync(
    path.join(root, "../../../electron/live-pk-protocol.js"),
    "utf8"
  );
  assert.match(protocol, /withEnterRetry|isRetryableEnterError/);
  assert.match(protocol, /协议进房重试|刷新 ttwid/);
  const multi = fs.readFileSync(
    path.join(root, "../../../electron/live-pk-multi-monitor.js"),
    "utf8"
  );
  assert.match(multi, /进房重试|maxAttempts/);
});
