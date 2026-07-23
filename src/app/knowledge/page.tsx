"use client";

import { useEffect, useState } from "react";

type Doc = { id: string; title: string; text: string };
const JSON_HEADERS = { "Content-Type": "application/json" };

function responseError(json: unknown, fallback: string) {
  if (!json || typeof json !== "object" || !("error" in json)) return fallback;
  const error = json.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ title: string; score: number; text: string }[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await fetch("/api/rag/documents", { credentials: "same-origin" });
    const json = await res.json();
    if (json.success) setDocs(json.data.documents || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addDoc() {
    setMsg("");
    const res = await fetch("/api/rag/documents", {
      method: "POST",
      credentials: "same-origin",
      headers: JSON_HEADERS,
      body: JSON.stringify({ title, text }),
    });
    const json = await res.json();
    if (!json.success) {
      setMsg(responseError(json, "保存失败"));
      return;
    }
    setTitle("");
    setText("");
    setMsg("已保存到本地知识库扩展文件");
    await load();
  }

  async function search() {
    const res = await fetch("/api/rag/search", {
      method: "POST",
      credentials: "same-origin",
      headers: JSON_HEADERS,
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    if (json.success) setHits(json.data.results || []);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-xl font-semibold">知识库管理（P2 MVP）</h1>
      <p className="text-sm text-muted-foreground">
        内置 <code>bot_help</code> 种子 + 可追加自定义文档（写入运行时存储目录）。
      </p>

      <section className="space-y-2 rounded-lg border p-3">
        <h2 className="font-medium">新增文档</h2>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          placeholder="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="min-h-28 w-full rounded border px-3 py-2 text-sm"
          placeholder="正文"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
          onClick={() => void addDoc()}
          disabled={!title.trim() || !text.trim()}
        >
          保存
        </button>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      </section>

      <section className="space-y-2 rounded-lg border p-3">
        <h2 className="font-medium">试检索</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-2 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例如：业务日"
          />
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void search()}>
            搜索
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {hits.map((h, i) => (
            <li key={`${h.title}-${i}`} className="rounded bg-muted/40 p-2">
              <div className="font-medium">{h.title} <span className="text-xs text-muted-foreground">{h.score}</span></div>
              <div className="text-muted-foreground">{h.text}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded-lg border p-3">
        <h2 className="font-medium">当前文档（{docs.length}）</h2>
        <ul className="space-y-1 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="border-b border-border/50 py-1">
              <span className="font-medium">{d.title}</span>
              <span className="ml-2 text-xs text-muted-foreground">{d.id}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm">
        <a className="text-primary underline" href="/agent">去智能客服对话</a>
        {" · "}
        <a className="text-primary underline" href="/bot">机器人状态</a>
      </p>
    </div>
  );
}
