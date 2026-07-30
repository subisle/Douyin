"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { latestWaveFromDayMap } = require("./pk-roster-stats");

test("latestWaveFromDayMap picks max date wave", () => {
  const dm = new Map([
    ["2026-07-01", 100],
    ["2026-07-15", 50],
    ["2026-07-09", 999],
  ]);
  assert.deepEqual(latestWaveFromDayMap(dm), {
    latestWave: 50,
    latestWaveDate: "2026-07-15",
  });
});

test("latestWaveFromDayMap empty → 0", () => {
  assert.deepEqual(latestWaveFromDayMap(new Map()), {
    latestWave: 0,
    latestWaveDate: null,
  });
  assert.deepEqual(latestWaveFromDayMap(null), {
    latestWave: 0,
    latestWaveDate: null,
  });
});

test("latestWaveFromDayMap accepts plain object", () => {
  assert.deepEqual(
    latestWaveFromDayMap({ "2026-07-02": 10, "2026-07-03": 20 }),
    { latestWave: 20, latestWaveDate: "2026-07-03" }
  );
});
