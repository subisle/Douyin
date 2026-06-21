const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

async function check() {
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
    const [tables] = await conn.query('SHOW TABLES');
    console.log('All tables:', tables.map(r => Object.values(r)[0]).join(', '));

    const [s] = await conn.query('SELECT COUNT(*) as c FROM streamers');
    const [sd] = await conn.query('SELECT COUNT(*) as c FROM streamer_data');
    console.log('\nstreamers count:', s[0].c);
    console.log('streamer_data count:', sd[0].c);

    const [s1] = await conn.query('SELECT * FROM streamers LIMIT 5');
    console.log('streamers sample:', JSON.stringify(s1, null, 2));

    const [sd1] = await conn.query('SELECT * FROM streamer_data LIMIT 5');
    console.log('streamer_data sample:', JSON.stringify(sd1, null, 2));
  } finally {
    conn.release();
    await pool.end();
  }
}

check().catch(e => { console.error(e.message); process.exit(1); });
