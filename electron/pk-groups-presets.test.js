"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  readPresets,
  writePresets,
  findPresetByName,
  canonKey,
} = require("./pk-groups-presets");

/** 用例之间隔离：用 BOT_STORAGE_DIR 把运行目录指到临时目录 */
function withTempRuntime(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pk-presets-"));
  const original = process.env.BOT_STORAGE_DIR;
  try {
    process.env.BOT_STORAGE_DIR = dir;
    fn(dir);
  } finally {
    if (original === undefined) delete process.env.BOT_STORAGE_DIR;
    else process.env.BOT_STORAGE_DIR = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SAMPLE = [
  {
    id: "a",
    name: "9.1分组",
    period: "2026-09",
    firstStart: "12:15",
    stepMinutes: 15,
    reviveExtraMinutes: 10,
    nameGroups: [["狼途", "狼俊"], ["浩森", "浩坤"], ["啸辰", "啸泽"]],
    groupLabels: ["第1组", "第2组", "第3组"],
  },
  {
    id: "b",
    name: "9.6分组",
    period: "2026-09",
    firstStart: "08:15",
    stepMinutes: 15,
    reviveExtraMinutes: 0,
    nameGroups: [["玖玥", "浩鸣"], ["浩龙", "啸安"]],
    groupLabels: ["晋级1组", "晋级2组"],
  },
];

test("canonKey 归一化：去空白、全角点转半角、小写", () => {
  assert.equal(canonKey(" 9．6分组 "), "9.6分组");
  assert.equal(canonKey("9.6"), "9.6");
});

test("读写往返：多份分组存档并存且字段保留", () => {
  withTempRuntime(() => {
    const saved = writePresets(SAMPLE);
    assert.equal(saved.length, 2);
    const read = readPresets();
    assert.equal(read.length, 2);
    const s6 = read.find((p) => p.name === "9.6分组");
    assert.ok(s6, "应能读到 9.6分组");
    assert.equal(s6.firstStart, "08:15");
    assert.equal(s6.stepMinutes, 15);
    assert.equal(s6.reviveExtraMinutes, 0);
    assert.deepEqual(s6.groupLabels, ["晋级1组", "晋级2组"]);
    assert.deepEqual(s6.nameGroups, [["玖玥", "浩鸣"], ["浩龙", "啸安"]]);
  });
});

test("非法数据被过滤：空分组 / 非对象", () => {
  withTempRuntime(() => {
    const saved = writePresets([
      ...SAMPLE,
      { name: "空分组", nameGroups: [] },
      { name: "坏数据", nameGroups: "not-an-array" },
      null,
    ]);
    assert.equal(saved.length, 2);
  });
});

test("按名查找：完整名 / 前缀 / 去「分组」后缀", () => {
  withTempRuntime(() => {
    writePresets(SAMPLE);
    assert.equal(findPresetByName("9.6分组")?.name, "9.6分组");
    assert.equal(findPresetByName("9.6")?.name, "9.6分组");
    assert.equal(findPresetByName("9.1")?.name, "9.1分组");
    assert.equal(findPresetByName("9.1分组")?.name, "9.1分组");
  });
});

test("按名查找：单字符不做前缀匹配（避免「8组」误命中「8月月底」）", () => {
  withTempRuntime(() => {
    writePresets([...SAMPLE, { name: "8月月底", nameGroups: [["浩龙", "浩楠"]] }]);
    assert.equal(findPresetByName("8"), null, "单字符不应前缀命中 8月月底");
    assert.equal(findPresetByName("8月月底")?.name, "8月月底");
  });
});

test("按名查找：查不到返回 null，空输入安全", () => {
  withTempRuntime(() => {
    writePresets(SAMPLE);
    assert.equal(findPresetByName("不存在的分组"), null);
    assert.equal(findPresetByName(""), null);
    assert.equal(findPresetByName(null), null);
  });
});
