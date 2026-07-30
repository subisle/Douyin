const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildDailyTop3Text,
  matchDailyPushCommand,
  pickTopByDailyWave,
  resolveDailyPushTargets,
  normalizeDailyReportPushSettings,
  formatDailyPushStatusText,
} = require("./weixin-bot-daily-push");

test("pickTopByDailyWave sorts by daily wave", () => {
  const top = pickTopByDailyWave([
    { name: "C", dailyWave: 100, rank: 3 },
    { name: "A", dailyWave: 900, rank: 1 },
    { name: "B", dailyWave: 500, rank: 2 },
    { name: "D", dailyWave: 50, rank: 4 },
  ], 3);
  assert.deepEqual(top.map((r) => r.name), ["A", "B", "C"]);
});

test("buildDailyTop3Text includes male and female blocks", () => {
  const text = buildDailyTop3Text(
    "2026-07-30",
    { rows: [{ name: "浩鸣", dailyWave: 500_000 }, { name: "狼澈", dailyWave: 230_000 }] },
    { rows: [{ name: "玖妹", dailyWave: 120_000 }] }
  );
  assert.match(text, /2026-07-30 当日音浪前三/);
  assert.match(text, /【男团】/);
  assert.match(text, /浩鸣 · 50 万/);
  assert.match(text, /【女队】/);
  assert.match(text, /玖妹 · 12 万/);
});

test("matchDailyPushCommand parses admin toggles", () => {
  assert.deepEqual(matchDailyPushCommand("开启日报推送"), { type: "enable" });
  assert.deepEqual(matchDailyPushCommand("关闭日报推送"), { type: "disable" });
  assert.deepEqual(matchDailyPushCommand("日报推送状态"), { type: "status" });
  assert.equal(matchDailyPushCommand("每日报告"), null);
});

test("resolveDailyPushTargets prefers explicit recipients with context", () => {
  const contexts = new Map([
    ["acc::u1", { contextToken: "tok1", toUserId: "u1" }],
    ["acc::g1", { contextToken: "tokg", toUserId: "u9", groupId: "g1" }],
  ]);
  const targets = resolveDailyPushTargets({
    accountId: "acc",
    contacts: [
      { accountId: "acc", id: "u1", kind: "user", conversationId: "u1", contextToken: "tok1" },
      { accountId: "acc", id: "u2", kind: "user", conversationId: "u2", contextToken: "tok2" },
      { accountId: "acc", id: "g1", kind: "group", conversationId: "g1", groupId: "g1", contextToken: "tokg", toUserId: "u9" },
    ],
    contexts,
    accessPolicy: { accessMode: "allowlist", allowUserIds: ["u1", "u2"], allowGroupIds: ["g1"] },
    pushSettings: {
      enabled: true,
      recipientUserIds: ["u1"],
      recipientGroupIds: ["g1"],
      adminUserIds: [],
    },
    accountScopedKey: (a, c) => `${a}::${c}`,
  });
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map((t) => t.id).sort(), ["g1", "u1"]);
});

test("normalize + status text", () => {
  const cfg = normalizeDailyReportPushSettings({ enabled: 1, adminUserIds: ["a", "a", ""] });
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.adminUserIds, ["a"]);
  const text = formatDailyPushStatusText(cfg);
  assert.match(text, /已开启/);
  assert.match(text, /管理员：a/);
});


const { createWeixinCommandHandler } = require("./weixin-bot-commands");

test("command handler toggles daily push for admin", async () => {
  let enabled = false;
  const replies = [];
  const handler = createWeixinCommandHandler({
    db: {
      getAnchors: async () => [],
      getDailyWaveReport: async () => ({ rows: [] }),
      exportWaveSnapshots: async () => [],
    },
    renderReportPng: async () => Buffer.from("x"),
    dailyPush: {
      isAdmin: (id) => id === "admin1",
      getStatusText: () => `日报自动推送：${enabled ? "已开启" : "已关闭"}`,
      setEnabled: (v) => { enabled = Boolean(v); return { enabled }; },
      notifyAfterImport: async () => ({}),
    },
  });
  const base = {
    fromUserId: "admin1",
    accountId: "acc",
    text: "开启日报推送",
    items: [],
    replyText: async (t) => { replies.push(t); },
  };
  assert.equal((await handler(base)).handled, true);
  assert.equal(enabled, true);
  assert.equal((await handler({ ...base, text: "日报推送状态" })).handled, true);
  assert.match(replies.at(-1), /已开启/);
  assert.equal((await handler({ ...base, fromUserId: "other", text: "关闭日报推送" })).handled, true);
  assert.equal(enabled, true);
  assert.match(replies.at(-1), /仅管理员/);
  assert.equal((await handler({ ...base, text: "关闭日报推送" })).handled, true);
  assert.equal(enabled, false);
});
