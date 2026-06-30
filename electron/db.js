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
    const host = process.env.DB_HOST;
    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const database = process.env.DB_NAME;
    if (!host || !user || !password || !database) {
      throw new Error("缺少数据库环境变量：DB_HOST, DB_USER, DB_PASSWORD, DB_NAME 必须全部设置");
    }
    pool = mysql.createPool({
      host,
      port: Number(process.env.DB_PORT) || 3312,
      user,
      password,
      database,
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

/**
 * 添加主播：同时创建 person 和主账号。
 */
async function addAnchor({ name, gender, anchorId, anchorName, douyinNo }) {
  if (!name || !anchorId) throw new Error("主播姓名和抖音ID不能为空");
  const db = getPool();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [pRes] = await conn.query(
      "INSERT INTO persons (name, gender, master_id, generation, created_at, updated_at) VALUES (?, ?, NULL, NULL, NOW(), NOW())",
      [name, gender || ""]
    );
    const personId = pRes.insertId;
    await conn.query(
      "INSERT INTO accounts (person_id, anchor_id, anchor_name, douyin_no, is_primary, created_at) VALUES (?, ?, ?, ?, 1, NOW())",
      [personId, anchorId, anchorName || name, douyinNo || ""]
    );
    await conn.commit();
    return { id: personId };
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") throw new Error("抖音ID已存在");
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 批量导入主播：从 CSV 解析出的主播列表批量创建 person + account。
 * 已存在的 anchor_id 自动跳过，返回创建/跳过计数。
 */
async function batchImportAnchors(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { created: 0, skipped: 0 };
  const db = getPool();
  const conn = await db.getConnection();
  let created = 0;
  let skipped = 0;
  try {
    await conn.beginTransaction();
    for (const row of rows) {
      const anchorId = String(row.anchorId ?? "").trim();
      const name = String(row.name ?? "").trim();
      const douyinNo = String(row.douyinNo ?? "").trim();
      if (!anchorId || !name) {
        skipped++;
        continue;
      }
      try {
        const [pRes] = await conn.query(
          "INSERT INTO persons (name, gender, master_id, generation, created_at, updated_at) VALUES (?, ?, NULL, NULL, NOW(), NOW())",
          [name, row.gender || ""]
        );
        await conn.query(
          "INSERT INTO accounts (person_id, anchor_id, anchor_name, douyin_no, is_primary, created_at) VALUES (?, ?, ?, ?, 1, NOW())",
          [pRes.insertId, anchorId, name, douyinNo]
        );
        created++;
      } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
          skipped++;
        } else {
          throw err;
        }
      }
    }
    await conn.commit();
    return { created, skipped };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 合并账号：把 secondary 主播的所有账号迁移到 primary 主播名下，并删除 secondary 的 person 记录。
 */
async function mergeAccounts({ primaryPersonId, secondaryPersonId }) {
  if (!primaryPersonId || !secondaryPersonId) throw new Error("请选择要合并的两个主播");
  if (Number(primaryPersonId) === Number(secondaryPersonId)) throw new Error("不能合并同一个主播");
  const db = getPool();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [secAccounts] = await conn.query(
      "SELECT id FROM accounts WHERE person_id = ?",
      [secondaryPersonId]
    );
    if (secAccounts.length === 0) throw new Error("被合并的主播没有账号");
    for (const acc of secAccounts) {
      await conn.query(
        "UPDATE accounts SET person_id = ?, is_primary = 0 WHERE id = ?",
        [primaryPersonId, acc.id]
      );
    }
    // 把「认 B 为师傅」的徒弟重定向到 A（防止悬空 master_id）
    await conn.query(
      "UPDATE persons SET master_id = ? WHERE master_id = ?",
      [primaryPersonId, secondaryPersonId]
    );
    // 确保主账号仍然存在
    const [primaryAccounts] = await conn.query(
      "SELECT id FROM accounts WHERE person_id = ? ORDER BY id LIMIT 1",
      [primaryPersonId]
    );
    if (primaryAccounts.length > 0) {
      await conn.query(
        "UPDATE accounts SET is_primary = 1 WHERE id = ?",
        [primaryAccounts[0].id]
      );
    }
    await conn.query("DELETE FROM persons WHERE id = ?", [secondaryPersonId]);
    await conn.commit();
    return { moved: secAccounts.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 批量删除主播：删除 persons + 关联 accounts + wave/duration 快照。
 * personIds: number[]
 */
async function deleteAnchors(personIds) {
  if (!Array.isArray(personIds) || personIds.length === 0)
    return { deleted: 0 };
  const db = getPool();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const ph = personIds.map(() => "?").join(",");

    // 查出这些 person 关联的所有 anchor_id
    const [accRows] = await conn.query(
      `SELECT DISTINCT anchor_id FROM accounts WHERE person_id IN (${ph}) AND anchor_id IS NOT NULL AND anchor_id != ''`,
      personIds
    );
    const anchorIds = accRows.map((r) => r.anchor_id);

    // 删除快照
    if (anchorIds.length > 0) {
      const aPh = anchorIds.map(() => "?").join(",");
      await conn.query(
        `DELETE FROM wave_snapshots WHERE anchor_id IN (${aPh})`,
        anchorIds
      );
      await conn.query(
        `DELETE FROM duration_snapshots WHERE anchor_id IN (${aPh})`,
        anchorIds
      );
    }

    // 把被删主播的徒弟重定向到其师傅（防止悬空 master_id）
    // 查出每个被删人的 master_id（用于重定向其徒弟）
    const [delPersons] = await conn.query(
      `SELECT id, master_id FROM persons WHERE id IN (${ph})`,
      personIds
    );
    for (const p of delPersons) {
      if (p.master_id) {
        // 该人的徒弟改为认其师傅为师
        await conn.query(
          `UPDATE persons SET master_id = ? WHERE master_id = ?`,
          [p.master_id, p.id]
        );
      } else {
        // 无师傅的人：直接清空其徒弟的 master_id（变成无师徒关系）
        await conn.query(
          `UPDATE persons SET master_id = NULL WHERE master_id = ?`,
          [p.id]
        );
      }
    }

    // 删除 accounts
    await conn.query(
      `DELETE FROM accounts WHERE person_id IN (${ph})`,
      personIds
    );
    // 删除 persons
    const [res] = await conn.query(
      `DELETE FROM persons WHERE id IN (${ph})`,
      personIds
    );
    await conn.commit();
    return { deleted: res.affectedRows };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 查找重复主播：按姓名（不区分大小写）分组，返回有重复的组。
 * 每组包含同名的人员列表（含账号信息），供用户选择合并或删除。
 */
async function findDuplicateAnchors() {
  const db = getPool();
  // 按小写姓名分组，找出 >1 的
  const [persons] = await db.query(
    `SELECT id, name, gender, master_id, generation, created_at
       FROM persons
      ORDER BY name ASC, id ASC`
  );
  const [accounts] = await db.query(
    `SELECT id, person_id, anchor_id, douyin_no, anchor_name, is_primary
       FROM accounts ORDER BY person_id, id`
  );
  const accByPerson = new Map();
  for (const a of accounts) {
    if (!accByPerson.has(a.person_id)) accByPerson.set(a.person_id, []);
    accByPerson.get(a.person_id).push(a);
  }

  // 按小写名分组
  const groups = new Map();
  for (const p of persons) {
    const key = (p.name || "").trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const duplicates = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    duplicates.push({
      name: list[0].name,
      count: list.length,
      persons: list.map((p) => {
        const accs = accByPerson.get(p.id) || [];
        const primary = accs.find((a) => a.is_primary === 1) || accs[0];
        return {
          id: p.id,
          name: p.name,
          gender: p.gender || "",
          generation: p.generation ?? null,
          masterId: p.master_id ?? null,
          createdAt: p.created_at || null,
          anchorId: primary ? primary.anchor_id || "" : "",
          douyinNo: primary ? primary.douyin_no || "" : "",
          accountCount: accs.length,
        };
      }),
    });
  }
  // 按人数降序
  duplicates.sort((a, b) => b.count - a.count);
  return duplicates;
}

/**
 * 总音浪趋势：每个导入日的全部音浪总和（不分性别）。
 */
async function getWaveTrendTotal() {
  const db = getPool();
  const [rows] = await db.query(
    `SELECT w.import_date AS date, COALESCE(SUM(w.wave_value),0) AS total
       FROM wave_snapshots w
      GROUP BY w.import_date
      ORDER BY w.import_date ASC`
  );
  const fmt = (d) =>
    d instanceof Date ? d.toISOString().split("T")[0] : String(d).split("T")[0];
  return rows.map((r) => ({ date: fmt(r.date), total: Number(r.total) || 0 }));
}

/**
 * 主播人数趋势：每个导入日有音浪数据的主播数（去重）。
 */
async function getAnchorCountTrend() {
  const db = getPool();
  const [rows] = await db.query(
    `SELECT w.import_date AS date, COUNT(DISTINCT w.anchor_id) AS cnt
       FROM wave_snapshots w
      GROUP BY w.import_date
      ORDER BY w.import_date ASC`
  );
  const fmt = (d) =>
    d instanceof Date ? d.toISOString().split("T")[0] : String(d).split("T")[0];
  return rows.map((r) => ({ date: fmt(r.date), total: Number(r.cnt) || 0 }));
}

/**
 * 更新主播姓名（同时更新 persons.name 和 accounts.anchor_name）。
 */
async function updateAnchorName({ personId, name }) {
  if (!personId || !name) throw new Error("参数不完整");
  const db = getPool();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE persons SET name = ?, updated_at = NOW() WHERE id = ?",
      [name.trim(), personId]
    );
    await conn.query(
      "UPDATE accounts SET anchor_name = ? WHERE person_id = ? AND is_primary = 1",
      [name.trim(), personId]
    );
    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 单个主播音浪趋势：按 anchor_id 查询每个导入日的音浪值。
 * anchorId 可选，不传则返回空。
 */
async function getAnchorWaveTrend(anchorId) {
  if (!anchorId) return [];
  const db = getPool();
  const [rows] = await db.query(
    `SELECT import_date AS date, wave_value AS total, \`rank\`
       FROM wave_snapshots
      WHERE anchor_id = ?
      ORDER BY import_date ASC`,
    [anchorId]
  );
  const fmt = (d) =>
    d instanceof Date ? d.toISOString().split("T")[0] : String(d).split("T")[0];
  return rows.map((r) => ({
    date: fmt(r.date),
    total: Number(r.total) || 0,
    rank: Number(r.rank) || 0,
  }));
}

/**
 * 多个主播音浪趋势：按 anchor_id 列表查询每个导入日每个主播的音浪值。
 * 返回 [{ anchorId, name, data: [{date, total, rank}] }]
 */
async function getAnchorsWaveTrend(anchorIds) {
  if (!anchorIds || anchorIds.length === 0) return [];
  const db = getPool();
  const placeholders = anchorIds.map(() => "?").join(",");
  const [rows] = await db.query(
    `SELECT w.anchor_id, COALESCE(a.anchor_name, p.name) AS name,
            w.import_date AS date, w.wave_value AS total, w.\`rank\`
       FROM wave_snapshots w
       LEFT JOIN accounts a ON a.anchor_id = w.anchor_id
       LEFT JOIN persons p ON p.id = a.person_id
      WHERE w.anchor_id IN (${placeholders})
      ORDER BY w.import_date ASC`,
    anchorIds
  );
  const fmt = (d) =>
    d instanceof Date ? d.toISOString().split("T")[0] : String(d).split("T")[0];
  const map = new Map();
  for (const r of rows) {
    const key = r.anchor_id;
    if (!map.has(key)) {
      map.set(key, { anchorId: key, name: r.name || key, data: [] });
    }
    map.get(key).data.push({
      date: fmt(r.date),
      total: Number(r.total) || 0,
      rank: Number(r.rank) || 0,
    });
  }
  return Array.from(map.values());
}

/**
 * 流动红旗：给定一个 personId（师傅），返回他 + 他所有徒弟的最新音浪和时长快照平均值。
 * 返回 { master: {id,name}, members: [{id,name,anchorId,wave,duration}], avgWave, avgDuration, count }
 */
async function getFlowingFlag(personId) {
  const db = getPool();

  // 1. 查师傅本人 + 他所有徒弟（仅男团，gender = 'male'）
  const [persons] = await db.query(
    `SELECT id, name, gender FROM persons
      WHERE (id = ? OR master_id = ?) AND gender = 'male'
      ORDER BY (id = ?) DESC, id ASC`,
    [personId, personId, personId]
  );

  if (!persons || persons.length === 0) {
    return {
      master: null,
      members: [],
      avgWave: 0,
      avgDuration: 0,
      count: 0,
    };
  }

  // 2. 查这些人对应的 accounts（anchor_id）
  const personIds = persons.map((p) => p.id);
  const placeholders = personIds.map(() => "?").join(",");
  const [accounts] = await db.query(
    `SELECT id, person_id, anchor_id, anchor_name FROM accounts
      WHERE person_id IN (${placeholders})`,
    personIds
  );

  const anchorByPerson = new Map(); // personId -> { anchorId, anchorName }
  for (const a of accounts) {
    anchorByPerson.set(a.person_id, {
      anchorId: a.anchor_id,
      anchorName: a.anchor_name,
    });
  }

  // 3. 查最新一批音浪快照
  const anchorIds = Array.from(anchorByPerson.values())
    .map((a) => a.anchorId)
    .filter(Boolean);
  let waveMap = new Map(); // anchorId -> wave_value
  let durationMap = new Map(); // anchorId -> duration_minutes

  if (anchorIds.length > 0) {
    const aPlaceholders = anchorIds.map(() => "?").join(",");

    // 最新导入日期
    const [latestDate] = await db.query(
      `SELECT MAX(import_date) AS latest FROM wave_snapshots WHERE anchor_id IN (${aPlaceholders})`,
      anchorIds
    );
    const latestWaveDate = latestDate[0]?.latest;

    if (latestWaveDate) {
      const [waveRows] = await db.query(
        `SELECT anchor_id, wave_value FROM wave_snapshots
          WHERE anchor_id IN (${aPlaceholders}) AND import_date = ?`,
        [...anchorIds, latestWaveDate]
      );
      for (const r of waveRows) {
        waveMap.set(r.anchor_id, Number(r.wave_value) || 0);
      }
    }

    // 最新时长快照
    const [latestDurDate] = await db.query(
      `SELECT MAX(import_date) AS latest FROM duration_snapshots WHERE anchor_id IN (${aPlaceholders})`,
      anchorIds
    );
    const latestDurDateRaw = latestDurDate[0]?.latest;

    if (latestDurDateRaw) {
      const [durRows] = await db.query(
        `SELECT anchor_id, total_minutes FROM duration_snapshots
          WHERE anchor_id IN (${aPlaceholders}) AND import_date = ?`,
        [...anchorIds, latestDurDateRaw]
      );
      for (const r of durRows) {
        durationMap.set(r.anchor_id, Number(r.total_minutes) || 0);
      }
    }
  }

  // 4. 组装成员数据
  const members = persons.map((p) => {
    const acc = anchorByPerson.get(p.id);
    const anchorId = acc?.anchorId || "";
    return {
      id: p.id,
      name: p.name,
      gender: p.gender,
      anchorId,
      wave: anchorId ? (waveMap.get(anchorId) ?? 0) : 0,
      duration: anchorId ? (durationMap.get(anchorId) ?? 0) : 0,
    };
  });

  const count = members.length;
  const totalWave = members.reduce((s, m) => s + m.wave, 0);
  const totalDuration = members.reduce((s, m) => s + m.duration, 0);

  return {
    master: { id: personId, name: persons[0]?.name || "" },
    members,
    avgWave: count > 0 ? totalWave / count : 0,
    avgDuration: count > 0 ? totalDuration / count : 0,
    count,
  };
}

/**
 * 结算指定月份各组流动红旗分数。
 * period 格式 'YYYY-MM'。对每个男性师傅分组，取该月所有批次快照的音浪/时长累计，
 * 计算各组人均月度音浪(avg_wave)与人均月度时长(avg_duration)。
 * 评分：分数 = 人均音浪/100 + 人均时长(分钟)/60，不归一化、不四舍五入。
 * 时长按小时计入（正音官方月度标准28小时≀28分）。
 * 整个过程在一个事务内保证原子性；DDL 已收敛到 init-db.js，运行时只做 DML。
 */
async function settleFlagScores(period) {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error("period 格式应为 YYYY-MM");
  }
  const db = getPool();
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. 日期范围
    const [y, m] = period.split("-").map(Number);
    const monthStart = period + "-01";
    const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10);

    // 2. 找出所有有弟弟的男性师傅
    const [allPersons] = await conn.query(
      "SELECT id, name, master_id FROM persons WHERE gender = 'male' ORDER BY id"
    );
    const masterIdSet = new Set();
    for (const p of allPersons) {
      if (p.master_id) masterIdSet.add(p.master_id);
    }
    const masters = allPersons.filter((p) => masterIdSet.has(p.id));

    // 3. 一次性查出所有师傅组的成员（师傅本人 + 男弟弟）
    const masterIdList = masters.map((m) => m.id);
    const groupMemberMap = new Map();
    if (masterIdList.length > 0) {
      const mPh = masterIdList.map(() => "?").join(",");
      const [memberRows] = await conn.query(
        "SELECT id, master_id FROM persons" +
        " WHERE (master_id IN (" + mPh + ") OR id IN (" + mPh + ")) AND gender = 'male'" +
        " ORDER BY id",
        [...masterIdList, ...masterIdList]
      );
      for (const row of memberRows) {
        const key = row.master_id ?? row.id;
        if (!groupMemberMap.has(key)) groupMemberMap.set(key, []);
        groupMemberMap.get(key).push(row.id);
      }
    }

    // 4. 一次性查出所有组所有主播当月音浪/时长累计
    const waveSumMap = new Map();
    const durSumMap  = new Map();
    const personAnchorMap = new Map();

    if (masterIdList.length > 0) {
      const allMemberIds = [];
      for (const ids of groupMemberMap.values()) allMemberIds.push(...ids);
      if (allMemberIds.length > 0) {
        const aPh = allMemberIds.map(() => "?").join(",");
        const [accRows] = await conn.query(
          "SELECT person_id, anchor_id FROM accounts" +
          " WHERE person_id IN (" + aPh + ") AND anchor_id IS NOT NULL AND anchor_id != ''",
          allMemberIds
        );
        const allAnchorIds = [];
        for (const r of accRows) {
          allAnchorIds.push(r.anchor_id);
          if (!personAnchorMap.has(r.person_id)) personAnchorMap.set(r.person_id, []);
          personAnchorMap.get(r.person_id).push(r.anchor_id);
        }
        if (allAnchorIds.length > 0) {
          const awPh = allAnchorIds.map(() => "?").join(",");
          const [waveRows] = await conn.query(
            "SELECT anchor_id, COALESCE(SUM(wave_value),0) AS w FROM wave_snapshots" +
            " WHERE anchor_id IN (" + awPh + ") AND import_date BETWEEN ? AND ? GROUP BY anchor_id",
            [...allAnchorIds, monthStart, monthEnd]
          );
          for (const r of waveRows) waveSumMap.set(r.anchor_id, Number(r.w) || 0);
          const [durRows] = await conn.query(
            "SELECT anchor_id, COALESCE(SUM(total_minutes),0) AS d FROM duration_snapshots" +
            " WHERE anchor_id IN (" + awPh + ") AND import_date BETWEEN ? AND ? GROUP BY anchor_id",
            [...allAnchorIds, monthStart, monthEnd]
          );
          for (const r of durRows) durSumMap.set(r.anchor_id, Number(r.d) || 0);
        }
      }
    }

    // 5. 在内存中组装各组评分结果
    const results = [];
    for (const master of masters) {
      const memberIds = groupMemberMap.get(master.id) || [];
      const denom = memberIds.length;
      if (denom === 0) continue;
      let waveSum = 0, durSum = 0;
      for (const pid of memberIds) {
        for (const aid of (personAnchorMap.get(pid) || [])) {
          waveSum += waveSumMap.get(aid) ?? 0;
          durSum  += durSumMap.get(aid)  ?? 0;
        }
      }
      const avgWave     = waveSum / denom;
      const avgDuration = durSum  / denom;
      const score       = avgWave / 100 + avgDuration / 60;
      results.push({ masterId: master.id, masterName: master.name, memberCount: denom, avgWave, avgDuration, score });
    }

    // 6. 写入 flag_scores 和 flag_winners（事务内）
    await conn.query("DELETE FROM flag_scores WHERE period = ?", [period]);
    await conn.query("DELETE FROM flag_winners WHERE period = ?", [period]);

    let winner = null;
    if (results.length > 0) {
      const now = new Date();
      const maxScore = Math.max(...results.map((r) => r.score), 0);
      let firstWinner = null;
      for (const r of results) {
        const isWinner = r.score > 0 && r.score === maxScore && !firstWinner;
        if (isWinner) firstWinner = r;
        await conn.query(
          "INSERT INTO flag_scores (master_id, period, score, avg_wave, avg_duration, member_count, is_winner, settled_at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [r.masterId, period, r.score, r.avgWave, r.avgDuration, r.memberCount, isWinner ? 1 : 0, now]
        );
      }
      if (firstWinner) {
        await conn.query(
          "INSERT INTO flag_winners (period, master_id, master_name, score, avg_wave, avg_duration, member_count, settled_at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [period, firstWinner.masterId, firstWinner.masterName, firstWinner.score,
           firstWinner.avgWave, firstWinner.avgDuration, firstWinner.memberCount, now]
        );
        winner = { masterId: firstWinner.masterId, masterName: firstWinner.masterName, score: firstWinner.score };
      }
    }

    await conn.commit();
    return { period, groups: results.length, winner };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 读取某月已结算的分组概览，按分数降序。
 */
async function getFlagGroups(period) {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error("period 格式应为 YYYY-MM");
  }
  const db = getPool();

  const [rows] = await db.query(
    `SELECT fs.master_id, fs.score, fs.avg_wave, fs.avg_duration, fs.member_count, fs.is_winner,
            p.name AS master_name
      FROM flag_scores fs
      LEFT JOIN persons p ON p.id = fs.master_id
      WHERE fs.period = ?
      ORDER BY fs.score DESC, fs.master_id ASC`,
    [period]
  );

  return rows.map((r) => ({
    masterId: r.master_id,
    masterName: r.master_name || "",
    memberCount: Number(r.member_count) || 0,
    score: Number(r.score) || 0,
    avgWave: Number(r.avg_wave) || 0,
    avgDuration: Number(r.avg_duration) || 0,
    isWinner: Number(r.is_winner) === 1,
  }));
}

/**
 * 读取某月小红旗得主（独立表 flag_winners，由 settleFlagScores 维护）。
 * 若该月未结算或无得主，返回 null。
 */
async function getFlagWinner(period) {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error("period 格式应为 YYYY-MM");
  }
  const db = getPool();
  // 注意：建表由 settleFlagScores 统一负责，这里不再重复定义（避免与其 schema 冲突）。
  const [rows] = await db.query(
    `SELECT fw.period, fw.master_id, fw.master_name, fw.score, fw.settled_at,
            p.name AS current_name
       FROM flag_winners fw
       LEFT JOIN persons p ON p.id = fw.master_id
      WHERE fw.period = ?
      LIMIT 1`,
    [period]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    period: r.period,
    masterId: r.master_id,
    masterName: r.current_name || r.master_name || "",
    score: Number(r.score) || 0,
    awardedAt: r.settled_at || null,
  };
}

/**
 * 获取所有等级规则，按 sort_order DESC（高等级在前）。
 */
async function getTierRules() {
  const db = getPool();
  const [rows] = await db.query(
    "SELECT id, label, min_wave, sort_order FROM tier_rules ORDER BY sort_order DESC, min_wave DESC"
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    minWave: Number(r.min_wave) || 0,
    sortOrder: Number(r.sort_order) || 0,
  }));
}

/**
 * 批量保存等级规则（先清空再插入）。
 */
async function saveTierRules(rules) {
  const db = getPool();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM tier_rules");
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    await conn.query(
      "INSERT INTO tier_rules (label, min_wave, sort_order) VALUES (?, ?, ?)",
      [r.label, r.minWave, rules.length - i]
    );
  }
    await conn.commit();
    return { saved: rules.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 每日音浪报告：按日期+性别展示当日音浪排行。
 * 返回 { date, gender, rows: [{rank, name, anchorId, dailyWave, totalWave, dailyDuration, totalDuration, tier, isLive}], summary }
 */
async function getDailyWaveReport(date, gender) {
  const db = getPool();
    // 等级规则
  const [tierRows] = await db.query(
    "SELECT label, min_wave FROM tier_rules ORDER BY min_wave DESC"
  );
  const tiers = tierRows.map((r) => ({ label: r.label, minWave: Number(r.min_wave) || 0 }));

  // 查所有指定性别主播
  const [persons] = await db.query(
    `SELECT p.id, p.name, a.anchor_id
       FROM persons p
       JOIN accounts a ON a.person_id = p.id
      WHERE p.gender = ? AND a.anchor_id IS NOT NULL AND a.anchor_id != ''
      ORDER BY p.id`,
    [gender]
  );

  if (persons.length === 0) {
    return { date, gender, rows: [], summary: { total: 0, notLiveCount: 0, notLiveNames: [] } };
  }

  const anchorIds = persons.map((p) => p.anchor_id);
  const ph = anchorIds.map(() => "?").join(",");

  // 累计总音浪
  const [totalRows] = await db.query(
    `SELECT anchor_id, COALESCE(SUM(wave_value),0) AS total FROM wave_snapshots
      WHERE anchor_id IN (${ph}) GROUP BY anchor_id`,
    anchorIds
  );
  const totalMap = new Map(totalRows.map((r) => [r.anchor_id, Number(r.total) || 0]));

  // 当日音浪
  const [dailyRows] = await db.query(
    `SELECT anchor_id, wave_value FROM wave_snapshots
      WHERE anchor_id IN (${ph}) AND import_date = ?`,
    [...anchorIds, date]
  );
  const dailyMap = new Map(dailyRows.map((r) => [r.anchor_id, Number(r.wave_value) || 0]));

  // 当日直播时长
  const [dailyDurRows] = await db.query(
    `SELECT anchor_id, total_minutes FROM duration_snapshots
      WHERE anchor_id IN (${ph}) AND import_date = ?`,
    [...anchorIds, date]
  );
  const dailyDurMap = new Map(dailyDurRows.map((r) => [r.anchor_id, Number(r.total_minutes) || 0]));

  // 累计总时长
  const [totalDurRows] = await db.query(
    `SELECT anchor_id, COALESCE(SUM(total_minutes),0) AS total FROM duration_snapshots
      WHERE anchor_id IN (${ph}) GROUP BY anchor_id`,
    anchorIds
  );
  const totalDurMap = new Map(totalDurRows.map((r) => [r.anchor_id, Number(r.total) || 0]));

  // 组装
  let rows = persons.map((p) => {
    const totalWave = totalMap.get(p.anchor_id) || 0;
    const isLive = dailyMap.has(p.anchor_id);
    const dailyWave = dailyMap.get(p.anchor_id) || 0;
    const dailyDuration = dailyDurMap.get(p.anchor_id) || 0;
    const totalDuration = totalDurMap.get(p.anchor_id) || 0;
    // 匹配等级
    const tier = tiers.find((t) => totalWave >= t.minWave)?.label || "";
    return {
      rank: 0,
      name: p.name || "",
      anchorId: p.anchor_id,
      dailyWave,
      totalWave,
      dailyDuration,
      totalDuration,
      tier,
      isLive,
    };
  });

  // 排序：当日音浪降序，未开播排最后
  rows.sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return b.dailyWave - a.dailyWave;
  });
  rows.forEach((r, i) => (r.rank = i + 1));

  const notLiveNames = rows.filter((r) => !r.isLive).map((r) => r.name);

  return {
    date,
    gender,
    rows,
    summary: {
      total: rows.length,
      notLiveCount: notLiveNames.length,
      notLiveNames,
    },
  };
}

/**
 * PK 名单生成：根据本月音浪数据，返回按性别分组的扁平列表。
 * period: 'YYYY-MM'，不传则取最新音浪导入日期所在月。
 * 返回 { period, males: PkMember[], females: PkMember[] }
 * 每个成员: { personId, name, anchorId, wave, trimmedAvg, maxWave, minWave, waveDays, duration, rank }
 */
async function getPkRoster(period, _groupSize = 8) {
  const db = getPool();

  // 确定 period
  if (!period) {
    const [[latest]] = await db.query(
      `SELECT MAX(import_date) AS latest FROM wave_snapshots`
    );
    if (!latest || !latest.latest) {
      return { period: "", males: [], females: [] };
    }
    const latestStr = String(latest.latest).slice(0, 10);
    period = latestStr.slice(0, 7); // YYYY-MM
  }

  const [y, m] = period.split("-").map(Number);
  const monthStart = `${period}-01`;
  const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10);

  // 查所有主播（有 anchor_id 的），分性别
  const [persons] = await db.query(
    `SELECT p.id, p.name, p.gender, a.anchor_id
       FROM persons p
       JOIN accounts a ON a.person_id = p.id
      WHERE a.anchor_id IS NOT NULL AND a.anchor_id != ''
      ORDER BY p.id`
  );

  if (persons.length === 0) {
    return { period, males: [], females: [] };
  }

  const anchorIds = persons.map((p) => p.anchor_id);
  const ph = anchorIds.map(() => "?").join(",");

  // 本月音浪：按天聚合，用于计算趋势指标
  const [waveDailyRows] = await db.query(
    `SELECT anchor_id, import_date, wave_value
       FROM wave_snapshots
      WHERE anchor_id IN (${ph}) AND import_date BETWEEN ? AND ?
      ORDER BY anchor_id, import_date`,
    [...anchorIds, monthStart, monthEnd]
  );

  // 按主播聚合每日数据
  const dailyMap = new Map(); // anchor_id -> [{date, wave}]
  for (const r of waveDailyRows) {
    if (!dailyMap.has(r.anchor_id)) dailyMap.set(r.anchor_id, []);
    dailyMap.get(r.anchor_id).push({ date: r.import_date, wave: Number(r.wave_value) || 0 });
  }

  // 计算分组用的趋势指标：去掉最高1天后的日均（trimmed mean）
  // 这样单次活动爆发不会拉偏分组
  const waveMap = new Map(); // anchor_id -> { total, trimmedAvg, max, min, days }
  for (const [aid, days] of dailyMap) {
    const waves = days.map((d) => d.wave).sort((a, b) => b - a);
    const total = waves.reduce((s, v) => s + v, 0);
    const max = waves[0] || 0;
    const min = waves[waves.length - 1] || 0;
    // 去掉最高1天后的均值（如果只有1天数据就用原值）
    const trimmed = waves.length > 1 ? waves.slice(1) : waves;
    const trimmedAvg = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
    waveMap.set(aid, { total, trimmedAvg, max, min, days: days.length });
  }

  // 本月时长累计
  const [durRows] = await db.query(
    `SELECT anchor_id, COALESCE(SUM(total_minutes),0) AS d
       FROM duration_snapshots
      WHERE anchor_id IN (${ph}) AND import_date BETWEEN ? AND ?
      GROUP BY anchor_id`,
    [...anchorIds, monthStart, monthEnd]
  );
  const durMap = new Map(durRows.map((r) => [r.anchor_id, Number(r.d) || 0]));

  // 组装
  const allMembers = persons.map((p) => {
    const w = waveMap.get(p.anchor_id);
    return {
      personId: p.id,
      name: p.name || "",
      gender: p.gender || "",
      anchorId: p.anchor_id,
      wave: w ? w.total : 0,          // 总音浪（展示用）
      trimmedAvg: w ? w.trimmedAvg : 0, // 去最高日均（分组用）
      maxWave: w ? w.max : 0,
      minWave: w ? w.min : 0,
      waveDays: w ? w.days : 0,
      duration: durMap.get(p.anchor_id) || 0,
    };
  });

  // 过滤掉本月无音浪数据的主播
  const active = allMembers.filter((m) => m.wave > 0 || m.duration > 0);

  // 按总音浪降序排序
  active.sort((a, b) => b.wave - a.wave);

  // 分性别，各自排名
  const males = active.filter((m) => m.gender === "male");
  const females = active.filter((m) => m.gender === "female");
  males.forEach((m, i) => (m.rank = i + 1));
  females.forEach((m, i) => (m.rank = i + 1));

  return { period, males, females };
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
  addAnchor,
  batchImportAnchors,
  mergeAccounts,
  deleteAnchors,
  findDuplicateAnchors,
  getWaveTrendTotal,
  getAnchorCountTrend,
  updateAnchorName,
  getAnchorWaveTrend,
  getAnchorsWaveTrend,
  getFlowingFlag,
  settleFlagScores,
  getFlagGroups,
  getTierRules,
  saveTierRules,
  getDailyWaveReport,
  getPkRoster,
};
