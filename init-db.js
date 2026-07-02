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

    await conn.query(`CREATE TABLE IF NOT EXISTS flag_scores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      master_id INT NOT NULL,
      period VARCHAR(7) NOT NULL,
      score BIGINT DEFAULT 0,
      avg_wave BIGINT DEFAULT 0,
      avg_duration INT DEFAULT 0,
      member_count INT DEFAULT 0,
      is_winner TINYINT(1) DEFAULT 0,
      settled_at DATETIME DEFAULT NULL,
      UNIQUE KEY uk_flag (master_id, period)
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS tier_rules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(8) NOT NULL,
      min_wave BIGINT NOT NULL,
      sort_order INT DEFAULT 0,
      UNIQUE KEY uk_label (label)
    )`);

    // flag_winners 表（流动红旗月度得主）
    await conn.query(`CREATE TABLE IF NOT EXISTS flag_winners (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period VARCHAR(7) NOT NULL,
      master_id INT NOT NULL,
      master_name VARCHAR(64) DEFAULT "",
      score BIGINT DEFAULT 0,
      avg_wave BIGINT DEFAULT 0,
      avg_duration INT DEFAULT 0,
      member_count INT DEFAULT 0,
      settled_at DATETIME DEFAULT NULL,
      UNIQUE KEY uk_period (period)
    )`);

    // seed 默认等级规则（仅表空时）
    const [[tierCount]] = await conn.query('SELECT COUNT(*) AS c FROM tier_rules');
    if (Number(tierCount.c) === 0) {
      const defaults = [
        // A 级（顶级主播）
        ['A', 500000, 4],
        // B 级（核心主播）
        ['B', 200000, 3],
        // C 级（活跃主播）
        ['C', 50000, 2],
        // D 级（新人/待提升）
        ['D', 0, 1],
      ];
      for (const [label, minWave, sortOrder] of defaults) {
        await conn.query(
          'INSERT INTO tier_rules (label, min_wave, sort_order) VALUES (?, ?, ?)',
          [label, minWave, sortOrder]
        );
      }
      console.log('Seeded 4 default tier_rules');
    }

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
