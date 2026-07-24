#!/usr/bin/env node
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function du(p) {
  try {
    return execSync(`du -sh "${p}" 2>/dev/null | cut -f1`, { encoding: "utf8" }).trim();
  } catch {
    return "n/a";
  }
}
function df(p) {
  try {
    const line = execSync(`df -h "${p}" | tail -1`, { encoding: "utf8" }).trim().split(/\s+/);
    return { size: line[1], used: line[2], avail: line[3], pct: line[4], mount: line[8] || line.at(-1) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

const report = {
  at: new Date().toISOString(),
  disks: {
    home: df(os.homedir()),
    project: df(root),
    tmp: df(os.tmpdir()),
  },
  paths: {
    tmpdir: os.tmpdir(),
    runtimeDefault: path.join(root, "data", "runtime"),
    artifactsDefault: path.join(root, "data", "runtime", "artifacts"),
    rag: path.join(root, "data", "rag"),
  },
  sizes: {
    projectData: du(path.join(root, "data")),
    projectNext: du(path.join(root, ".next")),
    userDataDouyin: du(path.join(os.homedir(), "Library/Application Support/douyin")),
    userDataMonitor: du(path.join(os.homedir(), "Library/Application Support/douyin-live-monitor")),
    userDataManager: du(path.join(os.homedir(), "Library/Application Support/douyin-manager")),
  },
  env: {
    BOT_STORAGE_DIR: process.env.BOT_STORAGE_DIR || "(unset → should use data/runtime)",
    ARTIFACT_ROOT: process.env.ARTIFACT_ROOT || "(unset → BOT_STORAGE_DIR/artifacts or data/runtime/artifacts)",
    AGENT_SESSION_PATH: process.env.AGENT_SESSION_PATH || "(unset)",
    DB_HOST: process.env.DB_HOST || "(unset)",
    DB_PORT: process.env.DB_PORT || "(unset)",
  },
  warnings: [],
};

const avail = report.disks.home?.avail || "";
if (String(avail).endsWith("Gi") && Number.parseFloat(avail) < 15) {
  report.warnings.push("系统盘可用空间偏低（<15Gi 量级），勿把会话/锁写到 /tmp");
}
if (!process.env.BOT_STORAGE_DIR) {
  report.warnings.push("未设置 BOT_STORAGE_DIR，建议 export BOT_STORAGE_DIR=$PWD/data/runtime");
}
if (!process.env.ARTIFACT_ROOT && !process.env.BOT_STORAGE_DIR) {
  report.warnings.push(
    "未设置 ARTIFACT_ROOT / BOT_STORAGE_DIR，Artifact 将落在 data/runtime/artifacts（勿依赖系统 /tmp）"
  );
}

console.log(JSON.stringify(report, null, 2));
if (report.warnings.length) {
  console.error("\nWARNINGS:\n- " + report.warnings.join("\n- "));
  process.exitCode = 0; // informational
}
