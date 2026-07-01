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

/* ---------- 导出专用：Desktop风格两列对比 ---------- */
function ExportCompareBoard({
  period,
  maleGroups,
  femaleGroups,
}: {
  period: string;
  maleGroups: GroupState[];
  femaleGroups: GroupState[];
}) {
  const BG = "#0f172a";
  const CARD_BG = "#1e293b";
  const BLUE_HEADER = "rgba(59, 130, 246, 0.2)";
  const PINK_HEADER = "rgba(236, 72, 153, 0.2)";
  const BLUE_TEXT = "#60a5fa";
  const PINK_TEXT = "#f472b6";
  const YELLOW = "#facc15";
  const CYAN = "#22d3ee";
  const TEXT_MAIN = "#f8fafc";
  const TEXT_MUTED = "#94a3b8";
  const BORDER = "#334155";

  const periodDisplay = (() => {
    const [y, m] = period.split("-");
    return `${y}年${parseInt(m, 10)}月`;
  })();

  const maleAll = useMemo(() => {
    const out: (PkMember & { groupLabel: string; isCaptain: boolean })[] = [];
    maleGroups.forEach((g) => g.members.forEach((m) => {
      out.push({ ...m, groupLabel: g.label, isCaptain: g.captainId === m.personId });
    }));
    return out.sort((a, b) => b.wave - a.wave);
  }, [maleGroups]);

  const femaleAll = useMemo(() => {
    const out: (PkMember & { groupLabel: string; isCaptain: boolean })[] = [];
    femaleGroups.forEach((g) => g.members.forEach((m) => {
      out.push({ ...m, groupLabel: g.label, isCaptain: g.captainId === m.personId });
    }));
    return out.sort((a, b) => b.wave - a.wave);
  }, [femaleGroups]);

  const maleTotal = maleAll.reduce((s, m) => s + m.wave, 0);
  const femaleTotal = femaleAll.reduce((s, m) => s + m.wave, 0);

  const renderColumn = (data: (PkMember & { groupLabel: string; isCaptain: boolean })[], gender: "male" | "female") => {
    const headerBg = gender === "male" ? BLUE_HEADER : PINK_HEADER;
    const headerText = gender === "male" ? BLUE_TEXT : PINK_TEXT;
    const label = gender === "male" ? `男主播 (${data.length}人)` : `女主播 (${data.length}人)`;
    const total = gender === "male" ? maleTotal : femaleTotal;
    return (
      <div>
        {/* 列标题 */}
        <div style={{ background: headerBg, borderRadius: "8px 8px 0 0", padding: "12px 16px", marginBottom: 0 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: headerText, textAlign: "center" }}>{label}</h3>
        </div>
        {/* 主播卡片列表 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0" }}>
          {data.map((m, i) => {
            const isEmpty = m.wave === 0;
            return (
              <div key={m.personId} style={{
                background: CARD_BG, borderRadius: 8, padding: "12px 16px",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: headerText, fontWeight: 700, fontSize: 16, fontFamily: 'Consolas, monospace' }}>#{i + 1}</span>
                    <span style={{ color: TEXT_MAIN, fontWeight: 500, fontSize: 15 }}>
                      {m.name}
                      {m.isCaptain && <span style={{ marginLeft: 4, color: "#fbbf24" }}>♛</span>}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: TEXT_MUTED, fontSize: 12, marginBottom: 2 }}>音浪</div>
                  <div style={{
                    color: isEmpty ? "#f87171" : YELLOW,
                    fontFamily: 'Consolas, monospace',
                    fontWeight: 700, fontSize: 18,
                  }}>
                    {isEmpty ? "未开播" : formatPkWave(m.wave)}
                  </div>
                </div>
              </div>
            );
          })}
          {data.length === 0 && (
            <div style={{ textAlign: "center", color: TEXT_MUTED, padding: "32px 0" }}>暂无数据</div>
          )}
        </div>
        {/* 汇总卡片 */}
        <div style={{
          background: gender === "male" ? "rgba(59,130,246,0.1)" : "rgba(236,72,153,0.1)",
          border: `1px solid ${gender === "male" ? "rgba(59,130,246,0.3)" : "rgba(236,72,153,0.3)"}`,
          borderRadius: 8, padding: "16px 20px", marginTop: 8,
        }}>
          <h4 style={{ margin: 0, marginBottom: 8, color: headerText, fontWeight: 700, textAlign: "center", fontSize: 15 }}>
            {gender === "male" ? "男主播音浪汇总" : "女主播音浪汇总"}
          </h4>
          <div style={{ textAlign: "center" }}>
            <span style={{ color: TEXT_MUTED, fontSize: 13 }}>总音浪 </span>
            <span style={{ color: YELLOW, fontFamily: 'Consolas, monospace', fontWeight: 700, fontSize: 18 }}>
              {formatPkWave(total)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      width: 960,
      background: BG,
      color: TEXT_MAIN,
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      padding: 32,
    }}>
      {/* 标题 */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#fff" }}>PK主播音浪数据对比</h2>
        <p style={{ margin: "8px 0 0", fontSize: 16, color: TEXT_MUTED }}>{periodDisplay} · 星势力</p>
      </div>
      {/* 两列布局 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {renderColumn(maleAll, "male")}
        {renderColumn(femaleAll, "female")}
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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
      setPreviewUrl(dataUrl);
    } catch (e) {
      console.error("导出失败", e);
    } finally {
      setExporting(false);
    }
  }, []);

  /** 下载预览图 */
  const handleDownloadPreview = useCallback(() => {
    if (!previewUrl) return;
    const link = document.createElement("a");
    link.download = `PK名单_${dataPeriod || period || currentMonth}.png`;
    link.href = previewUrl;
    link.click();
  }, [previewUrl, dataPeriod, period, currentMonth]);

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
        <div ref={exportRef}>
          {(maleGroups.some((g) => g.members.length > 0) || femaleGroups.some((g) => g.members.length > 0)) ? (
            <ExportCompareBoard
              period={displayPeriod}
              maleGroups={maleGroups}
              femaleGroups={femaleGroups}
            />
          ) : (
            <div className="p-8 text-center text-muted-foreground" style={{ width: 960 }}>
              暂无分组数据
            </div>
          )}
        </div>
      </div>

      {/* 预览弹窗 */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] overflow-auto rounded-lg bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold">导出预览</h3>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleDownloadPreview}>
                  <Download className="size-4" />
                  下载图片
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPreviewUrl(null)}>
                  关闭
                </Button>
              </div>
            </div>
            <img
              src={previewUrl}
              alt="PK名单预览"
              className="max-h-[80vh] max-w-full rounded"
            />
          </div>
        </div>
      )}
    </div>
  );
}
