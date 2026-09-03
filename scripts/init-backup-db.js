#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const BACKUP_PATH = path.join(__dirname, '../data/douyinxs_backup.db');
const MAIN_CONFIG = {
  host: process.env.DB_HOST || 'mysql7.sqlpub.com',
  port: parseInt(process.env.DB_PORT) || 3312,
  user: process.env.DB_USER || 'douyinxs',
  password: process.env.DB_PASSWORD || 'WABZfpfGGlPSxlrs',
  database: 'douyinxs'
};

console.log('=== 备用数据库初始化 ===');
console.log(`主数据库: ${MAIN_CONFIG.host}:${MAIN_CONFIG.port}`);
console.log(`备用数据库: ${BACKUP_PATH}`);

if (fs.existsSync(BACKUP_PATH)) {
  console.log('已有备用数据库，跳过');
  process.exit(0);
}

const backupDb = new Database(BACKUP_PATH);

// 复制主数据库的 schema（这里简化处理，实际需用 mysqldump 或连接主库复制表）
console.log('正在创建备用数据库结构...');

// 示例：复制几个关键表（实际生产建议用 mysqldump -u douyinxs -p douyinxs > backup.sql 然后导入）
backupDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

backupDb.exec(`
  CREATE TABLE IF NOT EXISTS live_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT UNIQUE,
    title TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

console.log('✅ 备用数据库创建成功！');
console.log('使用方法：');
console.log('1. 连接主数据库（使用 rk3318 隧道）');
console.log('2. 执行: node scripts/init-backup-db.js');
console.log('3. 定期运行: node scripts/sync-backup.js');
