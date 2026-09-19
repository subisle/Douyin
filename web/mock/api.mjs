// 仅用于本地看 UI 的假数据接口（没有 MySQL 时的临时替代品）。
// 真后端是 server/ 下的 Go 服务，接上 MySQL 后这个脚本就该删掉。
//
// 启动：node web/mock/api.mjs

import { createServer } from "node:http";

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const period = day(0).slice(0, 7);
const year = Number(day(0).slice(0, 4));

const persons = [
  { id: 1, name: "柚子", gender: "female", status: "active", groupName: "薇笑传媒", hideInDailyReport: false },
  { id: 2, name: "小满", gender: "female", status: "active", groupName: "薇笑传媒", hideInDailyReport: false },
  { id: 3, name: "初夏", gender: "female", status: "active", groupName: "薇笑传媒", hideInDailyReport: false },
  { id: 4, name: "阿泽", gender: "male", status: "active", groupName: "星嗨艺创", hideInDailyReport: false },
  { id: 5, name: "老K", gender: "male", status: "active", groupName: "星嗨艺创", hideInDailyReport: false },
  { id: 6, name: "大鹏", gender: "male", status: "paused", groupName: "星嗨艺创", hideInDailyReport: false },
];

const mkDaily = (p, i, wave, minutes, live = true, reliable = true) => ({
  personId: p.id,
  anchorId: `anchor-${p.id}`,
  bizDate: day(0),
  wave,
  cumulativeWave: wave * 40 + 120000,
  waveSpan: reliable ? 1 : 3,
  waveReliable: reliable,
  minutes,
  isLive: live,
  tier: wave >= 500000 ? "A" : wave >= 200000 ? "B" : wave >= 50000 ? "C" : "D",
  name: p.name,
  gender: p.gender,
  masterName: i < 2 ? "薇笑" : null,
});

const daily = [
  mkDaily(persons[0], 0, 386000, 320),
  mkDaily(persons[1], 1, 214000, 280),
  mkDaily(persons[2], 2, 96000, 190),
  mkDaily(persons[3], 3, 512000, 410),
  mkDaily(persons[4], 4, 143000, 240, true, false),
  mkDaily(persons[5], 5, 0, 0, false),
];

const monthly = persons.slice(0, 5).map((p, i) => ({
  personId: p.id,
  period,
  wave: [8600000, 5210000, 2870000, 11300000, 3960000][i],
  minutes: [9300, 7400, 5200, 11800, 6100][i],
  formattedDuration: ["155h", "123h20m", "86h40m", "196h40m", "101h40m"][i],
  liveDays: [28, 26, 22, 30, 24][i],
  absentDays: [2, 4, 8, 0, 6][i],
  bestDayWave: [520000, 310000, 180000, 640000, 240000][i],
  avgWavePerLiveDay: [307142, 200384, 130454, 376666, 165000][i],
  tier: ["A", "A", "B", "A", "B"][i],
  unreliableDays: [0, 1, 0, 2, 3][i],
  name: p.name,
  gender: p.gender,
}));

const yearly = persons.slice(0, 5).map((p, i) => ({
  personId: p.id,
  year,
  wave: [68400000, 41300000, 22800000, 90200000, 31500000][i],
  minutes: [74200, 59400, 41600, 94400, 48800][i],
  formattedDuration: ["1236h40m", "990h", "693h20m", "1573h20m", "813h20m"][i],
  liveDays: [312, 298, 254, 340, 276][i],
  activeMonths: [11, 11, 10, 12, 10][i],
  bestMonth: `${year}-0${(i % 9) + 1}`,
  bestMonthWave: [9100000, 6200000, 3400000, 12400000, 4700000][i],
  bestDayWave: [620000, 410000, 230000, 780000, 320000][i],
  avgMonthWave: [6218181, 3754545, 2280000, 7516666, 3150000][i],
  tier: ["A", "A", "B", "A", "B"][i],
  name: p.name,
  gender: p.gender,
}));

// 首页：30 天趋势 + KPI + 预警 + 榜单
const trend = Array.from({ length: 30 }, (_, i) => {
  const d = day(29 - i);
  const female = Math.round(280000 + Math.sin(i / 3) * 70000 + (i % 7 === 0 ? -90000 : 0));
  const male = Math.round(430000 + Math.cos(i / 4) * 95000 + (i % 5 === 0 ? -120000 : 0));
  return { date: d, female, male, total: female + male };
});

const totalToday = trend[29].total;
const totalPrev = trend[28].total;

const dashboard = {
  summary: {
    date: day(0),
    totalWave: totalToday,
    prevWave: totalPrev,
    liveCount: 42,
    totalCount: 48,
    monthWave: trend.reduce((s, p) => s + p.total, 0),
    monthMinutes: 748800,
    monthProgress: 0.63,
  },
  trend,
  absent: [
    { personId: 6, name: "大鹏", gender: "male", days: 5 },
    { personId: 7, name: "青禾", gender: "female", days: 3 },
    { personId: 8, name: "南风", gender: "female", days: 2 },
    { personId: 9, name: "木子", gender: "male", days: 2 },
    { personId: 10, name: "阿岩", gender: "male", days: 1 },
  ],
  top: [
    { personId: 4, name: "阿泽", gender: "male", wave: 512000, minutes: 410, tier: "A" },
    { personId: 1, name: "柚子", gender: "female", wave: 386000, minutes: 320, tier: "B" },
    { personId: 2, name: "小满", gender: "female", wave: 214000, minutes: 280, tier: "B" },
    { personId: 5, name: "老K", gender: "male", wave: 143000, minutes: 240, tier: "C" },
    { personId: 3, name: "初夏", gender: "female", wave: 96000, minutes: 190, tier: "C" },
  ],
};

const routes = {
  "/api/v1/persons": persons,
  "/api/v1/metrics/dashboard": dashboard,
  "/api/v1/metrics/daily": daily,
  "/api/v1/metrics/monthly": monthly,
  "/api/v1/metrics/yearly": yearly,
};

createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
    res.end();
    return;
  }

  if (req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ data: { batchId: 1, imported: 0, persons: 0, skipped: [] } }));
    return;
  }

  const data = routes[pathname];
  if (!data) {
    res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "mock 接口没有这个路径" } }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify({ data }));
}).listen(8080, () => {
  console.log("mock API 已在 http://127.0.0.1:8080 就绪（假数据，仅供看 UI）");
});
