"use strict";

const fs = require("fs");
const path = require("path");
const { resolveRagCustomPath } = require("./local-paths");

function tokenize(text) {
  const raw = String(text || "").toLowerCase();
  const tokens = [];
  // latin words / numbers
  for (const m of raw.match(/[a-z0-9_]+/g) || []) tokens.push(m);
  // chinese: unigrams + bigrams
  const hans = raw.replace(/[^一-鿿]/g, "");
  for (let i = 0; i < hans.length; i += 1) {
    tokens.push(hans[i]);
    if (i + 1 < hans.length) tokens.push(hans.slice(i, i + 2));
  }
  return tokens.filter(Boolean);
}

function scoreChunk(queryTokens, docText) {
  if (!queryTokens.length) return 0;
  const docTokens = tokenize(docText);
  if (!docTokens.length) return 0;
  const tf = new Map();
  for (const t of docTokens) tf.set(t, (tf.get(t) || 0) + 1);
  let score = 0;
  for (const q of queryTokens) {
    const f = tf.get(q) || 0;
    if (f > 0) score += 1 + Math.log(1 + f);
  }
  const q = queryTokens.join("");
  if (q && docText.includes(q)) score += 2;
  return score / Math.sqrt(docTokens.length);
}

function defaultSeedPath() {
  return path.join(__dirname, "..", "data", "rag", "bot_help.json");
}

function loadRagDocuments(seedPath = defaultSeedPath(), customPath = resolveRagCustomPath()) {
  const docs = [];
  const files = [
    seedPath,
    customPath,
  ];
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const collection = raw.collection || "bot_help";
      for (const d of raw.documents || []) {
        docs.push({
          id: String(d.id || ""),
          collection,
          title: String(d.title || d.id || "未命名"),
          text: String(d.text || ""),
          source: file,
        });
      }
    } catch {
      // ignore
    }
  }
  return docs;
}

function looksLikeStructuredDataQuestion(text) {
  const value = String(text || "");
  return /音浪|时长|排名|报告|导出|对比|多少|万|累计|未播|男团|女队|女团/.test(value)
    && !/怎么|如何|规则|帮助|口径|什么意思|业务日|导入/.test(value);
}

function ragSearch(query, { topK = 4, collection = null, documents = null } = {}) {
  const docs = documents || loadRagDocuments();
  const qTokens = tokenize(query);
  const ranked = [];
  for (const doc of docs) {
    if (collection && doc.collection !== collection) continue;
    const s = scoreChunk(qTokens, `${doc.title} ${doc.text}`);
    if (s <= 0) continue;
    ranked.push({
      id: doc.id,
      title: doc.title,
      collection: doc.collection,
      text: doc.text.slice(0, 800),
      score: Number(s.toFixed(4)),
      source: path.basename(doc.source || ""),
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  return {
    ok: true,
    query: String(query || ""),
    results: ranked.slice(0, Math.max(1, Math.min(8, topK))),
  };
}

module.exports = {
  loadRagDocuments,
  ragSearch,
  defaultSeedPath,
  looksLikeStructuredDataQuestion,
};
