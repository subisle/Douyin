"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getDataApi } from "@/client/http-electron-api";
import type { DataCleanupResult, DataCleanupSummary } from "@/types/electron";

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthRange(anchor: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(last)}`,
  };
}

const PRESETS: { id: string; label: string; resolve: () => { from: string; to: string } }[] = [
  { id: "today", label: "今天", resolve: () => ({ from: todayStr(), to: todayStr() }) },
  { id: "this-month", label: "本月", resolve: () => monthRange(new Date()) },
  {
    id: "last-month",
    label: "上月",
    resolve: () => monthRange(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)),
  },
];

export function DataCleanupPage() {
  const initial = useMemo(() => monthRange(new Date()), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [summary, setSummary] = useState<DataCleanupSummary | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DataCleanupResult | null>(null);

  const loadPreview = useCallback(async (nextFrom?: string, nextTo?: string) => {
    const api = getDataApi();
    if (!api) {
      setError("当前环境不支持数据操作");
      return;
    }
    const f = nextFrom ?? from;
    const t = nextTo ?? to;
    setPreviewing(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.getDataCleanupSummary(f, t);
      if (res.success) {
        setSummary(res.data);
      } else {
        setError(typeof res.error === "string" ? res.error : "预览失败");
        setSummary(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setPreviewing(false);
    }
  }, [from, to]);

  useEffect(() => {
    void loadPreview(initial.from, initial.to);
    // 仅在挂载时预载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runDelete = useCallback(async () => {
    const api = getDataApi();
    if (!api) {
      setError("当前环境不支持数据操作");
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await api.deleteDataByDateRange(from, to);
      if (res.success) {
        setResult(res.data);
        setSummary(null);
      } else {
        setError(typeof res.error === "string" ? res.error : "删除失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }, [from, to]);

  const total = summary?.total ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5 pt-6 pb-8">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Trash2 className="size-4" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold">按日期清理数据</h3>
              <p className="text-sm text-muted-foreground">
                删除指定日期区间内的音浪快照、时长快照、导入记录与收入结算。
                <span className="text-foreground font-medium">删除前会自动整行备份</span>
                ，备份表名为 <code className="rounded bg-muted px-1 py-0.5 text-xs">backup_purge_*</code>。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">开始日期</label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">结束日期</label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const range = p.resolve();
                    setFrom(range.from);
                    setTo(range.to);
                    void loadPreview(range.from, range.to);
                  }}
                >
                  <CalendarRange className="size-3.5" />
                  {p.label}
                </Button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => void loadPreview()} disabled={previewing}>
              {previewing ? <Loader2 className="size-4 animate-spin" /> : null}
              预览
            </Button>
          </div>

          {error ? (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-4" />
              {error}
            </div>
          ) : null}

          {summary ? (
            <div className="rounded-xl border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5 text-sm">
                <span className="font-medium">
                  {summary.from} ~ {summary.to} 将删除
                </span>
                <span className={cn("font-semibold", total > 0 ? "text-destructive" : "text-muted-foreground")}>
                  合计 {total.toLocaleString()} 行
                </span>
              </div>
              <div className="divide-y divide-border">
                {summary.items.map((item) => (
                  <div key={item.table} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-muted-foreground">
                      {item.label}
                      <span className="ml-2 text-xs">（{item.kind === "period" ? "按月 period" : "按 import_date"}）</span>
                    </span>
                    <span className={cn("font-medium", (item.count ?? 0) > 0 ? "" : "text-muted-foreground")}>
                      {(item.count ?? 0).toLocaleString()} 行
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end border-t border-border px-4 py-3">
                <Button variant="destructive" onClick={() => setConfirming(true)} disabled={total === 0}>
                  <Trash2 className="size-4" />
                  删除这些数据
                </Button>
              </div>
            </div>
          ) : null}

          {result ? (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium">已删除 {result.total.toLocaleString()} 行</div>
              {result.items.map((item) => (
                <div key={item.table} className="flex justify-between text-muted-foreground">
                  <span>{item.label}</span>
                  <span>{item.deleted ?? 0} 行</span>
                </div>
              ))}
              {result.backups.length > 0 ? (
                <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">备份表：</div>
                  {result.backups.map((b) => (
                    <div key={b.backupTable}>
                      {b.backupTable} · {b.rows} 行
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {confirming ? (
        <div
          className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setConfirming(false)}
        >
          <Card className="w-full max-w-md border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <CardContent className="space-y-4 pt-6 pb-6">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <h4 className="text-base font-semibold">确认删除？</h4>
                  <p className="text-sm text-muted-foreground">此操作不可撤销</p>
                </div>
              </div>
              <p className="text-sm">
                将删除 <span className="font-semibold">{from} ~ {to}</span> 区间内共{" "}
                <span className="font-semibold text-destructive">{total.toLocaleString()}</span> 行数据。
                删除前会自动备份到 backup_purge_* 表。
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={deleting}>
                  取消
                </Button>
                <Button variant="destructive" onClick={() => void runDelete()} disabled={deleting}>
                  {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  确认删除
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
