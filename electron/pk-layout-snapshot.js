"use strict";

/**
 * PK 分组布局快照（主进程可读）。
 * 分组存档本身在渲染进程 localStorage，微信/QQ bot 跑在主进程读不到，
 * 因此每次保存分组时同步一份到运行目录，供 bot 命令出图使用。
 */
const fs = require("fs");
const path = require("path");
const { resolveRuntimeDir } = require("./local-paths");

const FILE_NAME = "pk-groups-layout.json";

function resolveLayoutSnapshotPath() {
  return path.join(resolveRuntimeDir(), FILE_NAME);
}

function normalizeSnapshot(input) {
  const source = input && typeof input === "object" ? input : null;
  if (!source) return null;
  const nameGroups = Array.isArray(source.nameGroups)
    ? source.nameGroups
        .map((group) =>
          Array.isArray(group)
            ? group.map((name) => String(name || "").trim()).filter(Boolean)
            : []
        )
        .filter((group) => group.length > 0)
    : [];
  if (!nameGroups.length) return null;
  const groupLabels = Array.isArray(source.groupLabels)
    ? source.groupLabels.map((label) => String(label || "").trim())
    : [];
  return {
    id: String(source.id || "").trim(),
    name: String(source.name || "").trim(),
    note: String(source.note || "").trim(),
    period: String(source.period || "").trim(),
    mode: String(source.mode || "").trim(),
    scoreDisplay: String(source.scoreDisplay || "").trim(),
    groupSize: Number(source.groupSize) || 0,
    firstStart: String(source.firstStart || "").trim(),
    stepMinutes: Number(source.stepMinutes) || 0,
    reviveExtraMinutes: Number(source.reviveExtraMinutes) || 0,
    nameGroups,
    groupLabels,
    updatedAt: new Date().toISOString(),
  };
}

function readLayoutSnapshot() {
  try {
    const file = resolveLayoutSnapshotPath();
    if (!fs.existsSync(file)) return null;
    return normalizeSnapshot(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function writeLayoutSnapshot(input) {
  const snapshot = normalizeSnapshot(input);
  if (!snapshot) return null;
  const file = resolveLayoutSnapshotPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
  return snapshot;
}

function clearLayoutSnapshot() {
  try {
    const file = resolveLayoutSnapshotPath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  FILE_NAME,
  resolveLayoutSnapshotPath,
  normalizeSnapshot,
  readLayoutSnapshot,
  writeLayoutSnapshot,
  clearLayoutSnapshot,
};
