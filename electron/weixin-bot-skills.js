"use strict";

const fs = require("fs");
const path = require("path");
const { createWeixinAnalytics } = require("./weixin-bot-analytics");
const { ragSearch } = require("./weixin-bot-rag");
const {
  buildPkGroups,
  formatGroupsText,
  groupsToCsv,
  canonicalName,
  DEFAULT_GROUP_SIZE,
  DEFAULT_MIN_GAP,
} = require("./pk-group-engine");
const { renderPkGroupsPng } = require("./pk-group-image");
const {
  PRESET_BATTLE_GROUPS,
  PRESET_BATTLE_META,
  flattenPresetRosterNames,
} = require("../shared/pk-preset-battle-groups");


function loadPresetRosterNames() {
  try {
    const shared = flattenPresetRosterNames();
    if (shared.length) return shared;
  } catch {
    /* fall through to TS regex */
  }
  try {
    const file = path.join(__dirname, "../src/components/desktop/pk-roster-config.ts");
    const text = fs.readFileSync(file, "utf8");
    const match = text.match(/PRESET_ROSTER_TEXT = `([\s\S]*?)`;/);
    if (!match) return [];
    return match[1]
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function createWeixinBotSkills({ db, renderReportPng }) {
  if (!db) throw new Error("技能模块缺少数据库");
  if (typeof renderReportPng !== "function") throw new Error("技能模块缺少报告渲染器");

  const analytics = createWeixinAnalytics({ db, renderReportPng });

  async function ragSearchTool({ query, topK = 4, collection = null } = {}) {
    const q = String(query || "").trim();
    if (!q) return { ok: false, error: "query 不能为空" };
    return ragSearch(q, { topK, collection });
  }

  async function makePkGroupsTool(args = {}) {
    const modeRaw = String(args.mode || "preset").trim().toLowerCase();
    const mode =
      modeRaw === "balanced" ||
      modeRaw === "balance" ||
      modeRaw === "蛇形" ||
      modeRaw === "均衡" ||
      modeRaw === "平均"
        ? "balanced"
        : modeRaw === "score_capable" ||
            modeRaw === "score-capable" ||
            modeRaw === "neng_chu_fen" ||
            modeRaw === "能出分" ||
            modeRaw === "出分"
          ? "score_capable"
          : modeRaw === "preset" ||
              modeRaw === "builtin" ||
              modeRaw === "built-in" ||
              modeRaw === "内置" ||
              modeRaw === "固定" ||
              modeRaw === "锁定" ||
              modeRaw === "内置分组"
            ? "preset"
            : modeRaw === "high_to_low" ||
                modeRaw === "顺序" ||
                modeRaw === "order"
              ? "high_to_low"
              : "preset";
    const period = String(args.period || currentPeriod()).trim();
    const groupSize = Number(args.groupSize) || DEFAULT_GROUP_SIZE;
    const minGap = Number(args.minGap) || DEFAULT_MIN_GAP;
    const usePreset =
      args.usePresetRoster !== false &&
      args.usePresetRoster !== "false" &&
      args.usePresetRoster !== 0;

    if (typeof db.getPkRoster !== "function") {
      return { ok: false, error: "数据库未提供 getPkRoster" };
    }

    const roster = await db.getPkRoster(period, groupSize);
    // 产品：仅男团
    const pool = [...(roster.males || [])];
    let selected = pool;
    let rosterSource = "全库当月有音浪男主播";
    let missingNames = [];

    if (Array.isArray(args.names) && args.names.length) {
      const want = new Set(args.names.map((n) => canonicalName(n)));
      selected = pool.filter((m) => want.has(canonicalName(m.name)));
      rosterSource = `指定 ${args.names.length} 人`;
    } else if (usePreset) {
      const preset = loadPresetRosterNames();
      if (preset.length) {
        const want = new Set(preset.map((n) => canonicalName(n)));
        selected = pool.filter((m) => want.has(canonicalName(m.name)));
        rosterSource = `白名单 ${preset.length} 人（命中 ${selected.length}）`;
        const hit = new Set(selected.map((m) => canonicalName(m.name)));
        missingNames = preset.filter((n) => !hit.has(canonicalName(n)));
      }
    }

    if (!selected.length) {
      return {
        ok: false,
        error: `没有可分组成员（period=${period}，来源=${rosterSource}）`,
      };
    }

    const isPreset = mode === "preset" || mode === "builtin" || mode === "内置";
    const built = buildPkGroups({
      members: selected,
      mode: isPreset ? "preset" : mode,
      groupSize,
      minGap,
      firstStart: args.firstStart || (isPreset ? PRESET_BATTLE_META.firstStart : "08:15"),
      stepMinutes:
        Number(args.stepMinutes) ||
        (isPreset ? PRESET_BATTLE_META.stepMinutes : 5),
      scoreField: args.scoreField || "wave",
      nameGroups: isPreset ? PRESET_BATTLE_GROUPS : undefined,
    });

    if (!built.ok) {
      return {
        ok: false,
        error: built.error || "分组失败",
        period,
        rosterSource,
        missingNames,
      };
    }

    const text = formatGroupsText(built);
    const csv = groupsToCsv(built);
    const sendCsv = args.sendCsv === true || args.sendCsv === "true" || args.sendCsv === 1;
    // 默认出图；显式 false / 0 / "false" 可关
    const sendImage =
      args.sendImage === undefined ||
      args.sendImage === null ||
      args.sendImage === "" ||
      !(args.sendImage === false || args.sendImage === "false" || args.sendImage === 0);
    const periodLabel = roster.period || period;
    const csvFileName = `PK分组_${built.modeLabel}_${periodLabel}_${built.groupCount}组.csv`;
    const imageFileName = `星嗨艺创_分组_${built.modeLabel}_${periodLabel}_${built.groupCount}组.png`;

    const artifacts = [];
    let imageError;
    if (sendImage) {
      try {
        const png = await renderPkGroupsPng(built, {
          period: periodLabel,
          title: "星嗨艺创",
          constraints: built.constraints,
          rosterSource,
        });
        artifacts.push({
          kind: "image",
          fileName: imageFileName,
          buffer: png,
        });
      } catch (error) {
        imageError = error instanceof Error ? error.message : String(error);
      }
    }
    if (sendCsv) {
      artifacts.push({
        kind: "file",
        fileName: csvFileName,
        buffer: Buffer.from(csv, "utf8"),
      });
    }

    return {
      ok: true,
      period: periodLabel,
      rosterSource,
      missingNames,
      mode: built.mode,
      modeLabel: built.modeLabel,
      total: built.total,
      groupCount: built.groupCount,
      sizes: built.sizes,
      constraints: built.constraints,
      strongestGroup: built.strongestGroup,
      groups: built.groups,
      text,
      csv,
      csvFileName,
      imageFileName: sendImage ? imageFileName : undefined,
      sendCsv,
      sendImage,
      imageError,
      artifacts: artifacts.length ? artifacts : undefined,
      replyText: [
        text,
        missingNames.length ? `\n未命中白名单：${missingNames.join("、")}` : "",
        sendImage && !imageError ? "\n（附分组图）" : "",
        imageError ? `\n分组图生成失败：${imageError}` : "",
        sendCsv ? "\n（附 CSV 文件）" : "",
      ]
        .filter(Boolean)
        .join(""),
    };
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
        description: "生成并发送男团/女队/双团每日报告图片。gender=both 时分别生成；人数超过 30 时每团最多拆成 2 张。",
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
        name: "make_pk_groups",
        description:
          "PK 分组并默认导出分组图。preset=内置锁定分组（狼辉第4/狼佑第1，次强3/最强5，08:15×5min）；high_to_low=顺序；balanced=均衡；score_capable=能出分。硬约束：阳↔沐≥4、泽↔帆≥3。默认白名单男团。用户说「内置分组/锁定分组/顺序/均衡/能出分」「导出分组图」时调用。",
        parameters: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              description: "preset | high_to_low | balanced | score_capable",
              enum: ["preset", "high_to_low", "balanced", "score_capable"],
            },
            period: { type: "string", description: "YYYY-MM，默认本月" },
            groupSize: { type: "number", description: "目标每组人数，默认8" },
            minGap: { type: "number", description: "硬约束最小组间隔，默认3" },
            usePresetRoster: {
              type: "boolean",
              description: "是否只用15号白名单，默认 true",
            },
            names: {
              type: "array",
              items: { type: "string" },
              description: "可选，显式名单（提供则覆盖白名单）",
            },
            sendImage: {
              type: "boolean",
              description: "是否导出分组 PNG，默认 true",
            },
            sendCsv: { type: "boolean", description: "是否附带 CSV，默认 false" },
            firstStart: { type: "string", description: "首场时间 HH:mm，默认 08:15" },
            stepMinutes: { type: "number", description: "场间隔分钟，内置默认 15，其它默认 5" },
          },
        },
      },
      execute: makePkGroupsTool,
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
