#!/usr/bin/env node
/**
 * 导出「9.1分组」图片（读取运行时快照，使用软件内置 pk-group-image 渲染）。
 * 用法：node scripts/export-september-groups.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { renderPkGroupsPng } = require("../electron/pk-group-image.js");
const { computePkSchedule } = require("../electron/pk-group-engine.js");

async function main() {
  const snapshotPath = path.join(__dirname, "..", "data", "runtime", "pk-groups-layout.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const nameGroups = snapshot.nameGroups || [];

  // 时间表：按快照的连麦时间 / 间隔 / 复活赛时长
  const schedule = computePkSchedule(nameGroups.length, {
    firstStart: snapshot.firstStart,
    stepMinutes: snapshot.stepMinutes,
    reviveExtraMinutes: snapshot.reviveExtraMinutes,
  });

  const groups = nameGroups.map((names, gi) => ({
    label: `第${gi + 1}组`,
    order: gi + 1,
    count: names.length,
    startTime: schedule.startTimes[gi],
    scheduleLabel: `${schedule.startTimes[gi]} 开始连麦`,
    members: names.map((name, mi) => ({
      index: mi + 1,
      name,
      wave: 0,
      strength: 0,
      trimmedAvg: 0,
    })),
  }));

  const total = groups.reduce((s, g) => s + g.count, 0);
  const period = snapshot.period || "2026-09";
  const constraints = [...schedule.reviveNotes];

  const result = {
    ok: true,
    mode: "balanced",
    modeLabel: "9.1分组",
    total,
    groupCount: groups.length,
    sizes: groups.map((g) => g.count),
    period,
    constraints,
    groups,
  };

  const outputDir = path.join(__dirname, "..", "data", "exports");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, "9.1分组.png");
  console.log(`[export] 生成图片: ${outputPath}`);
  console.log(`[export] ${total}人 · ${groups.length}组 · 规模 ${result.sizes.join("+")}`);
  console.log(`[export] 时间表: 第1组 ${schedule.startTimes[0]} · ${constraints.join(" · ")}`);

  const png = await renderPkGroupsPng(result, {
    title: "星嗨艺创",
    period,
    subtitle: `9.1分组 · 共 ${total} 人 · ${groups.length} 组`,
    constraints,
    rosterSource: "9.1分组",
    showWave: false,
  });

  fs.writeFileSync(outputPath, png);
  console.log(`[export] 完成: ${outputPath} (${Math.round(png.length / 1024)} KB)`);
}

main().catch((err) => {
  console.error("[export] 失败:", err);
  process.exit(1);
});
