"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crown, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useElectronData } from "./use-electron-data";
import type { FamilyNode, RosterEntry } from "@/types/electron";
import { exportFamilyPoster } from "./export-family-poster";
import { exportRosterPoster } from "./export-roster-poster";
import {
  FAMILY_COL_GAP as COL_GAP,
  FAMILY_NODE_H as NODE_H,
  FAMILY_NODE_W as NODE_W,
  FAMILY_PAD as PAD,
  FAMILY_ROW_GAP as ROW_GAP,
  FAMILY_TREE_PS,
  getFamilyDisplayName,
  getFamilyGenerationColor,
  getFamilyGenerationText,
} from "./family-tree-style";
import {
  BrowserModeState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./states";

export interface TreeNode extends FamilyNode {
  children: TreeNode[];
  descendantCount: number;
}

interface Placed {
  node: TreeNode;
  x: number; // 左上 x（列）
  y: number; // 中心 y
}
interface Edge {
  px: number;
  py: number; // 父节点右侧中心
  cx: number;
  cy: number; // 子节点左侧中心
}

function buildTree(nodes: FamilyNode[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  nodes.forEach((n) => map.set(n.id, { ...n, children: [], descendantCount: 0 }));
  const roots: TreeNode[] = [];
  // 先用一次 DFS 拆掉 masterId 环（A→B→A 这种脏数据会让递归栈溢出）。
  // 把任何会形成环的 masterId 视作 null，让该节点退化为根，避免整页崩溃。
  const onStack = new Set<number>();
  const cleared = new Set<number>();
  const breakCycle = (id: number) => {
    if (cleared.has(id)) return;
    onStack.add(id);
    const node = map.get(id);
    if (node && node.masterId != null) {
      const parent = map.get(node.masterId);
      if (parent) {
        if (onStack.has(node.masterId)) {
          console.warn(`[family-tree] 检测到环：${node.id} → ${node.masterId}，已断开`);
          node.masterId = null;
        } else {
          breakCycle(node.masterId);
        }
      }
    }
    onStack.delete(id);
    cleared.add(id);
  };
  for (const id of map.keys()) breakCycle(id);

  for (const node of map.values()) {
    if (node.masterId != null && map.has(node.masterId)) {
      map.get(node.masterId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // 环已断开，但仍然带 visited 兜底，防止未来再有遗漏的脏数据把栈打爆。
  const countDesc = (n: TreeNode, visited: Set<number>): number => {
    if (visited.has(n.id)) {
      console.warn(`[family-tree] countDesc 跳过已访问节点 ${n.id}`);
      return 0;
    }
    visited.add(n.id);
    n.descendantCount = n.children.reduce((s, c) => s + 1 + countDesc(c, visited), 0);
    return n.descendantCount;
  };
  roots.forEach((r) => countDesc(r, new Set()));
  const sortRec = (list: TreeNode[], visited: Set<number>) => {
    list.sort((a, b) => b.descendantCount - a.descendantCount);
    for (const n of list) {
      if (visited.has(n.id)) continue;
      visited.add(n.id);
      sortRec(n.children, visited);
    }
  };
  sortRec(roots, new Set());
  roots.sort((a, b) => (a.generation ?? 99) - (b.generation ?? 99));
  return roots;
}

/** 左→右 tidy-tree：depth 决定列(x)，叶子顺序决定行(y)，父节点纵向居中于子节点。
 *  支持多个根节点，全部在同一张图中上下排列。 */
function layoutAll(roots: TreeNode[]) {
  const placed: Placed[] = [];
  const edges: Edge[] = [];
  let cursorY = PAD;
  const visited = new Set<number>();

  const walk = (node: TreeNode, depth: number): number => {
    if (visited.has(node.id)) {
      console.warn(`[family-tree] layout 跳过重复节点 ${node.id}`);
      return cursorY;
    }
    visited.add(node.id);
    const x = PAD + depth * (NODE_W + COL_GAP);
    let centerY: number;
    if (node.children.length === 0) {
      centerY = cursorY + NODE_H / 2;
      cursorY += NODE_H + ROW_GAP;
    } else {
      const cs = node.children.map((c) => walk(c, depth + 1));
      centerY = (cs[0] + cs[cs.length - 1]) / 2;
    }
    placed.push({ node, x, y: centerY });
    for (const c of node.children) {
      const cp = placed.find((p) => p.node === c);
      if (cp) edges.push({ px: x + NODE_W, py: centerY, cx: cp.x, cy: cp.y });
    }
    return centerY;
  };

  // 多个根之间加额外间距
  for (const root of roots) {
    walk(root, 0);
    cursorY += NODE_H; // 根之间额外间距
  }

  const maxX = Math.max(...placed.map((p) => p.x + NODE_W));
  const maxY = Math.max(...placed.map((p) => p.y + NODE_H / 2));
  return { placed, edges, width: maxX + PAD, height: maxY + PAD };
}

export function FamilyTreePage() {
  const { data, loading, error, unavailable, reload } = useElectronData((api) =>
    api.getFamilyTree()
  );

  const tree = useMemo(() => (data ? buildTree(data) : []), [data]);
  // 渲染所有"有徒弟"的根节点，按后辈数降序，合并到一张图
  const roots = useMemo(
    () =>
      tree
        .filter((n) => n.children.length > 0)
        .sort((a, b) => b.descendantCount - a.descendantCount),
    [tree]
  );

  if (unavailable) return <Wrap><BrowserModeState /></Wrap>;
  if (loading) return <Wrap><LoadingState label="正在加载族谱…" /></Wrap>;
  if (error || !data)
    return <Wrap><ErrorState message={error ?? "加载失败"} onRetry={reload} /></Wrap>;

  if (roots.length === 0)
    return <Wrap><EmptyState label="暂无族谱数据" /></Wrap>;

  return <TreeCard roots={roots} />;
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TreeCard({ roots }: { roots: TreeNode[] }) {
  const { placed, edges, width, height } = useMemo(() => layoutAll(roots), [roots]);
  const rootSet = useMemo(() => new Set(roots.map((r) => r.id)), [roots]);
  const stats = useMemo(() => {
    const generations = placed
      .map((p) => p.node.generation)
      .filter((g): g is number => g != null);
    return {
      roots: roots.length,
      generations: generations.length > 0 ? Math.max(...generations) - Math.min(...generations) + 1 : 0,
      descendants: placed.reduce((sum, p) => sum + p.node.children.length, 0),
    };
  }, [placed, roots.length]);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [exporting, setExporting] = useState(false);

  // 自动缩放：优先保证可读性，过大的树允许滚动查看。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const availW = el.clientWidth;
      const availH = el.clientHeight;
      if (availW <= 0 || availH <= 0 || width <= 0 || height <= 0) return;
      setScale(Math.max(0.68, Math.min(1, availW / width, availH / height)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportFamilyPoster(roots, "族谱海报.png");
    } catch (e) {
      console.error("导出失败", e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="shrink-0 pb-2 pt-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crown className="size-4 text-primary" />
            族谱
            <Badge variant="secondary" className="ml-1">
              {placed.length} 人
            </Badge>
          </CardTitle>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <span>{stats.roots} 个家族</span>
            <span className="h-3 w-px bg-border" />
            <span>{stats.generations} 代</span>
            <span className="h-3 w-px bg-border" />
            <span>{stats.descendants} 条关系</span>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
          >
            <Download className="size-4" />
            {exporting ? "导出中…" : "导出海报"}
          </button>
          <RosterExportButtons />
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full overflow-auto rounded-lg border border-border/70 bg-muted/20">
          {/* 缩放后占位高度，避免底部留白 */}
          <div style={{ width: width * scale, height: height * scale }}>
            <div
              ref={contentRef}
              className="relative origin-top-left bg-[radial-gradient(color-mix(in_srgb,var(--border)_72%,transparent)_1px,transparent_1px)] [background-size:24px_24px]"
              style={{
                width,
                height,
                transform: `scale(${scale})`,
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0"
                width={width}
                height={height}
              >
                {edges.map((e, i) => {
                  const midX = e.px + COL_GAP / 2;
                  return (
                    <path
                      key={i}
                      d={`M ${e.px} ${e.py} H ${midX} V ${e.cy} H ${e.cx}`}
                      fill="none"
                      stroke="var(--border)"
                      strokeWidth={1.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })}
              </svg>

              {placed.map((p) => (
                <div
                  key={p.node.id}
                  className="absolute"
                  style={{
                    left: p.x,
                    top: p.y - NODE_H / 2,
                    width: NODE_W,
                    height: NODE_H,
                  }}
                >
                  <NodeCard node={p.node} isRoot={rootSet.has(p.node.id)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
      <div className="shrink-0 border-t border-border/60 px-6 py-2 text-xs text-muted-foreground">
        {FAMILY_TREE_PS}
      </div>
    </Card>
  );
}

function NodeCard({ node, isRoot }: { node: TreeNode; isRoot: boolean }) {
  const displayName = getFamilyDisplayName(node, isRoot);
  const rawName = node.name.trim() || "未命名";
  const isFemale = node.gender === "female";
  const generationText = getFamilyGenerationText(node);
  const generationColor = getFamilyGenerationColor(node);
  const hasColoredGeneration = node.generation === 1 || node.generation === 2 || node.generation === 3;
  const title = rawName !== displayName ? `${displayName}（原始: ${rawName}）` : displayName;

  return (
    <div
      className={cn(
        "relative flex size-full select-none flex-col justify-center overflow-hidden rounded-md border px-2 py-1.5 shadow-sm",
        hasColoredGeneration
          ? "shadow-slate-200/50"
          : isRoot
          ? "border-primary/45 bg-primary/10 shadow-primary/10"
          : isFemale
            ? "border-rose-300/50 bg-rose-50/70 dark:border-rose-500/35 dark:bg-rose-950/20"
            : "border-border/80 bg-background"
      )}
      style={
        hasColoredGeneration
          ? {
              backgroundColor: generationColor.nodeBg,
              borderColor: generationColor.nodeBorder,
            }
          : undefined
      }
      title={title}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-0.5",
          !hasColoredGeneration && (isRoot ? "bg-primary" : isFemale ? "bg-rose-400" : "bg-sky-400")
        )}
        style={hasColoredGeneration ? { backgroundColor: generationColor.bar } : undefined}
      />
      <div className="flex min-w-0 items-center gap-1">
        {isRoot && <Crown className="size-3 shrink-0 text-primary" />}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] font-semibold leading-4",
            isRoot
              ? "text-primary"
              : isFemale
                ? "text-rose-600 dark:text-rose-300"
                : "text-foreground"
          )}
        >
          {displayName}
        </span>
      </div>
      <div className="mt-1 flex min-w-0 items-center justify-between gap-1">
        {generationText ? (
          <span
            className="truncate rounded-full border px-1.5 text-[9px] font-medium leading-3"
            style={{
              backgroundColor: generationColor.chipBg,
              borderColor: generationColor.chipBorder,
              color: generationColor.text,
            }}
          >
            {generationText}
          </span>
        ) : (
          <span />
        )}
        {node.children.length > 0 && (
          <span className="shrink-0 text-[9px] leading-3 text-muted-foreground">{node.children.length}徒</span>
        )}
      </div>
    </div>
  );
}

const SURNAMES = ["浩", "狼", "玖", "啸"] as const;

function RosterExportButtons() {
  const [exportingSurname, setExportingSurname] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);

  const handleRosterExport = async (surname: string) => {
    if (exportingSurname) return;
    setExportingSurname(surname);
    try {
      const res = await window.electronAPI?.getRosterBySurname(surname);
      if (!res || !res.success || !res.data || res.data.length === 0) {
        alert(`未找到${surname}字辈的成员`);
        return;
      }
      await exportRosterPoster({ surname, entries: res.data as RosterEntry[] });
    } catch (e) {
      console.error(`${surname}字辈名单导出失败`, e);
      alert(`${surname}字辈名单导出失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportingSurname(null);
      setRosterOpen(false);
    }
  };

  return (
    <div className="app-no-drag relative">
      <button
        onClick={() => setRosterOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
      >
        <Download className="size-4" />
        导出名单
      </button>
      {rosterOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 flex flex-col gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-md">
          {SURNAMES.map((s) => (
            <button
              key={s}
              onClick={() => handleRosterExport(s)}
              disabled={!!exportingSurname}
              className="flex items-center gap-2 rounded px-3 py-1.5 text-sm transition hover:bg-accent disabled:opacity-50"
            >
              {exportingSurname === s ? "导出中…" : `${s}字辈`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
