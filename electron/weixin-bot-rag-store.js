"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  resolveRagCustomPath,
  ragCustomMaxBytes,
} = require("./local-paths");

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10;

function lockToken() {
  return `${process.pid}:${crypto.randomUUID()}`;
}

function tryAcquireLock(file) {
  const lockFile = `${file}.write.lock`;
  const token = lockToken();
  try {
    const handle = fs.openSync(lockFile, "wx", 0o600);
    fs.writeFileSync(handle, token, "utf8");
    return {
      release() {
        try {
          fs.closeSync(handle);
        } catch {
          // The descriptor may already be closed after an I/O failure.
        }
        try {
          if (fs.readFileSync(lockFile, "utf8") === token) fs.unlinkSync(lockFile);
        } catch {
          // A stale lock may have been reclaimed by another writer.
        }
      },
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      if (Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(lockFile);
      }
    } catch (statError) {
      if (statError?.code !== "ENOENT") throw statError;
    }
    return null;
  }
}

async function withWriteLock(file, operation, options = {}) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : LOCK_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lock = null;
  while (!lock) {
    lock = tryAcquireLock(target);
    if (lock) break;
    if (Date.now() >= deadline) throw new Error("知识库写入锁等待超时");
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
  }
  try {
    return await operation(target);
  } finally {
    lock.release();
  }
}

function readCustomFile(file, maxBytes) {
  if (!fs.existsSync(file)) return { collection: "custom", documents: [] };
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("知识库文件不是普通文件");
  if (stat.size > maxBytes) throw new Error("知识库文件超过容量上限");

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("知识库文件格式损坏，请先修复后再写入");
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.documents)) {
    throw new Error("知识库文件格式损坏，请先修复后再写入");
  }
  return {
    collection: String(raw.collection || "custom"),
    documents: raw.documents,
  };
}

function writeCustomFile(file, data, maxBytes) {
  const serialized = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new Error("知识库文件超过容量上限");
  }
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows does not implement POSIX file modes.
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function appendCustomDocument(
  document,
  { file = resolveRagCustomPath(), maxBytes = ragCustomMaxBytes() } = {}
) {
  const id = String(document?.id || "").trim();
  const title = String(document?.title || "").trim();
  const text = String(document?.text || "").trim();
  if (!id || !title || !text) throw new Error("知识库文档字段不能为空");

  return withWriteLock(file, (target) => {
    const current = readCustomFile(target, maxBytes);
    if (current.documents.some((item) => String(item?.id || "") === id)) {
      throw new Error("知识库文档 ID 已存在");
    }
    current.documents.push({ id, title, text });
    writeCustomFile(target, current, maxBytes);
    return { id };
  });
}

module.exports = {
  appendCustomDocument,
  readCustomFile,
  withWriteLock,
};
