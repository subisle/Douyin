import mysql from "mysql2/promise";
const db = await mysql.createConnection({
  host: "mysql7.sqlpub.com", port: 3312,
  user: "douyinxs", password: "WABZfpfGGlPSxlrs", database: "douyinxs",
});
const [w] = await db.query(
  `SELECT anchor_id, import_date, wave_value FROM wave_snapshots
    WHERE anchor_id IN (SELECT anchor_id FROM wave_snapshots GROUP BY anchor_id HAVING COUNT(*) >= 3)
    ORDER BY anchor_id, import_date LIMIT 24`);
console.log("== wave_snapshots 样本 ==");
for (const r of w) console.log(r.anchor_id, String(r.import_date).slice(0, 10), r.wave_value);
const [d] = await db.query(
  `SELECT anchor_id, import_date, total_minutes FROM duration_snapshots ORDER BY anchor_id, import_date LIMIT 12`);
console.log("== duration_snapshots 样本 ==");
for (const r of d) console.log(r.anchor_id, String(r.import_date).slice(0, 10), r.total_minutes);
const [[{ wc }]] = await db.query("SELECT COUNT(*) c FROM wave_snapshots");
const [[{ dc }]] = await db.query("SELECT COUNT(*) c FROM duration_snapshots");
const [[{ pc }]] = await db.query("SELECT COUNT(*) c FROM persons");
const [[rng]] = await db.query("SELECT MIN(import_date) a, MAX(import_date) b FROM wave_snapshots");
const [[drg]] = await db.query("SELECT MIN(import_date) a, MAX(import_date) b FROM duration_snapshots");
console.log("counts:", { wave: wc, duration: dc, persons: pc });
console.log("wave 日期范围:", String(rng.a).slice(0, 10), "~", String(rng.b).slice(0, 10));
console.log("duration 日期范围:", String(drg.a).slice(0, 10), "~", String(drg.b).slice(0, 10));
await db.end();
