"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crown, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useElectronData } from "./use-electron-data";
import type { FamilyNode } from "@/types/electron";
import { exportElementAsImage } from "./export-image";
import {
  BrowserModeState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./states";

interface TreeNode extends FamilyNode {
  children: TreeNode[];
  descendantCount: number;
}

const NODE_W = 84;
const NODE_H = 38;
const COL_GAP = 28; // 列间距（辈分之间）
const ROW_GAP = 4; // 行间距（同列节点之间）
const PAD = 16;

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

/** 左→右 tidy-tree：depth 决定列(x)，叶子顺序决定行(y)，父节点纵向居中于子节点 */
function layout(root: TreeNode) {
  const placed: Placed[] = [];
  const edges: Edge[] = [];
  let cursorY = PAD;
  const visited = new Set<number>();

  const walk = (node: TreeNode, depth: number): number => {
    // buildTree 已经断环，这里再加一层守卫；即使 children 里夹了重复引用也不至于栈溢出。
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
  walk(root, 0);

  const maxX = Math.max(...placed.map((p) => p.x + NODE_W));
  const maxY = Math.max(...placed.map((p) => p.y + NODE_H / 2));
  return { placed, edges, width: maxX + PAD, height: maxY + PAD };
}

export function FamilyTreePage() {
  const { data, loading, error, unavailable, reload } = useElectronData((api) =>
    api.getFamilyTree()
  );

  const tree = useMemo(() => (data ? buildTree(data) : []), [data]);
  // 公司里男队/女队都有族谱，过去只 find 第一个 male，其余男根 + 全部女根都被丢弃。
  // 这里改为渲染所有"有徒弟"的根节点，按后辈数降序。
  const lineages = useMemo(
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

  return (
    <div className="space-y-4">
      {lineages.length > 0 ? (
        lineages.map((root) => <LineageCard key={root.id} root={root} />)
      ) : (
        <Wrap>
          <EmptyState label="暂无族谱数据" />
        </Wrap>
      )}
    </div>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function LineageCard({ root }: { root: TreeNode }) {
  const { placed, edges, width, height } = useMemo(() => layout(root), [root]);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [exporting, setExporting] = useState(false);

  // 自动缩放：让整棵树宽度刚好放进容器，窗口变化时自动重算
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth;
      if (avail <= 0 || width <= 0) return; // 防止 0 宽度算出 scale=0
      setScale(Math.min(1, avail / width));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const handleExport = async () => {
    if (!contentRef.current || exporting) return;
    setExporting(true);
    try {
      await exportElementAsImage(contentRef.current, `族谱-${root.name}.png`, {
        width,
        height,
        style: { transform: "none" },
      });
    } catch (e) {
      console.error("导出失败", e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crown className="size-4 text-primary" />
            {root.name} 一脉
            <Badge variant="secondary" className="ml-1">
              {root.descendantCount} 名后辈
            </Badge>
          </CardTitle>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="app-no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
          >
            <Download className="size-4" />
            {exporting ? "导出中…" : "导出图片"}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="w-full overflow-hidden">
          {/* 缩放后占位高度，避免底部留白 */}
          <div style={{ height: height * scale }}>
            <div
              ref={contentRef}
              className="relative origin-top-left bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px]"
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
                      strokeWidth={1.5}
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
                  <NodeCard node={p.node} isRoot={p.node === root} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NodeCard({ node, isRoot }: { node: TreeNode; isRoot: boolean }) {
  return (
    <div className="flex size-full select-none flex-col items-center justify-center gap-0.5 text-center">
      <div className="flex items-center gap-1">
        {isRoot && <Crown className="size-3 text-primary" />}
        <span
          className={cn(
            "whitespace-nowrap text-[13px] font-semibold leading-none",
            isRoot
              ? "text-primary"
              : node.gender === "female"
                ? "text-chart-1"
                : "text-foreground"
          )}
        >
          {node.name}
        </span>
      </div>
      <div className="flex items-center gap-1 leading-none">
        {node.children.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            · {node.children.length}徒
          </span>
        )}
      </div>
    </div>
  );
}
