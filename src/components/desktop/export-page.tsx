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
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">数据导出</h3>

      <div className="grid gap-5 sm:grid-cols-3">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <div
              key={opt.kind}
              className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 text-center"
            >
              <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
                <Icon className="size-7" />
              </div>
              <div>
                <p className="font-semibold text-foreground">{opt.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{opt.desc}</p>
              </div>
              <Button
                variant="outline"
                size="lg"
                onClick={() => onExport(opt)}
                disabled={busy !== null}
                className="w-full gap-2"
              >
                {busy === opt.kind ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Download className="size-5" />
                )}
                导出 CSV
              </Button>
            </div>
          );
        })}
      </div>

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
