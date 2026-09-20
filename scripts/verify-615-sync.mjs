import mysql from "mysql2/promise";
const db = await mysql.createConnection({
  host: "mysql7.sqlpub.com", port: 3312,
  user: "douyinxs", password: "WABZfpfGGlPSxlrs", database: "douyinxs",
});

// 1) 抽一个主播：对比 615 源表 与 Go 日指标的逐日音浪
const [anchor] = await db.query(
  `SELECT anchor_id, COUNT(*) c FROM wave_snapshots GROUP BY anchor_id ORDER BY c DESC LIMIT 1`);
const aid = anchor[0].anchor_id;
console.log("抽查主播 anchor_id =", aid, "（615 侧", anchor[0].c, "行）");

const [src] = await db.query(
  `SELECT import_date d, wave_value v FROM wave_snapshots WHERE anchor_id=? ORDER BY import_date`, [aid]);
const [go_] = await db.query(
  `SELECT biz_date d, wave v FROM daily_metric WHERE anchor_id=? ORDER BY biz_date`, [aid]);

const goMap = new Map(go_.map((r) => [String(r.d).slice(0, 10), Number(r.v)]));
let mismatch = 0, missingInGo = 0, checked = 0;
for (const r of src) {
  const k = String(r.d).slice(0, 10);
  const gv = goMap.get(k);
  if (gv === undefined) { missingInGo++; continue; }
  checked++;
  if (gv !== Number(r.v)) {
    if (mismatch < 5) console.log("  不一致:", k, "615 =", r.v, "Go =", gv);
    mismatch++;
  }
}
console.log(`逐日核对：可比 ${checked} 天，不一致 ${mismatch}，Go 缺行 ${missingInGo}`);

// 2) 月度音浪：615 按月汇总 vs Go 月指标（月指标按人，先把 anchor 换算成 person）
const [prow] = await db.query(`SELECT person_id FROM account WHERE anchor_id=? LIMIT 1`, [aid]);
const pid = prow[0].person_id;
const [srcMonth] = await db.query(
  `SELECT DATE_FORMAT(w.import_date,'%Y-%m') p, SUM(w.wave_value) s
     FROM wave_snapshots w JOIN account a ON a.anchor_id = w.anchor_id COLLATE utf8mb4_unicode_ci AND a.person_id = ?
    WHERE w.anchor_id = ? GROUP BY p ORDER BY p`, [pid, aid]);
const [goMonth] = await db.query(
  `SELECT period p, wave s FROM monthly_metric WHERE person_id=? ORDER BY period`, [pid]);
const gm = new Map(goMonth.map((r) => [r.p, Number(r.s)]));
console.log("== 月度音浪对比（person", pid, "）==");
for (const r of srcMonth) {
  console.log(" ", r.p, "615 =", Number(r.s), "Go =", gm.get(r.p) ?? "(无)");
}

// 3) 月度时长：615 月末快照 vs Go 月指标
const [srcDur] = await db.query(
  `SELECT DATE_FORMAT(w.import_date,'%Y-%m') p, SUM(w.total_minutes) m
     FROM duration_snapshots w JOIN account a ON a.anchor_id = w.anchor_id COLLATE utf8mb4_unicode_ci AND a.person_id = ?
    WHERE w.anchor_id = ? GROUP BY p ORDER BY p`, [pid, aid]);
const [goDur] = await db.query(
  `SELECT period p, minutes m FROM monthly_metric WHERE person_id=? AND minutes > 0 ORDER BY period`, [pid]);
const gd = new Map(goDur.map((r) => [r.p, Number(r.m)]));
console.log("== 月度时长对比 ==");
for (const r of srcDur) {
  console.log(" ", r.p, "615 =", Number(r.m), "Go =", gd.get(r.p) ?? "(无)");
}

// 4) 总量核对
const [[tot]] = await db.query(
  `SELECT (SELECT COUNT(*) FROM wave_snapshot) goWave, (SELECT COUNT(*) FROM wave_snapshots) srcWave615`);
console.log("== 快照行数 ==", "Go =", tot.goWave, "615 =", tot.srcWave615);

await db.end();
