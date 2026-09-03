#!/usr/bin/env node
/**
 * 生成带家族内部总排名和距上一名分数的 815 分组图片
 * 数据：8月份累计音浪（截止8.29，对应 import_date <= 2026-08-28）
 * 排名：星嗨艺创家族内部排名（只统计家族成员）
 */
"use strict";

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const { PRESET_BATTLE_GROUPS, PRESET_BATTLE_META } = require("../shared/pk-preset-battle-groups.js");
const { renderPkGroupsPng } = require("../electron/pk-group-image.js");
const fs = require("fs");
const path = require("path");

// 家族成员 = 815分组中的所有人（去重）
const FAMILY_MEMBERS = [...new Set(PRESET_BATTLE_GROUPS.flat())];
const ALIASES = { 浩远: "浩运", 阿楠: "南方楠", 萧恒: "啸恒" };

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // 8月份累计音浪（截止8.29 = import_date <= 2026-08-28）
  const [all] = await conn.query(`
    SELECT p.id, p.name, COALESCE(SUM(w.wave_value),0) AS wave
    FROM persons p
    INNER JOIN accounts a ON a.person_id = p.id
    LEFT JOIN wave_snapshots w ON w.anchor_id = a.anchor_id
      AND w.import_date >= '2026-08-01'
      AND w.import_date <= '2026-08-28 23:59:59'
    GROUP BY p.id, p.name
    ORDER BY wave DESC
  `);
  await conn.end();

  // 只保留家族成员，计算家族内部排名
  const familyRanking = all
    .map((r, i) => ({ ...r, globalRank: i + 1 }))
    .filter((r) => {
      const name = r.name;
      return FAMILY_MEMBERS.some((m) => (ALIASES[m] || m) === name);
    })
    .map((r, i) => ({ ...r, familyRank: i + 1 }));

  console.log("家族成员数:", familyRanking.length);
  console.log("家族榜前15名:");
  familyRanking.slice(0, 15).forEach((r) =>
    console.log(`  ${String(r.familyRank).padStart(2)}. ${r.name}  ${Number(r.wave).toLocaleString()} (总榜#${r.globalRank})`)
  );

  const jiuYue = familyRanking.find((r) => r.name === "玖玥");
  if (jiuYue) {
    console.log(`\n玖玥: 家族榜第${jiuYue.familyRank}名, ${Number(jiuYue.wave).toLocaleString()}音浪`);
  }

  // 建立名字 -> {familyRank, wave, distanceText} 映射
  // 优化后的距离规则（针对57人家族榜，区间更均匀）：
  // 1-3已在前三 / 4-10距前三 / 11-20距前十 / 21-40距前二十 / 41+距前四十
  // 差距<1万时追加显示上一个更高门槛
  const top3 = familyRanking[2]?.wave || 0;
  const top10 = familyRanking[9]?.wave || 0;
  const top20 = familyRanking[19]?.wave || 0;
  const top40 = familyRanking[39]?.wave || 0;
  console.log("门槛音浪: 前三=" + top3.toLocaleString() + " 前十=" + top10.toLocaleString() + " 前二十=" + top20.toLocaleString() + " 前四十=" + top40.toLocaleString());

  function calcDistance(rank, wave) {
    if (rank <= 3) return "已在前三";
    // 确定基础门槛层级（从低到高）
    let baseLevel;
    if (rank <= 10) baseLevel = { name: "前三", value: top3 };
    else if (rank <= 20) baseLevel = { name: "前十", value: top10 };
    else if (rank <= 40) baseLevel = { name: "前二十", value: top20 };
    else baseLevel = { name: "前四十", value: top40 };

    // 从基础门槛向上遍历，差距<1万就包含更高门槛
    const levels = [
      { name: "前四十", value: top40 },
      { name: "前二十", value: top20 },
      { name: "前十", value: top10 },
      { name: "前三", value: top3 },
    ];
    const startIdx = levels.findIndex((l) => l.name === baseLevel.name);
    const included = [];
    for (let i = startIdx; i < levels.length; i++) {
      const diff = levels[i].value - wave;
      included.push({ name: levels[i].name, diff });
      if (diff >= 10000) break;
    }
    // 按从高到低显示（前三在前，前四十在后）
    included.sort((a, b) => b.diff - a.diff);
    return included.map((t) => `距${t.name} ${t.diff.toLocaleString()}`).join(" · ");
  }

  const rankMap = new Map();
  familyRanking.forEach((r) => {
    const wave = Number(r.wave);
    rankMap.set(r.name, {
      familyRank: r.familyRank,
      wave,
      distanceText: calcDistance(r.familyRank, wave),
    });
  });

  // 构建分组数据
  const groups = PRESET_BATTLE_GROUPS.map((names, gi) => {
    const members = names.map((name, mi) => {
      const lookupName = ALIASES[name] || name;
      const info = rankMap.get(lookupName);
      const wave = info?.wave || 0;
      const rank = info?.familyRank || null;
      const distanceText = info?.distanceText || "未找到";
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
      `家族内部总排名（8月累计音浪，截止8.29），共${familyRanking.length}名家族成员`,
      `门槛: 前三${top3.toLocaleString()} · 前十${top10.toLocaleString()} · 前二十${top20.toLocaleString()} · 前四十${top40.toLocaleString()}`,
      `差距<1万时追加显示上一个更高门槛`,
    ],
    groups,
  };

  const png = await renderPkGroupsPng(result, {
    title: "星嗨艺创",
    period: "2026-08",
    subtitle: `2026-08-815 · 共${total}人 · 8组 · 20:15起/间隔15分 · 8月家族总排名·距离分数`,
    constraints: result.constraints,
    rosterSource: "815分组·8月家族总榜",
    showWave: false,
    showRank: true,
  });

  const outDir = path.join(__dirname, "..", "data", "exports");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "815-分组-家族总排名.png");
  fs.writeFileSync(out, png);
  console.log(`\n生成: ${out} (${Math.round(png.length / 1024)}KB)`);
  console.log(`规模: ${result.sizes.join("+")} 共${total}人`);

  const found = groups.flatMap((g) => g.members).filter((m) => m.globalRank);
  const missing = groups.flatMap((g) => g.members).filter((m) => !m.globalRank);
  console.log(`找到排名: ${found.length}/${total}`);
  if (missing.length) console.log("未找到:", missing.map((m) => m.name).join(", "));
})().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
