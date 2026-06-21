const path = require("path");
const mysql = require("mysql2/promise");

// 复用根项目 .env（与 DouyinLang 同一套远程 MySQL）
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
  quiet: true,
});

/** @type {import('mysql2/promise').Pool | null} */
let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "mysql7.sqlpub.com",
      port: Number(process.env.DB_PORT) || 3312,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 10000,
      // DATE/DATETIME 直接返回字符串，避免 JS Date 经 UTC 转换导致日期回退一天
      dateStrings: true,
    });
  }
  return pool;
}

/**
 * 聚合 persons + accounts 为主播列表（与 DouyinLang buildAnchorsFromNewSchema 一致）
 */
async function getAnchors() {
  const db = getPool();
  const [persons] = await db.query(
    "SELECT id, name, gender, master_id, generation, created_at, updated_at FROM persons ORDER BY id"
  );
  const [accounts] = await db.query(
    "SELECT id, person_id, anchor_id, douyin_no, anchor_name, is_primary, created_at FROM accounts"
  );

  /** @type {Map<number, any[]>} */
  const byPerson = new Map();
  for (const acc of accounts) {
    if (!byPerson.has(acc.person_id)) byPerson.set(acc.person_id, []);
    byPerson.get(acc.person_id).push(acc);
  }

  return persons.map((p) => {
    const list = byPerson.get(p.id) || [];
    const primary = list.find((a) => a.is_primary === 1) || list[0];
    const aliases = primary
      ? list.filter((a) => a.id !== primary.id).map((a) => a.anchor_id)
      : list.map((a) => a.anchor_id);
    return {
      id: p.id,
      name: p.name || (primary && primary.anchor_name) || "",
      gender: p.gender || "",
      generation: p.generation ?? null,
      masterId: p.master_id ?? null,
      anchorId: primary ? primary.anchor_id || "" : "",
      anchorName: primary ? primary.anchor_name || p.name || "" : p.name || "",
      douyinNo: primary ? primary.douyin_no || "" : "",
      accountCount: list.length,
      aliasIds: aliases,
      createdAt: p.created_at || null,
    };
  });
}

/**
 * 族谱：返回带师父名字的人员关系
 */
async function getFamilyTree() {
  const db = getPool();
  const [persons] = await db.query(
    "SELECT id, name, gender, master_id, generation FROM persons ORDER BY generation IS NULL, generation, id"
  );
  const nameById = new Map(persons.map((p) => [p.id, p.name]));
  return persons.map((p) => ({
    id: p.id,
    name: p.name || "",
    gender: p.gender || "",
    generation: p.generation ?? null,
    masterId: p.master_id ?? null,
    masterName: p.master_id ? nameById.get(p.master_id) || null : null,
  }));
}

/**
 * 仪表盘统计概览。音浪/时长快照表当前可能为空，COUNT/SUM 会返回 0。
 */
async function getDashboardSummary() {
  const db = getPool();
  const [[personCount]] = await db.query(
    "SELECT COUNT(*) AS c FROM persons"
  );
  const [[accountCount]] = await db.query(
    "SELECT COUNT(*) AS c FROM accounts"
  );
  const [[waveAgg]] = await db.query(
    "SELECT COUNT(*) AS rows_count, COALESCE(SUM(wave_value),0) AS total FROM wave_snapshots"
  );
  const [[durationAgg]] = await db.query(
    "SELECT COUNT(*) AS rows_count, COALESCE(SUM(total_minutes),0) AS total FROM duration_snapshots"
  );

  const totalAnchors = Number(personCount.c) || 0;
  const totalWave = Number(waveAgg.total) || 0;
  const totalDuration = Number(durationAgg.total) || 0;
  const waveRows = Number(waveAgg.rows_count) || 0;
  const durationRows = Number(durationAgg.rows_count) || 0;

  return {
    totalAnchors,
    totalAccounts: Number(accountCount.c) || 0,
    totalWave,
    totalDuration,
    avgWave: totalAnchors ? totalWave / totalAnchors : 0,
    avgDuration: totalAnchors ? totalDuration / totalAnchors : 0,
    dataCount: waveRows + durationRows,
  };
}

/**
 * 音浪榜：按累计音浪排名，附带所属家族（师父名）、累计时长、趋势。
 * 趋势 = 最近两期音浪导入日的对比。快照为空时返回 []。
 */
async function getWaveRanking(limit = 10) {
  const db = getPool();

  // 累计音浪排名 + 家族（师父名）
  const [rows] = await db.query(
    `SELECT a.anchor_id,
            COALESCE(a.anchor_name, p.name) AS name,
            m.name AS family,
            COALESCE(SUM(w.wave_value),0) AS wave
       FROM wave_snapshots w
       JOIN accounts a ON a.anchor_id = w.anchor_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN persons m ON m.id = p.master_id
      GROUP BY a.anchor_id, name, family
      ORDER BY wave DESC
      LIMIT ?`,
    [limit]
  );
  if (rows.length === 0) return [];

  // 累计时长（按 anchor 聚合）
  const [durRows] = await db.query(
    "SELECT anchor_id, COALESCE(SUM(total_minutes),0) AS mins FROM duration_snapshots GROUP BY anchor_id"
  );
  const durMap = new Map(durRows.map((r) => [r.anchor_id, Number(r.mins) || 0]));

  // 趋势：最近两个音浪导入日的当日音浪对比
  const [dates] = await db.query(
    "SELECT DISTINCT import_date FROM wave_snapshots ORDER BY import_date DESC LIMIT 2"
  );
  let latestMap = new Map();
  let prevMap = new Map();
  if (dates[0]) {
    const [r] = await db.query(
      "SELECT anchor_id, SUM(wave_value) AS w FROM wave_snapshots WHERE import_date = ? GROUP BY anchor_id",
      [dates[0].import_date]
    );
    latestMap = new Map(r.map((x) => [x.anchor_id, Number(x.w) || 0]));
  }
  if (dates[1]) {
    const [r] = await db.query(
      "SELECT anchor_id, SUM(wave_value) AS w FROM wave_snapshots WHERE import_date = ? GROUP BY anchor_id",
      [dates[1].import_date]
    );
    prevMap = new Map(r.map((x) => [x.anchor_id, Number(x.w) || 0]));
  }

  return rows.map((r, i) => {
    const latest = latestMap.get(r.anchor_id);
    const prev = prevMap.get(r.anchor_id);
    let trend = "flat";
    if (latest != null && prev != null) {
      trend = latest > prev ? "up" : latest < prev ? "down" : "flat";
    }
    return {
      rank: i + 1,
      name: r.name || "",
      anchorId: r.anchor_id,
      family: r.family || "",
      wave: Number(r.wave) || 0,
      duration: durMap.get(r.anchor_id) || 0,
      trend,
    };
  });
}

/**
 * 按性别的音浪趋势：每个导入日的当日音浪总和，分男/女两条序列。
 * 返回 { male: [{date, total}], female: [{date, total}] }
 * 快照为空时两条都为 []。
 */
async function getWaveTrendByGender() {
  const db = getPool();
  const [rows] = await db.query(
    `SELECT w.import_date AS date,
            p.gender AS gender,
            COALESCE(SUM(w.wave_value),0) AS total
       FROM wave_snapshots w
       JOIN accounts a ON a.anchor_id = w.anchor_id
       LEFT JOIN persons p ON p.id = a.person_id
      GROUP BY w.import_date, p.gender
      ORDER BY w.import_date ASC`
  );

  const fmt = (d) =>
    d instanceof Date ? d.toISOString().split("T")[0] : String(d).split("T")[0];

  const male = [];
  const female = [];
  for (const r of rows) {
    const point = { date: fmt(r.date), total: Number(r.total) || 0 };
    if (r.gender === "male") male.push(point);
    else if (r.gender === "female") female.push(point);
  }
  return { male, female };
}

/**
 * 批量导入音浪快照（按 anchor_id + import_date UPSERT，可重复导入覆盖）。
 * rows: [{ anchorId, waveValue, rank }]
 */
async function importWaveSnapshots(importDate, rows) {
  if (!rows || rows.length === 0) return { inserted: 0 };
  const db = getPool();
  const values = rows.map((r) => [
    r.anchorId,
    importDate,
    Math.round(r.waveValue) || 0,
    Math.round(r.rank) || 0,
  ]);
  const [res] = await db.query(
    `INSERT INTO wave_snapshots (anchor_id, import_date, wave_value, \`rank\`)
     VALUES ?
     ON DUPLICATE KEY UPDATE wave_value = VALUES(wave_value), \`rank\` = VALUES(\`rank\`)`,
    [values]
  );
  return { inserted: res.affectedRows };
}

/**
 * 批量导入时长快照（同上 UPSERT）。
 * rows: [{ anchorId, totalMinutes }]
 */
async function importDurationSnapshots(importDate, rows) {
  if (!rows || rows.length === 0) return { inserted: 0 };
  const db = getPool();
  const values = rows.map((r) => [
    r.anchorId,
    importDate,
    Math.round(r.totalMinutes) || 0,
  ]);
  const [res] = await db.query(
    `INSERT INTO duration_snapshots (anchor_id, import_date, total_minutes)
     VALUES ?
     ON DUPLICATE KEY UPDATE total_minutes = VALUES(total_minutes)`,
    [values]
  );
  return { inserted: res.affectedRows };
}

/**
 * 导出音浪快照（关联主播名），用于导出 CSV。可选按日期过滤。
 */
async function exportWaveSnapshots(importDate) {
  const db = getPool();
  const where = importDate ? "WHERE w.import_date = ?" : "";
  const params = importDate ? [importDate] : [];
  const [rows] = await db.query(
    `SELECT w.anchor_id, COALESCE(a.anchor_name, p.name) AS name,
            w.import_date, w.wave_value, w.\`rank\`
       FROM wave_snapshots w
       LEFT JOIN accounts a ON a.anchor_id = w.anchor_id
       LEFT JOIN persons p ON p.id = a.person_id
       ${where}
      ORDER BY w.import_date DESC, w.wave_value DESC`,
    params
  );
  const fmt = (d) =>
    d instanceof Date ? d.toISOString().split("T")[0] : String(d).split("T")[0];
  return rows.map((r) => ({
    抖音号: r.anchor_id,
    昵称: r.name || "",
    日期: fmt(r.import_date),
    音浪: Number(r.wave_value) || 0,
    排名: Number(r.rank) || 0,
  }));
}

/**
 * 导出时长快照（关联主播名）。
 */
async function exportDurationSnapshots(importDate) {
  const db = getPool();
  const where = importDate ? "WHERE d.import_date = ?" : "";
  const params = importDate ? [importDate] : [];
  const [rows] = await db.query(
    `SELECT d.anchor_id, COALESCE(a.anchor_name, p.name) AS name,
            d.import_date, d.total_minutes
       FROM duration_snapshots d
       LEFT JOIN accounts a ON a.anchor_id = d.anchor_id
       LEFT JOIN persons p ON p.id = a.person_id
       ${where}
      ORDER BY d.import_date DESC, d.total_minutes DESC`,
    params
  );
  const fmt = (d) =>
    d instanceof Date ? d.toISOString().split("T")[0] : String(d).split("T")[0];
  return rows.map((r) => ({
    抖音号: r.anchor_id,
    昵称: r.name || "",
    日期: fmt(r.import_date),
    时长分钟: Number(r.total_minutes) || 0,
  }));
}

/**
 * 导出主播档案（含族谱信息）。
 */
async function exportAnchors() {
  const list = await getAnchors();
  return list.map((a) => ({
    主播: a.name,
    性别: a.gender === "male" ? "男" : a.gender === "female" ? "女" : "",
    代数: a.generation ?? "",
    抖音ID: a.anchorId,
    抖音号: a.douyinNo,
    账号数: a.accountCount,
  }));
}

module.exports = {
  getPool,
  getAnchors,
  getFamilyTree,
  getDashboardSummary,
  getWaveRanking,
  getWaveTrendByGender,
  importWaveSnapshots,
  importDurationSnapshots,
  exportWaveSnapshots,
  exportDurationSnapshots,
  exportAnchors,
};
