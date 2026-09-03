#!/usr/bin/env node
/**
 * rk3318 SSH 隧道管理脚本
 * - 建立本地 3307 -> rk3318:3306 的 SSH 隧道
 * - 支持 start / status / stop
 *
 * 用法:
 *   node scripts/ssh-tunnel-rk3318.js start    # 建立隧道（后台）
 *   node scripts/ssh-tunnel-rk3318.js status   # 检查隧道状态
 *   node scripts/ssh-tunnel-rk3318.js stop     # 关闭隧道
 */
"use strict";

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOCAL_PORT = 3307;
const REMOTE_HOST = "192.168.5.12";
const REMOTE_PORT = 3306;
const SSH_USER = "root";
const PID_FILE = path.join(__dirname, "..", "data", "runtime", "ssh-tunnel-rk3318.pid");

function ensureDir() {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isPortListening(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null`, { encoding: "utf8" });
    return out.trim().length > 0;
  } catch (_) {
    return false;
  }
}

function getPidFromPort(port) {
  try {
    const out = execSync(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null`, { encoding: "utf8" });
    const pid = parseInt(out.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch (_) {
    return null;
  }
}

function readPidFile() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch (_) {
    return null;
  }
}

function isProcessRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function start() {
  ensureDir();

  if (isPortListening(LOCAL_PORT)) {
    const pid = getPidFromPort(LOCAL_PORT);
    console.log(`隧道已在运行（端口 ${LOCAL_PORT}，PID ${pid || "未知"}）`);
    return;
  }

  console.log(`建立 SSH 隧道: 127.0.0.1:${LOCAL_PORT} -> ${REMOTE_HOST}:${REMOTE_PORT}`);
  console.log(`目标: ${SSH_USER}@${REMOTE_HOST}（rk3318 板卡）`);

  const args = [
    "-N",
    "-L",
    `${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}`,
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ExitOnForwardFailure=yes",
    `${SSH_USER}@${REMOTE_HOST}`,
  ];

  const child = spawn("ssh", args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));

  // 等一下确认隧道建立成功
  let ok = false;
  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    while (Date.now() - start < 500) {
      // busy wait
    }
    if (isPortListening(LOCAL_PORT)) {
      ok = true;
      break;
    }
  }

  if (ok) {
    console.log(`✅ 隧道已建立（PID ${child.pid}）`);
    console.log(`   数据库连接: DB_HOST=127.0.0.1 DB_PORT=${LOCAL_PORT}`);
  } else {
    console.log(`⚠️  隧道进程已启动（PID ${child.pid}），但端口尚未监听`);
    console.log(`   可能原因: rk3318 板卡不在线、SSH 密钥未配置、或需要密码交互`);
    console.log(`   检查: ssh ${SSH_USER}@${REMOTE_HOST}`);
  }
}

function status() {
  const portOpen = isPortListening(LOCAL_PORT);
  const pid = getPidFromPort(LOCAL_PORT);
  const filePid = readPidFile();
  const fileRunning = isProcessRunning(filePid);

  console.log(`SSH 隧道状态 (127.0.0.1:${LOCAL_PORT} -> ${REMOTE_HOST}:${REMOTE_PORT})`);
  console.log(`  端口监听: ${portOpen ? "✅ 是" : "❌ 否"}`);
  console.log(`  监听 PID: ${pid || "无"}`);
  console.log(`  PID 文件: ${filePid || "无"}${fileRunning ? "（运行中）" : "（已失效）"}`);

  if (!portOpen) {
    console.log(`\n提示: 运行 'node scripts/ssh-tunnel-rk3318.js start' 建立隧道`);
  }
}

function stop() {
  const pid = getPidFromPort(LOCAL_PORT) || readPidFile();
  if (!pid) {
    console.log("未找到运行中的隧道进程");
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`已发送 SIGTERM 到 PID ${pid}`);
    // 等一下确认端口释放
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      while (Date.now() - start < 300) {
        // busy wait
      }
      if (!isPortListening(LOCAL_PORT)) break;
    }
    if (isPortListening(LOCAL_PORT)) {
      console.log("端口仍在监听，强制 kill...");
      try {
        process.kill(pid, "SIGKILL");
      } catch (_) {
        // already dead
      }
    }
    console.log("✅ 隧道已关闭");
  } catch (err) {
    console.log(`进程 ${pid} 已不存在或无法终止: ${err.message}`);
  }
  if (fs.existsSync(PID_FILE)) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch (_) {
      // ignore
    }
  }
}

const command = process.argv[2] || "status";
switch (command) {
  case "start":
    start();
    break;
  case "stop":
    stop();
    break;
  case "status":
    status();
    break;
  default:
    console.log(`用法: node scripts/ssh-tunnel-rk3318.js [start|stop|status]`);
    process.exit(1);
}
