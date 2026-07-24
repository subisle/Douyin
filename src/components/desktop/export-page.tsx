"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Waves, Clock, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { downloadCsv } from "./csv";
import { BrowserModeState } from "./states";

type ExportKind = "wave" | "duration" | "anchors";

// 业务日默认昨天：今天 22 → 21
function businessIsoDate() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const OPTIONS: {
  kind: ExportKind;
  label: string;
  desc: string;
  icon: typeof Waves;
  file: string;
}[] = [
  { kind: "wave", label: "音浪数据", desc: "全部音浪快照（含日期、排名）", icon: Waves, file: "音浪数据" },
  {
    kind: "duration",
    label: "时长数据",
    desc: "按截止日导出累计直播时长（取最近一次快照）",
    icon: Clock,
    file: "时长数据",
  },
  { kind: "anchors", label: "主播档案", desc: "主播 + 性别 + 代数 + 账号", icon: Users, file: "主播档案" },
];

export function ExportPage() {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 默认填最近有时长/数据的导入日
  const [asOfDate, setAsOfDate] = useState("");

  const unavailable = typeof window !== "undefined" && !getDataApi();
  const durationHint = useMemo(
    () => `导出截至 ${asOfDate || "最新"} 的累计时长`,
    [asOfDate]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = getDataApi();
      if (!api) {
        if (!cancelled) setAsOfDate(businessIsoDate());
        return;
      }
      try {
        const res = await api.getDashboardSummary();
        if (cancelled) return;
        const latest =
          (res.success &&
            (res.data.latestDurationDate || res.data.latestDataDate || res.data.latestWaveDate)) ||
          null;
        setAsOfDate(latest || businessIsoDate());
      } catch {
        if (!cancelled) setAsOfDate(businessIsoDate());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
            ? await api.exportDuration(asOfDate || undefined)
            : await api.exportAnchors();
      if (!res.success) throw new Error(res.error);
      if (res.data.length === 0) {
        setMsg(`${opt.label}暂无数据可导出`);
        return;
      }
      const stamp = asOfDate || businessIsoDate();
      downloadCsv(res.data, `${opt.file}_${stamp}.csv`);
      setMsg(
        opt.kind === "duration"
          ? `已导出 ${res.data.length} 条累计时长（截止 ${stamp}）`
          : `已导出 ${res.data.length} 条${opt.label}`
      );
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

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">时长截止日</p>
            <p className="text-xs text-muted-foreground">
              导入的时长是累计值；导出时取该日及之前最近一次快照作为累计时长。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-[160px]"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAsOfDate(businessIsoDate())}
            >
              昨天
            </Button>
          </div>
        </CardContent>
      </Card>

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
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {opt.kind === "duration" ? durationHint : opt.desc}
                </p>
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
