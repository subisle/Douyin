#!/usr/bin/env node
/**
 * MySQL 数据库本地备份脚本
 * - 用 mysqldump 导出远程数据库为 gzip 压缩 SQL 文件
 * - 备份文件保存在 backups/mysql/ 目录，按时间戳命名
 * - 默认保留最近 30 份，超出自动删除最旧的
 *
 * 用法:
 *   node scripts/backup-mysql.js              # 备份并保留 30 份
 *   node scripts/backup-mysql.js --keep 10    # 保留 10 份
 *   node scripts/backup-mysql.js --no-clean    # 不清理旧备份
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const zlib = require("zlib");

// ---- 配置 ----
const PROJECT_ROOT = path.join(__dirname, "..");
const BACKUP_DIR = path.join(PROJECT_ROOT, "backups", "mysql");
const DEFAULT_KEEP = 30;

// 从 .env 读取数据库配置（与 electron/db.js 一致的查找顺序）
function loadEnv() {
  const envPaths = [
    path.join(PROJECT_ROOT, ".env"),
    process.resourcesPath ? path.join(process.resourcesPath, ".env") : null,
    path.join(process.cwd(), ".env"),
  ].filter(Boolean);
  const envPath = envPaths.find((p) => fs.existsSync(p));
  if (!envPath) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // 去掉首尾引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let keep = DEFAULT_KEEP;
  let clean = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--keep" && args[i + 1]) {
      keep = Math.max(1, parseInt(args[i + 1], 10) || DEFAULT_KEEP);
      i++;
    } else if (args[i] === "--no-clean") {
      clean = false;
    }
  }
  return { keep, clean };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function findMysqldump() {
  const candidates = ["/opt/homebrew/bin/mysqldump", "/usr/local/bin/mysqldump", "/usr/bin/mysqldump", "mysqldump"];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch (_) {
      // continue
    }
  }
  return null;
}

function runBackup({ host, port, user, password, database, outputPath }) {
  const mysqldump = findMysqldump();
  if (!mysqldump) {
    throw new Error("未找到 mysqldump，请先安装: brew install mysql-client");
  }

  const args = [
    `--host=${host}`,
    `--port=${port}`,
    `--user=${user}`,
    `--databases`,
    database,
    "--single-transaction",
    "--routines",
    "--triggers",
    "--add-drop-database",
    "--add-drop-table",
    "--complete-insert",
    "--default-character-set=utf8mb4",
  ];

  console.log(`[backup] 使用 mysqldump: ${mysqldump}`);
  console.log(`[backup] 源: ${user}@${host}:${port}/${database}`);

  // 用环境变量传密码，避免出现在进程参数中
  const env = { ...process.env, MYSQL_PWD: password };
  const sql = execFileSync(mysqldump, args, {
    env,
    maxBuffer: 512 * 1024 * 1024, // 512MB
  });

  // gzip 压缩
  const gzipped = zlib.gzipSync(sql, { level: 9 });
  fs.writeFileSync(outputPath, gzipped);

  const sizeKB = Math.round((gzipped.length / 1024) * 10) / 10;
  console.log(`[backup] 已写入: ${outputPath} (${sizeKB} KB)`);
  return { size: gzipped.length };
}

function cleanupOldBackups(keepCount) {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".sql.gz"))
    .map((f) => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime); // 最新的在前

  if (files.length <= keepCount) return [];
  const toDelete = files.slice(keepCount);
  const deleted = [];
  for (const f of toDelete) {
    try {
      fs.unlinkSync(f.path);
      deleted.push(f.name);
      console.log(`[backup] 清理旧备份: ${f.name}`);
    } catch (err) {
      console.warn(`[backup] 清理失败 ${f.name}: ${err.message}`);
    }
  }
  return deleted;
}

function main() {
  loadEnv();
  const { keep, clean } = parseArgs();

  const host = process.env.DB_HOST || "127.0.0.1";
  const port = process.env.DB_PORT || "3307";
  const user = process.env.DB_USER || "douyinxs";
  const password = process.env.DB_PASSWORD || "";
  const database = process.env.DB_NAME || "douyinxs";

  if (!password) {
    console.error("[backup] 错误: 未设置 DB_PASSWORD");
    process.exit(1);
  }

  ensureDir(BACKUP_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `${database}_${timestamp}.sql.gz`;
  const outputPath = path.join(BACKUP_DIR, fileName);

  try {
    const start = Date.now();
    runBackup({ host, port, user, password, database, outputPath });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[backup] 完成，耗时 ${elapsed}s`);

    if (clean) {
      const deleted = cleanupOldBackups(keep);
      console.log(`[backup] 保留最近 ${keep} 份，清理 ${deleted.length} 份`);
    }

    // 列出当前备份
    const remaining = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".sql.gz"))
      .sort();
    console.log(`[backup] 当前备份目录共 ${remaining.length} 份: ${BACKUP_DIR}`);
  } catch (err) {
    console.error(`[backup] 失败: ${err.message}`);
    if (err.stderr) console.error(err.stderr.toString());
    process.exit(1);
  }
}

main();
