"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FileUp,
  Loader2,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  matchRows,
  parseCsvFile,
  type ImportableRow,
  type ImportKind,
  type ParsedRow,
} from "./csv";
import { formatDuration, formatWave } from "./format";
import { BrowserModeState } from "./states";
import type { ImportMeta, ImportPreviewResult } from "@/types/electron";

export interface DroppedImportFile {
  id: number;
  file: File;
}

type ChangeStatus = "new" | "changed" | "unchanged";

interface PreviewRow extends ImportableRow {
  previousValue: number | null;
  previousRank: number | null;
  status: ChangeStatus;
  duplicateInFile: boolean;
}

interface PreviewSummary {
  importable: PreviewRow[];
  matched: PreviewRow[];
  unmatched: { anchorIdRaw: string; anchorName: string; value: number }[];
  skipped: number;
  totalRows: number;
  duplicateRows: number;
  stats: Record<ChangeStatus, number>;
  meta: ImportMeta;
  duplicateFile: ImportPreviewResult["duplicateFile"];
  duplicateData: ImportPreviewResult["duplicateData"];
}

const yesterdayStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  wave: "音浪",
  duration: "直播时长",
};

function detectKindFromHeader(text: string, fallback: ImportKind): ImportKind {
  const header = text.split(/\r?\n/)[0]?.toLowerCase() ?? "";
  if (/(时长|duration|开播|有效时长)/i.test(header)) return "duration";
  if (/(音浪|wave|总音浪)/i.test(header)) return "wave";
  return fallback;
}

async function detectImportKind(file: File, fallback: ImportKind): Promise<ImportKind> {
  const text = await file.slice(0, 4096).text();
  return detectKindFromHeader(text, fallback);
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}

function md5ArrayBuffer(buffer: ArrayBuffer): string {
  const input = new Uint8Array(buffer);
  const bytes = Array.from(input);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLen / 2 ** (8 * i)) & 0xff);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
  const leftRotate = (x: number, amount: number) => ((x << amount) | (x >>> (32 - amount))) >>> 0;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const m = Array.from({ length: 16 }, (_, i) => {
      const j = offset + i * 4;
      return (bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24)) >>> 0;
    });
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const next = d;
      d = c;
      c = b;
      b = (b + leftRotate((a + f + k[i] + m[g]) >>> 0, s[i])) >>> 0;
      a = next;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const wordToHex = (word: number) =>
    [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, "0")).join("");
  return [a0, b0, c0, d0].map(wordToHex).join("");
}

async function md5File(file: File) {
  return md5ArrayBuffer(await file.arrayBuffer());
}

function dedupeImportable(rows: ImportableRow[]) {
  const seen = new Map<string, ImportableRow>();
  const duplicated = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.anchorId)) duplicated.add(row.anchorId);
    seen.set(row.anchorId, row);
  }
  return {
    rows: Array.from(seen.values()),
    duplicated,
    duplicateRows: rows.length - seen.size,
  };
}

async function buildImportMeta(file: File, kind: ImportKind, rows: ImportableRow[]): Promise<ImportMeta> {
  const canonical = rows
    .map((row) => ({
      anchorId: row.anchorId,
      value: Math.round(row.value) || 0,
      rank: kind === "wave" ? Math.round(row.rank) || 0 : 0,
    }))
    .sort((a, b) => a.anchorId.localeCompare(b.anchorId));
  return {
    fileHash: await md5File(file),
    dataHash: await sha256Text(JSON.stringify(canonical)),
    fileName: file.name,
    rowCount: canonical.length,
  };
}

function statusLabel(status: ChangeStatus) {
  if (status === "new") return "新增";
  if (status === "changed") return "覆盖";
  return "无变化";
}

function statusClass(status: ChangeStatus) {
  if (status === "new") return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300";
  if (status === "changed") return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300";
  return "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300";
}

export function ImportPage({
  incomingFile,
  onIncomingFileConsumed,
}: {
  incomingFile?: DroppedImportFile | null;
  onIncomingFileConsumed?: () => void;
}) {
  const [kind, setKind] = useState<ImportKind>("wave");
  const [date, setDate] = useState(yesterdayStr());
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const currentFileRef = useRef<File | null>(null);
  const lastIncomingId = useRef<number | null>(null);

  const unavailable = typeof window !== "undefined" && !window.electronAPI;
  const rowsToImport = useMemo(
    () => summary?.importable.filter((row) => row.status !== "unchanged") ?? [],
    [summary]
  );
  const blockedByDuplicate = Boolean(summary?.duplicateFile || summary?.duplicateData);

  const reset = () => {
    setSummary(null);
    setResult(null);
    setError(null);
    setFileName("");
    currentFileRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
  };

  const buildPreview = async (file: File, rows: ParsedRow[], nextKind: ImportKind) => {
    const anchorsRes = await window.electronAPI!.getAnchors();
    if (!anchorsRes.success) throw new Error(anchorsRes.error);
    const baseSummary = matchRows(rows, anchorsRes.data);
    const deduped = dedupeImportable(baseSummary.importable);
    const meta = await buildImportMeta(file, nextKind, deduped.rows);
    const previewRes = await window.electronAPI!.getImportPreview(
      nextKind,
      date,
      deduped.rows.map((row) => row.anchorId),
      meta
    );
    if (!previewRes.success) throw new Error(previewRes.error);

    const existing = new Map(previewRes.data.existing.map((row) => [row.anchorId, row]));
    const importable = deduped.rows.map((row): PreviewRow => {
      const old = existing.get(row.anchorId);
      const oldValue = old ? Number(old.value) || 0 : null;
      const oldRank = old ? Number(old.rank) || 0 : null;
      const sameValue = oldValue !== null && Math.round(oldValue) === Math.round(row.value);
      const sameRank = nextKind !== "wave" || Math.round(oldRank || 0) === (Math.round(row.rank) || 0);
      const status: ChangeStatus = oldValue === null ? "new" : sameValue && sameRank ? "unchanged" : "changed";
      return {
        ...row,
        previousValue: oldValue,
        previousRank: oldRank,
        status,
        duplicateInFile: deduped.duplicated.has(row.anchorId),
      };
    });
    const stats = importable.reduce<Record<ChangeStatus, number>>(
      (acc, row) => {
        acc[row.status] += 1;
        return acc;
      },
      { new: 0, changed: 0, unchanged: 0 }
    );
    setSummary({
      importable,
      matched: importable.filter((row) => row.matched),
      unmatched: baseSummary.unmatched,
      skipped: baseSummary.skipped,
      totalRows: baseSummary.totalRows,
      duplicateRows: deduped.duplicateRows,
      stats,
      meta,
      duplicateFile: previewRes.data.duplicateFile,
      duplicateData: previewRes.data.duplicateData,
    });
  };

  const onPickFile = async (file: File, mode: "auto" | "current" = "current") => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("请拖入 CSV 文件");
      return;
    }
    setError(null);
    setResult(null);
    setParsing(true);
    setFileName(file.name);
    currentFileRef.current = file;
    try {
      const nextKind = mode === "auto" ? await detectImportKind(file, kind) : kind;
      if (nextKind !== kind) setKind(nextKind);
      const rows = await parseCsvFile(file, nextKind);
      await buildPreview(file, rows, nextKind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setParsing(false);
      onIncomingFileConsumed?.();
    }
  };

  const handleKindChange = async (nextKind: ImportKind) => {
    setKind(nextKind);
    setResult(null);
    if (!currentFileRef.current) {
      setSummary(null);
      setError(null);
      return;
    }
    const file = currentFileRef.current;
    setParsing(true);
    setError(null);
    try {
      const rows = await parseCsvFile(file, nextKind);
      await buildPreview(file, rows, nextKind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setParsing(false);
    }
  };

  useEffect(() => {
    if (!incomingFile || incomingFile.id === lastIncomingId.current) return;
    lastIncomingId.current = incomingFile.id;
    onPickFile(incomingFile.file, "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- incomingFile is an external drop event, handled once by id.
  }, [incomingFile]);

  useEffect(() => {
    if (!currentFileRef.current || parsing) return;
    const file = currentFileRef.current;
    setParsing(true);
    setError(null);
    parseCsvFile(file, kind)
      .then((rows) => buildPreview(file, rows, kind))
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setSummary(null);
      })
      .finally(() => setParsing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- date changes only need rebuilding preview against existing DB data.
  }, [date]);

  const onSubmit = async () => {
    if (!summary || rowsToImport.length === 0 || blockedByDuplicate) return;
    setSubmitting(true);
    setError(null);
    try {
      const api = window.electronAPI!;
      const res =
        kind === "wave"
          ? await api.importWave(
              date,
              rowsToImport.map((m) => ({
                anchorId: m.anchorId,
                waveValue: m.value,
                rank: m.rank,
              })),
              summary.meta
            )
          : await api.importDuration(
              date,
              rowsToImport.map((m) => ({
                anchorId: m.anchorId,
                totalMinutes: m.value,
              })),
              summary.meta
            );
      if (!res.success) throw new Error(res.error);
      setResult(
        `成功导入 ${rowsToImport.length} 条${IMPORT_KIND_LABEL[kind]}数据（新增 ${summary.stats.new}，覆盖 ${summary.stats.changed}，无变化 ${summary.stats.unchanged}，日期 ${date}）`
      );
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (unavailable) {
    return (
      <Card>
        <CardContent>
          <BrowserModeState />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">数据导入</h3>
          <Badge variant="outline" className="font-mono text-[11px]">
            默认 {yesterdayStr()}
          </Badge>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">数据类型</label>
            <div className="flex gap-2">
              {(["wave", "duration"] as ImportKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => handleKindChange(k)}
                  className={cn(
                    "rounded-full px-6 py-2 text-sm font-medium transition-colors",
                    kind === k
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  {IMPORT_KIND_LABEL[k]}
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
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickFile(f, "current");
          }}
        />
        <div
          data-import-drop-zone="true"
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter.current += 1;
            setIsDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragLeave={(e) => {
            e.stopPropagation();
            dragCounter.current -= 1;
            if (dragCounter.current <= 0) {
              dragCounter.current = 0;
              setIsDragging(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter.current = 0;
            setIsDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onPickFile(f, "auto");
          }}
          onClick={() => !parsing && fileRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-accent/30",
            parsing && "pointer-events-none opacity-60"
          )}
        >
          {parsing ? (
            <Loader2 className="size-8 animate-spin text-primary" />
          ) : (
            <FileUp className="size-8 text-muted-foreground" />
          )}
          <span className="text-sm font-medium text-foreground">
            {fileName || "拖拽 CSV 文件到此处，或点击选择"}
          </span>
          <span className="text-xs text-muted-foreground">
            支持全局拖入；拖入后可修改日期并预览新增、覆盖和无变化数据
          </span>
        </div>
      </div>

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

      {summary && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck2 className="size-4 text-primary" />
                导入预览
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-emerald-500/15 px-3 py-1 text-sm text-emerald-600 hover:bg-emerald-500/15">
                  新增 {summary.stats.new}
                </Badge>
                <Badge className="bg-amber-500/15 px-3 py-1 text-sm text-amber-700 hover:bg-amber-500/15">
                  覆盖 {summary.stats.changed}
                </Badge>
                <Badge variant="outline" className="px-3 py-1 text-sm">
                  无变化 {summary.stats.unchanged}
                </Badge>
                {summary.duplicateRows > 0 && (
                  <Badge variant="destructive" className="px-3 py-1 text-sm">
                    文件内重复 {summary.duplicateRows}
                  </Badge>
                )}
                {summary.unmatched.length > 0 && (
                  <Badge variant="destructive" className="px-3 py-1 text-sm">
                    待添加主播 {summary.unmatched.length}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {(summary.duplicateFile || summary.duplicateData) && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <div>
                  {summary.duplicateFile
                    ? `文件 MD5 已导入过：${summary.duplicateFile.fileName || "同名记录"}`
                    : `导入数据与历史记录重复：${summary.duplicateData?.fileName || "同内容记录"}`}
                </div>
              </div>
            )}
            <PreviewTable kind={kind} summary={summary} />

            <div className="flex items-center gap-4 pt-2">
              <Button
                onClick={onSubmit}
                disabled={submitting || rowsToImport.length === 0 || blockedByDuplicate}
                size="lg"
                className="min-w-[180px] gap-2"
              >
                {submitting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Upload className="size-5" />
                )}
                确认导入 {rowsToImport.length} 条
              </Button>
              <Button variant="outline" size="lg" onClick={reset} disabled={submitting}>
                取消
              </Button>
              <span className="text-xs text-muted-foreground">
                MD5 {summary.meta.fileHash.slice(0, 8)} · 数据 {summary.meta.dataHash.slice(0, 8)}
              </span>
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
  summary: PreviewSummary;
}) {
  const fmt = (v: number | null) => {
    if (v === null) return "—";
    return kind === "wave" ? formatWave(v) : formatDuration(v);
  };
  const sample = summary.importable.slice(0, 80);

  return (
    <div className="space-y-3">
      <div className="max-h-80 overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/90 backdrop-blur">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">主播</th>
              <th className="px-3 py-2 font-medium">抖音ID</th>
              <th className="px-3 py-2 text-right font-medium">已有</th>
              <th className="px-3 py-2 text-right font-medium">导入后</th>
              {kind === "wave" && <th className="px-3 py-2 text-right font-medium">排名</th>}
            </tr>
          </thead>
          <tbody>
            {sample.map((m, i) => (
              <tr
                key={m.anchorId + i}
                className={cn(
                  "border-t border-border/60",
                  m.status === "changed" && "bg-amber-50/60 dark:bg-amber-950/15",
                  m.status === "unchanged" && "text-muted-foreground"
                )}
              >
                <td className="px-3 py-1.5">
                  <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs", statusClass(m.status))}>
                    {statusLabel(m.status)}
                  </span>
                </td>
                <td className="px-3 py-1.5 font-medium text-foreground">
                  {m.anchorName || "未命名"}
                  {m.duplicateInFile && (
                    <span className="ml-2 text-xs text-destructive">重复行</span>
                  )}
                  {!m.matched && (
                    <span className="ml-2 text-xs text-muted-foreground">未在主播列表</span>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {m.anchorId}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{fmt(m.previousValue)}</td>
                <td className="px-3 py-1.5 text-right text-primary">{fmt(m.value)}</td>
                {kind === "wave" && (
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {m.previousRank ? `${m.previousRank} -> ${m.rank || "—"}` : m.rank || "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {summary.importable.length > sample.length && (
        <p className="text-xs text-muted-foreground">
          仅预览前 {sample.length} 条，共 {summary.importable.length} 条有效数据。
        </p>
      )}
      {summary.unmatched.length > 0 && (
        <p className="text-xs text-muted-foreground">
          未匹配主播的数据会先进入快照库；添加对应主播后，历史数据会自动出现在报表中。
        </p>
      )}
      {summary.skipped > 0 && (
        <p className="text-xs text-muted-foreground">
          {summary.skipped} 行因缺少主播 ID 或数值非法被跳过。
        </p>
      )}
    </div>
  );
}
