"use strict";

const { createWeixinAnalytics } = require("./weixin-bot-analytics");
const { ragSearch } = require("./weixin-bot-rag");

function createWeixinBotSkills({ db, renderReportPng }) {
  if (!db) throw new Error("技能模块缺少数据库");
  if (typeof renderReportPng !== "function") throw new Error("技能模块缺少报告渲染器");

  const analytics = createWeixinAnalytics({ db, renderReportPng });

  async function ragSearchTool({ query, topK = 4, collection = null } = {}) {
    const q = String(query || "").trim();
    if (!q) return { ok: false, error: "query 不能为空" };
    return ragSearch(q, { topK, collection });
  }

  const tools = [
    {
      type: "function",
      function: {
        name: "search_anchors",
        description: "按姓名/抖音号/主播ID搜索主播，用于消歧。不唯一时返回候选列表。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
      execute: analytics.searchAnchors,
    },
    {
      type: "function",
      function: {
        name: "get_anchor_full_profile",
        description: "查询主播库内全部音浪/时长数据汇总（对齐直接发艺名）",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      execute: analytics.getAnchorFullProfile,
    },
    {
      type: "function",
      function: {
        name: "get_anchor_wave_profile",
        description: "查询一位主播的音浪表现（截止日期、日音浪、累计、排名等）",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "主播姓名、抖音号或主播 ID" },
            date: { type: "string", description: "YYYY-MM-DD，可选" },
          },
          required: ["query"],
        },
      },
      execute: analytics.getAnchorWaveProfile,
    },
    {
      type: "function",
      function: {
        name: "get_anchor_wave_days",
        description: "查询主播本月有音浪天数与累计音浪",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            date: { type: "string" },
          },
          required: ["query"],
        },
      },
      execute: analytics.getAnchorWaveDays,
    },
    {
      type: "function",
      function: {
        name: "compare_anchor_wave",
        description: "比较 2-5 位主播的音浪数据",
        parameters: {
          type: "object",
          properties: {
            queries: { type: "array", items: { type: "string" } },
            date: { type: "string" },
          },
          required: ["queries"],
        },
      },
      execute: analytics.compareAnchorWave,
    },
    {
      type: "function",
      function: {
        name: "get_anchor_duration",
        description: "查询主播累计直播时长（累计分钟，非日播差分）",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            date: { type: "string" },
          },
          required: ["query"],
        },
      },
      execute: analytics.getAnchorDuration,
    },
    {
      type: "function",
      function: {
        name: "analyze_anchor_wave",
        description: "分析主播音浪序列：最新/峰值/均值/环比",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            range: { type: "string", enum: ["7d", "14d", "30d"] },
          },
          required: ["query"],
        },
      },
      execute: analytics.analyzeAnchorWave,
    },
    {
      type: "function",
      function: {
        name: "get_daily_report_data",
        description: "获取某日男团/女队日报摘要",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string" },
            gender: { type: "string", enum: ["male", "female", "both"] },
          },
        },
      },
      execute: analytics.getDailyReportData,
    },
    {
      type: "function",
      function: {
        name: "export_daily_report_image",
        description: "生成并发送男团/女队/双团每日报告图片。gender=both 时分别生成；导出选「两张」且超过 30 人时每团最多拆成 2 张，人数不够仍发一张。",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string" },
            gender: { type: "string", enum: ["male", "female", "both"] },
            title: { type: "string" },
          },
        },
      },
      execute: analytics.exportDailyReportImage,
    },
    {
      type: "function",
      function: {
        name: "export_not_live_report",
        description: "生成并发送未开播天数报告图片和 CSV。可按日或按月；gender=both 时男女各发一套。",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD，按日报告" },
            month: { type: "string", description: "YYYY-MM，按月报告" },
            gender: { type: "string", enum: ["male", "female", "both"] },
          },
        },
      },
      execute: analytics.exportNotLiveReport,
    },
    {
      type: "function",
      function: {
        name: "export_wave_file",
        description: "导出并发送某日音浪 CSV 文件",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string" },
          },
        },
      },
      execute: analytics.exportWaveFile,
    },
    {
      type: "function",
      function: {
        name: "rag_search",
        description: "检索运营知识库（帮助/规则/字段口径）。禁止用此工具回答具体音浪或时长数字。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            topK: { type: "number" },
            collection: { type: "string" },
          },
          required: ["query"],
        },
      },
      execute: ragSearchTool,
    },
  ];

  return {
    tools,
    analytics,
    definitions: tools.map(({ type, function: fn }) => ({ type, function: fn })),
    async execute(name, args) {
      const tool = tools.find((item) => item.function.name === name);
      if (!tool) return { ok: false, error: `未知工具: ${name}` };
      return tool.execute(args || {});
    },
  };
}

module.exports = {
  createWeixinBotSkills,
};
