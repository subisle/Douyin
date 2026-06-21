"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Pencil, GitMerge } from "lucide-react";
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
import type { AnchorRow } from "@/types/electron";
import { useElectronData } from "./use-electron-data";
import {
  BrowserModeState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./states";
import { AddAnchorDialog, MergeAccountsDialog } from "./anchor-dialogs";

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
    window.addEventListener("anchors:openAdd", openAdd);
    window.addEventListener("anchors:openMerge", openMerge);
    return () => {
      window.removeEventListener("anchors:openAdd", openAdd);
      window.removeEventListener("anchors:openMerge", openMerge);
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
              <Badge variant="secondary">
                共 {filtered.length} 人
              </Badge>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState label="没有匹配的主播" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
                    className="cursor-default select-none"
                  >
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
