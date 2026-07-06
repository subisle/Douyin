"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Waves, Clock, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadCsv } from "./csv";
import { BrowserModeState } from "./states";

type ExportKind = "wave" | "duration" | "anchors";

const OPTIONS: {
  kind: ExportKind;
  label: string;
  desc: string;
  icon: typeof Waves;
  file: string;
}[] = [
  { kind: "wave", label: "音浪数据", desc: "全部音浪快照（含日期、排名）", icon: Waves, file: "音浪数据" },
  { kind: "duration", label: "时长数据", desc: "全部直播时长快照", icon: Clock, file: "时长数据" },
  { kind: "anchors", label: "主播档案", desc: "主播 + 性别 + 代数 + 账号", icon: Users, file: "主播档案" },
];

export function ExportPage() {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unavailable = typeof window !== "undefined" && !getDataApi();
  if (unavailable) {
    return (
      <Card>
        <CardContent>
          <BrowserModeState />
        </CardContent>
      </Card>
    );
  }

  const onExport = async (opt: (typeof OPTIONS)[number]) => {
    setBusy(opt.kind);
    setMsg(null);
    setError(null);
    try {
      const api = getDataApi()!;
      const res =
        opt.kind === "wave"
          ? await api.exportWave()
          : opt.kind === "duration"
            ? await api.exportDuration()
            : await api.exportAnchors();
      if (!res.success) throw new Error(res.error);
      if (res.data.length === 0) {
        setMsg(`${opt.label}暂无数据可导出`);
        return;
      }
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      downloadCsv(res.data, `${opt.file}_${date}.csv`);
      setMsg(`已导出 ${res.data.length} 条${opt.label}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">数据导出</h3>
        <Badge variant="outline" className="font-mono text-[11px]">CSV</Badge>
      </div>

      <div className="space-y-3">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isBusy = busy === opt.kind;
          return (
            <div
              key={opt.kind}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors",
                isBusy && "border-primary/40 bg-primary/5"
              )}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="font-semibold text-foreground">{opt.label}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{opt.desc}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExport(opt)}
                disabled={busy !== null}
                className="shrink-0 gap-1.5"
              >
                {isBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                导出
              </Button>
            </div>
          );
        })}
      </div>

      {msg && (
        <Card className="border-chart-2/40">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-chart-2">
            <CheckCircle2 className="size-4" />
            {msg}
          </CardContent>
        </Card>
      )}
      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
