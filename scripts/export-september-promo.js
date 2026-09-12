#!/usr/bin/env node
/**
 * 生成「9.1 晋级赛」8 组推荐分组图。
 * 规则：9.1 小组赛 43 人全晋级 · 按 9 月累计音浪降序贪心均衡分 8 组，
 * 每组第 1 位为本组最强（组内按音浪降序）。
 * 用法：node scripts/export-september-promo.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { renderPkGroupsPng } = require("../electron/pk-group-image.js");
const db = require("../electron/db.js");

const GROUP_COUNT = 8;

async function main() {
  const snapshotPath = path.join(__dirname, "..", "data", "runtime", "pk-groups-layout.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const names = snapshot.nameGroups.flat();

  const roster = await db.getPkRoster(snapshot.period || "2026-09", 8);
  const all = [...(roster.males || []), ...(roster.females || [])];
  const byName = new Map(all.map((m) => [m.name, m]));

  const people = names
    .map((name) => ({ name, wave: Number(byName.get(name)?.wave) || 0 }))
    .sort((a, b) => b.wave - a.wave);

  const n = people.length;
  const caps = Array(GROUP_COUNT).fill(Math.floor(n / GROUP_COUNT));
  for (let i = 0; i < n % GROUP_COUNT; i++) caps[i]++;

  // 贪心：最强逐个放进当前总音浪最弱的未满组
  const groups = Array.from({ length: GROUP_COUNT }, () => []);
  for (const p of people) {
    let best = -1;
    for (let i = 0; i < GROUP_COUNT; i++) {
      if (groups[i].length >= caps[i]) continue;
      if (best === -1) {
        best = i;
        continue;
      }
      const ta = groups[best].reduce((s, x) => s + x.wave, 0);
      const tb = groups[i].reduce((s, x) => s + x.wave, 0);
      if (tb < ta) best = i;
    }
    groups[best].push(p);
  }
  groups.forEach((g) => g.sort((a, b) => b.wave - a.wave));

  const totals = groups.map((g) => g.reduce((s, p) => s + p.wave, 0));
  const fmt = (w) => (w >= 10000 ? `${(w / 10000).toFixed(1)}万` : String(w));

  const uiGroups = groups.map((g, gi) => ({
    label: `第${gi + 1}组`,
    order: gi + 1,
    count: g.length,
    members: g.map((p, mi) => ({
      index: mi + 1,
      name: p.name,
      wave: p.wave,
      strength: p.wave,
      trimmedAvg: 0,
    })),
  }));

  const total = people.length;
  const spread = Math.max(...totals) - Math.min(...totals);
  const constraints = [
    `43 人 · 8 组 · 规模 [${caps.join(",")}]`,
    `按 9 月累计音浪贪心均衡 · 组总音浪极差 ${fmt(spread)}`,
    `每组第 1 位为本组最强`,
  ];

  const result = {
    ok: true,
    mode: "balanced",
    modeLabel: "9.1 晋级赛",
    total,
    groupCount: groups.length,
    sizes: groups.map((g) => g.length),
    period: snapshot.period || "2026-09",
    constraints,
    groups: uiGroups,
  };

  const outputDir = path.join(__dirname, "..", "data", "exports");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "9.1晋级赛-推荐.png");

  console.log(`[export] ${total}人 · ${groups.length}组 · 规模 ${result.sizes.join("+")} · 极差 ${fmt(spread)}`);
  const png = await renderPkGroupsPng(result, {
    title: "星嗨艺创",
    period: snapshot.period || "2026-09",
    subtitle: `9.1 晋级赛（推荐）· 共 ${total} 人 · ${groups.length} 组`,
    constraints,
    rosterSource: "9.1晋级赛-推荐",
    showWave: false,
  });

  fs.writeFileSync(outputPath, png);
  console.log(`[export] 完成: ${outputPath} (${Math.round(png.length / 1024)} KB)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[export] 失败:", err);
  process.exit(1);
});
