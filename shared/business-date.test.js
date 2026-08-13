"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  businessDateStr,
  resolveDailyReportDefaultDate,
  resolveMonthlyReportMonth,
} = require("./business-date");

test("businessDateStr is yesterday in local time", () => {
  assert.equal(businessDateStr(new Date(2026, 7, 14, 9, 0, 0)), "2026-08-13");
});

test("daily report prefers latest wave date and ignores duration month-end", () => {
  assert.equal(
    resolveDailyReportDefaultDate({
      latestDurationDate: "2026-07-31",
      latestWaveDate: "2026-08-13",
      latestDataDate: "2026-08-13",
    }),
    "2026-08-13"
  );
});

test("daily report falls back to yesterday when only duration month-end exists", () => {
  assert.equal(
    resolveDailyReportDefaultDate(
      {
        latestDurationDate: "2026-07-31",
        latestWaveDate: null,
        latestDataDate: "2026-07-31",
      },
      new Date(2026, 7, 14, 10, 0, 0)
    ),
    "2026-08-13"
  );
});

test("monthly report can use duration month", () => {
  assert.equal(
    resolveMonthlyReportMonth({
      latestDurationDate: "2026-07-31",
      latestWaveDate: "2026-08-13",
    }),
    "2026-07"
  );
});
