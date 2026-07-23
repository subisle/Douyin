"use client";

import { useState } from "react";

type ChatMsg = { role: "user" | "assistant"; text: string; sources?: { title: string; score?: number }[] };

export default function AgentChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sessionId] = useState(() => globalThis.crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        const message = typeof json.error === "string" ? json.error : json.error?.message;
        throw new Error(message || `HTTP ${res.status}`);
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: json.data.reply || "",
          sources: json.data.sources || [],
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">智能客服（Web MVP）</h1>
        <p className="text-sm text-muted-foreground">
          P1：知识库问答；结构化音浪问题会提示走数据工具。
        </p>
      </header>
      <div className="flex min-h-[420px] flex-1 flex-col gap-2 overflow-y-auto rounded-lg border p-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">试试：「CSV怎么导入」「业务日是什么」</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={`${msg.role}-${i}`}
            className={
              msg.role === "user"
                ? "ml-8 rounded-lg bg-primary/10 px-3 py-2 text-sm"
                : "mr-8 rounded-lg bg-muted/50 px-3 py-2 text-sm"
            }
          >
            <div className="whitespace-pre-wrap">{msg.text}</div>
            {msg.sources && msg.sources.length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                来源：{msg.sources.map((s) => s.title).join(" · ")}
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入问题…"
          disabled={busy}
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : "发送"}
        </button>
      </form>
    </div>
  );
}
