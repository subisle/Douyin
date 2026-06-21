"use client";

import { useRef, useState } from "react";
import { Upload, FileUp, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  parseCsvFile,
  matchRows,
  type ImportKind,
  type ParseSummary,
} from "./csv";
import { formatWave, formatDuration } from "./format";
import { BrowserModeState } from "./states";

const todayStr = () => new Date().toISOString().split("T")[0];

export function ImportPage() {
  const [kind, setKind] = useState<ImportKind>("wave");
  const [date, setDate] = useState(todayStr());
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const unavailable =
    typeof window !== "undefined" && !window.electronAPI;

  if (unavailable) {
    return (
      <Card>
        <CardContent>
          <BrowserModeState />
        </CardContent>
      </Card>
    );
  }

  const reset = () => {
    setSummary(null);
    setResult(null);
    setError(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const onPickFile = async (file: File) => {
    setError(null);
    setResult(null);
    setParsing(true);
    setFileName(file.name);
    try {
      const rows = await parseCsvFile(file, kind);
      const anchorsRes = await window.electronAPI!.getAnchors();
      if (!anchorsRes.success) throw new Error(anchorsRes.error);
      setSummary(matchRows(rows, anchorsRes.data));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setParsing(false);
    }
  };

  const onSubmit = async () => {
    if (!summary || summary.matched.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const api = window.electronAPI!;
      const res =
        kind === "wave"
          ? await api.importWave(
              date,
              summary.matched.map((m) => ({
                anchorId: m.anchorId,
                waveValue: m.value,
                rank: m.rank,
              }))
            )
          : await api.importDuration(
              date,
              summary.matched.map((m) => ({
                anchorId: m.anchorId,
                totalMinutes: m.value,
              }))
            );
      if (!res.success) throw new Error(res.error);
      setResult(
        `成功导入 ${summary.matched.length} 条${kind === "wave" ? "音浪" : "时长"}数据（日期 ${date}）`
      );
      setSummary(null);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 配置区 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">导入设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">数据类型</label>
            <div className="flex gap-2">
              {(["wave", "duration"] as ImportKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setKind(k);
                    reset();
                  }}
                  className={cn(
                    "rounded-full px-5 py-1.5 text-sm font-medium transition-colors",
                    kind === k
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  {k === "wave" ? "音浪" : "时长"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">导入日期</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-48"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              CSV 文件
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                需含列：抖音号、昵称、{kind === "wave" ? "音浪、排名" : "时长"}
              </span>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={parsing}
            >
              {parsing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileUp className="size-4" />
              )}
              {fileName || "选择 CSV 文件"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="border-chart-2/40">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-chart-2">
            <CheckCircle2 className="size-4" />
            {result}
          </CardContent>
        </Card>
      )}

      {/* 预览区 */}
      {summary && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">匹配预览</CardTitle>
              <div className="flex gap-2">
                <Badge className="bg-chart-2/15 text-chart-2 hover:bg-chart-2/15">
                  匹配 {summary.matched.length}
                </Badge>
                {summary.unmatched.length > 0 && (
                  <Badge variant="destructive">
                    未匹配 {summary.unmatched.length}
                  </Badge>
                )}
                {summary.skipped > 0 && (
                  <Badge variant="outline">跳过 {summary.skipped}</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <PreviewTable kind={kind} summary={summary} />

            <div className="flex items-center gap-3">
              <Button
                onClick={onSubmit}
                disabled={submitting || summary.matched.length === 0}
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                确认导入 {summary.matched.length} 条
              </Button>
              <Button variant="ghost" onClick={reset} disabled={submitting}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PreviewTable({
  kind,
  summary,
}: {
  kind: ImportKind;
  summary: ParseSummary;
}) {
  const fmt = (v: number) => (kind === "wave" ? formatWave(v) : formatDuration(v));
  const sample = summary.matched.slice(0, 50);

  return (
    <div className="space-y-3">
      <div className="max-h-72 overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">主播</th>
              <th className="px-3 py-2 font-medium">抖音ID</th>
              <th className="px-3 py-2 text-right font-medium">
                {kind === "wave" ? "音浪" : "时长"}
              </th>
              {kind === "wave" && (
                <th className="px-3 py-2 text-right font-medium">排名</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sample.map((m, i) => (
              <tr key={m.anchorId + i} className="border-t border-border/60">
                <td className="px-3 py-1.5 font-medium text-foreground">{m.name}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {m.anchorId}
                </td>
                <td className="px-3 py-1.5 text-right text-primary">{fmt(m.value)}</td>
                {kind === "wave" && (
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {m.rank || "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {summary.matched.length > sample.length && (
        <p className="text-xs text-muted-foreground">
          仅预览前 {sample.length} 条，全部 {summary.matched.length} 条都会导入。
        </p>
      )}
      {summary.unmatched.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {summary.unmatched.length} 条未匹配到主播（抖音号不在库中），将不会导入。
        </p>
      )}
    </div>
  );
}
