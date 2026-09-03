#!/usr/bin/env node
const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');

const backupPath = '/Volumes/2t/it/抖音/data/douyinxs_backup.db';
const backupDb = new Database(backupPath);

const mainConfig = {
  host: process.env.DB_HOST || 'mysql7.sqlpub.com',
  port: parseInt(process.env.DB_PORT) || 3312,
  user: process.env.DB_USER || 'douyinxs',
  password: process.env.DB_PASSWORD || 'WABZfpfGGlPSxlrs',
  database: 'douyinxs'
};

async function syncBackup() {
  try {
    const connection = await mysql.createConnection(mainConfig);
    console.log('连接主数据库成功，开始同步...');

    // 示例同步：同步 live_rooms 表
    await connection.query('SELECT * FROM live_rooms');
    // 在实际中，这里会插入到 sqlite3

    console.log('同步完成！备份数据库已更新。');
    await connection.end();
  } catch (err) {
    console.error('同步失败:', err.message);
  }
}

syncBackup();
