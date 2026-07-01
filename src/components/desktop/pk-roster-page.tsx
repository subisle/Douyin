"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Swords, Waves, Download, RefreshCw, X, Crown, ChevronRight } from "lucide-react";
import { LoadingState, ErrorState, EmptyState } from "./states";
import type { PkMember, IpcResult } from "@/types/electron";

/* ---------- 类型 ---------- */
interface GroupState {
  key: string;
  gender: "male" | "female";
  label: string;
  members: PkMember[];
  captainId: number | null;
}

/* ---------- 颜色 ---------- */
const GROUP_COLORS = [
  "border-l-red-400",
  "border-l-blue-400",
  "border-l-green-400",
  "border-l-purple-400",
  "border-l-orange-400",
  "border-l-pink-400",
  "border-l-cyan-400",
  "border-l-yellow-400",
];

/* ---------- 辅助 ---------- */
/** PK名单专用：万级取整，不显示小数 */
function formatPkWave(value: number): string {
  if (!value) return "0";
  if (value >= 1_0000_0000) return `${Math.round(value / 1_0000_0000)} 亿`;
  if (value >= 1_0000) return `${Math.round(value / 1_0000)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
}

/* ---------- 排除人员对话框 ---------- */
function ExcludeDialog({
  open,
  onClose,
  allMembers,
  excludedIds,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  allMembers: PkMember[];
  excludedIds: Set<number>;
  onConfirm: (ids: Set<number>) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(excludedIds));

  useEffect(() => {
    if (open) setSelected(new Set(excludedIds));
  }, [open, excludedIds]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="app-no-drag w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-lg font-semibold">选择不参与 PK 的人员</h3>
        <div className="mb-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set(allMembers.map((m) => m.personId)))}>
            全选
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
            清空
          </Button>
          <Badge variant="secondary">{selected.size} 人已选</Badge>
        </div>
        <ScrollArea className="h-72 rounded-lg border border-border">
          {allMembers.map((m, idx) => (
            <div
              key={`${m.personId}-${idx}`}
              className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/50"
              onClick={() => toggle(m.personId)}
            >
              <span
                className={`flex size-4 items-center justify-center rounded border ${
                  selected.has(m.personId) ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
                }`}
              >
                {selected.has(m.personId) && <span className="text-[10px]">✓</span>}
              </span>
              <span className="text-sm font-medium">{m.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{formatPkWave(m.wave)}</span>
            </div>
          ))}
        </ScrollArea>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={() => {
              onConfirm(selected);
              onClose();
            }}
          >
            确认（排除 {selected.size} 人）
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 右键菜单 ---------- */
interface MenuState {
  x: number;
  y: number;
  groupKey: string;
  personId: number;
}

function ContextMenu({
  menu,
  onClose,
  onSetCaptain,
}: {
  menu: MenuState;
  onClose: () => void;
  onSetCaptain: (groupKey: string, personId: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="app-no-drag fixed z-50 min-w-[120px] rounded-lg border border-border bg-popover py-1 shadow-lg"
      style={{ left: menu.x, top: menu.y }}
    >
      <button
        onClick={() => {
          onSetCaptain(menu.groupKey, menu.personId);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
      >
        <Crown className="size-3.5 text-amber-500" />
        设为队长
      </button>
    </div>
  );
}

/* ---------- 成员池卡片（未分组人员） ---------- */
function MemberPoolCard({
  members,
  selectedIds,
  onToggleSelect,
  onDragStart,
}: {
  members: PkMember[];
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onDragStart: (e: React.DragEvent, personId: number) => void;
}) {
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">未分组池</CardTitle>
          <Badge variant="secondary">{members.length} 人</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <div
              key={m.personId}
              draggable
              onDragStart={(e) => onDragStart(e, m.personId)}
              onClick={() => onToggleSelect(m.personId)}
              className={`cursor-grab rounded-md border px-2 py-1 text-xs transition-colors active:cursor-grabbing ${
                selectedIds.has(m.personId)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent/50"
              }`}
            >
              {m.name}
              <span className="ml-1 text-muted-foreground">{formatPkWave(m.wave)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- 组卡片（支持拖拽） ---------- */
function GroupCard({
  group,
  index,
  onDropTo,
  onContextMenuMember,
  onDragStart,
}: {
  group: GroupState;
  index: number;
  onDropTo: (targetKey: string, personId: number) => void;
  onContextMenuMember: (e: React.MouseEvent, groupKey: string, personId: number) => void;
  onDragStart: (e: React.DragEvent, personId: number, fromKey: string) => void;
}) {
  const colorClass = GROUP_COLORS[index % GROUP_COLORS.length];
  const totalWave = group.members.reduce((s, m) => s + m.wave, 0);
  const totalTrimmed = group.members.reduce((s, m) => s + m.trimmedAvg, 0);
  const captainName = group.members.find((m) => m.personId === group.captainId)?.name;

  // 组内按总音浪降序
  const sorted = [...group.members].sort((a, b) => b.wave - a.wave);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/pk");
    if (!raw) return;
    const { personId } = JSON.parse(raw);
    onDropTo(group.key, personId);
  };

  return (
    <Card className={`border-l-4 ${colorClass}`} onDragOver={handleDragOver} onDrop={handleDrop}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{group.label}</CardTitle>
          <Badge variant="secondary">{group.members.length} 人</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Waves className="size-3" />
            总音浪 {formatPkWave(totalWave)}
          </span>
          <span>日均 {formatPkWave(totalTrimmed)}</span>
          {captainName && (
            <span className="flex items-center gap-1 text-amber-500">
              <Crown className="size-3" />
              队长：{captainName}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-1 text-left font-medium w-7">#</th>
              <th className="py-1 text-left font-medium">姓名</th>
              <th className="py-1 text-right font-medium">日均</th>
              <th className="py-1 text-right font-medium">最高</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => (
              <tr
                key={m.personId}
                draggable
                onDragStart={(e) => onDragStart(e, m.personId, group.key)}
                onContextMenu={(e) => onContextMenuMember(e, group.key, m.personId)}
                className="border-b border-border/50 last:border-0 cursor-grab active:cursor-grabbing hover:bg-accent/50"
              >
                <td className="py-1.5 text-muted-foreground w-7">{i + 1}</td>
                <td className="py-1.5 font-medium">
                  {m.name}
                  {group.captainId === m.personId && (
                    <Crown className="ml-1 inline size-3 text-amber-500" />
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums text-foreground">
                  {formatPkWave(m.trimmedAvg)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {formatPkWave(m.maxWave)}
                  {m.maxWave > m.trimmedAvg * 3 && m.waveDays > 1 && (
                    <span className="ml-1 text-amber-500" title="单日异常高值">⚠</span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-muted-foreground text-xs">
                  拖拽成员到此处
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/* ---------- 导出专用：海报式排名表 ---------- */
function ExportRankTable({
  title,
  period,
  groups,
  gender,
}: {
  title: string;
  period: string;
  groups: GroupState[];
  gender: "male" | "female";
}) {
  const CYAN1 = "#00f5d4";
  const CYAN2 = "#00b8ff";
  const BG1 = "#0a0f1c";
  const BG2 = "#020617";
  const PANEL = "rgba(10, 24, 37, 0.88)";
  const PANEL_STRONG = "rgba(10, 24, 37, 0.95)";
  const LINE = "rgba(255, 255, 255, 0.08)";
  const LINE_SOFT = "rgba(255, 255, 255, 0.05)";
  const TEXT_MAIN = "#f8fafc";
  const TEXT_SUB = "#a5f3fc";
  const TEXT_MUTED = "#94a3b8";
  const DANGER = "#f87171";
  const PURPLE = "#c4b5fd";

  // 合并所有组，按音浪降序
  const all = useMemo(() => {
    const out: (PkMember & { groupLabel: string; isCaptain: boolean })[] = [];
    groups.forEach((g) => {
      g.members.forEach((m) => {
        out.push({ ...m, groupLabel: g.label, isCaptain: g.captainId === m.personId });
      });
    });
    return out.sort((a, b) => b.wave - a.wave);
  }, [groups]);

  const totalWave = all.reduce((s, m) => s + m.wave, 0);
  const notStartedList = all.filter((m) => m.wave === 0);
  const notStarted = notStartedList.length;
  const maxWave = Math.max(...all.map((m) => m.wave), 1);

  // 等级（按总音浪）
  const levelOf = (w: number) => {
    if (w >= 1_0000_0000) return { label: "S1", tier: "S" };
    if (w >= 5000_0000) return { label: "A1", tier: "A" };
    if (w >= 1000_0000) return { label: "B1", tier: "B" };
    if (w >= 500_0000) return { label: "B2", tier: "B" };
    if (w >= 100_0000) return { label: "C1", tier: "C" };
    if (w >= 50_0000) return { label: "C2", tier: "C" };
    if (w > 0) return { label: "D1", tier: "D" };
    return { label: "-", tier: "-" };
  };

  // 解析 period "2026-07" → "2026年7月"
  const periodDisplay = (() => {
    const [y, m] = period.split("-");
    return `${y}年${parseInt(m, 10)}月`;
  })();

  return (
    <div
      style={{
        width: 1080,
        minHeight: 1080,
        padding: 18,
        background: `radial-gradient(circle at 50% 18%, ${BG1} 0%, ${BG2} 62%, #000 100%)`,
        color: TEXT_MAIN,
        fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 网格背景 */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
        backgroundSize: "28px 28px",
        opacity: 0.35,
      }} />
      {/* 右上角光晕 */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(circle at top right, rgba(0, 245, 212, 0.16), transparent 28%)`,
      }} />

      {/* 内容层 */}
      <div style={{ position: "relative", width: "100%" }}>
        {/* Header Panel */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 250px", gap: 16,
          padding: "22px 24px",
          background: PANEL,
          border: `1px solid ${LINE}`,
          borderRadius: 24,
          boxShadow: "0 22px 44px rgba(0,0,0,0.32)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 68, height: 68, borderRadius: 20,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, fontWeight: 800, color: "#fff",
              background: `linear-gradient(135deg, rgba(0,245,212,0.18), rgba(0,184,255,0.18))`,
              border: "1px solid rgba(0,245,212,0.32)",
              boxShadow: "0 0 26px rgba(0,245,212,0.16)",
              flexShrink: 0,
            }}>
              {gender === "male" ? "♂" : "♀"}
            </div>
            <div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                marginBottom: 8, padding: "6px 12px", borderRadius: 999,
                fontSize: 12, letterSpacing: 1, color: CYAN1,
                background: "rgba(0,245,212,0.08)",
                border: "1px solid rgba(0,245,212,0.18)",
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${CYAN1}, ${CYAN2})`,
                  boxShadow: "0 0 10px rgba(0,245,212,0.6)",
                }} />
                星势力 {gender === "male" ? "男" : "女"}主播音浪统计
              </div>
              <h1 style={{
                margin: 0, fontSize: 32, lineHeight: 1.15, letterSpacing: 1,
                color: "#fff", whiteSpace: "nowrap",
                textShadow: "0 0 24px rgba(0,245,212,0.18)",
              }}>
                {title}
              </h1>
              <div style={{ marginTop: 10, fontSize: 14, color: TEXT_MUTED, lineHeight: 1.5 }}>
                统计周期：{periodDisplay} · 按总音浪降序排列
              </div>
            </div>
          </div>
          {/* 日期卡片 */}
          <div style={{
            display: "flex", flexDirection: "column", justifyContent: "center", gap: 8,
            padding: "18px 20px", borderRadius: 20, textAlign: "center",
            background: "rgba(15, 37, 56, 0.82)",
            border: "1px solid rgba(0,245,212,0.16)",
          }}>
            <div style={{ fontSize: 12, letterSpacing: 1, color: TEXT_MUTED }}>数据周期</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>{periodDisplay}</div>
            <div style={{ fontSize: 13, color: CYAN1 }}>共 {all.length} 人参战</div>
          </div>
        </div>

        {/* Stats Grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 14,
        }}>
          <div style={{ padding: "16px 18px", borderRadius: 20, background: PANEL, border: `1px solid ${LINE}` }}>
            <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 8 }}>参战人数</div>
            <div style={{ fontSize: 28, lineHeight: 1, fontWeight: 700, color: "#fff", textShadow: "0 0 18px rgba(0,245,212,0.16)", fontFamily: 'Consolas, monospace' }}>{all.length}</div>
          </div>
          <div style={{ padding: "16px 18px", borderRadius: 20, background: PANEL, border: `1px solid ${LINE}` }}>
            <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 8 }}>未开播</div>
            <div style={{ fontSize: 28, lineHeight: 1, fontWeight: 700, color: DANGER, fontFamily: 'Consolas, monospace' }}>{notStarted}</div>
          </div>
          <div style={{ padding: "16px 18px", borderRadius: 20, background: PANEL, border: `1px solid ${LINE}` }}>
            <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 8 }}>30天总音浪</div>
            <div style={{ fontSize: 28, lineHeight: 1, fontWeight: 700, color: "#fff", textShadow: "0 0 18px rgba(0,245,212,0.16)", fontFamily: 'Consolas, monospace' }}>{formatPkWave(totalWave)}</div>
          </div>
          <div style={{ padding: "16px 18px", borderRadius: 20, background: PANEL, border: `1px solid ${LINE}` }}>
            <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 8 }}>累计总音浪</div>
            <div style={{ fontSize: 28, lineHeight: 1, fontWeight: 700, color: "#fff", textShadow: "0 0 18px rgba(0,245,212,0.16)", fontFamily: 'Consolas, monospace' }}>{formatPkWave(totalWave)}</div>
          </div>
        </div>

        {/* Board (Table) */}
        <div style={{
          marginTop: 14, background: PANEL, borderRadius: 24,
          border: `1px solid ${LINE}`, overflow: "hidden",
          boxShadow: "0 18px 36px rgba(0,0,0,0.22)",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: PANEL_STRONG }}>
                <th style={{ width: "8%", padding: "11px 8px", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: TEXT_SUB, textAlign: "left", borderBottom: `1px solid ${LINE}` }}>排名</th>
                <th style={{ width: "18%", padding: "11px 8px", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: TEXT_SUB, textAlign: "left", borderBottom: `1px solid ${LINE}` }}>主播姓名</th>
                <th style={{ width: "24%", padding: "11px 8px", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: TEXT_SUB, textAlign: "left", borderBottom: `1px solid ${LINE}` }}>30天音浪</th>
                <th style={{ width: "21%", padding: "11px 8px", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: TEXT_SUB, textAlign: "left", borderBottom: `1px solid ${LINE}` }}>累计总音浪</th>
                <th style={{ width: "12%", padding: "11px 8px", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: TEXT_SUB, textAlign: "left", borderBottom: `1px solid ${LINE}` }}>等级</th>
                <th style={{ width: "17%", padding: "11px 8px", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: TEXT_SUB, textAlign: "left", borderBottom: `1px solid ${LINE}` }}>直播时长</th>
              </tr>
            </thead>
            <tbody>
              {all.map((m, i) => {
                const lv = levelOf(m.wave);
                const isEmpty = m.wave === 0;
                const widthPct = isEmpty ? 0 : Math.max(2, (m.wave / maxWave) * 100);
                const rank = i + 1;
                const rankCls = rank === 1 ? "top1" : rank === 2 ? "top2" : rank === 3 ? "top3" : "";
                const rowBg = rank === 1
                  ? "linear-gradient(90deg, rgba(0,245,212,0.12), rgba(0,184,255,0.03))"
                  : rank === 2
                  ? "linear-gradient(90deg, rgba(0,245,212,0.09), rgba(255,255,255,0.02))"
                  : rank === 3
                  ? "linear-gradient(90deg, rgba(0,184,255,0.09), rgba(255,255,255,0.02))"
                  : rank % 2 === 0
                  ? "rgba(255,255,255,0.015)"
                  : "transparent";
                return (
                  <tr key={m.personId} style={{ background: rowBg }}>
                    <td style={{ padding: "5px 8px", fontSize: 12.5, verticalAlign: "middle", borderBottom: `1px solid ${LINE_SOFT}`, color: "rgba(255,255,255,0.92)" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 28, height: 28, borderRadius: 10,
                        fontSize: rank <= 3 ? 16 : 12, fontWeight: 700,
                        ...(rank <= 3
                          ? { background: "linear-gradient(135deg, rgba(0,245,212,0.2), rgba(0,184,255,0.18))", border: "1px solid rgba(0,245,212,0.22)", color: "#fff" }
                          : { background: "rgba(148,163,184,0.14)", border: "1px solid rgba(148,163,184,0.18)", color: "rgba(255,255,255,0.72)", fontFamily: 'Consolas, monospace' }),
                      }}>
                        {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : String(rank).padStart(2, "0")}
                      </span>
                    </td>
                    <td style={{
                      padding: "5px 8px", fontSize: 13, verticalAlign: "middle",
                      borderBottom: `1px solid ${LINE_SOFT}`,
                      color: rank <= 3 ? "#fff" : TEXT_SUB, fontWeight: 600,
                    }}>
                      {m.name}
                      {m.isCaptain && <span style={{ marginLeft: 4, color: "#fbbf24" }}>♛</span>}
                    </td>
                    <td style={{ padding: "5px 8px", fontSize: 12.5, verticalAlign: "middle", borderBottom: `1px solid ${LINE_SOFT}` }}>
                      <div style={{ fontFamily: 'Consolas, monospace', fontWeight: 700, fontSize: 12, color: isEmpty ? DANGER : "#fff", whiteSpace: "nowrap" }}>
                        {isEmpty ? "未开播" : formatPkWave(m.wave)}
                      </div>
                      <div style={{ width: "100%", maxWidth: 138, height: 4, marginTop: 4, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", width: `${widthPct}%`, borderRadius: 999,
                          background: isEmpty ? "#475569" : `linear-gradient(90deg, ${CYAN1}, ${CYAN2})`,
                          boxShadow: isEmpty ? "none" : "0 0 12px rgba(0,245,212,0.26)",
                        }} />
                      </div>
                    </td>
                    <td style={{
                      padding: "5px 8px", fontSize: 12.5, verticalAlign: "middle",
                      borderBottom: `1px solid ${LINE_SOFT}`,
                      fontFamily: 'Consolas, monospace', fontWeight: 700,
                      color: "rgba(255,255,255,0.95)", whiteSpace: "nowrap",
                    }}>
                      {formatPkWave(m.wave)}
                    </td>
                    <td style={{ padding: "5px 8px", verticalAlign: "middle", borderBottom: `1px solid ${LINE_SOFT}` }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        minWidth: 54, padding: "4px 10px", borderRadius: 999,
                        fontSize: 11, fontWeight: 800, color: "#04111f",
                        background: `linear-gradient(90deg, ${CYAN1}, ${CYAN2})`,
                        boxShadow: "0 0 14px rgba(0,245,212,0.18)",
                      }}>
                        {lv.label}
                      </span>
                    </td>
                    <td style={{
                      padding: "5px 8px", fontSize: 12, verticalAlign: "middle",
                      borderBottom: `1px solid ${LINE_SOFT}`,
                      color: PURPLE, textAlign: "center", whiteSpace: "nowrap",
                    }}>
                      {m.waveDays ? `${(m.waveDays * 0.5).toFixed(1)} 小时` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer Panel */}
        {notStarted > 0 && (
          <div style={{
            marginTop: 14, padding: "16px 18px", borderRadius: 22,
            background: PANEL, border: `1px solid ${LINE}`,
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 16, marginBottom: 12,
            }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 13, color: TEXT_SUB, fontWeight: 700 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${CYAN1}, ${CYAN2})`,
                  boxShadow: "0 0 12px rgba(0,245,212,0.48)",
                }} />
                未开播名单
              </div>
              <div style={{ fontSize: 12, color: TEXT_MUTED }}>共 {notStarted} 人</div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {notStartedList.map((m) => (
                <span key={m.personId} style={{
                  padding: "5px 12px", borderRadius: 999,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  fontSize: 12, color: "rgba(255,255,255,0.84)",
                }}>
                  {m.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ================================================================
   主页面
   ================================================================ */
export function PkRosterPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 后端返回的扁平列表
  const [rawMales, setRawMales] = useState<PkMember[]>([]);
  const [rawFemales, setRawFemales] = useState<PkMember[]>([]);
  const [dataPeriod, setDataPeriod] = useState("");

  // 分组状态
  const [maleGroups, setMaleGroups] = useState<GroupState[]>([]);
  const [femaleGroups, setFemaleGroups] = useState<GroupState[]>([]);
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [selectedPoolIds, setSelectedPoolIds] = useState<Set<number>>(new Set());
  const exportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  /** 拉取数据 */
  const fetchRoster = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res: IpcResult<{ period: string; males: PkMember[]; females: PkMember[] }> =
        await api.getPkRoster(period || undefined, 8);
      if (res.success) {
        setRawMales(res.data.males);
        setRawFemales(res.data.females);
        setDataPeriod(res.data.period);
        // 初始化空分组（男3组、女3组）
        setMaleGroups([
          { key: "male-0", gender: "male", label: "男团 第1组", members: [], captainId: null },
          { key: "male-1", gender: "male", label: "男团 第2组", members: [], captainId: null },
          { key: "male-2", gender: "male", label: "男团 第3组", members: [], captainId: null },
        ]);
        setFemaleGroups([
          { key: "female-0", gender: "female", label: "女团 第1组", members: [], captainId: null },
          { key: "female-1", gender: "female", label: "女团 第2组", members: [], captainId: null },
          { key: "female-2", gender: "female", label: "女团 第3组", members: [], captainId: null },
        ]);
        setExcludedIds(new Set());
        setSelectedPoolIds(new Set());
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 所有成员（去重，用于排除对话框） */
  const allMembers = useMemo(() => {
    const out: PkMember[] = [];
    const seen = new Set<number>();
    rawMales.forEach((m) => {
      if (!seen.has(m.personId)) { seen.add(m.personId); out.push(m); }
    });
    rawFemales.forEach((m) => {
      if (!seen.has(m.personId)) { seen.add(m.personId); out.push(m); }
    });
    return out;
  }, [rawMales, rawFemales]);

  /** 未分组的男成员（排除已排除和已分组的，按 personId 去重） */
  const poolMales = useMemo(() => {
    const inGroup = new Set<number>();
    maleGroups.forEach((g) => g.members.forEach((m) => inGroup.add(m.personId)));
    const seen = new Set<number>();
    return rawMales.filter((m) => {
      if (excludedIds.has(m.personId) || inGroup.has(m.personId) || seen.has(m.personId)) return false;
      seen.add(m.personId);
      return true;
    });
  }, [rawMales, excludedIds, maleGroups]);

  /** 未分组的女成员 */
  const poolFemales = useMemo(() => {
    const inGroup = new Set<number>();
    femaleGroups.forEach((g) => g.members.forEach((m) => inGroup.add(m.personId)));
    const seen = new Set<number>();
    return rawFemales.filter((m) => {
      if (excludedIds.has(m.personId) || inGroup.has(m.personId) || seen.has(m.personId)) return false;
      seen.add(m.personId);
      return true;
    });
  }, [rawFemales, excludedIds, femaleGroups]);

  /** 拖拽开始 */
  const handleDragStart = useCallback((e: React.DragEvent, personId: number, fromKey?: string) => {
    e.dataTransfer.setData("application/pk", JSON.stringify({ personId, fromGroup: fromKey || "" }));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  /** 拖拽放置到组 */
  const handleDropToGroup = useCallback((targetKey: string, personId: number) => {
    const moveMember = (groups: GroupState[], setGroups: (g: GroupState[]) => void) => {
      let moved: PkMember | null = null;
      let fromKey = "";
      // 从源移除
      const next = groups.map((g) => {
        const idx = g.members.findIndex((m) => m.personId === personId);
        if (idx !== -1) {
          moved = g.members[idx];
          fromKey = g.key;
          return { ...g, members: g.members.filter((m) => m.personId !== personId), captainId: g.captainId === personId ? null : g.captainId };
        }
        return g;
      });
      if (!moved) return groups;
      // 放到目标
      return next.map((g) => {
        if (g.key === targetKey) return { ...g, members: [...g.members, moved!] };
        return g;
      });
    };

    // 判断目标属于男团还是女团
    if (maleGroups.some((g) => g.key === targetKey)) {
      setMaleGroups(moveMember(maleGroups, setMaleGroups));
    } else if (femaleGroups.some((g) => g.key === targetKey)) {
      setFemaleGroups(moveMember(femaleGroups, setFemaleGroups));
    }
  }, [maleGroups, femaleGroups]);

  /** 从组移回池 */
  const handleDropToPool = useCallback((personId: number, gender: "male" | "female") => {
    if (gender === "male") {
      setMaleGroups((prev) => prev.map((g) => ({
        ...g,
        members: g.members.filter((m) => m.personId !== personId),
        captainId: g.captainId === personId ? null : g.captainId,
      })));
    } else {
      setFemaleGroups((prev) => prev.map((g) => ({
        ...g,
        members: g.members.filter((m) => m.personId !== personId),
        captainId: g.captainId === personId ? null : g.captainId,
      })));
    }
  }, []);

  /** 设置队长（同性别内唯一） */
  const handleSetCaptain = useCallback((groupKey: string, personId: number) => {
    const update = (groups: GroupState[]) => {
      const target = groups.find((g) => g.key === groupKey);
      if (!target) return groups;
      return groups.map((g) => {
        if (g.gender !== target.gender) return g;
        if (g.key === groupKey) return { ...g, captainId: personId };
        return { ...g, captainId: null };
      });
    };
    if (maleGroups.some((g) => g.key === groupKey)) setMaleGroups(update(maleGroups));
    else setFemaleGroups(update(femaleGroups));
  }, [maleGroups, femaleGroups]);

  /** 右键菜单 */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, groupKey: string, personId: number) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, groupKey, personId });
    },
    []
  );

  /** 确认排除 */
  const handleConfirmExclude = useCallback((newExcluded: Set<number>) => {
    setExcludedIds(newExcluded);
    // 从所有组中移除被排除的
    setMaleGroups((prev) => prev.map((g) => ({
      ...g,
      members: g.members.filter((m) => !newExcluded.has(m.personId)),
      captainId: g.captainId !== null && newExcluded.has(g.captainId) ? null : g.captainId,
    })));
    setFemaleGroups((prev) => prev.map((g) => ({
      ...g,
      members: g.members.filter((m) => !newExcluded.has(m.personId)),
      captainId: g.captainId !== null && newExcluded.has(g.captainId) ? null : g.captainId,
    })));
  }, []);

  /** 池中勾选 */
  const togglePoolSelect = useCallback((id: number) => {
    setSelectedPoolIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** 批量分配选中成员到组 */
  const assignSelectedToGroup = useCallback((groupKey: string, gender: "male" | "female") => {
    const pool = gender === "male" ? poolMales : poolFemales;
    const selected = pool.filter((m) => selectedPoolIds.has(m.personId));
    if (selected.length === 0) return;

    if (gender === "male") {
      setMaleGroups((prev) => prev.map((g) => {
        if (g.key !== groupKey) return g;
        return { ...g, members: [...g.members, ...selected] };
      }));
    } else {
      setFemaleGroups((prev) => prev.map((g) => {
        if (g.key !== groupKey) return g;
        return { ...g, members: [...g.members, ...selected] };
      }));
    }
    setSelectedPoolIds(new Set());
  }, [poolMales, poolFemales, selectedPoolIds]);

  /** 添加新组 */
  const addGroup = useCallback((gender: "male" | "female") => {
    if (gender === "male") {
      setMaleGroups((prev) => [...prev, {
        key: `male-${prev.length}`, gender, label: `男团 第${prev.length + 1}组`, members: [], captainId: null,
      }]);
    } else {
      setFemaleGroups((prev) => [...prev, {
        key: `female-${prev.length}`, gender, label: `女团 第${prev.length + 1}组`, members: [], captainId: null,
      }]);
    }
  }, []);

  /** 删除组（成员回到池） */
  const removeGroup = useCallback((groupKey: string, gender: "male" | "female") => {
    if (gender === "male") {
      setMaleGroups((prev) => prev.filter((g) => g.key !== groupKey));
    } else {
      setFemaleGroups((prev) => prev.filter((g) => g.key !== groupKey));
    }
  }, []);

  /** 导出图片 */
  const handleExportImage = useCallback(async () => {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(exportRef.current, {
        backgroundColor: "#0f172a",
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `PK名单_${dataPeriod}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error("导出失败", e);
    } finally {
      setExporting(false);
    }
  }, [dataPeriod]);

  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const displayPeriod = dataPeriod || period || currentMonth;

  return (
    <div className="space-y-5">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Swords className="size-5 text-primary" />
            PK 名单
          </h2>
          <Badge variant="outline">{displayPeriod}</Badge>
          {excludedIds.size > 0 && (
            <Badge variant="destructive">{excludedIds.size} 人已排除</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={period || currentMonth}
            onChange={(e) => setPeriod(e.target.value)}
            className="app-no-drag rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none"
          />
          <Button variant="outline" size="sm" onClick={() => setExcludeOpen(true)}>
            <X className="size-4" />
            排除人员
          </Button>
          <Button variant="outline" size="sm" onClick={fetchRoster} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
          <Button size="sm" onClick={handleExportImage} disabled={exporting}>
            <Download className="size-4" />
            {exporting ? "导出中…" : "导出图片"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
        💡 成员按总音浪降序排列。从池中勾选成员后点「分配到组」，或直接拖拽到目标组。右键成员可设队长（同性别唯一）。导出图片含音浪数据。
      </div>

      {/* 内容 */}
      {loading ? (
        <LoadingState label="加载 PK 数据中…" />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchRoster} />
      ) : rawMales.length === 0 && rawFemales.length === 0 ? (
        <EmptyState label={`${displayPeriod} 月暂无音浪数据`} />
      ) : (
        <div className="space-y-6">
          {/* 男团 */}
          {rawMales.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <span className="size-2 rounded-full bg-chart-2" />
                  男团
                </h3>
                <Badge variant="secondary">
                  池 {poolMales.length} 人 · 分组 {maleGroups.reduce((s, g) => s + g.members.length, 0)} 人
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => addGroup("male")}>
                  + 添加组
                </Button>
              </div>

              {/* 成员池 */}
              <MemberPoolCard
                members={poolMales}
                selectedIds={selectedPoolIds}
                onToggleSelect={togglePoolSelect}
                onDragStart={(e, id) => handleDragStart(e, id)}
              />

              {/* 分组操作栏 */}
              {selectedPoolIds.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <span className="text-sm font-medium">已选 {selectedPoolIds.size} 人，分配到：</span>
                  {maleGroups.map((g) => (
                    <Button key={g.key} variant="outline" size="sm" onClick={() => assignSelectedToGroup(g.key, "male")}>
                      {g.label}
                      <ChevronRight className="size-3" />
                    </Button>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => setSelectedPoolIds(new Set())}>
                    取消选择
                  </Button>
                </div>
              )}

              {/* 组卡片 */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {maleGroups.map((g, i) => (
                  <div key={g.key} className="relative">
                    <GroupCard
                      group={g}
                      index={i}
                      onDropTo={(key, id) => handleDropToGroup(key, id)}
                      onContextMenuMember={handleContextMenu}
                      onDragStart={handleDragStart}
                    />
                    {g.members.length === 0 && (
                      <button
                        onClick={() => removeGroup(g.key, "male")}
                        className="absolute right-2 top-2 text-muted-foreground hover:text-destructive"
                        title="删除空组"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 女团 */}
          {rawFemales.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <span className="size-2 rounded-full bg-chart-1" />
                  女团
                </h3>
                <Badge variant="secondary">
                  池 {poolFemales.length} 人 · 分组 {femaleGroups.reduce((s, g) => s + g.members.length, 0)} 人
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => addGroup("female")}>
                  + 添加组
                </Button>
              </div>

              {/* 成员池 */}
              <MemberPoolCard
                members={poolFemales}
                selectedIds={selectedPoolIds}
                onToggleSelect={togglePoolSelect}
                onDragStart={(e, id) => handleDragStart(e, id)}
              />

              {/* 分组操作栏 */}
              {selectedPoolIds.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <span className="text-sm font-medium">已选 {selectedPoolIds.size} 人，分配到：</span>
                  {femaleGroups.map((g) => (
                    <Button key={g.key} variant="outline" size="sm" onClick={() => assignSelectedToGroup(g.key, "female")}>
                      {g.label}
                      <ChevronRight className="size-3" />
                    </Button>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => setSelectedPoolIds(new Set())}>
                    取消选择
                  </Button>
                </div>
              )}

              {/* 组卡片 */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {femaleGroups.map((g, i) => (
                  <div key={g.key} className="relative">
                    <GroupCard
                      group={g}
                      index={i}
                      onDropTo={(key, id) => handleDropToGroup(key, id)}
                      onContextMenuMember={handleContextMenu}
                      onDragStart={handleDragStart}
                    />
                    {g.members.length === 0 && (
                      <button
                        onClick={() => removeGroup(g.key, "female")}
                        className="absolute right-2 top-2 text-muted-foreground hover:text-destructive"
                        title="删除空组"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 右键菜单 */}
      {menu && (
        <ContextMenu menu={menu} onClose={() => setMenu(null)} onSetCaptain={handleSetCaptain} />
      )}

      {/* 排除对话框 */}
      <ExcludeDialog
        open={excludeOpen}
        onClose={() => setExcludeOpen(false)}
        allMembers={allMembers}
        excludedIds={excludedIds}
        onConfirm={handleConfirmExclude}
      />

      {/* 隐藏的导出 DOM */}
      <div className="fixed -left-[9999px] top-0">
        <div ref={exportRef} className="space-y-6">
          {maleGroups.some((g) => g.members.length > 0) && (
            <ExportRankTable
              title="星势力男主播 PK 名单"
              period={displayPeriod}
              groups={maleGroups}
              gender="male"
            />
          )}
          {femaleGroups.some((g) => g.members.length > 0) && (
            <ExportRankTable
              title="星势力女主播 PK 名单"
              period={displayPeriod}
              groups={femaleGroups}
              gender="female"
            />
          )}
          {!maleGroups.some((g) => g.members.length > 0) &&
            !femaleGroups.some((g) => g.members.length > 0) && (
              <div className="p-8 text-center text-muted-foreground" style={{ width: 960 }}>
                暂无分组数据
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
