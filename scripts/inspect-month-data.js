"use strict";

// 只读探查：按月份统计各业务表的数据分布。绝不执行 DELETE / UPDATE / DROP。
// 用法: node scripts/inspect-month-data.js [YYYY-MM ...]

const mysql = require("mysql2/promise");
require("dotenv").config();
const { resolveDbConfig } = require("../electron/db-config");

const months = process.argv.slice(2);
const TARGETS = months.length > 0 ? months : ["2025-09", "2026-09"];

async function main() {
  const config = resolveDbConfig(process.env);
  const conn = await mysql.createConnection({
    ...config,
    connectTimeout: 20000,
  });

  try {
    const [tables] = await conn.query(
      `SELECT table_name AS name
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
        ORDER BY table_name`
    );

    const [columns] = await conn.query(
      `SELECT table_name AS tableName, column_name AS columnName, data_type AS dataType
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND (data_type IN ('date', 'datetime', 'timestamp')
               OR column_name IN ('period', 'import_date', 'stat_date', 'biz_date'))`
    );

    const colsByTable = new Map();
    for (const c of columns) {
      const list = colsByTable.get(c.tableName) || [];
      list.push(c);
      colsByTable.set(c.tableName, list);
    }

    const report = [];
    for (const t of tables) {
      const cols = colsByTable.get(t.name) || [];
      if (cols.length === 0) continue;

      const [[totalRow]] = await conn.query(
        `SELECT COUNT(*) AS c FROM \`${t.name}\``
      );
      const total = Number(totalRow.c);
      if (total === 0) continue;

      const perMonth = {};
      for (const col of cols) {
        for (const m of TARGETS) {
          if (col.dataType === "date") {
            const [[row]] = await conn.query(
              `SELECT COUNT(*) AS c FROM \`${t.name}\`
                WHERE \`${col.columnName}\` >= ? AND \`${col.columnName}\` < DATE_ADD(?, INTERVAL 1 MONTH)`,
              [m + "-01", m + "-01"]
            );
            perMonth[`${col.columnName}=${m}`] = Number(row.c);
          } else if (col.columnName === "period") {
            const [[row]] = await conn.query(
              `SELECT COUNT(*) AS c FROM \`${t.name}\` WHERE \`${col.columnName}\` = ?`,
              [m]
            );
            perMonth[`${col.columnName}=${m}`] = Number(row.c);
          } else {
            const [[row]] = await conn.query(
              `SELECT COUNT(*) AS c FROM \`${t.name}\`
                WHERE \`${col.columnName}\` >= ? AND \`${col.columnName}\` < DATE_ADD(?, INTERVAL 1 MONTH)`,
              [m + "-01 00:00:00", m + "-01 00:00:00"]
            );
            perMonth[`${col.columnName}=${m}`] = Number(row.c);
          }
        }
      }

      const hits = Object.entries(perMonth).filter(([, v]) => v > 0);
      report.push({ table: t.name, total, hits });
    }

    const relevant = report.filter((r) => r.hits.length > 0);
    console.log("=== 命中目标月份的表 ===");
    for (const r of relevant) {
      console.log(`\n${r.table}  (总行数 ${r.total})`);
      for (const [k, v] of r.hits) console.log(`   ${k}: ${v}`);
    }
    console.log("\n=== 其他有时间列的表（本月无数据）===");
    for (const r of report.filter((x) => x.hits.length === 0)) {
      console.log(`${r.table} (总行数 ${r.total})`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("探查失败:", err.message);
  process.exit(1);
});
