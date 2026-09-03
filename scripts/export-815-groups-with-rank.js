#!/usr/bin/env node
/**
 * 生成带总排名和距离分数的 815 分组图片
 */
"use strict";

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const { PRESET_BATTLE_GROUPS, PRESET_BATTLE_META } = require("../shared/pk-preset-battle-groups.js");
const { renderPkGroupsPng } = require("../electron/pk-group-image.js");
const fs = require("fs");
const path = require("path");

// 距离分数计算：差距<1万时向上追加更高门槛
function calcDistance(rank, wave, thresholds) {
  if (rank <= 3) return "已在前三";

  // 门槛层级（从低到高）
  const levels = [
    { name: "前五十", value: thresholds.top50, minRank: 51 },
    { name: "前二十", value: thresholds.top20, minRank: 21 },
    { name: "前十", value: thresholds.top10, minRank: 11 },
    { name: "前三", value: thresholds.top3, minRank: 4 },
  ];

  // 找到最低门槛（最接近当前排名的那个）
  let startIdx = levels.findIndex((l) => rank >= l.minRank);
  if (startIdx === -1) startIdx = 0;

  // 从最低门槛向上遍历，差距<1万就包含
  const included = [];
  for (let i = startIdx; i < levels.length; i++) {
    const diff = levels[i].value - wave;
    included.push({ name: levels[i].name, diff });
    if (diff >= 10000) break; // 差距≥1万，停止向上
  }

  // 按从高到低显示（前三在前，前五十在后）
  included.sort((a, b) => b.diff - a.diff);
  return included.map((t) => `距${t.name} ${t.diff.toLocaleString()}`).join(" · ");
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // 查询所有主播最近两天音浪，按降序排列（总排名）
  // 数据库最新日期为 2026-08-28（UTC），最近两天为 8.27-8.28
  const [all] = await conn.query(`
    SELECT p.name, COALESCE(SUM(w.wave_value),0) AS wave
    FROM persons p
    INNER JOIN accounts a ON a.person_id = p.id
    LEFT JOIN wave_snapshots w ON w.anchor_id = a.anchor_id
      AND DATE(w.import_date) IN ('2026-08-27','2026-08-28')
    GROUP BY p.id, p.name
    ORDER BY wave DESC
  `);
  await conn.end();

  // 门槛音浪
  const thresholds = {
    top3: Number(all[2]?.wave || 0),
    top10: Number(all[9]?.wave || 0),
    top20: Number(all[19]?.wave || 0),
    top50: Number(all[49]?.wave || 0),
  };
  console.log("门槛音浪:", thresholds);
  console.log("总主播数:", all.length);

  // 建立名字 -> {rank, wave} 映射
  const rankMap = new Map();
  all.forEach((r, i) => rankMap.set(r.name, { rank: i + 1, wave: Number(r.wave) }));

  // 别名映射
  const aliases = { 浩远: "浩运", 阿楠: "南方楠", 萧恒: "啸恒" };

  // 构建分组数据，带排名和距离分数
  const groups = PRESET_BATTLE_GROUPS.map((names, gi) => {
    const members = names.map((name, mi) => {
      const lookupName = aliases[name] || name;
      const info = rankMap.get(lookupName);
      const wave = info?.wave || 0;
      const rank = info?.rank || null;
      const distanceText = rank ? calcDistance(rank, wave, thresholds) : "未找到";
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
      `总排名基于最近两天(8.27-8.28)音浪，共${all.length}人`,
      `门槛: 前三${thresholds.top3.toLocaleString()} · 前十${thresholds.top10.toLocaleString()} · 前二十${thresholds.top20.toLocaleString()} · 前五十${thresholds.top50.toLocaleString()}`,
    ],
    groups,
  };

  const png = await renderPkGroupsPng(result, {
    title: "星嗨艺创",
    period: "2026-08",
    subtitle: `2026-08-815 · 共${total}人 · 8组 · 20:15起/间隔15分 · 含总排名与距离分数`,
    constraints: result.constraints,
    rosterSource: "815分组·含排名",
    showWave: false,
    showRank: true,
  });

  const outDir = path.join(__dirname, "..", "data", "exports");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "815-分组-含排名.png");
  fs.writeFileSync(out, png);
  console.log(`生成: ${out} (${Math.round(png.length / 1024)}KB)`);
  console.log(`规模: ${result.sizes.join("+")} 共${total}人`);

  // 打印排名分布检查
  const found = groups.flatMap((g) => g.members).filter((m) => m.globalRank);
  const missing = groups.flatMap((g) => g.members).filter((m) => !m.globalRank);
  console.log(`找到排名: ${found.length}/${total}`);
  if (missing.length) console.log("未找到:", missing.map((m) => m.name).join(", "));
})().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
