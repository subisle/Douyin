#!/usr/bin/env node
/**
 * Local storage rate / capacity probe.
 * Writes ONLY under a dedicated bench dir (default: project data/local-bench).
 * Does not touch userData or system root.
 *
 * Usage:
 *   node scripts/bench-local-storage.mjs
 *   BENCH_DIR=$PWD/data/local-bench node scripts/bench-local-storage.mjs
 */
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const benchRoot = process.env.BENCH_DIR
  || path.join(projectRoot, "data", "local-bench");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const workDir = path.join(benchRoot, RUN_ID);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function df(target) {
  try {
    const out = execSync(`df -k "${target}"`, { encoding: "utf8" });
    const line = out.trim().split("\n").at(-1).split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity Mounted
    const totalKb = Number(line[1]);
    const usedKb = Number(line[2]);
    const availKb = Number(line[3]);
    const mount = line[8] || line[line.length - 1];
    return {
      totalBytes: totalKb * 1024,
      usedBytes: usedKb * 1024,
      availBytes: availKb * 1024,
      capacityPct: line[4],
      mount,
    };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

function human(n) {
  if (!Number.isFinite(n)) return String(n);
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
}

function writeSequential(file, totalBytes, chunkSize = 1024 * 1024) {
  const fd = fs.openSync(file, "w");
  const chunk = Buffer.alloc(chunkSize, 0x61);
  let written = 0;
  const t0 = process.hrtime.bigint();
  try {
    while (written < totalBytes) {
      const n = Math.min(chunkSize, totalBytes - written);
      fs.writeSync(fd, chunk, 0, n);
      written += n;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { bytes: written, ms, mibs: (written / (1024 * 1024)) / (ms / 1000) };
}

function writeJsonBurst(dir, count, approxBytesEach) {
  ensureDir(dir);
  const payload = "x".repeat(Math.max(16, approxBytesEach - 64));
  const t0 = process.hrtime.bigint();
  let bytes = 0;
  for (let i = 0; i < count; i += 1) {
    const obj = {
      i,
      ts: Date.now(),
      payload,
    };
    const s = JSON.stringify(obj);
    const f = path.join(dir, `sess-${i}.json`);
    fs.writeFileSync(f, s, "utf8");
    bytes += Buffer.byteLength(s);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { files: count, bytes, ms, opsPerSec: count / (ms / 1000) };
}

function appendLog(file, lines, lineBytes = 200) {
  const line = `${"L".repeat(lineBytes)}\n`;
  const t0 = process.hrtime.bigint();
  let bytes = 0;
  for (let i = 0; i < lines; i += 1) {
    fs.appendFileSync(file, line);
    bytes += Buffer.byteLength(line);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { lines, bytes, ms, linesPerSec: lines / (ms / 1000) };
}

function readSequential(file) {
  const t0 = process.hrtime.bigint();
  const buf = fs.readFileSync(file);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { bytes: buf.length, ms, mibs: (buf.length / (1024 * 1024)) / (ms / 1000) };
}

function main() {
  ensureDir(workDir);
  const report = {
    at: new Date().toISOString(),
    host: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    workDir,
    disks: {
      bench: df(workDir),
      project: df(projectRoot),
      home: df(os.homedir()),
      tmp: df(os.tmpdir()),
    },
    paths: {
      tmpdir: os.tmpdir(),
      home: os.homedir(),
      projectRoot,
    },
    tests: {},
  };

  // Safety: refuse if free < 500MB on bench disk
  const avail = report.disks.bench?.availBytes ?? 0;
  if (avail > 0 && avail < 500 * 1024 * 1024) {
    console.error("ABORT: bench disk free < 500MB", human(avail));
    process.exit(2);
  }

  const seqFile = path.join(workDir, "seq-32m.bin");
  report.tests.seqWrite32MiB = writeSequential(seqFile, 32 * 1024 * 1024);
  report.tests.seqRead32MiB = readSequential(seqFile);

  report.tests.jsonBurst200x4k = writeJsonBurst(
    path.join(workDir, "json-burst"),
    200,
    4 * 1024
  );

  report.tests.appendLog1000 = appendLog(
    path.join(workDir, "append.log"),
    1000,
    256
  );

  // Estimate growth models used by the app
  const model = {
    weixinBotStore: {
      pathPattern: "userData/weixin-bot.v*.json",
      estimate: "加密 token + settings + contacts；通常 < 200KB，上限建议 2MB",
      risk: "低",
    },
    agentSessions: {
      pathPattern: "BOT_STORAGE_DIR/weixin-agent-sessions.json 或 tmp",
      estimate: "每会话最多约 40 条 × 2KB ≈ 80KB；200 会话 ≈ 16MB",
      risk: "中（若落系统盘 tmp 会挤占）",
    },
    electronPartitions: {
      pathPattern: "userData/Partitions (Chromium)",
      estimate: "实测 douyin 相关合计可达 0.5–1.2GB",
      risk: "高（系统盘）",
    },
    reportPngTmp: {
      pathPattern: "临时 Buffer，一般不落盘",
      estimate: "单张报告图约 0.5–3MB 内存",
      risk: "低",
    },
    rag: {
      pathPattern: "data/rag/*.json",
      estimate: "种子 KB 级；custom 建议 cap 5MB",
      risk: "低",
    },
  };
  report.appStorageModel = model;

  // Hard caps recommendation derived from free space
  const homeAvail = report.disks.home?.availBytes ?? 0;
  const volAvail = report.disks.bench?.availBytes ?? 0;
  report.recommendations = {
    preferVolume: volAvail > homeAvail * 2 ? "project/volume" : "either",
    maxAgentSessionsFileBytes: 20 * 1024 * 1024,
    maxRagCustomBytes: 5 * 1024 * 1024,
    maxUserDataWarnBytes: 800 * 1024 * 1024,
    minFreeHomeBytes: 5 * 1024 * 1024 * 1024,
    note:
      homeAvail < 15 * 1024 * 1024 * 1024
        ? "系统盘剩余偏低：会话/锁/缓存必须迁离 tmp 与谨慎控制 userData"
        : "系统盘空间尚可",
  };

  // Cleanup large bin to avoid leaving junk (keep report)
  try {
    fs.unlinkSync(seqFile);
  } catch {
    // ignore
  }

  const outJson = path.join(benchRoot, `report-${RUN_ID}.json`);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    workDir,
    outJson,
    benchDisk: report.disks.bench,
    homeDisk: report.disks.home,
    seqWriteMibs: report.tests.seqWrite32MiB.mibs?.toFixed?.(1),
    seqReadMibs: report.tests.seqRead32MiB.mibs?.toFixed?.(1),
    jsonOps: report.tests.jsonBurst200x4k.opsPerSec?.toFixed?.(0),
    appendLines: report.tests.appendLog1000.linesPerSec?.toFixed?.(0),
  }, null, 2));
}

main();
