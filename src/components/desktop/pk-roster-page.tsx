"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Swords, Waves, Download, RefreshCw, X, Crown, Search } from "lucide-react";
import { LoadingState, ErrorState, EmptyState } from "./states";
import { downloadDataUrlAsFile, elementToPngDataUrl } from "./export-image";
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

const DEFAULT_GROUP_SIZE = 8;
const LIVE_WAVE_THRESHOLD = 2;

/* ---------- 辅助 ---------- */
/** PK名单专用：万级取整，不显示小数 */
function formatPkWave(value: number): string {
  if (!value) return "0";
  if (value >= 1_0000_0000) return `${Math.round(value / 1_0000_0000)} 亿`;
  if (value >= 1_0000) return `${Math.round(value / 1_0000)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
}

function formatPkWaveOrInactive(value: number): string {
  return value >= LIVE_WAVE_THRESHOLD ? formatPkWave(value) : "未开播";
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
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(new Set(excludedIds));
      setQuery("");
    }
  }, [open, excludedIds]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allMembers;
    return allMembers.filter((member) => {
      const fields = [
        member.name,
        member.anchorId,
        String(member.personId),
        member.gender === "male" ? "男" : member.gender === "female" ? "女" : member.gender,
      ];
      return fields.some((field) => field.toLowerCase().includes(q));
    });
  }, [allMembers, query]);

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
        <div className="mb-3 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索姓名、主播ID或人员ID"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set(allMembers.map((m) => m.personId)))}>
              全选
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filteredMembers.length === 0}
              onClick={() => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  filteredMembers.forEach((member) => next.add(member.personId));
                  return next;
                });
              }}
            >
              排除搜索结果
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
              清空
            </Button>
            <Badge variant="secondary">{selected.size} 人已选</Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              显示 {filteredMembers.length}/{allMembers.length}
            </span>
          </div>
        </div>
        <ScrollArea className="h-72 rounded-lg border border-border">
          {filteredMembers.map((m, idx) => (
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
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {m.anchorId || `人员ID ${m.personId}`}
                </span>
              </span>
              <Badge
                className={
                  m.gender === "male"
                    ? "shrink-0 bg-chart-2/15 text-chart-2 hover:bg-chart-2/15"
                    : m.gender === "female"
                      ? "shrink-0 bg-chart-1/15 text-chart-1 hover:bg-chart-1/15"
                      : "shrink-0 bg-muted text-muted-foreground hover:bg-muted"
                }
              >
                {m.gender === "male" ? "男" : m.gender === "female" ? "女" : "-"}
              </Badge>
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{formatPkWaveOrInactive(m.wave)}</span>
            </div>
          ))}
          {filteredMembers.length === 0 && (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              未找到匹配人员
            </div>
          )}
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

/* ---------- 组卡片 ---------- */
function GroupCard({
  group,
  index,
}: {
  group: GroupState;
  index: number;
}) {
  const colorClass = GROUP_COLORS[index % GROUP_COLORS.length];
  const totalWave = group.members.reduce((s, m) => s + m.wave, 0);
  const totalTrimmed = group.members.reduce((s, m) => s + m.trimmedAvg, 0);
  const captainName = group.members.find((m) => m.personId === group.captainId)?.name;

  // 组内按总音浪降序
  const sorted = [...group.members].sort((a, b) => b.wave - a.wave);

  return (
    <Card className={`border-l-4 ${colorClass}`}>
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
                className="border-b border-border/50 last:border-0 hover:bg-accent/50"
              >
                <td className="py-1.5 text-muted-foreground w-7">{i + 1}</td>
                <td className="py-1.5 font-medium">
                  {m.name}
                  {group.captainId === m.personId && (
                    <Crown className="ml-1 inline size-3 text-amber-500" />
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums text-foreground">
                  {m.wave >= LIVE_WAVE_THRESHOLD ? formatPkWave(m.trimmedAvg) : "未开播"}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {m.maxWave >= LIVE_WAVE_THRESHOLD ? formatPkWave(m.maxWave) : "-"}
                  {m.maxWave > m.trimmedAvg * 3 && m.waveDays > 1 && (
                    <span className="ml-1 text-amber-500" title="单日异常高值">⚠</span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-muted-foreground text-xs">
                  暂无成员
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/* ---------- 导出专用：精简分组名单 ---------- */
function ExportCompareBoard({
  period,
  maleGroups,
  femaleGroups,
}: {
  period: string;
  maleGroups: GroupState[];
  femaleGroups: GroupState[];
}) {
  const TEXT_MAIN = "#0F172A";
  const TEXT_MUTED = "#64748B";
  const BORDER = "#E2E8F0";
  const BLUE = { text: "#0369A1", soft: "#E0F2FE", line: "#38BDF8" };
  const PINK = { text: "#BE185D", soft: "#FCE7F3", line: "#F472B6" };

  const periodDisplay = (() => {
    const [y, m] = period.split("-");
    return `${y}年${parseInt(m, 10)}月`;
  })();

  const maxGroupCount = Math.max(1, maleGroups.length, femaleGroups.length);
  const boardWidth = Math.max(1280, maxGroupCount * 230 + 96);

  const renderGroup = (group: GroupState, accent: typeof BLUE) => {
    const captain = group.members.find((member) => member.personId === group.captainId);
    const members = [...group.members];

    return (
      <div
        key={group.key}
        style={{
          background: "#FFFFFF",
          border: `1px solid ${BORDER}`,
          borderTop: `5px solid ${accent.line}`,
          borderRadius: 14,
          padding: 12,
        }}
      >
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: accent.text, fontSize: 18, fontWeight: 900 }}>{group.label}</div>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginTop: 7,
            padding: "5px 9px",
            borderRadius: 999,
            background: accent.soft,
            color: accent.text,
            fontSize: 13,
            fontWeight: 800,
          }}>
            <span>队长</span>
            <span>{captain?.name || "-"}</span>
          </div>
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 7,
        }}>
          {members.map((member) => {
            const isCaptain = group.captainId === member.personId;
            return (
              <div
                key={member.personId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  border: `1px solid ${isCaptain ? accent.line : "#EEF2F7"}`,
                  background: isCaptain ? accent.soft : "#F8FAFC",
                  borderRadius: 9,
                  padding: "7px 9px",
                  minHeight: 34,
                }}
              >
                <span style={{
                  minWidth: 0,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  color: TEXT_MAIN,
                  fontSize: 14,
                  fontWeight: isCaptain ? 900 : 700,
                }}>
                  {member.name}
                </span>
                {isCaptain && (
                  <span style={{
                    flexShrink: 0,
                    color: accent.text,
                    fontSize: 11,
                    fontWeight: 900,
                  }}>
                    队长
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderBand = (groups: GroupState[], gender: "male" | "female") => {
    const accent = gender === "male" ? BLUE : PINK;
    const label = gender === "male" ? "男团" : "女团";
    return (
      <div style={{
        background: "#FFFFFF",
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 16,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}>
          <h3 style={{ margin: 0, color: accent.text, fontSize: 23, fontWeight: 950 }}>{label}</h3>
          <div style={{ color: TEXT_MUTED, fontSize: 14, fontWeight: 700 }}>
            {groups.length} 组 · {groups.reduce((sum, group) => sum + group.members.length, 0)} 人
          </div>
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(groups.length, 1)}, minmax(210px, 1fr))`,
          gap: 12,
          alignItems: "start",
        }}>
          {groups.length > 0 ? (
            groups.map((group) => renderGroup(group, accent))
          ) : (
            <div style={{
              border: `1px dashed ${BORDER}`,
              color: TEXT_MUTED,
              borderRadius: 12,
              padding: "42px 0",
              textAlign: "center",
              fontSize: 14,
            }}>
              暂无数据
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      width: boardWidth,
      background: "#F8FAFC",
      color: TEXT_MAIN,
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      padding: 30,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 18,
        transform: "rotate(-18deg) scale(1.15)",
        transformOrigin: "center",
        opacity: 0.08,
        pointerEvents: "none",
      }}>
        {Array.from({ length: 28 }).map((_, index) => (
          <div
            key={index}
            style={{
              color: "#334155",
              fontSize: 30,
              fontWeight: 950,
              whiteSpace: "nowrap",
              textAlign: "center",
            }}
          >
            内部数据 · 请勿外传
          </div>
        ))}
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{
          textAlign: "center",
          marginBottom: 22,
        }}>
          <h2 style={{ margin: 0, fontSize: 34, lineHeight: 1.1, fontWeight: 950, color: TEXT_MAIN }}>
            PK名单分组
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: 19, color: TEXT_MUTED, fontWeight: 800 }}>
            {periodDisplay}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {renderBand(maleGroups, "male")}
          {renderBand(femaleGroups, "female")}
        </div>

        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: `1px solid ${BORDER}`,
          color: TEXT_MAIN,
          fontSize: 18,
          fontWeight: 900,
          marginTop: 22,
          paddingTop: 14,
        }}>
          <span>PS：</span>
          <span>一定要跟自己的队长联系，确认自己是哪个队伍。</span>
        </div>
      </div>
    </div>
  );
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildAutoGroups(
  members: PkMember[],
  gender: "male" | "female",
  excludedIds: Set<number>,
  groupSize = DEFAULT_GROUP_SIZE
): GroupState[] {
  const seen = new Set<number>();
  const eligible = members
    .filter((member) => {
      if (excludedIds.has(member.personId) || seen.has(member.personId)) return false;
      seen.add(member.personId);
      return true;
    })
    .sort((left, right) => {
      const scoreDiff = right.trimmedAvg - left.trimmedAvg;
      if (scoreDiff !== 0) return scoreDiff;
      return right.wave - left.wave;
    });

  if (eligible.length === 0) return [];

  const groupCount = Math.max(1, Math.ceil(eligible.length / groupSize));
  const prefix = gender === "male" ? "男团" : "女团";
  const groups: GroupState[] = Array.from({ length: groupCount }, (_, index) => ({
    key: `${gender}-${index}`,
    gender,
    label: `${prefix} 第${index + 1}组`,
    members: [],
    captainId: null,
  }));

  eligible.forEach((member, index) => {
    const round = Math.floor(index / groupCount);
    const offset = index % groupCount;
    const targetIndex = round % 2 === 0 ? offset : groupCount - 1 - offset;
    groups[targetIndex].members.push(member);
  });

  return groups.map((group) => {
    const sortedMembers = [...group.members].sort((left, right) => {
      const scoreDiff = right.trimmedAvg - left.trimmedAvg;
      if (scoreDiff !== 0) return scoreDiff;
      return right.wave - left.wave;
    });

    return {
      ...group,
      members: sortedMembers,
      captainId: sortedMembers[0]?.personId ?? null,
    };
  });
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
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [excludeOpen, setExcludeOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /** 拉取数据 */
  const fetchRoster = useCallback(async () => {
    const api = getDataApi();
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
        setExcludedIds(new Set());
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

  const maleGroups = useMemo(
    () => buildAutoGroups(rawMales, "male", excludedIds),
    [rawMales, excludedIds]
  );

  const femaleGroups = useMemo(
    () => buildAutoGroups(rawFemales, "female", excludedIds),
    [rawFemales, excludedIds]
  );

  /** 确认排除 */
  const handleConfirmExclude = useCallback((newExcluded: Set<number>) => {
    setExcludedIds(newExcluded);
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
      const dataUrl = await elementToPngDataUrl(exportRef.current, {
        backgroundColor: "#f8fafc",
        pixelRatio: 3,
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
    void downloadDataUrlAsFile(previewUrl, `PK名单分组_${dataPeriod || period || currentMonth}.png`);
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
        💡 系统按去最高后日均音浪自动蛇形分组，默认每组最多 {DEFAULT_GROUP_SIZE} 人；导出图片只保留队伍分组、队长和成员名单。
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
                  自动 {maleGroups.length} 组 · {maleGroups.reduce((s, g) => s + g.members.length, 0)} 人
                </Badge>
              </div>

              {/* 组卡片 */}
              {maleGroups.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {maleGroups.map((g, i) => (
                    <GroupCard
                      key={g.key}
                      group={g}
                      index={i}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState label="男团成员已全部排除" />
              )}
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
                  自动 {femaleGroups.length} 组 · {femaleGroups.reduce((s, g) => s + g.members.length, 0)} 人
                </Badge>
              </div>

              {/* 组卡片 */}
              {femaleGroups.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {femaleGroups.map((g, i) => (
                    <GroupCard
                      key={g.key}
                      group={g}
                      index={i}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState label="女团成员已全部排除" />
              )}
            </div>
          )}
        </div>
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
            <div className="p-8 text-center text-muted-foreground" style={{ width: 1600 }}>
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
            {/* eslint-disable-next-line @next/next/no-img-element -- 预览图是本地生成的 data URL，不需要 Next Image 优化。 */}
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
