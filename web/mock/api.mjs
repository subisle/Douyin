// 仅用于本地看 UI 的假数据接口（没有 MySQL 时的临时替代品）。
// 真后端是 server/ 下的 Go 服务，接上 MySQL 后这个脚本就该删掉。
//
// 启动：node web/mock/api.mjs

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sampleSvg = (name) => readFileSync(join(here, "samples", `${name}.svg`), "utf8");

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

let qqConfigured = false;
// 微信扫码登录的假流程：取码 → 2 次未扫 → 已扫码 → 登录成功
let loginPollCount = 0;

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
    res.end();
    return;
  }

  // 兜底：其他 POST（如导入）统一回成功。必须放在所有具体路由之后。
  if (req.method === "POST" && !pathname.startsWith("/api/v1/bots/")) {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ data: { batchId: 1, imported: 0, persons: 0, skipped: [] } }));
    return;
  }

  // 导出图：直接返回 Go 渲染器生成的样例 SVG（internal/render 的 golden 输出）
  if (pathname === "/api/v1/exports/report.svg") {
    const style = new URL(req.url, "http://localhost").searchParams.get("style");
    const name = style === "apple" ? "apple" : "classic";
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(sampleSvg(name));
    return;
  }

// 机器人状态
  if (pathname === "/api/v1/bots/status") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      data: {
        channels: [
          { name: "weixin", running: loginPollCount >= 3, connected: loginPollCount >= 3, note: loginPollCount >= 3 ? "已登录" : "尚未扫码" },
          { name: "qq", running: qqConfigured, connected: qqConfigured, note: qqConfigured ? "凭证已配置" : "尚未配置凭证" },
        ],
        push: false,
      },
    }));
    return;
  }

  // 微信：取二维码（mock 返回一个假内容，前端本地渲染）
  if (pathname === "/api/v1/bots/weixin/qrcode") {
    loginPollCount = 0;
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      data: {
        qrcode: "https://work.weixin.qq.com/mock-qrcode-demo",
        url: "",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    }));
    return;
  }

  // 微信：轮询扫码状态
  if (pathname === "/api/v1/bots/weixin/qrcode/status") {
    loginPollCount += 1;
    const phase = loginPollCount >= 3 ? "running" : loginPollCount === 2 ? "scanned" : "awaiting_scan";
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      data: {
        phase,
        scanned: loginPollCount >= 2,
        loggedIn: loginPollCount >= 3,
        nickname: phase === "running" ? "演示账号" : undefined,
      },
    }));
    return;
  }

  // QQ：保存凭证（mock 只记个开关）
  if (pathname === "/api/v1/bots/qq/credentials") {
    qqConfigured = true;
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ data: { mounted: true } }));
    return;
  }

  // 指令试玩：这里只是够演示的简化版，真实解析在 Go 的 internal/bot（22 个单测覆盖）
  if (pathname === "/api/v1/bots/parse") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body || "{}").text || "";
    const t = String(input).trim();
    const intent = { Kind: "person_query", Date: "", Period: "", Year: 0, Query: t, Gender: "" };
    const now = new Date();
    const y = now.getFullYear();
    const pad = (n) => String(n).padStart(2, "0");

    if (/帮助|^help$/.test(t)) { intent.Kind = "help"; intent.Query = ""; }
    else if (/推送/.test(t)) {
      intent.Kind = /开启/.test(t) || /关闭/.test(t) ? "push_toggle" : "push_status";
      intent.Query = "";
    } else if (/之星/.test(t)) { intent.Kind = "daily_star"; intent.Query = ""; intent.Date = `${y}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; }
    else if (/^20\d{2}年?$/.test(t) || /年报/.test(t)) { intent.Kind = "yearly_report"; intent.Year = Number(t.slice(0, 4)) || y; intent.Query = ""; }
    else if (/(月报)|(\d{1,2}\s*月$)|(20\d{2}\s*[年./-]\s*\d{1,2}\s*月?$)/.test(t)) {
      intent.Kind = "monthly_report";
      const m = t.match(/(\d{1,2})\s*月/);
      intent.Period = `${y}-${pad(m ? Number(m[1]) : now.getMonth() + 1)}`;
      intent.Query = "";
    } else if (/(日报|报告)/.test(t)) {
      intent.Kind = "daily_report";
      const d = t.match(/(\d{1,2})\s*[日号]/);
      intent.Date = `${y}-${pad(now.getMonth() + 1)}-${pad(d ? Number(d[1]) : now.getDate())}`;
      intent.Query = "";
    } else if (/^(\d{1,2})[.．](\d{1,2})$/.test(t)) {
      // 裸日期 = 预告导入日（615 语义），不再是日报
      const m = t.match(/^(\d{1,2})[.．](\d{1,2})$/);
      intent.Kind = "import_date";
      intent.Date = `${y}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
      intent.Query = "";
    } else if (/昨天|昨日/.test(t)) {
      const d = new Date(now.getTime() - 86400000);
      intent.Kind = "daily_report";
      intent.Date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      intent.Query = "";
    }

    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ data: { input: t, intent } }));
    return;
  }

  // 启停与推送开关：mock 下只回成功
  if (/^\/api\/v1\/bots\//.test(pathname)) {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ data: { ok: true } }));
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
