#!/usr/bin/env node
/**
 * 把「分组存档」同步给主进程，供微信/QQ bot 按名出图。
 *
 * - 9.1分组：来自主进程快照 data/runtime/pk-groups-layout.json（软件里保存过的那份）
 * - 9.6分组：来自代码内置 src/components/desktop/pk-roster-config.ts 的 BUILTIN_SEPTEMBER6_GROUPS
 *
 * 软件运行时会在每次保存分组时自动同步全部存档，本脚本用于「不打开软件也想让 bot 立刻能用」的场景。
 * 用法：node scripts/sync-pk-groups-presets.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { writePresets, resolvePresetsPath } = require("../electron/pk-groups-presets.js");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "src", "components", "desktop", "pk-roster-config.ts");

/** 从 ts 内置常量抽 9.6 分组（保持单一数据源） */
function readSeptember6() {
  const src = fs.readFileSync(CONFIG_PATH, "utf8");
  const block = src.match(/BUILTIN_SEPTEMBER6_GROUPS[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error("未找到 BUILTIN_SEPTEMBER6_GROUPS");
  const nameGroups = [...block[1].matchAll(/\[([^\]]*)\]/g)]
    .map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].trim()))
    .filter((row) => row.length);
  const labelsBlock = src.match(/BUILTIN_SEPTEMBER6_GROUP_LABELS[^=]*=\s*\[([\s\S]*?)\];/);
  const groupLabels = labelsBlock
    ? [...labelsBlock[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
    : [];
  const metaBlock = src.match(/BUILTIN_SEPTEMBER6_META\s*=\s*\{([\s\S]*?)\};/);
  const meta = { period: "2026-09", firstStart: "08:15", stepMinutes: 15, reviveExtraMinutes: 0 };
  if (metaBlock) {
    const pick = (key) => metaBlock[1].match(new RegExp(`${key}\\s*:\\s*"?([^",\\n]+)"?`));
    if (pick("firstStart")) meta.firstStart = pick("firstStart")[1].trim();
    if (pick("stepMinutes")) meta.stepMinutes = Number(pick("stepMinutes")[1]);
    if (pick("reviveExtraMinutes")) meta.reviveExtraMinutes = Number(pick("reviveExtraMinutes")[1]);
    if (pick("period")) meta.period = pick("period")[1].trim();
  }
  return { nameGroups, groupLabels: groupLabels.slice(0, nameGroups.length), meta };
}

function main() {
  const presets = [];

  // 1) 9.1分组：主进程快照（软件里保存过的）
  const snapshotPath = path.join(ROOT, "data", "runtime", "pk-groups-layout.json");
  if (fs.existsSync(snapshotPath)) {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    if (Array.isArray(snap.nameGroups) && snap.nameGroups.length) {
      presets.push({
        id: snap.id || "builtin-9.1",
        name: String(snap.name || "9.1分组").trim(),
        note: snap.note,
        period: snap.period,
        mode: snap.mode,
        groupSize: snap.groupSize,
        firstStart: snap.firstStart,
        stepMinutes: snap.stepMinutes,
        reviveExtraMinutes: snap.reviveExtraMinutes,
        nameGroups: snap.nameGroups,
        groupLabels: snap.groupLabels || [],
        savedAt: snap.updatedAt || new Date().toISOString(),
      });
    }
  }

  // 2) 9.6分组：代码内置
  const s6 = readSeptember6();
  if (s6.nameGroups.length) {
    presets.push({
      id: "builtin-9.6",
      name: "9.6分组",
      note: `9月6日晋级赛 · ${s6.nameGroups.length}组 · ${s6.nameGroups.flat().length}人`,
      period: s6.meta.period,
      mode: "preset",
      groupSize: s6.meta.groupSize,
      firstStart: s6.meta.firstStart,
      stepMinutes: s6.meta.stepMinutes,
      reviveExtraMinutes: s6.meta.reviveExtraMinutes,
      nameGroups: s6.nameGroups,
      groupLabels: s6.groupLabels,
      savedAt: new Date().toISOString(),
    });
  }

  const saved = writePresets(presets);
  console.log(`[sync] 写入: ${resolvePresetsPath()}`);
  saved.forEach((p) => {
    console.log(`[sync] ${p.name} · ${p.nameGroups.length}组 · ${p.nameGroups.flat().length}人 · ${p.firstStart || "-"} 起`);
  });
}

main();
