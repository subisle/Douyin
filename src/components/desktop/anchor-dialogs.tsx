"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useMemo, useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FileUp, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnchorRow } from "@/types/electron";
import { parseAnchorsCsv, type AnchorImportRow } from "./csv";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  error?: string | null;
  success?: string | null;
  contentClassName?: string;
}

function Modal({ open, onClose, title, children, error, success, contentClassName }: ModalProps) {
  if (!open) return null;
  return (
    <div className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={cn("w-full max-w-md", contentClassName)} onClick={(e) => e.stopPropagation()}>
        <Card className="border border-border shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {children}
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
                {success}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface AddAnchorDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddAnchorDialog({ open, onClose, onSuccess }: AddAnchorDialogProps) {
  const [name, setName] = useState("");
  const [anchorId, setAnchorId] = useState("");
  const [douyinNo, setDouyinNo] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setAnchorId("");
    setDouyinNo("");
    setGender("");
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const api = getDataApi();
    if (!api) return;
    setError(null);
    setSuccess(null);
    if (!name.trim() || !anchorId.trim()) {
      setError("请填写主播姓名和抖音ID");
      return;
    }
    setLoading(true);
    try {
      const res = await api.addAnchor({
        name: name.trim(),
        anchorId: anchorId.trim(),
        anchorName: name.trim(),
        douyinNo: douyinNo.trim(),
        gender,
      });
      if (res.success) {
        setSuccess(`已添加主播：${name.trim()}`);
        onSuccess();
      } else {
        setError(res.error || "添加失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="添加主播" error={error} success={success}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">主播姓名</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="必填"
            disabled={loading}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">抖音ID</label>
          <Input
            value={anchorId}
            onChange={(e) => setAnchorId(e.target.value)}
            placeholder="必填，唯一"
            disabled={loading}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">抖音号</label>
          <Input
            value={douyinNo}
            onChange={(e) => setDouyinNo(e.target.value)}
            placeholder="选填"
            disabled={loading}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">性别</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGender("male")}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm transition",
                gender === "male"
                  ? "border-chart-2 bg-chart-2/10 text-chart-2"
                  : "border-border hover:bg-accent"
              )}
            >
              男
            </button>
            <button
              type="button"
              onClick={() => setGender("female")}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm transition",
                gender === "female"
                  ? "border-chart-1 bg-chart-1/10 text-chart-1"
                  : "border-border hover:bg-accent"
              )}
            >
              女
            </button>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={handleClose} disabled={loading}>
          取消
        </Button>
        <Button onClick={submit} disabled={loading || !!success}>
          {loading ? "保存中…" : success ? "已保存" : "保存"}
        </Button>
      </div>
    </Modal>
  );
}

interface MergeAccountsDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  anchors: AnchorRow[];
  prefillSecondary?: number;
}

function matchAnchorQuery(anchor: AnchorRow, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    anchor.name,
    anchor.anchorId,
    anchor.anchorName,
    anchor.douyinNo,
    ...(anchor.aliasIds || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function formatAnchorOption(anchor: AnchorRow) {
  const ids = [anchor.anchorId, ...(anchor.aliasIds || [])].filter(Boolean);
  const uniqueIds = Array.from(new Set(ids));
  const idText = uniqueIds.length > 0 ? uniqueIds.join(" / ") : "无ID";
  const countText = anchor.accountCount > 1 ? ` · ${anchor.accountCount}账号` : "";
  return {
    title: `${anchor.name}${countText}`,
    subtitle: idText + (anchor.douyinNo ? ` · 抖音号 ${anchor.douyinNo}` : ""),
  };
}

function AnchorSearchPicker({
  label,
  value,
  onChange,
  anchors,
  excludeId,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  anchors: AnchorRow[];
  excludeId?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(
    () => anchors.find((a) => String(a.id) === value) || null,
    [anchors, value]
  );
  const options = useMemo(() => {
    return anchors
      .filter((a) => String(a.id) !== excludeId)
      .filter((a) => matchAnchorQuery(a, query))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .slice(0, 80);
  }, [anchors, excludeId, query]);

  useEffect(() => {
    if (!value) setQuery("");
  }, [value]);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">{label}</label>
      {selected ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{formatAnchorOption(selected).title}</div>
            <div className="truncate text-xs text-muted-foreground">{formatAnchorOption(selected).subtitle}</div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onChange("");
              setQuery("");
            }}
          >
            重选
          </Button>
        </div>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder || "搜索姓名 / 抖音ID / 抖音号"}
            disabled={disabled}
          />
          <div className="max-h-44 overflow-y-auto rounded-md border border-border">
            {options.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">无匹配主播</div>
            ) : (
              options.map((anchor) => {
                const meta = formatAnchorOption(anchor);
                return (
                  <button
                    key={anchor.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(String(anchor.id))}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-accent"
                  >
                    <span className="text-sm font-medium">{meta.title}</span>
                    <span className="text-xs text-muted-foreground">{meta.subtitle}</span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function MergeAccountsDialog({ open, onClose, onSuccess, anchors, prefillSecondary }: MergeAccountsDialogProps) {
  const [primary, setPrimary] = useState<string>("");
  const [secondary, setSecondary] = useState<string>("");
  const [mergeDuration, setMergeDuration] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 打开时重置状态；若有 prefillSecondary 则额外预填
  useEffect(() => {
    if (open) {
      reset();
      if (prefillSecondary) {
        setSecondary(String(prefillSecondary));
      }
    }
  }, [open, prefillSecondary]);

  const reset = () => {
    setPrimary("");
    setSecondary("");
    setMergeDuration(false);
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const api = getDataApi();
    if (!api) return;
    setError(null);
    setSuccess(null);
    if (!primary || !secondary) {
      setError("请选择两个主播");
      return;
    }
    if (primary === secondary) {
      setError("不能合并同一个主播");
      return;
    }
    setLoading(true);
    try {
      const res = await api.mergeAccounts({
        primaryPersonId: Number(primary),
        secondaryPersonId: Number(secondary),
        mergeDuration,
      });
      if (res.success) {
        const durationTip = res.data.mergeDuration ? "，已合并时长" : "，未合并时长";
        setSuccess(`已合并，迁移 ${res.data.moved} 个账号${durationTip}`);
        onSuccess();
      } else {
        setError(res.error || "合并失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="合并账号"
      error={error}
      success={success}
      contentClassName="max-w-xl"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <AnchorSearchPicker
            label="保留的主播（主账号）"
            value={primary}
            onChange={setPrimary}
            anchors={anchors}
            excludeId={secondary}
            disabled={loading || !!success}
            placeholder="搜索要保留的主播"
          />
          <AnchorSearchPicker
            label="合并进来的主播（将被删除）"
            value={secondary}
            onChange={setSecondary}
            anchors={anchors}
            excludeId={primary}
            disabled={loading || !!success}
            placeholder="搜索要并入的主播"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={mergeDuration}
            disabled={loading || !!success}
            onChange={(e) => setMergeDuration(e.target.checked)}
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">同时合并时长</span>
            <span className="block text-xs text-muted-foreground">
              默认只合并音浪归属。勾选后会保留被合并主播的时长数据。
            </span>
          </span>
        </label>

        <div className="space-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <p>音浪始终合并：副号会迁到主账号名下，音浪按人名下全部账号汇总。</p>
          <p>时长默认不合并：未勾选时会删除被合并主播的时长快照。</p>
          <p>展示时长取名下“时长最多”的账号，不会把多账号时长相加。</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={handleClose} disabled={loading}>
          取消
        </Button>
        <Button onClick={submit} disabled={loading || !!success}>
          {loading ? "合并中…" : success ? "已合并" : "确认合并"}
        </Button>
      </div>
    </Modal>
  );
}

interface ImportAnchorsDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  anchors: AnchorRow[];
}

export function ImportAnchorsDialog({ open, onClose, onSuccess, anchors }: ImportAnchorsDialogProps) {
  const [rows, setRows] = useState<AnchorImportRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [gender, setGender] = useState<"male" | "female">("male");
  const dragCounter = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setRows([]);
    setSelectedIds(new Set());
    setError(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("请拖入 CSV 文件");
      return;
    }
    setError(null);
    setResult(null);
    setParsing(true);
    try {
      const parsed = await parseAnchorsCsv(file);
      const existingIds = new Set(anchors.map((a) => a.anchorId));
      const newRows = parsed.filter((r) => !existingIds.has(r.anchorId));
      setRows(newRows);
      setSelectedIds(new Set(newRows.map((r) => r.anchorId)));
      if (newRows.length === 0) {
        setError(`文件中 ${parsed.length} 个主播已全部存在，无需导入`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  };

  const toggleSelect = (anchorId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(anchorId)) next.delete(anchorId);
      else next.add(anchorId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.anchorId)));
    }
  };

  const updateRow = (index: number, field: keyof AnchorImportRow, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const submit = async () => {
    const selected = rows.filter((r) => selectedIds.has(r.anchorId));
    if (selected.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const api = getDataApi();
      if (!api) return;
      const res = await api.batchImportAnchors(
        selected.map((r) => ({ ...r, gender }))
      );
      if (res.success) {
        setResult(res.data);
        onSuccess();
      } else {
        setError(res.error || "导入失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-file-drop-zone="true"
      className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div className="max-h-[85vh] w-full max-w-3xl overflow-auto" onClick={(e) => e.stopPropagation()}>
        <Card className="border border-border shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">从文件导入主播</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 性别选择 */}
            {!result && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-foreground">性别</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setGender("male")}
                    disabled={submitting}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                      gender === "male"
                        ? "bg-chart-2 text-white"
                        : "border border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    男团
                  </button>
                  <button
                    onClick={() => setGender("female")}
                    disabled={submitting}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                      gender === "female"
                        ? "bg-chart-1 text-white"
                        : "border border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    女队
                  </button>
                </div>
              </div>
            )}

            {/* 拖拽 / 选择文件 */}
            {rows.length === 0 && !result && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    dragCounter.current += 1;
                    setIsDragging(true);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={() => {
                    dragCounter.current -= 1;
                    if (dragCounter.current <= 0) {
                      dragCounter.current = 0;
                      setIsDragging(false);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dragCounter.current = 0;
                    setIsDragging(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleFile(f);
                  }}
                  onClick={() => !parsing && fileRef.current?.click()}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-12 transition-colors",
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
                    拖拽 CSV 文件到此处，或点击选择
                  </span>
                  <span className="text-xs text-muted-foreground">
                    需含列：主播id（或 抖音号）、主播名（可选）
                  </span>
                </div>
              </>
            )}

            {/* 预览表格 */}
            {rows.length > 0 && !result && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    共 {rows.length} 个新主播，已选 {selectedIds.size} 个
                  </span>
                  <button
                    onClick={toggleSelectAll}
                    className="text-sm text-primary hover:underline"
                  >
                    {selectedIds.size === rows.length ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="max-h-72 overflow-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr className="text-left text-muted-foreground">
                        <th className="w-10 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === rows.length && rows.length > 0}
                            onChange={toggleSelectAll}
                            className="accent-primary"
                          />
                        </th>
                        <th className="px-3 py-2 font-medium">主播ID</th>
                        <th className="px-3 py-2 font-medium">抖音号</th>
                        <th className="px-3 py-2 font-medium">姓名</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="px-3 py-1.5">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(r.anchorId)}
                              onChange={() => toggleSelect(r.anchorId)}
                              className="accent-primary"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={r.anchorId}
                              onChange={(e) => updateRow(i, "anchorId", e.target.value)}
                              className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={r.douyinNo}
                              onChange={(e) => updateRow(i, "douyinNo", e.target.value)}
                              className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={r.name}
                              onChange={(e) => updateRow(i, "name", e.target.value)}
                              className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={reset} disabled={submitting}>
                    重新选择
                  </Button>
                  <Button onClick={submit} disabled={submitting || selectedIds.size === 0}>
                    {submitting ? "导入中…" : `确认导入 ${selectedIds.size} 个`}
                  </Button>
                </div>
              </>
            )}

            {/* 导入结果 */}
            {result && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
                  <CheckCircle2 className="size-4" />
                  成功导入 {result.created} 个主播
                  {result.skipped > 0 && `，跳过 ${result.skipped} 个（已存在）`}
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleClose}>完成</Button>
                </div>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
