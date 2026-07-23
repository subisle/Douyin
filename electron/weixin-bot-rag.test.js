const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveRagCustomPath } = require("./local-paths");
const { loadRagDocuments, ragSearch } = require("./weixin-bot-rag");

test("rag search finds import rules", () => {
  const result = ragSearch("CSV怎么导入");
  assert.equal(result.ok, true);
  assert.ok(result.results.length >= 1);
  assert.match(result.results[0].title, /导入|用法/);
});

test("rag search finds business day", () => {
  const result = ragSearch("业务日是什么");
  assert.ok(result.results.some((r) => /业务日/.test(r.title) || /昨天/.test(r.text)));
});

test("RAG loads a configured custom repository exactly once", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-rag-"));
  const customPath = path.join(dir, "custom.json");
  fs.writeFileSync(customPath, JSON.stringify({
    collection: "custom",
    documents: [{ id: "custom-1", title: "自定义规则", text: "定制内容" }],
  }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const docs = loadRagDocuments(path.join(dir, "missing-seed.json"), customPath);
  assert.deepEqual(docs.map((doc) => doc.id), ["custom-1"]);
});

test("RAG custom documents default to the writable runtime directory", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-rag-runtime-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(
    resolveRagCustomPath({ BOT_STORAGE_DIR: dir }),
    path.join(dir, "rag", "custom.json")
  );
  assert.ok(fs.statSync(path.join(dir, "rag")).isDirectory());
});
