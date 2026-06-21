"use client";

import { useState } from "react";
import { Download, Loader2, Waves, Clock, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

  const unavailable = typeof window !== "undefined" && !window.electronAPI;
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
      const api = window.electronAPI!;
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
      const date = new Date().toISOString().split("T")[0];
      downloadCsv(res.data, `${opt.file}_${date}.csv`);
      setMsg(`已导出 ${res.data.length} 条${opt.label}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">导出数据</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <div
                key={opt.kind}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                  <Icon className="size-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{opt.desc}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onExport(opt)}
                  disabled={busy !== null}
                >
                  {busy === opt.kind ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  导出 CSV
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {msg && (
        <Card className="border-chart-2/40">
          <CardContent className="py-4 text-sm text-chart-2">{msg}</CardContent>
        </Card>
      )}
      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}
    </div>
  );
}
