"use strict";

// 按日期区间清理业务数据：先整行备份到 backup 表，再删除。
// 用法:
//   node scripts/purge-month-data.js --from=2026-09-01 --to=2026-09-17            # 预演
//   node scripts/purge-month-data.js --from=2026-09-01 --to=2026-09-17 --apply    # 真删
// 说明: --apply 前一定会先备份，备份表名为 backup_purge_<table>_<时间戳>。

const mysql = require("mysql2/promise");
require("dotenv").config();
const { resolveDbConfig } = require("../electron/db-config");

function parseArgs(argv) {
  const out = { from: "", to: "", apply: false };
  for (const arg of argv) {
    if (arg === "--apply") out.apply = true;
    else if (arg.startsWith("--from=")) out.from = arg.slice(7);
    else if (arg.startsWith("--to=")) out.to = arg.slice(5);
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 表 -> 日期过滤表达式（? 占位符为 from / to）
const TARGETS = [
  { table: "wave_snapshots", kind: "range", column: "import_date" },
  { table: "duration_snapshots", kind: "range", column: "import_date" },
  { table: "import_records", kind: "range", column: "import_date" },
  { table: "anchor_income", kind: "period", column: "period" },
];

async function main() {
  const { from, to, apply } = parseArgs(process.argv.slice(2));
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    console.error("用法: node scripts/purge-month-data.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--apply]");
    process.exit(1);
  }

  const period = from.slice(0, 7);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");

  const conn = await mysql.createConnection({
    ...resolveDbConfig(process.env),
    connectTimeout: 20000,
  });

  try {
    const [tables] = await conn.query(
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()`
    );
    const existing = new Set(tables.map((t) => t.name));

    const plan = [];
    for (const t of TARGETS) {
      if (!existing.has(t.table)) {
        console.log(`跳过 ${t.table}（表不存在）`);
        continue;
      }
      let where;
      let params;
      if (t.kind === "range") {
        where = `\`${t.column}\` BETWEEN ? AND ?`;
        params = [from, to];
      } else {
        where = `\`${t.column}\` = ?`;
        params = [period];
      }
      const [[row]] = await conn.query(
        `SELECT COUNT(*) AS c FROM \`${t.table}\` WHERE ${where}`,
        params
      );
      plan.push({ ...t, where, params, count: Number(row.c) });
    }

    console.log(`\n清理区间: ${from} ~ ${to}` + (apply ? "  [执行模式]" : "  [预演模式]"));
    let total = 0;
    for (const p of plan) {
      console.log(
        `  ${p.table.padEnd(22)} ${p.kind === "period" ? `period=${period}` : `${p.column} in range`} -> ${p.count} 行`
      );
      total += p.count;
    }
    console.log(`  合计 ${total} 行`);

    if (!apply) {
      console.log("\n预演结束，未修改任何数据。确认后加 --apply 执行。");
      return;
    }

    if (total === 0) {
      console.log("\n没有匹配数据，无需处理。");
      return;
    }

    for (const p of plan) {
      if (p.count === 0) continue;
      const backup = `backup_purge_${p.table}_${stamp}`;
      await conn.query(
        `CREATE TABLE \`${backup}\` AS SELECT * FROM \`${p.table}\` WHERE ${p.where}`,
        p.params
      );
      const [[bk]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${backup}\``);
      const [res] = await conn.query(
        `DELETE FROM \`${p.table}\` WHERE ${p.where}`,
        p.params
      );
      console.log(`  ${p.table}: 备份 ${bk.c} 行 -> ${backup}；删除 ${res.affectedRows} 行`);
    }

    console.log("\n完成。备份表可直接查，确认无误后可自行 DROP。");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("清理失败:", err.message);
  process.exit(1);
});
