"use client";

import { AlertCircle, Loader2, MonitorOff, Inbox } from "lucide-react";

export function LoadingState({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertCircle className="size-6 text-destructive" />
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-full border border-border px-4 py-1.5 text-sm text-foreground transition hover:bg-accent"
        >
          重试
        </button>
      )}
    </div>
  );
}

export function EmptyState({ label = "暂无数据" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Inbox className="size-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** electronAPI 不存在（浏览器模式）时的提示 */
export function BrowserModeState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
      <MonitorOff className="size-6" />
      <p className="text-sm">
        当前在浏览器中预览，无法连接数据库。
        <br />
        请用 <code className="rounded bg-muted px-1.5 py-0.5">npm run electron:dev</code> 启动桌面端查看真实数据。
      </p>
    </div>
  );
}
