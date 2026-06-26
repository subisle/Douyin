"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Pencil, GitMerge, Trash2, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AnchorRow, DuplicateAnchorGroup } from "@/types/electron";
import { useElectronData } from "./use-electron-data";
import {
  BrowserModeState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./states";
import { AddAnchorDialog, MergeAccountsDialog, ImportAnchorsDialog } from "./anchor-dialogs";

type GenderFilter = "all" | "male" | "female";
const PAGE_SIZE = 15;

export function AnchorsPage() {
  const { data, loading, error, unavailable, reload } = useElectronData((api) =>
    api.getAnchors()
  );
  const [keyword, setKeyword] = useState("");
  const [gender, setGender] = useState<GenderFilter>("all");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // 多选状态
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // 删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<{
    ids: number[];
    names: string[];
  } | null>(null);
  // 重复数据弹窗
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    anchorId: number;
    anchorName: string;
  } | null>(null);
  // 编辑姓名弹窗
  const [editTarget, setEditTarget] = useState<{
    personId: number;
    currentName: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const openAdd = () => setAddOpen(true);
    const openMerge = () => setMergeOpen(true);
    const openImport = () => setImportOpen(true);
    window.addEventListener("anchors:openAdd", openAdd);
    window.addEventListener("anchors:openMerge", openMerge);
    window.addEventListener("anchors:openImport", openImport);
    return () => {
      window.removeEventListener("anchors:openAdd", openAdd);
      window.removeEventListener("anchors:openMerge", openMerge);
      window.removeEventListener("anchors:openImport", openImport);
    };
  }, []);

  // 点击其他区域关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data;
    if (gender !== "all") {
      list = list.filter((a) => a.gender === gender);
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(kw) ||
          a.anchorName.toLowerCase().includes(kw) ||
          a.anchorId.includes(kw) ||
          a.douyinNo.includes(kw)
      );
    }
    return list;
  }, [data, gender, keyword]);

  useEffect(() => {
    setPage(1);
  }, [gender, keyword]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const start = (pageSafe - 1) * PAGE_SIZE;
  const paged = filtered.slice(start, start + PAGE_SIZE);

  /** 右键处理 */
  const onContextMenu = (
    e: React.MouseEvent,
    anchor: AnchorRow
  ) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      anchorId: anchor.id,
      anchorName: anchor.name,
    });
  };

  /** 打开合并弹窗并预填被合并项 */
  const handleMergeFromContext = () => {
    if (!contextMenu) return;
    setMergeOpen(true);
    setContextMenu(null);
  };

  /** 切换单行选择 */
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 当前页全选/取消全选 */
  const toggleSelectAll = () => {
    const pageIds = paged.map((a) => a.id);
    const allSelected = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  /** 右键删除选中 */
  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    const names = (data || [])
      .filter((a) => selectedIds.has(a.id))
      .map((a) => a.name);
    setDeleteTarget({ ids: Array.from(selectedIds), names });
    setContextMenu(null);
  };

  /** 右键删除单个 */
  const handleDeleteSingle = () => {
    if (!contextMenu) return;
    setDeleteTarget({
      ids: [contextMenu.anchorId],
      names: [contextMenu.anchorName],
    });
    setContextMenu(null);
  };

  // 筛选/搜索变化时清空选择
  useEffect(() => {
    setSelectedIds(new Set());
  }, [gender, keyword]);

  if (unavailable) {
    return (
      <Card>
        <CardContent>
          <BrowserModeState />
        </CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardContent>
          <LoadingState label="正在加载主播列表…" />
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent>
          <ErrorState message={error ?? "加载失败"} onRetry={reload} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索主播 / 抖音ID / 抖音号"
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <GenderTabs value={gender} onChange={setGender} />
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => setDuplicateOpen(true)}
              >
                <Copy className="size-4" />
                重复数据
              </Button>
              <Badge variant="secondary">
                共 {filtered.length} 人
              </Badge>
              {selectedIds.size > 0 && (
                <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">
                  已选 {selectedIds.size}
                </Badge>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState label="没有匹配的主播" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer rounded border-border accent-primary"
                      checked={
                        paged.length > 0 &&
                        paged.every((a) => selectedIds.has(a.id))
                      }
                      onChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>主播</TableHead>
                  <TableHead>性别</TableHead>
                  <TableHead>抖音ID</TableHead>
                  <TableHead>抖音号</TableHead>
                  <TableHead className="text-right">账号数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((a, i) => (
                  <TableRow
                    key={a.id}
                    onContextMenu={(e) => onContextMenu(e, a)}
                    className={cn(
                      "cursor-default select-none",
                      selectedIds.has(a.id) && "bg-amber-500/5"
                    )}
                  >
                    <TableCell className="w-10">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer rounded border-border accent-primary"
                        checked={selectedIds.has(a.id)}
                        onChange={() => toggleSelect(a.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {start + i + 1}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {a.name}
                    </TableCell>
                    <TableCell>
                      <GenderBadge gender={a.gender} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {a.anchorId || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {a.douyinNo || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.accountCount > 1 ? (
                        <Badge variant="outline">{a.accountCount}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{a.accountCount}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {pageCount > 1 && (
            <Pagination
              page={pageSafe}
              pageCount={pageCount}
              onPageChange={setPage}
              total={filtered.length}
              start={start + 1}
              end={Math.min(start + PAGE_SIZE, filtered.length)}
            />
          )}
        </CardContent>
      </Card>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="app-no-drag fixed z-[100] min-w-[180px] rounded-xl border border-border bg-popover p-1.5 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              setEditTarget({
                personId: contextMenu.anchorId,
                currentName: contextMenu.anchorName,
              });
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
          >
            <Pencil className="size-4 text-muted-foreground" />
            编辑姓名
          </button>
          <button
            onClick={handleMergeFromContext}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
          >
            <GitMerge className="size-4 text-muted-foreground" />
            合并到其他主播
          </button>
          <div className="mx-2 my-1 border-t border-border" />
          {selectedIds.size > 0 && selectedIds.has(contextMenu.anchorId) && (
            <button
              onClick={handleDeleteSelected}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-4" />
              删除选中（{selectedIds.size}个）
            </button>
          )}
          <button
            onClick={handleDeleteSingle}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-4" />
            删除此主播
          </button>
          <div className="mx-2 my-1 border-t border-border" />
          <span className="block px-3 py-1 text-xs text-muted-foreground">
            ID: {contextMenu.anchorId}
          </span>
        </div>
      )}

      {/* 编辑姓名弹窗 */}
      {editTarget && (
        <EditNameDialog
          personId={editTarget.personId}
          currentName={editTarget.currentName}
          onClose={() => setEditTarget(null)}
          onSuccess={() => reload()}
        />
      )}

      <AddAnchorDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => reload()}
      />
      <MergeAccountsDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        onSuccess={() => reload()}
        anchors={data}
        prefillSecondary={contextMenu?.anchorId}
      />
      <ImportAnchorsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => reload()}
        anchors={data}
      />

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          ids={deleteTarget.ids}
          names={deleteTarget.names}
          onClose={() => setDeleteTarget(null)}
          onSuccess={() => {
            setDeleteTarget(null);
            setSelectedIds(new Set());
            reload();
          }}
        />
      )}

      {/* 重复数据弹窗 */}
      <DuplicateAnchorsDialog
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        onSuccess={() => reload()}
      />
    </div>
  );
}

/** 编辑姓名对话框 */
function EditNameDialog({
  personId,
  currentName,
  onClose,
  onSuccess,
}: {
  personId: number;
  currentName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const api = window.electronAPI;
    if (!api) return;
    setError(null);
    if (!name.trim()) {
      setError("姓名不能为空");
      return;
    }
    setLoading(true);
    try {
      const res = await api.updateAnchorName({ personId, name: name.trim() });
      if (res.success) {
        onSuccess();
        onClose();
      } else {
        setError(res.error || "更新失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <Card className="border border-border shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">编辑主播姓名</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">当前姓名</label>
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{currentName}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">新姓名</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入新姓名"
                disabled={loading}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={loading}>
                取消
              </Button>
              <Button onClick={submit} disabled={loading}>
                {loading ? "保存中…" : "保存"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function GenderTabs({
  value,
  onChange,
}: {
  value: GenderFilter;
  onChange: (v: GenderFilter) => void;
}) {
  const tabs: { id: GenderFilter; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "male", label: "男" },
    { id: "female", label: "女" },
  ];
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "rounded-full px-4 py-1 text-sm font-medium transition-colors",
            value === t.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function GenderBadge({ gender }: { gender: string }) {
  if (gender === "male")
    return <Badge className="bg-chart-2/15 text-chart-2 hover:bg-chart-2/15">男</Badge>;
  if (gender === "female")
    return <Badge className="bg-chart-1/15 text-chart-1 hover:bg-chart-1/15">女</Badge>;
  return <Badge variant="outline">—</Badge>;
}

function Pagination({
  page,
  pageCount,
  onPageChange,
  total,
  start,
  end,
}: {
  page: number;
  pageCount: number;
  onPageChange: (p: number) => void;
  total: number;
  start: number;
  end: number;
}) {
  const pages = useMemo(() => {
    const arr: (number | "ellipsis")[] = [];
    if (pageCount <= 7) {
      for (let i = 1; i <= pageCount; i++) arr.push(i);
      return arr;
    }
    arr.push(1);
    if (page > 3) arr.push("ellipsis");
    const s = Math.max(2, page - 2);
    const e = Math.min(pageCount - 1, page + 2);
    for (let i = s; i <= e; i++) arr.push(i);
    if (page < pageCount - 2) arr.push("ellipsis");
    arr.push(pageCount);
    return arr;
  }, [page, pageCount]);

  return (
    <div className="flex flex-col items-center justify-between gap-3 pt-2 md:flex-row">
      <span className="text-xs text-muted-foreground">
        显示第 {start} - {end} 条，共 {total} 条
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          上一页
        </Button>
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="sm"
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          )
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

/** 删除确认对话框 */
function DeleteConfirmDialog({
  ids,
  names,
  onClose,
  onSuccess,
}: {
  ids: number[];
  names: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const api = window.electronAPI;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.deleteAnchors(ids);
      if (res.success) {
        onSuccess();
      } else {
        setError(res.error || "删除失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <Card className="border border-border shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-base text-destructive">
              确认删除主播
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              即将删除以下 {ids.length} 位主播，此操作不可撤销，相关账号和音浪/时长数据将一并删除：
            </p>
            <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 p-2">
              <ul className="space-y-1 text-sm">
                {names.map((n, i) => (
                  <li key={i} className="px-2 py-0.5">
                    {n}
                  </li>
                ))}
              </ul>
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={loading}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={submit}
                disabled={loading}
              >
                {loading ? "删除中…" : `确认删除 ${ids.length} 个`}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** 重复数据对话框 */
function DuplicateAnchorsDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [groups, setGroups] = useState<DuplicateAnchorGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = async () => {
    const api = window.electronAPI;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.findDuplicateAnchors();
      if (res.success) {
        setGroups(res.data);
      } else {
        setError(res.error || "加载失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDelete = async (personId: number) => {
    const api = window.electronAPI;
    if (!api) return;
    setDeletingId(personId);
    try {
      const res = await api.deleteAnchors([personId]);
      if (res.success) {
        onSuccess();
        load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="border border-border shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">重复主播数据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && (
              <p className="text-sm text-muted-foreground">正在加载…</p>
            )}
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {!loading && !error && groups.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                没有发现重复主播数据
              </p>
            )}
            {groups.map((g, gi) => (
              <div key={gi} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  <Badge variant="secondary">{g.count} 条重复</Badge>
                </div>
                <div className="space-y-2">
                  {g.persons.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <GenderBadge gender={p.gender} />
                        <span className="font-mono text-xs text-muted-foreground">
                          ID: {p.id}
                        </span>
                        {p.anchorId && (
                          <span className="font-mono text-xs text-muted-foreground">
                            抖音ID: {p.anchorId}
                          </span>
                        )}
                        {p.douyinNo && (
                          <span className="font-mono text-xs text-muted-foreground">
                            抖音号: {p.douyinNo}
                          </span>
                        )}
                        {p.accountCount > 1 && (
                          <Badge variant="outline">{p.accountCount}账号</Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-destructive hover:bg-destructive/10"
                        disabled={deletingId === p.id}
                        onClick={() => handleDelete(p.id)}
                      >
                        <Trash2 className="size-4" />
                        {deletingId === p.id ? "删除中…" : "删除"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
