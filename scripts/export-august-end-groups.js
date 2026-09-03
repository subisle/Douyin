#!/usr/bin/env node
/**
 * 导出「8月月底」分组图片（使用软件内置 pk-group-image 渲染）
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { AUGUST_END_BATTLE_GROUPS, AUGUST_END_BATTLE_META } = require("../shared/pk-preset-battle-groups.js");
const { renderPkGroupsPng } = require("../electron/pk-group-image.js");

async function main() {
  // 构造 BuildPkGroupsResult 结构
  const groups = AUGUST_END_BATTLE_GROUPS.map((names, gi) => ({
    label: `第${gi + 1}组`,
    order: gi + 1,
    count: names.length,
    members: names.map((name, mi) => ({
      index: mi + 1,
      name,
      wave: 0,
      strength: 0,
      trimmedAvg: 0,
    })),
  }));

  const result = {
    ok: true,
    mode: "preset",
    modeLabel: AUGUST_END_BATTLE_META.label,
    total: groups.reduce((s, g) => s + g.count, 0),
    groupCount: groups.length,
    sizes: groups.map((g) => g.count),
    period: AUGUST_END_BATTLE_META.periodHint,
    constraints: AUGUST_END_BATTLE_META.notes,
    groups,
  };

  const outputDir = path.join(__dirname, "..", "data", "exports");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, "8月月底-分组.png");
  console.log(`[export] 生成图片: ${outputPath}`);
  console.log(`[export] ${result.total}人 · ${result.groupCount}组 · 规模 ${result.sizes.join("+")}`);

  const png = await renderPkGroupsPng(result, {
    title: "星嗨艺创",
    period: AUGUST_END_BATTLE_META.periodHint,
    subtitle: `${AUGUST_END_BATTLE_META.label} · 共 ${result.total} 人 · ${result.groupCount} 组`,
    constraints: AUGUST_END_BATTLE_META.notes,
    rosterSource: "8月月底分组",
    showWave: false,
  });

  fs.writeFileSync(outputPath, png);
  console.log(`[export] 完成: ${outputPath} (${Math.round(png.length / 1024)} KB)`);
}

main().catch((err) => {
  console.error("[export] 失败:", err);
  process.exit(1);
});
