"use strict";

/**
 * Server-side agent orchestrator (P1+):
 * - FastRoute-like deterministic intents
 * - analytics tools via createWeixinAnalytics
 * - rag_search for help/rules
 * - optional OpenAI-compatible tool loop when AI_* env set
 */

const { createWeixinAnalytics } = require("./weixin-bot-analytics");
const { ragSearch } = require("./weixin-bot-rag");
const { parseBotCommand, resolveDateSpec } = require("./weixin-bot-commands");
const { matchFastRoute } = require("./weixin-bot-mode");

function looksLikeData(text) {
  const t = String(text || "");
  if (/怎么|如何|规则|帮助|口径|什么意思|业务日|导入/.test(t) && !/音浪|时长|排名/.test(t)) {
    return false;
  }
  return /音浪|时长|排名|报告|导出|对比|多少|累计|未播|男团|女队|女团/.test(t);
}

function normalizeAiBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  const localhost = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const localHttp = url.protocol === "http:" && localhost.has(url.hostname);
  if (url.protocol !== "https:" && !localHttp) return "";
  return url.toString().replace(/\/$/, "");
}

function getAiEnvConfig() {
  const baseUrl = normalizeAiBaseUrl(process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "");
  const apiKey = String(process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = String(process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const explicitlyEnabled = /^(?:1|true|yes|on)$/i.test(String(process.env.AI_ENABLED || "").trim());
  return {
    enabled: Boolean(explicitlyEnabled && baseUrl && apiKey && model),
    baseUrl,
    apiKey,
    model,
    timeoutMs: Math.min(120_000, Math.max(5_000, Number(process.env.AI_TIMEOUT_MS) || 45_000)),
    maxToolRounds: Math.min(6, Math.max(1, Number(process.env.AI_MAX_TOOL_ROUNDS) || 4)),
  };
}

async function loadDb() {
  // Prefer electron/db when running under node from project root
  return require("./db");
}

function buildToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "search_anchors",
        description: "搜索主播",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_anchor_full_profile",
        description: "主播库内全量音浪时长",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_anchor_wave_profile",
        description: "主播音浪点查",
        parameters: {
          type: "object",
          properties: { query: { type: "string" }, date: { type: "string" } },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_anchor_wave_days",
        description: "本月有音浪天数",
        parameters: {
          type: "object",
          properties: { query: { type: "string" }, date: { type: "string" } },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_anchor_duration",
        description: "累计时长",
        parameters: {
          type: "object",
          properties: { query: { type: "string" }, date: { type: "string" } },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "compare_anchor_wave",
        description: "对比主播音浪",
        parameters: {
          type: "object",
          properties: {
            queries: { type: "array", items: { type: "string" } },
            date: { type: "string" },
          },
          required: ["queries"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "analyze_anchor_wave",
        description: "音浪序列分析",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            range: { type: "string", enum: ["7d", "14d", "30d"] },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_daily_report_data",
        description: "日报摘要",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string" },
            gender: { type: "string", enum: ["male", "female", "both"] },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rag_search",
        description: "知识库检索（帮助/规则/口径）。禁止用于具体音浪数字。",
        parameters: {
          type: "object",
          properties: { query: { type: "string" }, topK: { type: "number" } },
          required: ["query"],
        },
      },
    },
  ];
}

async function executeTool(analytics, name, args = {}) {
  switch (name) {
    case "search_anchors":
      return analytics.searchAnchors(args);
    case "get_anchor_full_profile": {
      const result = await analytics.getAnchorFullProfile(args);
      if (result?.textParts) {
        return { ...result, textParts: undefined, summaryText: result.summaryText };
      }
      return result;
    }
    case "get_anchor_wave_profile":
      return analytics.getAnchorWaveProfile(args);
    case "get_anchor_wave_days":
      return analytics.getAnchorWaveDays(args);
    case "get_anchor_duration":
      return analytics.getAnchorDuration(args);
    case "compare_anchor_wave":
      return analytics.compareAnchorWave(args);
    case "analyze_anchor_wave":
      return analytics.analyzeAnchorWave(args);
    case "get_daily_report_data":
      return analytics.getDailyReportData(args);
    case "rag_search":
      return ragSearch(String(args.query || ""), { topK: args.topK || 4 });
    default:
      return { ok: false, error: `未知工具: ${name}` };
  }
}

function formatToolReply(name, result) {
  if (!result) return "无结果";
  if (result.text) return result.text;
  if (result.summaryText) return result.summaryText;
  if (result.message) return result.message;
  if (result.error) return result.error;
  if (name === "rag_search" && result.results?.length) {
    return [
      result.results[0].text,
      "",
      "来源：",
      ...result.results.map((r, i) => `${i + 1}. ${r.title}`),
    ].join("\n");
  }
  if (name === "get_anchor_wave_profile" && result.found) {
    return `${result.anchor?.name || ""} ${result.asOfDate} 日音浪 ${result.dailyWaveText}，累计 ${result.totalWaveText}，排名 ${result.rank || "-"}`;
  }
  if (name === "compare_anchor_wave" && result.results) {
    return result.results.map((r) => (
      r.found
        ? `${r.anchor?.name}: 日 ${r.dailyWaveText} / 累计 ${r.totalWaveText}`
        : `${r.anchor?.name || "?"} 无数据`
    )).join("\n");
  }
  if (name === "search_anchors") {
    return result.anchors?.length
      ? result.anchors.map((a) => `${a.name} (${a.douyinNo || a.id})`).join("\n")
      : "未找到主播";
  }
  if (name === "get_daily_report_data") {
    if (result.male) {
      return `${result.asOfDate} 男团 ${result.male.total} 人，女队 ${result.female.total} 人`;
    }
    return `${result.asOfDate} ${result.gender} 共 ${result.total} 人，未播 ${result.notLiveCount}`;
  }
  return JSON.stringify(result).slice(0, 1500);
}

async function handleDeterministic(analytics, message) {
  // Only high-confidence FastRoute (not full parseBotCommand — avoids treating "CSV怎么导入" as 艺名)
  const command = matchFastRoute(message, { parseBotCommand });
  if (!command) return null;

  if (command.type === "anchor-profile") {
    const result = await analytics.getAnchorFullProfile({ query: command.query });
    return {
      mode: "fast-route",
      reply: result.ok ? (result.summaryText || result.message) : (result.error || "查询失败"),
      tool: "get_anchor_full_profile",
      sources: [{ title: "数据工具·全量档案" }],
    };
  }
  if (command.type === "anchor-wave") {
    const latestDate = command.dateSpec ? await analytics.latestWaveDate() : null;
    const date = command.dateSpec ? resolveDateSpec(command.dateSpec, latestDate) : undefined;
    const result = await analytics.getAnchorWaveProfile({ query: command.query, date });
    return {
      mode: "fast-route",
      reply: formatToolReply("get_anchor_wave_profile", result),
      tool: "get_anchor_wave_profile",
      sources: [{ title: "数据工具·音浪" }],
    };
  }
  if (command.type === "anchor-duration") {
    const result = await analytics.getAnchorDuration({ query: command.query });
    return {
      mode: "fast-route",
      reply: result.text || result.message || result.error || "无数据",
      tool: "get_anchor_duration",
      sources: [{ title: "数据工具·时长" }],
    };
  }
  if (command.type === "anchor-wave-days") {
    const result = await analytics.getAnchorWaveDays({ query: command.query });
    return {
      mode: "fast-route",
      reply: result.text || result.message || result.error || "无数据",
      tool: "get_anchor_wave_days",
      sources: [{ title: "数据工具·有音浪天数" }],
    };
  }
  if (command.type === "report") {
    const latestDate = command.dateSpec ? await analytics.latestWaveDate() : null;
    const date = command.dateSpec ? resolveDateSpec(command.dateSpec, latestDate) : undefined;
    const result = await analytics.getDailyReportData({
      date,
      gender: command.gender === "both" ? "both" : command.gender,
    });
    return {
      mode: "fast-route",
      reply: `${formatToolReply("get_daily_report_data", result)}\n（Web 端暂不直接推送 PNG，请用桌面微信「每日报告」收图）`,
      tool: "get_daily_report_data",
      sources: [{ title: "数据工具·日报摘要" }],
    };
  }
  if (command.type === "help") {
    const rag = ragSearch(message || "帮助", { topK: 3 });
    return {
      mode: "rag",
      reply: formatToolReply("rag_search", rag),
      tool: "rag_search",
      sources: (rag.results || []).map((r) => ({ title: r.title, score: r.score })),
    };
  }
  return null;
}

async function runLlmToolLoop(analytics, message, history = []) {
  const config = getAiEnvConfig();
  if (!config.enabled) return null;

  const tools = buildToolDefinitions();
  const messages = [
    {
      role: "system",
      content: [
        "你是内部数据客服。",
        "音浪/时长/排名必须调用数据工具；帮助/规则可 rag_search 并注明来源。",
        "禁止编造数字。默认业务日是昨天。",
        "回答简洁中文。",
      ].join("\n"),
    },
    ...history.slice(-12).map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "").slice(0, 2000),
    })),
    { role: "user", content: message },
  ];

  const sources = [];
  let finalText = "";
  for (let round = 0; round < config.maxToolRounds; round += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    let raw;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0.15,
        }),
        signal: controller.signal,
      });
      raw = await response.text();
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`AI HTTP ${response.status}: ${raw.slice(0, 200)}`);
    const json = JSON.parse(raw);
    const choice = json?.choices?.[0]?.message || {};
    const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
    if (!toolCalls.length) {
      finalText = String(choice.content || "").trim();
      break;
    }
    const executableToolCalls = toolCalls.slice(0, 3);
    messages.push({
      role: "assistant",
      content: choice.content || null,
      tool_calls: executableToolCalls,
    });
    for (const call of executableToolCalls) {
      const name = String(call?.function?.name || "");
      let args = {};
      try {
        args = JSON.parse(call?.function?.arguments || "{}");
      } catch {
        args = {};
      }
      const observation = await executeTool(analytics, name, args);
      if (name === "rag_search") {
        for (const r of observation.results || []) sources.push({ title: r.title, score: r.score });
      } else {
        sources.push({ title: `数据工具·${name}` });
      }
      // strip heavy fields
      const safeObs = { ...observation };
      delete safeObs.textParts;
      if (safeObs.artifact) delete safeObs.artifact.buffer;
      if (Array.isArray(safeObs.artifacts)) {
        safeObs.artifacts = safeObs.artifacts.map((a) => ({ kind: a.kind, fileName: a.fileName }));
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id || `tool_${name}`,
        content: JSON.stringify(safeObs).slice(0, 6000),
      });
    }
  }
  if (!finalText) finalText = "已查询数据，但模型未生成文字摘要。请换种问法。";
  return {
    mode: "llm-tools",
    reply: finalText.slice(0, 3500),
    sources,
  };
}

async function handleServerAgentChat({ message, sessionId, history = [] } = {}) {
  const text = String(message || "").trim();
  if (!text) return { success: false, error: "message 不能为空" };

  // 0) help / rules first via RAG (no DB)
  if (!looksLikeData(text) || /帮助|怎么|如何|规则|业务日|导入/.test(text)) {
    const rag = ragSearch(text, { topK: 4 });
    if (rag.results?.length && rag.results[0].score >= 0.2) {
      // still allow FastRoute for pure 每日报告 etc. below if looksLikeData heavily
      if (!/报告|音浪|时长|导出/.test(text) || /怎么|如何|规则|帮助|业务日|导入/.test(text)) {
        return {
          success: true,
          data: {
            sessionId,
            mode: "rag",
            reply: formatToolReply("rag_search", rag),
            sources: rag.results.map((r) => ({ title: r.title, score: r.score })),
            ragUsed: true,
          },
        };
      }
    }
  }

  let analytics;
  try {
    const db = await loadDb();
    analytics = createWeixinAnalytics({
      db,
      renderReportPng: async () => {
        throw new Error("Web 端暂不渲染 PNG，请用桌面微信收图");
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // DB unavailable: still answer RAG
    const rag = ragSearch(text, { topK: 4 });
    if (rag.results?.length) {
      return {
        success: true,
        data: {
          sessionId,
          mode: "rag-db-down",
          reply: formatToolReply("rag_search", rag),
          sources: rag.results.map((r) => ({ title: r.title, score: r.score })),
          warning: `数据库暂不可用：${msg}`,
        },
      };
    }
    return { success: false, error: `数据库不可用：${msg}` };
  }

  // 1) deterministic FastRoute
  const det = await handleDeterministic(analytics, text);
  if (det) {
    return { success: true, data: { sessionId, ...det } };
  }

  // 2) LLM tool loop if configured
  try {
    const llm = await runLlmToolLoop(analytics, text, history);
    if (llm) {
      return { success: true, data: { sessionId, ...llm, ragUsed: false } };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: true,
      data: {
        sessionId,
        mode: "error-fallback",
        reply: `智能推理暂时失败：${msg}。可改用明确命令，如「小张」「每日报告」。`,
        sources: [],
      },
    };
  }

  // 3) short name heuristic only (not long questions)
  if (text.length <= 16 && !/[？?怎么如何]/.test(text)) {
    const profile = await analytics.getAnchorFullProfile({ query: text });
    if (profile.ok && profile.found) {
      return {
        success: true,
        data: {
          sessionId,
          mode: "heuristic-profile",
          reply: profile.summaryText,
          sources: [{ title: "数据工具·全量档案" }],
        },
      };
    }
    if (profile.candidates?.length) {
      return {
        success: true,
        data: {
          sessionId,
          mode: "disambiguation",
          reply: `主播不唯一，候选：${profile.candidates.map((c) => c.name).join("、")}`,
          sources: [{ title: "数据工具·搜索" }],
        },
      };
    }
  }

  // 4) last RAG fallback
  const rag = ragSearch(text, { topK: 4 });
  if (rag.results?.length) {
    return {
      success: true,
      data: {
        sessionId,
        mode: "rag-fallback",
        reply: formatToolReply("rag_search", rag),
        sources: rag.results.map((r) => ({ title: r.title, score: r.score })),
        ragUsed: true,
      },
    };
  }

  return {
    success: true,
    data: {
      sessionId,
      mode: "fallback",
      reply: "暂时无法理解。可试：艺名、艺名音浪、每日报告、CSV怎么导入。配置 AI_BASE_URL/AI_API_KEY 可启用完整推理。",
      sources: [],
    },
  };
}

module.exports = {
  handleServerAgentChat,
  handleDeterministic,
  getAiEnvConfig,
  executeTool,
  runLlmToolLoop,
};
