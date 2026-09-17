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
        机器人只支持固定指令，已不再提供 AI 对话。
      </p>
      <p className="text-sm text-muted-foreground">
        机器人运行状态见 <code className="rounded bg-muted px-1">GET /api/v1/bots</code>
        （多 QQ 机器人列表见 <code className="rounded bg-muted px-1">GET /api/v1/bots/qq/bots</code>）。
      </p>
    </div>
  );
}
