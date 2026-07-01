const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

/**
 * 从 streamers 表同步主播到 persons + accounts。
 *
 * 稳定键：streamers.streamer_id === accounts.anchor_id（accounts 上有 UNIQUE uk_anchor）。
 * 采用按业务键 UPSERT，绝不清空全表、绝不按下标顺序配对——
 * 旧实现 DELETE + 按 [i] 对应会把账号挂到错误的人身上，并连带清掉
 * scripts-seed-family.js 单独维护的 master_id / generation / gender。
 *
 * 行为：
 *  - streamer_id 已有对应 account：仅更新姓名/抖音号，person 的师徒/代数/性别保持不变。
 *  - streamer_id 尚无 account：新建 person + 主账号。
 * 全程在一个事务内。
 */
async function sync() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    dateStrings: true,
    connectionLimit: 3,
  });
  const conn = await pool.getConnection();
  try {
    // 1. 读取源数据：仅取有稳定键(streamer_id)且有姓名的行
    const [streamers] = await conn.query(
      'SELECT streamer_id, streamer_name, douyin_id FROM streamers ' +
      'WHERE streamer_id IS NOT NULL AND streamer_id != "" AND streamer_name IS NOT NULL AND streamer_name != ""'
    );
    console.log(`读取到 ${streamers.length} 条有效主播`);
    if (streamers.length === 0) { console.log('无数据可同步'); return; }

    // 2. 现有账号：anchor_id -> person_id，用于判断该主播是否已存在
    const [existingAccounts] = await conn.query(
      'SELECT anchor_id, person_id FROM accounts WHERE anchor_id IS NOT NULL AND anchor_id != ""'
    );
    const personIdByAnchor = new Map(
      existingAccounts.map((a) => [String(a.anchor_id), a.person_id])
    );

    await conn.beginTransaction();
    let created = 0;
    let updated = 0;

    for (const s of streamers) {
      const anchorId = String(s.streamer_id).trim();
      const name = String(s.streamer_name).trim();
      const douyinNo = String(s.douyin_id || '').trim();
      if (!anchorId || !name) continue;

      const existingPersonId = personIdByAnchor.get(anchorId);
      if (existingPersonId) {
        // 已存在：只更新展示字段，不动师徒关系/代数/性别
        await conn.query(
          'UPDATE persons SET name = ?, updated_at = NOW() WHERE id = ?',
          [name, existingPersonId]
        );
        await conn.query(
          'UPDATE accounts SET anchor_name = ?, douyin_no = ? WHERE anchor_id = ?',
          [name, douyinNo, anchorId]
        );
        updated++;
      } else {
        // 新主播：新建 person + 主账号
        const [pRes] = await conn.query(
          'INSERT INTO persons (name, gender, master_id, generation, created_at, updated_at) ' +
          'VALUES (?, "", NULL, NULL, NOW(), NOW())',
          [name]
        );
        await conn.query(
          'INSERT INTO accounts (person_id, anchor_id, douyin_no, anchor_name, is_primary, created_at) ' +
          'VALUES (?, ?, ?, ?, 1, NOW())',
          [pRes.insertId, anchorId, douyinNo, name]
        );
        personIdByAnchor.set(anchorId, pRes.insertId);
        created++;
      }
    }

    await conn.commit();
    console.log(`同步完成：新建 ${created} 人，更新 ${updated} 人`);

    const [p] = await conn.query('SELECT COUNT(*) as c FROM persons');
    const [a] = await conn.query('SELECT COUNT(*) as c FROM accounts');
    console.log(`当前总量：persons=${p[0].c}, accounts=${a[0].c}`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
}

sync().catch(e => { console.error(e.message); process.exit(1); });
