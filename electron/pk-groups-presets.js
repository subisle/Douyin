"use strict";

/**
 * PK 命名分组存档（主进程可读，多份）。
 *
 * 背景：分组存档本身在渲染进程 localStorage，微信/QQ bot 跑在主进程读不到。
 * 旧方案只同步「激活的那一份」（pk-groups-layout.json），导致 bot 只能出激活分组的图，
 * 想出「9.6分组」就得先去软件里把它切成激活 —— 会把 9.1 顶掉。
 *
 * 这里存全部命名分组，bot 命令可直接按名字（9.6 / 9.6分组）取用，互不干扰。
 */
const fs = require("fs");
const path = require("path");
const { resolveRuntimeDir } = require("./local-paths");

const FILE_NAME = "pk-groups-presets.json";

function resolvePresetsPath() {
  return path.join(resolveRuntimeDir(), FILE_NAME);
}

function normalizePreset(input) {
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
    savedAt: String(source.savedAt || "").trim(),
  };
}

function readPresets() {
  try {
    const file = resolvePresetsPath();
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(parsed?.presets) ? parsed.presets : [];
    return list.map(normalizePreset).filter(Boolean);
  } catch {
    return [];
  }
}

function writePresets(list) {
  const presets = (Array.isArray(list) ? list : []).map(normalizePreset).filter(Boolean);
  const file = resolvePresetsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = { updatedAt: new Date().toISOString(), presets };
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
  return presets;
}

/** 归一化名字用于匹配：去空白、全角点转半角、统一小写 */
function canonKey(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[．。]/g, ".")
    .toLowerCase();
}

/**
 * 按名字找分组存档。匹配优先级：
 * 1. 完全相等（9.6分组）
 * 2. 存档名以查询开头（9.6 → 9.6分组）
 * 3. 存档名去掉「分组」后缀后与查询相等（9.6分组 ← 9.6）
 */
function findPresetByName(name) {
  const key = canonKey(name);
  if (!key) return null;
  const presets = readPresets();
  const exact = presets.filter((p) => canonKey(p.name) === key);
  if (exact.length) return exact[exact.length - 1];
  // 前缀匹配（9.6 → 9.6分组）；单字符不做前缀匹配，否则「8组」的 8 会误命中「8月月底」
  if (key.length >= 2) {
    const prefixed = presets.filter((p) => canonKey(p.name).startsWith(key));
    if (prefixed.length) return prefixed[prefixed.length - 1];
  }
  const stripped = presets.filter((p) => canonKey(p.name).replace(/分组$/, "") === key);
  if (stripped.length) return stripped[stripped.length - 1];
  return null;
}

module.exports = {
  FILE_NAME,
  resolvePresetsPath,
  normalizePreset,
  readPresets,
  writePresets,
  findPresetByName,
  canonKey,
};
