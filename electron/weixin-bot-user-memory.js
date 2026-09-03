"use strict";

const fs = require("fs");
const path = require("path");
const { resolveUserMemoryPath } = require("./local-paths");

const STORE_VERSION = 1;
const MAX_THREAD_MESSAGES = 40; // ~20 turns
const MAX_MESSAGE_CHARS = 2_000;
const MAX_THREAD_CHARS = 24_000;
const MAX_THREADS = 200;
const MAX_PROFILES = 200;
const THREAD_TTL_MS = 24 * 60 * 60_000;
const MAX_TOP_ANCHORS = 8;
const MAX_QUERY_CHARS = 40;
const MAX_ANCHOR_ID_DIGITS = 18;
const MAX_FACTS_PER_KEY = 12;
const MAX_FACT_SUMMARY_CHARS = 240;
const FACT_TTL_MS = THREAD_TTL_MS;

/** 指令/系统口令等不应进入 topAnchors 的噪声 query */
const NOISE_QUERY_RE = /^(?:\/?help|帮助|菜单|命令|指令|人工客服|智能客服|客服|开启客服|打开客服|退出客服|关闭客服|结束客服|取消客服|清空对话|清除记忆|清除习惯|清除我的习惯|清空习惯|每日报告|日报|未开播报告|未开播天数报告|未播报告|导出|对比)$/i;

const WAVE_TOOLS = new Set([
  "get_anchor_wave_profile",
  "get_anchor_wave_days",
  "compare_anchor_wave",
  "analyze_anchor_wave",
  "export_wave_file",
]);
const DURATION_TOOLS = new Set(["get_anchor_duration"]);
const PROFILE_QUERY_TOOLS = new Set([
  "search_anchors",
  "get_anchor_full_profile",
  "get_anchor_wave_profile",
  "get_anchor_wave_days",
  "compare_anchor_wave",
  "get_anchor_duration",
  "analyze_anchor_wave",
]);

function isUserMemoryEnabled(env = process.env) {
  const raw = String(env.AI_USER_MEMORY ?? "").trim().toLowerCase();
  if (!raw) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return true;
}

function emptyStore() {
  return {
    version: STORE_VERSION,
    threads: Object.create(null),
    profiles: Object.create(null),
    facts: Object.create(null),
  };
}

function emptyProfile() {
  return {
    version: STORE_VERSION,
    updatedAt: 0,
    topAnchors: [],
    preferMetric: null,
    preferTeam: null,
    preferArtifact: null,
  };
}

function normalizeKey(key) {
  return String(key || "").trim().slice(0, 200) || "unknown";
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") return null;
  const role = String(message.role || "");
  if (role !== "user" && role !== "assistant") return null;
  return {
    role,
    content: String(message.content || "").slice(0, MAX_MESSAGE_CHARS),
  };
}

function clampThreadMessages(messages) {
  const list = Array.isArray(messages)
    ? messages.map(normalizeMessage).filter(Boolean)
    : [];
  while (list.length > MAX_THREAD_MESSAGES) list.shift();
  let total = list.reduce((sum, item) => sum + item.content.length, 0);
  while (total > MAX_THREAD_CHARS && list.length > 2) {
    const removed = list.shift();
    total -= removed.content.length;
  }
  return list;
}

function normalizeQuery(value) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY_CHARS);
  if (!text) return "";
  // 1 字纯标点 / 纯符号串
  if (/^[^\w一-鿿\d]+$/u.test(text)) return "";
  // 系统口令、帮助、报告等噪声
  if (NOISE_QUERY_RE.test(text)) return "";
  // 过长纯数字无意义串；短数字可当主播 ID
  if (/^\d+$/.test(text) && text.length > MAX_ANCHOR_ID_DIGITS) return "";
  return text;
}

function compactToolFact(toolName, args = {}, observation = {}) {
  if (!observation || typeof observation !== "object") return null;
  if (observation.ok === false) return null;
  const tool = String(toolName || "").trim();
  if (!tool || tool === "rag_search") return null;

  const query = normalizeQuery(args?.query)
    || normalizeQuery(Array.isArray(args?.queries) ? args.queries.join("/") : "")
    || normalizeQuery(observation.anchor?.name)
    || normalizeQuery(observation.name)
    || "";
  const asOfDate = String(observation.asOfDate || args?.date || "").slice(0, 32);

  let summary = "";
  if (typeof observation.text === "string" && observation.text.trim()) {
    summary = observation.text.trim();
  } else if (typeof observation.message === "string" && observation.message.trim()) {
    summary = observation.message.trim();
  } else {
    const bits = [];
    const anchorName = observation.anchor?.name || observation.name;
    if (anchorName) bits.push(String(anchorName));
    if (asOfDate) bits.push(`截至${asOfDate}`);
    if (observation.dailyWaveText) bits.push(`日音浪${observation.dailyWaveText}`);
    else if (observation.dailyWave != null) bits.push(`日音浪${observation.dailyWave}`);
    if (observation.totalWaveText) bits.push(`累计${observation.totalWaveText}`);
    else if (observation.totalWave != null) bits.push(`累计${observation.totalWave}`);
    if (observation.durationText) bits.push(`时长${observation.durationText}`);
    else if (observation.minutes != null) bits.push(`时长${observation.minutes}分钟`);
    if (observation.liveDays != null) bits.push(`有音浪${observation.liveDays}天`);
    if (observation.rank != null) bits.push(`排名${observation.rank}`);
    if (Array.isArray(observation.results) && observation.results.length) {
      bits.push(`对比${observation.results.length}人`);
    }
    summary = bits.join("，");
  }
  summary = String(summary || "").replace(/\s+/g, " ").trim().slice(0, MAX_FACT_SUMMARY_CHARS);
  if (!summary) return null;

  return {
    tool,
    query,
    asOfDate,
    summary,
    at: 0,
  };
}

function formatFactsSummary(facts, { maxItems = 8 } = {}) {
  const list = Array.isArray(facts) ? facts : [];
  if (!list.length) return "";
  const lines = list.slice(0, maxItems).map((item, index) => {
    const head = [
      item.query ? item.query : null,
      item.asOfDate ? item.asOfDate : null,
      item.tool ? item.tool : null,
    ].filter(Boolean).join(" · ");
    return `${index + 1}. ${head ? `${head}：` : ""}${item.summary}`;
  });
  return [
    "【本会话已查事实】以下为近期工具结果摘要，数字已由工具给出。",
    "若用户追问仍在这些事实覆盖范围内：直接回答，不要重复调用同类工具。",
    "仅当缺字段、换主播、换日期、要对比/出图/导出，或事实明显过期时，再调用工具。",
    ...lines,
  ].join("\n").slice(0, 1_200);
}

function observationFailed(observation) {
  if (!observation || typeof observation !== "object") return false;
  if (observation.ok === false) return true;
  return false;
}

/** 明确未匹配 / 错误时不写 topAnchors（仍可学偏好） */
function observationRejectsAnchors(observation) {
  if (!observation || typeof observation !== "object") return false;
  if (observation.ok === false) return true;
  if (observation.error) return true;
  if (observation.unmatched === true || observation.notFound === true) return true;
  if (observation.matched === false) return true;
  return false;
}

function pushNormalizedQuery(target, value) {
  const q = normalizeQuery(value);
  if (q && !target.includes(q)) target.push(q);
}

function collectLearnQueries(toolName, args = {}, observation = {}) {
  const name = String(toolName || "").trim();
  if (!PROFILE_QUERY_TOOLS.has(name)) return [];
  if (observationRejectsAnchors(observation)) return [];

  const queries = [];
  pushNormalizedQuery(queries, args?.query);
  if (Array.isArray(args?.queries)) {
    for (const item of args.queries) pushNormalizedQuery(queries, item);
  }
  // args 无有效 query 时，从 observation 常见字段补主播名
  if (!queries.length && observation && typeof observation === "object") {
    pushNormalizedQuery(queries, observation.anchor?.name);
    pushNormalizedQuery(queries, observation.anchor?.nickname);
    pushNormalizedQuery(queries, observation.name);
    if (Array.isArray(observation.anchors) && observation.anchors[0]) {
      pushNormalizedQuery(queries, observation.anchors[0].name);
      pushNormalizedQuery(queries, observation.anchors[0].nickname);
    }
    const data = observation.data && typeof observation.data === "object" ? observation.data : null;
    if (data) {
      pushNormalizedQuery(queries, data.anchor?.name);
      pushNormalizedQuery(queries, data.anchor?.nickname);
      pushNormalizedQuery(queries, data.name);
      if (Array.isArray(data.anchors) && data.anchors[0]) {
        pushNormalizedQuery(queries, data.anchors[0].name);
      }
    }
  }
  return queries;
}

function createWeixinUserMemory(options = {}) {
  const storagePath = typeof options.storagePath === "function"
    ? options.storagePath
    : () => options.filePath || resolveUserMemoryPath();
  const nowFn = typeof options.now === "function" ? options.now : () => Date.now();
  const enabledFn = typeof options.isEnabled === "function"
    ? options.isEnabled
    : () => isUserMemoryEnabled();

  let cache = null;
  let cachePath = "";

  function enabled() {
    return enabledFn() !== false;
  }

  function readStore() {
    if (!enabled()) return emptyStore();
    const file = storagePath();
    if (cache && cachePath === file) return cache;
    cachePath = file;
    if (!fs.existsSync(file)) {
      cache = emptyStore();
      return cache;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      cache = {
        version: STORE_VERSION,
        threads: parsed?.threads && typeof parsed.threads === "object" && !Array.isArray(parsed.threads)
          ? parsed.threads
          : Object.create(null),
        profiles: parsed?.profiles && typeof parsed.profiles === "object" && !Array.isArray(parsed.profiles)
          ? parsed.profiles
          : Object.create(null),
        facts: parsed?.facts && typeof parsed.facts === "object" && !Array.isArray(parsed.facts)
          ? parsed.facts
          : Object.create(null),
      };
    } catch {
      cache = emptyStore();
    }
    return cache;
  }

  function writeStore(store) {
    if (!enabled()) return;
    const file = storagePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = `${file}.${process.pid}.tmp`;
    const payload = JSON.stringify({
      version: STORE_VERSION,
      threads: store.threads,
      profiles: store.profiles,
      facts: store.facts || Object.create(null),
    });
    fs.writeFileSync(tempFile, payload, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempFile, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows may ignore POSIX modes.
    }
    cache = store;
    cachePath = file;
  }

  function prune(store, now = nowFn()) {
    if (!store.facts || typeof store.facts !== "object") store.facts = Object.create(null);
    for (const [key, thread] of Object.entries(store.threads)) {
      if (now - Number(thread?.updatedAt || 0) > THREAD_TTL_MS) delete store.threads[key];
    }
    for (const [key, bucket] of Object.entries(store.facts)) {
      if (now - Number(bucket?.updatedAt || 0) > FACT_TTL_MS) delete store.facts[key];
    }
    const threadEntries = Object.entries(store.threads)
      .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0));
    while (threadEntries.length > MAX_THREADS) {
      const [key] = threadEntries.shift();
      delete store.threads[key];
    }
    const factEntries = Object.entries(store.facts)
      .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0));
    while (factEntries.length > MAX_THREADS) {
      const [key] = factEntries.shift();
      delete store.facts[key];
    }
    const profileEntries = Object.entries(store.profiles)
      .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0));
    while (profileEntries.length > MAX_PROFILES) {
      const [key] = profileEntries.shift();
      delete store.profiles[key];
    }
    return store;
  }

  function getThread(key) {
    if (!enabled()) return { messages: [], updatedAt: 0 };
    const store = prune(readStore());
    const item = store.threads[normalizeKey(key)];
    if (!item) return { messages: [], updatedAt: 0 };
    return {
      messages: clampThreadMessages(item.messages),
      updatedAt: Number(item.updatedAt || 0),
    };
  }

  function saveThread(key, messages) {
    if (!enabled()) return getThread(key);
    const store = prune(readStore());
    const id = normalizeKey(key);
    const now = nowFn();
    store.threads[id] = {
      messages: clampThreadMessages(messages),
      updatedAt: now,
    };
    writeStore(store);
    return store.threads[id];
  }

  function clearThread(key) {
    if (!enabled()) return;
    const store = readStore();
    const id = normalizeKey(key);
    delete store.threads[id];
    if (store.facts) delete store.facts[id];
    writeStore(store);
  }

  function clearProfile(key) {
    if (!enabled()) return emptyProfile();
    const store = readStore();
    delete store.profiles[normalizeKey(key)];
    writeStore(store);
    return emptyProfile();
  }

  function getFacts(key) {
    if (!enabled()) return [];
    const store = prune(readStore());
    const bucket = store.facts?.[normalizeKey(key)];
    if (!bucket || !Array.isArray(bucket.items)) return [];
    return bucket.items
      .map((item) => ({
        tool: String(item?.tool || "").slice(0, 64),
        query: normalizeQuery(item?.query),
        asOfDate: String(item?.asOfDate || "").slice(0, 32),
        summary: String(item?.summary || "").slice(0, MAX_FACT_SUMMARY_CHARS),
        at: Number(item?.at) || 0,
      }))
      .filter((item) => item.tool && item.summary)
      .slice(0, MAX_FACTS_PER_KEY);
  }

  function rememberToolFact(key, toolName, args = {}, observation = {}) {
    if (!enabled()) return [];
    const fact = compactToolFact(toolName, args, observation);
    if (!fact) return getFacts(key);
    const store = prune(readStore());
    if (!store.facts) store.facts = Object.create(null);
    const id = normalizeKey(key);
    const now = nowFn();
    fact.at = now;
    const prev = Array.isArray(store.facts[id]?.items) ? store.facts[id].items : [];
    const next = [fact, ...prev]
      .filter((item, index, arr) => {
        const sig = `${item.tool}|${item.query}|${item.asOfDate}|${item.summary}`;
        return arr.findIndex((x) => `${x.tool}|${x.query}|${x.asOfDate}|${x.summary}` === sig) === index;
      })
      .slice(0, MAX_FACTS_PER_KEY);
    store.facts[id] = { updatedAt: now, items: next };
    writeStore(store);
    return next;
  }

  function clearFacts(key) {
    if (!enabled()) return;
    const store = readStore();
    if (store.facts) delete store.facts[normalizeKey(key)];
    writeStore(store);
  }

  function getProfile(key) {
    if (!enabled()) return emptyProfile();
    const store = prune(readStore());
    const item = store.profiles[normalizeKey(key)];
    if (!item || typeof item !== "object") return emptyProfile();
    return {
      version: STORE_VERSION,
      updatedAt: Number(item.updatedAt || 0),
      topAnchors: Array.isArray(item.topAnchors)
        ? item.topAnchors
          .map((row) => ({
            query: normalizeQuery(row?.query),
            count: Math.max(0, Number(row?.count) || 0),
            lastAt: Number(row?.lastAt) || 0,
          }))
          .filter((row) => row.query)
          .slice(0, MAX_TOP_ANCHORS)
        : [],
      preferMetric: ["wave", "duration", "mixed"].includes(item.preferMetric)
        ? item.preferMetric
        : null,
      preferTeam: ["male", "female", "both"].includes(item.preferTeam)
        ? item.preferTeam
        : null,
      preferArtifact: ["text", "image", "file", "mixed"].includes(item.preferArtifact)
        ? item.preferArtifact
        : null,
    };
  }

  function saveProfile(key, profile) {
    if (!enabled()) return emptyProfile();
    const store = prune(readStore());
    const id = normalizeKey(key);
    const next = {
      ...emptyProfile(),
      ...profile,
      version: STORE_VERSION,
      updatedAt: nowFn(),
    };
    store.profiles[id] = next;
    writeStore(store);
    return next;
  }

  function bumpMetric(current, next) {
    if (!current) return next;
    if (current === next) return current;
    return "mixed";
  }

  function learnFromTool(key, toolName, args = {}, observation = {}) {
    if (!enabled()) return getProfile(key);
    if (observationFailed(observation)) return getProfile(key);
    const name = String(toolName || "").trim();
    if (!name || name === "rag_search") return getProfile(key);

    const profile = getProfile(key);
    const now = nowFn();
    let changed = false;

    const queries = collectLearnQueries(name, args, observation);
    if (queries.length) {
      const map = new Map(profile.topAnchors.map((row) => [row.query, { ...row }]));
      for (const query of queries) {
        const prev = map.get(query) || { query, count: 0, lastAt: 0 };
        prev.count += 1;
        prev.lastAt = now;
        map.set(query, prev);
      }
      profile.topAnchors = [...map.values()]
        .sort((a, b) => (b.count - a.count) || (b.lastAt - a.lastAt))
        .slice(0, MAX_TOP_ANCHORS);
      changed = true;
    }

    if (WAVE_TOOLS.has(name)) {
      profile.preferMetric = bumpMetric(profile.preferMetric, "wave");
      changed = true;
    } else if (DURATION_TOOLS.has(name)) {
      profile.preferMetric = bumpMetric(profile.preferMetric, "duration");
      changed = true;
    }

    if (name === "get_daily_report_data" || name === "export_daily_report_image" || name === "export_not_live_report") {
      const gender = String(args.gender || args.team || "").toLowerCase();
      if (gender === "male" || gender === "female" || gender === "both") {
        profile.preferTeam = gender;
        changed = true;
      }
    }

    if (name === "export_daily_report_image" || name === "export_not_live_report") {
      profile.preferArtifact = bumpMetric(profile.preferArtifact, "image");
      changed = true;
    } else if (name === "export_wave_file") {
      profile.preferArtifact = bumpMetric(profile.preferArtifact, "file");
      changed = true;
    }

    if (!changed) return profile;
    return saveProfile(key, profile);
  }

  function formatProfileSummary(profile) {
    if (!profile) return "";
    const parts = [];
    if (Array.isArray(profile.topAnchors) && profile.topAnchors.length) {
      parts.push(`常查：${profile.topAnchors.slice(0, 5).map((row) => row.query).join("、")}`);
    }
    if (profile.preferMetric === "wave") parts.push("偏好：音浪");
    else if (profile.preferMetric === "duration") parts.push("偏好：时长");
    else if (profile.preferMetric === "mixed") parts.push("偏好：音浪/时长均有");
    if (profile.preferTeam === "male") parts.push("团队：男团");
    else if (profile.preferTeam === "female") parts.push("团队：女队");
    else if (profile.preferTeam === "both") parts.push("团队：双团");
    if (profile.preferArtifact === "image") parts.push("常用：日报图");
    else if (profile.preferArtifact === "file") parts.push("常用：导出文件");
    else if (profile.preferArtifact === "mixed") parts.push("常用：图/文件");
    if (!parts.length) return "";
    return `【用户习惯·自动】${parts.join("；")}。当轮用户明确要求优先于习惯。禁止用习惯编造数字。`.slice(0, 300);
  }

  return {
    enabled,
    getThread,
    saveThread,
    clearThread,
    clearProfile,
    getProfile,
    saveProfile,
    getFacts,
    rememberToolFact,
    clearFacts,
    learnFromTool,
    formatProfileSummary,
    formatFactsSummary,
    storagePath,
  };
}

module.exports = {
  createWeixinUserMemory,
  isUserMemoryEnabled,
  emptyProfile,
  compactToolFact,
  formatFactsSummary,
  normalizeQuery,
  MAX_THREAD_MESSAGES,
  MAX_TOP_ANCHORS,
  MAX_FACTS_PER_KEY,
  MAX_QUERY_CHARS,
  THREAD_TTL_MS,
};
