const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

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
    // 1. 从 streamers 读取数据
    const [streamers] = await conn.query('SELECT id, streamer_id, streamer_name, douyin_id, status, join_date FROM streamers');
    console.log(`读取到 ${streamers.length} 条主播`);

    if (streamers.length === 0) { console.log('无数据可同步'); return; }

    // 2. 写入 persons（只同步有姓名的）
    const personValues = streamers
      .filter(s => s.streamer_name)
      .map(s => [
        s.streamer_name,
        '',           // gender
        null,         // master_id
        null,         // generation
        new Date(),  // created_at
        new Date(),  // updated_at
      ]);

    if (personValues.length > 0) {
      // 清空旧数据后重新插入
      await conn.query('DELETE FROM persons');
      await conn.query(
        'INSERT INTO persons (name, gender, master_id, generation, created_at, updated_at) VALUES ?',
        [personValues]
      );
      console.log(`写入 ${personValues.length} 条 persons`);
    }

    // 3. streamers 原始数据还在，重新读出来做对应
    const [allStreamers] = await conn.query('SELECT streamer_id, streamer_name, douyin_id FROM streamers WHERE streamer_name != ""');

    // 4. 按插入顺序与 persons 对应（两者数量相同且顺序一致）
    const [newPersons] = await conn.query('SELECT id, name FROM persons ORDER BY id');

    const accountValues = [];
    for (let i = 0; i < allStreamers.length && i < newPersons.length; i++) {
      const sp = allStreamers[i];
      const person = newPersons[i];
      accountValues.push([
        person.id,         // person_id
        sp.streamer_id,    // anchor_id
        sp.douyin_id || '',
        sp.streamer_name,
        1,                 // is_primary
        new Date(),
      ]);
    }

    if (accountValues.length > 0) {
      await conn.query('DELETE FROM accounts');
      await conn.query(
        'INSERT INTO accounts (person_id, anchor_id, douyin_no, anchor_name, is_primary, created_at) VALUES ?',
        [accountValues]
      );
      console.log(`写入 ${accountValues.length} 条 accounts`);
    }

    // 验证
    const [p] = await conn.query('SELECT COUNT(*) as c FROM persons');
    const [a] = await conn.query('SELECT COUNT(*) as c FROM accounts');
    console.log(`\n同步完成：persons=${p[0].c}, accounts=${a[0].c}`);

    const [sample] = await conn.query(
      'SELECT p.id, p.name, a.anchor_id, a.douyin_no FROM persons p JOIN accounts a ON a.person_id = p.id LIMIT 5'
    );
    console.log('示例:', JSON.stringify(sample, null, 2));

  } finally {
    conn.release();
    await pool.end();
  }
}

sync().catch(e => { console.error(e.message); process.exit(1); });
