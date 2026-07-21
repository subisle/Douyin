"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FileUp,
  ListFilter,
  Loader2,
  ShieldAlert,
  Upload,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  matchRows,
  parseAnchorsCsvWithSummary,
  parseCsvFile,
  type AnchorImportRow,
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
type PreviewFilter = "all" | ChangeStatus | "unmatched" | "duplicate";
type ImportMode = ImportKind | "anchors";
type AnchorRowStatus = "new" | "existing";

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

interface AnchorPreviewRow extends AnchorImportRow {
  status: AnchorRowStatus;
  existingName: string | null;
}

interface AnchorPreviewSummary {
  rows: AnchorPreviewRow[];
  importable: AnchorPreviewRow[];
  existing: AnchorPreviewRow[];
  skipped: number;
  totalRows: number;
  duplicateRows: number;
  meta: ImportMeta;
  stats: Record<AnchorRowStatus, number>;
}

const yesterdayStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const IMPORT_KIND_LABEL: Record<ImportMode, string> = {
  wave: "音浪",
  duration: "直播时长",
  anchors: "主播档案",
};

function detectKindFromHeader(text: string, fallback: ImportMode): ImportMode {
  const header = text.split(/\r?\n/)[0]?.toLowerCase() ?? "";
  if (/(时长|duration|开播|有效时长)/i.test(header)) return "duration";
  if (/(音浪|wave|总音浪)/i.test(header)) return "wave";
  if (/(主播|昵称|姓名|抖音号|抖音id|anchor|uid|douyin)/i.test(header)) return "anchors";
  return fallback;
}

async function detectImportKind(file: File, fallback: ImportMode): Promise<ImportMode> {
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

async function buildAnchorImportMeta(file: File, rows: AnchorImportRow[]): Promise<ImportMeta> {
  const canonical = rows
    .map((row) => ({
      anchorId: row.anchorId,
      douyinNo: row.douyinNo || "",
      name: row.name || "",
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

function formatValueForKind(kind: ImportKind, value: number | null) {
  if (value === null) return "—";
  return kind === "wave" ? formatWave(value) : formatDuration(value);
}

function formatDeltaForKind(kind: ImportKind, previousValue: number | null, nextValue: number) {
  if (previousValue === null) return `+${formatValueForKind(kind, nextValue)}`;
  const delta = Math.round(nextValue) - Math.round(previousValue);
  if (delta === 0) return "0";
  return `${delta > 0 ? "+" : "-"}${formatValueForKind(kind, Math.abs(delta))}`;
}

function deltaClass(previousValue: number | null, nextValue: number) {
  if (previousValue === null) return "text-emerald-700 dark:text-emerald-300";
  const delta = Math.round(nextValue) - Math.round(previousValue);
  if (delta > 0) return "text-emerald-700 dark:text-emerald-300";
  if (delta < 0) return "text-red-700 dark:text-red-300";
  return "text-muted-foreground";
}

export function ImportPage({
  incomingFile,
  onIncomingFileConsumed,
}: {
  incomingFile?: DroppedImportFile | null;
  onIncomingFileConsumed?: () => void;
}) {
  const [kind, setKind] = useState<ImportMode>("wave");
  const [date, setDate] = useState(yesterdayStr());
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [anchorSummary, setAnchorSummary] = useState<AnchorPreviewSummary | null>(null);
  const [anchorGender, setAnchorGender] = useState<"male" | "female">("male");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const currentFileRef = useRef<File | null>(null);
  const lastIncomingId = useRef<number | null>(null);

  const unavailable = typeof window !== "undefined" && !getDataApi();
  const rowsToImport = useMemo(
    () => summary?.importable.filter((row) => row.status !== "unchanged") ?? [],
    [summary]
  );
  const anchorRowsToImport = useMemo(
    () => anchorSummary?.importable ?? [],
    [anchorSummary]
  );
  const blockedByDuplicate = kind !== "anchors" && Boolean(summary?.duplicateFile || summary?.duplicateData);

  const resetImportState = (options: { keepResult?: boolean } = {}) => {
    setSummary(null);
    setAnchorSummary(null);
    if (!options.keepResult) setResult(null);
    setError(null);
    setFileName("");
    currentFileRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
  };
  const reset = () => resetImportState();
  const resetAfterSuccess = () => resetImportState({ keepResult: true });

  const buildPreview = async (file: File, rows: ParsedRow[], nextKind: ImportKind) => {
    const anchorsRes = await getDataApi()!.getAnchors();
    if (!anchorsRes.success) throw new Error(anchorsRes.error);
    const baseSummary = matchRows(rows, anchorsRes.data);
    const deduped = dedupeImportable(baseSummary.importable);
    const meta = await buildImportMeta(file, nextKind, deduped.rows);
    const previewRes = await getDataApi()!.getImportPreview(
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

  const buildAnchorPreview = async (file: File) => {
    const anchorsRes = await getDataApi()!.getAnchors();
    if (!anchorsRes.success) throw new Error(anchorsRes.error);
    const parsed = await parseAnchorsCsvWithSummary(file);
    const byAnchorId = new Map(anchorsRes.data.map((anchor) => [anchor.anchorId, anchor]));
    const byDouyinNo = new Map(
      anchorsRes.data
        .filter((anchor) => anchor.douyinNo)
        .map((anchor) => [anchor.douyinNo, anchor])
    );
    const meta = await buildAnchorImportMeta(file, parsed.rows);
    const rows = parsed.rows.map((row): AnchorPreviewRow => {
      const existing = byAnchorId.get(row.anchorId) || (row.douyinNo ? byDouyinNo.get(row.douyinNo) : undefined);
      return {
        ...row,
        status: existing ? "existing" : "new",
        existingName: existing ? existing.name || existing.anchorName || null : null,
      };
    });
    const importable = rows.filter((row) => row.status === "new");
    setAnchorSummary({
      rows,
      importable,
      existing: rows.filter((row) => row.status === "existing"),
      skipped: parsed.skipped,
      totalRows: parsed.totalRows,
      duplicateRows: parsed.duplicateRows,
      meta,
      stats: {
        new: importable.length,
        existing: rows.length - importable.length,
      },
    });
    setSummary(null);
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
      if (nextKind === "anchors") {
        await buildAnchorPreview(file);
      } else {
        const rows = await parseCsvFile(file, nextKind);
        await buildPreview(file, rows, nextKind);
        setAnchorSummary(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setParsing(false);
      onIncomingFileConsumed?.();
    }
  };

  const handleKindChange = async (nextKind: ImportMode) => {
    setKind(nextKind);
    setResult(null);
    if (!currentFileRef.current) {
      setSummary(null);
      setAnchorSummary(null);
      setError(null);
      return;
    }
    const file = currentFileRef.current;
    setParsing(true);
    setError(null);
    try {
      if (nextKind === "anchors") {
        await buildAnchorPreview(file);
      } else {
        const rows = await parseCsvFile(file, nextKind);
        await buildPreview(file, rows, nextKind);
        setAnchorSummary(null);
      }
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
    if (!currentFileRef.current || parsing || kind === "anchors") return;
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
    if (kind === "anchors") {
      if (!anchorSummary || anchorRowsToImport.length === 0) return;
    } else if (!summary || rowsToImport.length === 0 || blockedByDuplicate) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const api = getDataApi()!;
      if (kind === "anchors") {
        const res = await api.batchImportAnchors(
          anchorRowsToImport.map((row) => ({
            anchorId: row.anchorId,
            name: row.name,
            douyinNo: row.douyinNo,
            gender: anchorGender,
          }))
        );
        if (!res.success) throw new Error(res.error);
        setResult(`成功导入 ${res.data.created} 个主播，跳过 ${res.data.skipped} 个已存在主播`);
      } else {
        const res = kind === "wave"
          ? await api.importWave(
              date,
              rowsToImport.map((m) => ({
                anchorId: m.anchorId,
                waveValue: m.value,
                rank: m.rank,
              })),
              summary!.meta
            )
          : await api.importDuration(
              date,
              rowsToImport.map((m) => ({
                anchorId: m.anchorId,
                totalMinutes: m.value,
              })),
              summary!.meta
            );
        if (!res.success) throw new Error(res.error);
        setResult(
          `成功导入 ${rowsToImport.length} 条${IMPORT_KIND_LABEL[kind]}数据（新增 ${summary!.stats.new}，覆盖 ${summary!.stats.changed}，无变化 ${summary!.stats.unchanged}，日期 ${date}）`
        );
      }
      resetAfterSuccess();
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
            {kind === "anchors" ? "主播档案" : `默认 ${yesterdayStr()}`}
          </Badge>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">数据类型</label>
            <div className="flex flex-wrap gap-2">
              {(["wave", "duration", "anchors"] as ImportMode[]).map((k) => (
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

          {kind === "anchors" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">主播性别</label>
              <div className="inline-flex rounded-full border border-border bg-card p-1">
                {([
                  ["male", "男"],
                  ["female", "女"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setAnchorGender(value)}
                    className={cn(
                      "rounded-full px-5 py-1.5 text-sm font-medium transition-colors",
                      anchorGender === value
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">导入日期</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-48"
              />
            </div>
          )}
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
          data-file-drop-zone="true"
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
            if (f) onPickFile(f, "current");
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
            支持全局拖入，导入前会先预览
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

      {summary && kind !== "anchors" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div className="app-no-drag flex max-h-[calc(100vh-48px)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-semibold">
                  <FileCheck2 className="size-4 text-primary" />
                  导入预览
                  {parsing && <Loader2 className="size-4 animate-spin text-primary" />}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {fileName || summary.meta.fileName} · {date}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-full border border-border bg-background p-1">
                  {(["wave", "duration", "anchors"] as ImportMode[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => handleKindChange(k)}
                      disabled={parsing || submitting}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                        kind === k
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {IMPORT_KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={parsing || submitting}
                  className="h-8 w-36"
                />
                <Badge className="bg-emerald-500/15 px-3 py-1 text-sm text-emerald-600 hover:bg-emerald-500/15">新增 {summary.stats.new}</Badge>
                <Badge className="bg-amber-500/15 px-3 py-1 text-sm text-amber-700 hover:bg-amber-500/15">覆盖 {summary.stats.changed}</Badge>
                <Badge variant="outline" className="px-3 py-1 text-sm">无变化 {summary.stats.unchanged}</Badge>
                <button
                  onClick={reset}
                  disabled={submitting}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                  title="关闭预览"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4">
              <ImportAuditSummary
                kind={kind}
                date={date}
                fileName={fileName}
                summary={summary}
                rowsToImportCount={rowsToImport.length}
                blockedByDuplicate={blockedByDuplicate}
              />
              {(summary.duplicateFile || summary.duplicateData) && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  <div>重复导入，已锁定确认按钮</div>
                </div>
              )}
              <PreviewTable kind={kind} summary={summary} />
              <ImportIssueList kind={kind} summary={summary} />
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-card px-5 py-4">
              <Button
                onClick={onSubmit}
                disabled={submitting || parsing || rowsToImport.length === 0 || blockedByDuplicate}
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
              <span className="text-xs text-muted-foreground">已完成重复校验</span>
            </div>
          </div>
        </div>
      )}

      {anchorSummary && kind === "anchors" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div className="app-no-drag flex max-h-[calc(100vh-48px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-semibold">
                  <Users className="size-4 text-primary" />
                  主播导入预览
                  {parsing && <Loader2 className="size-4 animate-spin text-primary" />}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {fileName || anchorSummary.meta.fileName} · {anchorGender === "male" ? "男主播" : "女主播"}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-full border border-border bg-background p-1">
                  {(["wave", "duration", "anchors"] as ImportMode[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => handleKindChange(k)}
                      disabled={parsing || submitting}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                        kind === k
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {IMPORT_KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
                <div className="inline-flex rounded-full border border-border bg-background p-1">
                  {([
                    ["male", "男"],
                    ["female", "女"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setAnchorGender(value)}
                      disabled={submitting}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                        anchorGender === value
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Badge className="bg-emerald-500/15 px-3 py-1 text-sm text-emerald-600 hover:bg-emerald-500/15">
                  新增 {anchorSummary.stats.new}
                </Badge>
                <Badge variant="outline" className="px-3 py-1 text-sm">
                  已存在 {anchorSummary.stats.existing}
                </Badge>
                <button
                  onClick={reset}
                  disabled={submitting}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                  title="关闭预览"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4">
              <AnchorImportAuditSummary
                summary={anchorSummary}
                fileName={fileName}
                gender={anchorGender}
              />
              <AnchorPreviewTable summary={anchorSummary} />
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-card px-5 py-4">
              <Button
                onClick={onSubmit}
                disabled={submitting || parsing || anchorRowsToImport.length === 0}
                size="lg"
                className="min-w-[180px] gap-2"
              >
                {submitting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Upload className="size-5" />
                )}
                确认导入 {anchorRowsToImport.length} 个
              </Button>
              <Button variant="outline" size="lg" onClick={reset} disabled={submitting}>
                取消
              </Button>
              <span className="text-xs text-muted-foreground">已完成重复校验</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnchorImportAuditSummary({
  summary,
  fileName,
  gender,
}: {
  summary: AnchorPreviewSummary;
  fileName: string;
  gender: "male" | "female";
}) {
  const fileLabel = fileName || summary.meta.fileName || "未命名文件";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
      <Badge variant="secondary">{gender === "male" ? "男主播" : "女主播"}</Badge>
      <span className="max-w-72 truncate text-muted-foreground">{fileLabel}</span>
      <Badge variant="outline">有效 {summary.rows.length}</Badge>
      <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">新增 {summary.stats.new}</Badge>
      <Badge variant="outline">已存在 {summary.stats.existing}</Badge>
      {summary.duplicateRows > 0 && <Badge className="bg-amber-500/15 text-amber-800 hover:bg-amber-500/15">重复 {summary.duplicateRows}</Badge>}
      {summary.skipped > 0 && <Badge className="bg-amber-500/15 text-amber-800 hover:bg-amber-500/15">跳过 {summary.skipped}</Badge>}
    </div>
  );
}

function AnchorPreviewTable({ summary }: { summary: AnchorPreviewSummary }) {
  const [filter, setFilter] = useState<"all" | AnchorRowStatus>("all");
  const counts = {
    all: summary.rows.length,
    new: summary.stats.new,
    existing: summary.stats.existing,
  };
  const rows = summary.rows.filter((row) => filter === "all" || row.status === filter);
  const sample = rows.slice(0, 160);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ListFilter className="size-4 text-primary" />
          主播明细
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ["all", "全部"],
            ["new", "新增"],
            ["existing", "已存在"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              disabled={counts[key] === 0}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                filter === key
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {label} {counts[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/90 backdrop-blur">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">主播</th>
              <th className="px-3 py-2 font-medium">主播ID</th>
              <th className="px-3 py-2 font-medium">抖音号</th>
              <th className="px-3 py-2 font-medium">库内姓名</th>
            </tr>
          </thead>
          <tbody>
            {sample.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  当前筛选没有数据
                </td>
              </tr>
            )}
            {sample.map((row) => (
              <tr
                key={row.anchorId}
                className={cn(
                  "border-t border-border/60",
                  row.status === "new" && "bg-emerald-50/40 dark:bg-emerald-950/10",
                  row.status === "existing" && "text-muted-foreground"
                )}
              >
                <td className="px-3 py-1.5">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-xs",
                      row.status === "new"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
                        : "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300"
                    )}
                  >
                    {row.status === "new" ? "新增" : "已存在"}
                  </span>
                </td>
                <td className="px-3 py-1.5 font-medium text-foreground">{row.name || "未命名"}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{row.anchorId}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{row.douyinNo || "—"}</td>
                <td className="px-3 py-1.5">{row.existingName || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > sample.length && (
        <p className="text-xs text-muted-foreground">
          当前筛选仅预览前 {sample.length} 条，共 {rows.length} 条。
        </p>
      )}
    </div>
  );
}

function ImportAuditSummary({
  kind,
  date,
  fileName,
  summary,
  rowsToImportCount,
  blockedByDuplicate,
}: {
  kind: ImportKind;
  date: string;
  fileName: string;
  summary: PreviewSummary;
  rowsToImportCount: number;
  blockedByDuplicate: boolean;
}) {
  const matchedCount = summary.importable.filter((row) => row.matched).length;
  const unmatchedCount = summary.importable.length - matchedCount;
  const fileLabel = fileName || summary.meta.fileName || "未命名文件";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
      <Badge variant="secondary">{IMPORT_KIND_LABEL[kind]}</Badge>
      <Badge variant="outline">{date}</Badge>
      <span className="max-w-72 truncate text-muted-foreground">{fileLabel}</span>
      <Badge variant="outline">有效 {summary.importable.length}</Badge>
      <Badge variant={unmatchedCount > 0 ? "outline" : "secondary"}>主播列表 {matchedCount}/{summary.importable.length}</Badge>
      {unmatchedCount > 0 && (
        <Badge className="bg-sky-500/15 text-sky-700 hover:bg-sky-500/15 dark:text-sky-200">
          未入列表 {unmatchedCount}，也会导入
        </Badge>
      )}
      <Badge className={cn(
        blockedByDuplicate
          ? "bg-red-500/15 text-red-700 hover:bg-red-500/15"
          : "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15"
      )}>
        {blockedByDuplicate ? "重复" : `写入 ${rowsToImportCount}`}
      </Badge>
      {summary.duplicateRows > 0 && <Badge className="bg-amber-500/15 text-amber-800 hover:bg-amber-500/15">重复行 {summary.duplicateRows}</Badge>}
      {summary.skipped > 0 && <Badge className="bg-amber-500/15 text-amber-800 hover:bg-amber-500/15">跳过 {summary.skipped}</Badge>}
    </div>
  );
}

function ImportIssueList({
  kind,
  summary,
}: {
  kind: ImportKind;
  summary: PreviewSummary;
}) {
  const unmatchedSample = summary.unmatched.slice(0, 12);
  const hasIssues = summary.unmatched.length > 0 || summary.skipped > 0 || summary.duplicateRows > 0;
  if (!hasIssues) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {summary.unmatched.length > 0 && (
          <Badge className="bg-sky-500/15 text-sky-700 hover:bg-sky-500/15 dark:text-sky-200">
            未入列表 {summary.unmatched.length}
          </Badge>
        )}
        {summary.duplicateRows > 0 && <Badge className="bg-amber-500/15 text-amber-800 hover:bg-amber-500/15">重复行 {summary.duplicateRows}</Badge>}
        {summary.skipped > 0 && <Badge className="bg-amber-500/15 text-amber-800 hover:bg-amber-500/15">跳过 {summary.skipped}</Badge>}
      </div>
      {summary.unmatched.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 text-sm text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              <Users className="size-4" />
              未入主播列表，也会导入
            </div>
            <Badge variant="outline" className="border-sky-300 bg-white/70 text-sky-700 dark:bg-sky-950/30 dark:text-sky-200">
              {summary.unmatched.length} 条
            </Badge>
          </div>
          <div className="mt-2 max-h-36 overflow-auto rounded-lg border border-sky-200/70 bg-white/70 dark:border-sky-900/60 dark:bg-background/30">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-sky-50 text-sky-700 dark:bg-sky-950/80 dark:text-sky-200">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">主播</th>
                  <th className="px-2 py-1.5 text-left font-medium">抖音ID</th>
                  <th className="px-2 py-1.5 text-right font-medium">数值</th>
                </tr>
              </thead>
              <tbody>
                {unmatchedSample.map((row, index) => (
                  <tr key={`${row.anchorIdRaw}-${index}`} className="border-t border-sky-100/80 dark:border-sky-900/50">
                    <td className="px-2 py-1.5">{row.anchorName || `ID ${row.anchorIdRaw}`}</td>
                    <td className="px-2 py-1.5 font-mono">{row.anchorIdRaw}</td>
                    <td className="px-2 py-1.5 text-right">{formatValueForKind(kind, row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary.unmatched.length > unmatchedSample.length && (
            <div className="mt-2 text-xs opacity-75">仅显示前 {unmatchedSample.length} 条</div>
          )}
        </div>
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
  const [filter, setFilter] = useState<PreviewFilter>("all");
  const counts: Record<PreviewFilter, number> = {
    all: summary.importable.length,
    new: summary.stats.new,
    changed: summary.stats.changed,
    unchanged: summary.stats.unchanged,
    unmatched: summary.importable.filter((row) => !row.matched).length,
    duplicate: summary.importable.filter((row) => row.duplicateInFile).length,
  };
  const filters: { key: PreviewFilter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "new", label: "新增" },
    { key: "changed", label: "覆盖" },
    { key: "unchanged", label: "无变化" },
    { key: "unmatched", label: "未入列表" },
    { key: "duplicate", label: "重复行" },
  ];
  const filteredRows = summary.importable.filter((row) => {
    if (filter === "all") return true;
    if (filter === "unmatched") return !row.matched;
    if (filter === "duplicate") return row.duplicateInFile;
    return row.status === filter;
  });
  const sample = filteredRows.slice(0, 120);
  const colSpan = kind === "wave" ? 8 : 7;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ListFilter className="size-4 text-primary" />
          明细
        </div>
        <div className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              disabled={counts[item.key] === 0}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                filter === item.key
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {item.label} {counts[item.key]}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/90 backdrop-blur">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">主播</th>
              <th className="px-3 py-2 font-medium">抖音ID</th>
              <th className="px-3 py-2 font-medium">在列表</th>
              <th className="px-3 py-2 text-right font-medium">已有</th>
              <th className="px-3 py-2 text-right font-medium">变化</th>
              <th className="px-3 py-2 text-right font-medium">导入后</th>
              {kind === "wave" && <th className="px-3 py-2 text-right font-medium">排名</th>}
            </tr>
          </thead>
          <tbody>
            {sample.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  当前筛选没有数据
                </td>
              </tr>
            )}
            {sample.map((m, i) => (
              <tr
                key={m.anchorId + i}
                className={cn(
                  "border-t border-border/60",
                  m.status === "new" && "bg-emerald-50/40 dark:bg-emerald-950/10",
                  m.status === "changed" && "bg-amber-50/60 dark:bg-amber-950/15",
                  m.status === "unchanged" && "text-muted-foreground",
                  !m.matched && "bg-sky-50/50 dark:bg-sky-950/15"
                )}
              >
                <td className="px-3 py-1.5">
                  <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs", statusClass(m.status))}>
                    {statusLabel(m.status)}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex min-w-40 flex-col gap-1">
                    <span className="font-medium text-foreground">
                      {m.anchorName || `ID ${m.anchorId}`}
                    </span>
                    {(m.duplicateInFile || !m.matched) && (
                      <div className="flex flex-wrap gap-1">
                        {m.duplicateInFile && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">重复</span>
                        )}
                        {!m.matched && (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">会导入</span>
                        )}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {m.anchorId}
                </td>
                <td className="px-3 py-1.5">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-xs",
                      m.matched
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-300"
                        : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-300"
                    )}
                  >
                    {m.matched ? "是" : "否"}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">
                  {formatValueForKind(kind, m.previousValue)}
                </td>
                <td className={cn("px-3 py-1.5 text-right font-medium", deltaClass(m.previousValue, m.value))}>
                  {formatDeltaForKind(kind, m.previousValue, m.value)}
                </td>
                <td className="px-3 py-1.5 text-right font-medium text-primary">
                  {formatValueForKind(kind, m.value)}
                </td>
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
      {filteredRows.length > sample.length && (
        <p className="text-xs text-muted-foreground">
          当前筛选仅预览前 {sample.length} 条，共 {filteredRows.length} 条。
        </p>
      )}
    </div>
  );
}
