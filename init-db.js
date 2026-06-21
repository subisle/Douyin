const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

async function init() {
  const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 10000,
    dateStrings: true,
  });

  const conn = await db.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS persons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) DEFAULT '',
      gender VARCHAR(16) DEFAULT '',
      master_id INT DEFAULT NULL,
      generation INT DEFAULT NULL,
      created_at DATETIME DEFAULT NULL,
      updated_at DATETIME DEFAULT NULL
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      person_id INT DEFAULT NULL,
      anchor_id VARCHAR(64) NOT NULL,
      douyin_no VARCHAR(64) DEFAULT '',
      anchor_name VARCHAR(128) DEFAULT '',
      is_primary TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT NULL,
      UNIQUE KEY uk_anchor (anchor_id)
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS wave_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      anchor_id VARCHAR(64) NOT NULL,
      import_date DATE NOT NULL,
      wave_value BIGINT DEFAULT 0,
      \`rank\` INT DEFAULT 0,
      UNIQUE KEY uk_wave (anchor_id, import_date)
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS duration_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      anchor_id VARCHAR(64) NOT NULL,
      import_date DATE NOT NULL,
      total_minutes INT DEFAULT 0,
      UNIQUE KEY uk_dur (anchor_id, import_date)
    )`);

    const [t] = await conn.query('SHOW TABLES');
    console.log('Tables created:', t.map(r => Object.values(r)[0]).join(', '));
  } finally {
    conn.release();
    await db.end();
  }
}

init().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
