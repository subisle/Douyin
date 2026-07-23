"use client";

import { useEffect, useState } from "react";

export default function BotStatusPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void fetch("/api/bot/status")
      .then((r) => r.json())
      .then((j) => setData(j.data || j));
  }, []);

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">机器人状态</h1>
      <pre className="overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
        {JSON.stringify(data, null, 2)}
      </pre>
      <p className="text-sm text-muted-foreground">
        服务端微信 Worker 为 P2 能力；当前请用桌面 Electron 连接微信。同一账号勿双开。
      </p>
      <p className="text-sm">
        <a className="text-primary underline" href="/agent">智能客服</a>
        {" · "}
        <a className="text-primary underline" href="/knowledge">知识库</a>
      </p>
    </div>
  );
}
