#!/usr/bin/env node
/**
 * 生成带总排名和距上一名分数的 815 分组图片
 * 数据：最新一天（8月29号，对应 import_date 2026-08-28 UTC）
 */
"use strict";

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const { PRESET_BATTLE_GROUPS, PRESET_BATTLE_META } = require("../shared/pk-preset-battle-groups.js");
const { renderPkGroupsPng } = require("../electron/pk-group-image.js");
const fs = require("fs");
const path = require("path");

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // 截止到8月29号的累计音浪（import_date <= 2026-08-28 UTC）
  const [all] = await conn.query(`
    SELECT p.name, COALESCE(SUM(w.wave_value),0) AS wave
    FROM persons p
    INNER JOIN accounts a ON a.person_id = p.id
    LEFT JOIN wave_snapshots w ON w.anchor_id = a.anchor_id
      AND w.import_date <= '2026-08-28 23:59:59'
    GROUP BY p.id, p.name
    ORDER BY wave DESC
  `);
  await conn.end();

  console.log("总主播数:", all.length);
  console.log("前3名:", all.slice(0,3).map((r,i)=>`${i+1}.${r.name} ${Number(r.wave).toLocaleString()}`).join(" | "));

  // 建立名字 -> {rank, wave, prevWave, gap} 映射
  const rankMap = new Map();
  all.forEach((r, i) => {
    const wave = Number(r.wave);
    const prevWave = i > 0 ? Number(all[i - 1].wave) : null;
    const gap = prevWave !== null ? prevWave - wave : 0;
    rankMap.set(r.name, { rank: i + 1, wave, prevWave, gap });
  });

  // 别名映射
  const aliases = { 浩远: "浩运", 阿楠: "南方楠", 萧恒: "啸恒" };

  // 构建分组数据
  const groups = PRESET_BATTLE_GROUPS.map((names, gi) => {
    const members = names.map((name, mi) => {
      const lookupName = aliases[name] || name;
      const info = rankMap.get(lookupName);
      const wave = info?.wave || 0;
      const rank = info?.rank || null;
      let distanceText;
      if (!rank) {
        distanceText = "未找到";
      } else if (rank === 1) {
        distanceText = "已在榜首";
      } else {
        const gap = info.gap;
        const prevName = all[rank - 2]?.name || "";
        distanceText = `距上一名(${prevName}) ${gap.toLocaleString()}`;
      }
      return {
        index: mi + 1,
        name,
        wave,
        strength: wave,
        trimmedAvg: wave,
        globalRank: rank,
        distanceText,
      };
    });
    return {
      label: `第${gi + 1}组`,
      order: gi + 1,
      count: members.length,
      members,
    };
  });

  const total = groups.reduce((s, g) => s + g.count, 0);
  const result = {
    ok: true,
    mode: "preset",
    modeLabel: PRESET_BATTLE_META.label,
    total,
    groupCount: groups.length,
    sizes: groups.map((g) => g.count),
    period: "2026-08",
    constraints: [
      `总排名基于截止8月29号累计音浪，共${all.length}人`,
      `显示距离上一名所需音浪（提升1位排名需要的分数）`,
    ],
    groups,
  };

  const png = await renderPkGroupsPng(result, {
    title: "星嗨艺创",
    period: "2026-08",
    subtitle: `2026-08-815 · 共${total}人 · 8组 · 20:15起/间隔15分 · 截止8.29累计排名`,
    constraints: result.constraints,
    rosterSource: "815分组·8.29排名",
    showWave: false,
    showRank: true,
  });

  const outDir = path.join(__dirname, "..", "data", "exports");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "815-分组-8月29排名.png");
  fs.writeFileSync(out, png);
  console.log(`生成: ${out} (${Math.round(png.length / 1024)}KB)`);
  console.log(`规模: ${result.sizes.join("+")} 共${total}人`);

  const found = groups.flatMap((g) => g.members).filter((m) => m.globalRank);
  const missing = groups.flatMap((g) => g.members).filter((m) => !m.globalRank);
  console.log(`找到排名: ${found.length}/${total}`);
  if (missing.length) console.log("未找到:", missing.map((m) => m.name).join(", "));
})().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
