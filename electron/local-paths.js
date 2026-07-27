"use strict";

/**
 * Local runtime paths — keep sessions/locks off system /tmp when possible.
 * Runtime locations are configurable so development and packaged processes can
 * keep bounded state on an application-owned volume.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_SESSION_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_RAG_CUSTOM_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_SESSION_MAX_SESSIONS = 200;

function projectRoot() {
  // electron/ → project root (dev). Packaged asar: still resolve sibling.
  return path.resolve(__dirname, "..");
}

function isAsarPath(p) {
  return String(p || "").includes(`${path.sep}app.asar`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Runtime root for sessions / locks / short-lived tmp.
 * Priority: BOT_STORAGE_DIR → <project>/data/runtime → os.tmpdir()/douyin-runtime
 */
function resolveRuntimeDir(env = process.env) {
  const fromEnv = String(env.BOT_STORAGE_DIR || "").trim();
  if (fromEnv) return ensureDir(path.resolve(fromEnv));

  const projectRuntime = path.join(projectRoot(), "data", "runtime");
  if (!isAsarPath(__dirname)) {
    try {
      return ensureDir(projectRuntime);
    } catch {
      // fall through
    }
  }

  const fallback = path.join(os.tmpdir(), "douyin-runtime");
  try {
    return ensureDir(fallback);
  } catch {
    return os.tmpdir();
  }
}

function resolveSessionPath(env = process.env) {
  const fromEnv = String(env.AGENT_SESSION_PATH || "").trim();
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    ensureDir(path.dirname(abs));
    return abs;
  }
  const dir = path.join(resolveRuntimeDir(env), "sessions");
  ensureDir(dir);
  return path.join(dir, "weixin-agent-sessions.json");
}

function resolveLockPath(env = process.env) {
  const fromEnv = String(env.BOT_LOCK_PATH || "").trim();
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    ensureDir(path.dirname(abs));
    return abs;
  }
  const dir = path.join(resolveRuntimeDir(env), "locks");
  ensureDir(dir);
  return path.join(dir, "weixin-bot-runner.lock");
}

/**
 * Local artifact staging root (iLink media / CSV / report buffers).
 * Priority: ARTIFACT_ROOT → BOT_STORAGE_DIR/artifacts → <runtime>/artifacts
 * Never defaults straight to os.tmpdir()/douyin-artifacts when project runtime is usable.
 */
function resolveArtifactRoot(env = process.env) {
  const fromEnv = String(env.ARTIFACT_ROOT || "").trim();
  if (fromEnv) return ensureDir(path.resolve(fromEnv));

  const storage = String(env.BOT_STORAGE_DIR || "").trim();
  if (storage) {
    return ensureDir(path.join(path.resolve(storage), "artifacts"));
  }

  return ensureDir(path.join(resolveRuntimeDir(env), "artifacts"));
}

function artifactMaxBytes(env = process.env) {
  const n = Number(env.ARTIFACT_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20 * 1024 * 1024;
}

function artifactTtlMs(env = process.env) {
  const n = Number(env.ARTIFACT_TTL_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30 * 60_000;
}

function resolveWorkerStatusPath(env = process.env) {
  const fromEnv = String(env.BOT_WORKER_STATUS_PATH || "").trim();
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    ensureDir(path.dirname(abs));
    return abs;
  }
  return path.join(resolveRuntimeDir(env), "bot-worker-status.json");
}

function resolveLocalTmpDir(env = process.env) {
  const fromEnv = String(env.LOCAL_TMP_DIR || "").trim();
  if (fromEnv) return ensureDir(path.resolve(fromEnv));
  return ensureDir(path.join(resolveRuntimeDir(env), "tmp"));
}

/**
 * Per-user Weixin agent memory (threads + habit profiles).
 * Priority: AI_USER_MEMORY_PATH → <runtime>/memory/weixin-user-memory.json
 */
function resolveUserMemoryPath(env = process.env) {
  const fromEnv = String(env.AI_USER_MEMORY_PATH || "").trim();
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    ensureDir(path.dirname(abs));
    return abs;
  }
  const dir = path.join(resolveRuntimeDir(env), "memory");
  ensureDir(dir);
  return path.join(dir, "weixin-user-memory.json");
}

function resolveRagCustomPath(env = process.env) {
  const fromEnv = String(env.RAG_CUSTOM_PATH || "").trim();
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    ensureDir(path.dirname(abs));
    return abs;
  }
  const dir = path.join(resolveRuntimeDir(env), "rag");
  ensureDir(dir);
  return path.join(dir, "custom.json");
}

function sessionMaxBytes(env = process.env) {
  const n = Number(env.AGENT_SESSION_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SESSION_MAX_BYTES;
}

function sessionMaxSessions(env = process.env) {
  const n = Number(env.AGENT_SESSION_MAX_SESSIONS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SESSION_MAX_SESSIONS;
}

function ragCustomMaxBytes(env = process.env) {
  const n = Number(env.RAG_CUSTOM_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RAG_CUSTOM_MAX_BYTES;
}

function diskFreeBytes(targetPath) {
  try {
    // Node 18.15+ ; fallback null
    if (typeof fs.statfsSync === "function") {
      const s = fs.statfsSync(targetPath);
      return Number(s.bavail) * Number(s.bsize);
    }
  } catch {
    // ignore
  }
  return null;
}

function formatBytes(n) {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

/**
 * One-line storage doctor for startup logs.
 */
function getStorageReport(env = process.env) {
  const runtimeDir = resolveRuntimeDir(env);
  const sessionPath = resolveSessionPath(env);
  const lockPath = resolveLockPath(env);
  const workerStatusPath = resolveWorkerStatusPath(env);
  const artifactRoot = resolveArtifactRoot(env);
  const tmpDir = resolveLocalTmpDir(env);
  const ragCustom = resolveRagCustomPath(env);
  const freeRuntime = diskFreeBytes(runtimeDir);
  const freeHome = diskFreeBytes(os.homedir());
  const freeArtifacts = diskFreeBytes(artifactRoot);
  const warnings = [];
  if (freeHome != null && freeHome < 5 * 1024 * 1024 * 1024) {
    warnings.push(`系统盘可用 ${formatBytes(freeHome)} < 5GB，避免写 /tmp`);
  }
  if (sessionPath.startsWith(os.tmpdir()) || lockPath.startsWith(os.tmpdir())) {
    warnings.push("会话或锁仍落在系统临时目录");
  }
  if (artifactRoot.startsWith(os.tmpdir())) {
    warnings.push("Artifact 根目录落在系统临时目录；请设置 ARTIFACT_ROOT 或 BOT_STORAGE_DIR");
  }
  return {
    runtimeDir,
    sessionPath,
    lockPath,
    workerStatusPath,
    artifactRoot,
    tmpDir,
    ragCustomPath: ragCustom,
    freeRuntime: formatBytes(freeRuntime),
    freeHome: formatBytes(freeHome),
    freeArtifacts: formatBytes(freeArtifacts),
    sessionMaxBytes: sessionMaxBytes(env),
    ragCustomMaxBytes: ragCustomMaxBytes(env),
    artifactMaxBytes: artifactMaxBytes(env),
    artifactTtlMs: artifactTtlMs(env),
    warnings,
  };
}

function logStorageReport(env = process.env, logger = console) {
  const r = getStorageReport(env);
  const line = `[storage] runtime=${r.runtimeDir} session=${r.sessionPath} lock=${r.lockPath} artifacts=${r.artifactRoot} homeFree=${r.freeHome} runtimeFree=${r.freeRuntime}`;
  if (typeof logger.log === "function") logger.log(line);
  for (const w of r.warnings) {
    if (typeof logger.warn === "function") logger.warn(`[storage] WARN ${w}`);
  }
  return r;
}

module.exports = {
  projectRoot,
  resolveRuntimeDir,
  resolveSessionPath,
  resolveLockPath,
  resolveWorkerStatusPath,
  resolveArtifactRoot,
  resolveLocalTmpDir,
  resolveUserMemoryPath,
  resolveRagCustomPath,
  sessionMaxBytes,
  sessionMaxSessions,
  ragCustomMaxBytes,
  artifactMaxBytes,
  artifactTtlMs,
  getStorageReport,
  logStorageReport,
  formatBytes,
  DEFAULT_SESSION_MAX_BYTES,
  DEFAULT_RAG_CUSTOM_MAX_BYTES,
  DEFAULT_SESSION_MAX_SESSIONS,
};
