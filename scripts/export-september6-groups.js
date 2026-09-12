#!/usr/bin/env node
/**
 * 导出「9.6分组」图片（晋级赛 · 34人 · 5组 · 08:15 起每 15 分钟一组）。
 * 数据源：src/components/desktop/pk-roster-config.ts 的 BUILTIN_SEPTEMBER6_GROUPS（单一数据源）。
 * 用法：node scripts/export-september6-groups.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { renderPkGroupsPng } = require("../electron/pk-group-image.js");
const { computePkSchedule } = require("../electron/pk-group-engine.js");

const CONFIG_PATH = path.join(
  __dirname,
  "..",
  "src",
  "components",
  "desktop",
  "pk-roster-config.ts"
);

/** 从 ts 常量里抽分组，避免与代码内置表不同步 */
function readBuiltInGroups() {
  const src = fs.readFileSync(CONFIG_PATH, "utf8");
  const block = src.match(/BUILTIN_SEPTEMBER6_GROUPS[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error("未找到 BUILTIN_SEPTEMBER6_GROUPS");
  const rows = [...block[1].matchAll(/\[([^\]]*)\]/g)].map((m) =>
    [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].trim())
  );
  const metaBlock = src.match(/BUILTIN_SEPTEMBER6_META\s*=\s*\{([\s\S]*?)\};/);
  const meta = { period: "2026-09", firstStart: "08:15", stepMinutes: 15, reviveExtraMinutes: 0 };
  if (metaBlock) {
    const pick = (key) => metaBlock[1].match(new RegExp(`${key}\\s*:\\s*"?([^",\\n]+)"?`));
    if (pick("firstStart")) meta.firstStart = pick("firstStart")[1].trim();
    if (pick("stepMinutes")) meta.stepMinutes = Number(pick("stepMinutes")[1]);
    if (pick("reviveExtraMinutes")) meta.reviveExtraMinutes = Number(pick("reviveExtraMinutes")[1]);
    if (pick("period")) meta.period = pick("period")[1].trim();
  }
  return { nameGroups: rows.filter((r) => r.length), meta };
}

async function main() {
  const { nameGroups, meta } = readBuiltInGroups();

  const schedule = computePkSchedule(nameGroups.length, {
    firstStart: meta.firstStart,
    stepMinutes: meta.stepMinutes,
    reviveExtraMinutes: meta.reviveExtraMinutes,
  });

  const groups = nameGroups.map((names, gi) => ({
    label: `晋级${gi + 1}组`,
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
  const constraints = [...schedule.reviveNotes];

  const result = {
    ok: true,
    mode: "preset",
    modeLabel: "9.6分组",
    total,
    groupCount: groups.length,
    sizes: groups.map((g) => g.count),
    period: meta.period,
    constraints,
    groups,
  };

  const outputDir = path.join(__dirname, "..", "data", "exports");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "9.6分组.png");

  console.log(`[export] 生成图片: ${outputPath}`);
  console.log(`[export] ${total}人 · ${groups.length}组 · 规模 ${result.sizes.join("+")}`);
  console.log(`[export] 时间表: ${schedule.startTimes.join(" / ")}${constraints.length ? " · " + constraints.join(" · ") : " · 无复活赛"}`);

  const png = await renderPkGroupsPng(result, {
    title: "星嗨艺创",
    period: meta.period,
    subtitle: `9.6分组 · 晋级赛 · 共 ${total} 人 · ${groups.length} 组`,
    constraints,
    rosterSource: "9.6分组",
    showWave: false,
  });

  fs.writeFileSync(outputPath, png);
  console.log(`[export] 完成: ${outputPath} (${Math.round(png.length / 1024)} KB)`);
}

main().catch((err) => {
  console.error("[export] 失败:", err);
  process.exit(1);
});
