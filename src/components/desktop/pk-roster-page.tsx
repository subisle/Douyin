"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Swords, Waves, Download, RefreshCw, X, Crown, Search, ClipboardPaste, ListChecks } from "lucide-react";
import { LoadingState, ErrorState, EmptyState } from "./states";
import { downloadDataUrlAsFile, elementToPngDataUrl } from "./export-image";
import { cn } from "@/lib/utils";
import type { PkMember, IpcResult } from "@/types/electron";
import {
  BATTLE_STAGE_TAB_OPTIONS,
  DEFAULT_PK_GROUP_SIZE,
  PRESET_PROMOTION_GROUPS,
  PRESET_ROSTER_TEXT,
  ROSTER_CONFIG_STORAGE_KEY,
  ROSTER_SLOT_OPTIONS,
  loadRosterConfigs,
  resolvePresetBattleGroups,
  resolvePresetPromotionGroups,
  resolveRosterNames,
  type BattleStageTab,
  type RosterConfig,
  type RosterSlot,
} from "./pk-roster-config";

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

const DEFAULT_GROUP_SIZE = DEFAULT_PK_GROUP_SIZE;
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

function comparePkMembers(left: PkMember, right: PkMember) {
  const scoreDiff = right.trimmedAvg - left.trimmedAvg;
  if (scoreDiff !== 0) return scoreDiff;
  const waveDiff = right.wave - left.wave;
  if (waveDiff !== 0) return waveDiff;
  return left.personId - right.personId;
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
          {captain && (
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
              <span>{captain.name}</span>
            </div>
          )}
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

  const hasCaptains = [...maleGroups, ...femaleGroups].some((group) => group.captainId !== null);

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

        {hasCaptains && (
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
        )}
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
  groupSize = DEFAULT_GROUP_SIZE,
  assignCaptains = true
): GroupState[] {
  const seen = new Set<number>();
  const eligible = members
    .filter((member) => {
      if (excludedIds.has(member.personId) || seen.has(member.personId)) return false;
      seen.add(member.personId);
      return true;
    })
    .sort(comparePkMembers);

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
    const targetIndex = Math.floor(index / groupSize);
    groups[targetIndex].members.push(member);
  });

  return groups.map((group) => {
    const sortedMembers = [...group.members].sort(comparePkMembers);

    return {
      ...group,
      members: sortedMembers,
      captainId: assignCaptains ? sortedMembers[0]?.personId ?? null : null,
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
  const [rosterSlot, setRosterSlot] = useState<RosterSlot>("midmonth");
  const [rosterConfigs, setRosterConfigs] = useState<Record<RosterSlot, RosterConfig>>(loadRosterConfigs);
  /** 15号：常规自动分组 / 争霸赛三轮分组 */
  const [midmonthView, setMidmonthView] = useState<"auto" | "battle">("auto");
  const [battleStage, setBattleStage] = useState<BattleStageTab>("group");

  // 后端返回的扁平列表
  const [rawMales, setRawMales] = useState<PkMember[]>([]);
  const [rawFemales, setRawFemales] = useState<PkMember[]>([]);
  const [dataPeriod, setDataPeriod] = useState("");

  // 分组状态
  const [excludeOpen, setExcludeOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(ROSTER_CONFIG_STORAGE_KEY, JSON.stringify(rosterConfigs));
  }, [rosterConfigs]);

  const updateActiveConfig = useCallback((patch: Partial<RosterConfig>) => {
    setRosterConfigs((current) => ({
      ...current,
      [rosterSlot]: {
        ...current[rosterSlot],
        ...patch,
      },
    }));
  }, [rosterSlot]);

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

  const activeConfig = rosterConfigs[rosterSlot];
  const includeResolution = useMemo(
    () => resolveRosterNames(allMembers, activeConfig.includeText),
    [activeConfig.includeText, allMembers]
  );
  const excludeResolution = useMemo(
    () => resolveRosterNames(allMembers, activeConfig.excludeText),
    [activeConfig.excludeText, allMembers]
  );

  const rosterMembers = useMemo(() => {
    const filter = (members: PkMember[]) => members.filter((member) => {
      if (activeConfig.mode === "include" && includeResolution.names.length > 0 && !includeResolution.ids.has(member.personId)) {
        return false;
      }
      if (excludeResolution.ids.has(member.personId)) return false;
      return true;
    });
    return {
      males: filter(rawMales),
      females: filter(rawFemales),
    };
  }, [activeConfig.mode, excludeResolution.ids, includeResolution.ids, includeResolution.names.length, rawFemales, rawMales]);

  const activeRosterCount = rosterMembers.males.length + rosterMembers.females.length;
  const excludedCount = allMembers.length - activeRosterCount;
  const assignCaptains = rosterSlot !== "midmonth";

  const maleGroups = useMemo(
    () => buildAutoGroups(rosterMembers.males, "male", new Set(), DEFAULT_GROUP_SIZE, assignCaptains),
    [assignCaptains, rosterMembers.males]
  );

  const femaleGroups = useMemo(
    () => buildAutoGroups(rosterMembers.females, "female", new Set(), DEFAULT_GROUP_SIZE, assignCaptains),
    [assignCaptains, rosterMembers.females]
  );

  /** 15号争霸赛：小组 / 复活 / 晋级 内置分组（按当前名单成员匹配） */
  const battlePool = useMemo(() => {
    // 争霸赛只看男团 + 白名单过滤后的名单
    return rosterMembers.males;
  }, [rosterMembers.males]);

  const groupStagePreset = useMemo(
    () => resolvePresetBattleGroups(battlePool),
    [battlePool]
  );
  const promotionStagePreset = useMemo(
    () => resolvePresetPromotionGroups(battlePool),
    [battlePool]
  );

  const battleStageGroups = useMemo(() => {
    if (battleStage === "promotion") {
      return promotionStagePreset.groups.map((group, index) => ({
        key: group.key,
        gender: "male" as const,
        label: group.label || `晋级${index + 1}组`,
        members: group.members,
        captainId: null as number | null,
      }));
    }
    return groupStagePreset.groups.map((group, index) => ({
      key: group.key,
      gender: "male" as const,
      label: group.label || `第${index + 1}组`,
      members: group.members,
      captainId: null as number | null,
    }));
  }, [battleStage, groupStagePreset.groups, promotionStagePreset.groups]);

  const battleStageMeta = useMemo(() => {
    if (battleStage === "promotion") {
      return {
        detail: promotionStagePreset.detail,
        missing: promotionStagePreset.missingNames,
        note: `内置晋级 ${PRESET_PROMOTION_GROUPS.length} 组 · 每组晋级 1 人 · 无复活赛 · 全部结束后进决赛`,
      };
    }
    return {
      detail: groupStagePreset.detail,
      missing: groupStagePreset.missingNames,
      note: "内置小组赛 7 组 · 53 人均衡（8×4+7×3）；啸泽首/啸帆末/啸安第2；08:15 起间隔 5 分钟",
    };
  }, [
    battleStage,
    groupStagePreset.detail,
    groupStagePreset.missingNames,
    promotionStagePreset.detail,
    promotionStagePreset.missingNames,
  ]);

  /** 确认排除 */
  const handleConfirmExclude = useCallback((newExcluded: Set<number>) => {
    const names = allMembers
      .filter((member) => newExcluded.has(member.personId))
      .map((member) => member.name)
      .join("\n");
    updateActiveConfig({ excludeText: names });
  }, [allMembers, updateActiveConfig]);

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
          <Badge variant="secondary">{ROSTER_SLOT_OPTIONS.find((item) => item.key === rosterSlot)?.label}</Badge>
          <Badge variant={activeConfig.mode === "include" ? "default" : "outline"}>
            {activeConfig.mode === "include" ? "只打名单" : "排除名单"}
          </Badge>
          {excludedCount > 0 && (
            <Badge variant="destructive">{excludedCount} 人不参与</Badge>
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
        💡 {rosterSlot === "midmonth" && midmonthView === "battle"
          ? "15号争霸赛分组：小组赛 / 晋级赛。晋级赛每组晋级 1 人，全部结束后进入决赛；无复活赛。"
          : `系统按去最高后日均音浪从高到低自动分组，默认每组最多 ${DEFAULT_GROUP_SIZE} 人；导出图片只保留队伍分组${assignCaptains ? "、队长" : ""}和成员名单。`}
      </div>

      <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border bg-background p-0.5">
              {ROSTER_SLOT_OPTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setRosterSlot(item.key)}
                  className={cn(
                    "h-8 rounded-[5px] px-3 text-xs font-bold transition",
                    rosterSlot === item.key
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {item.shortLabel}
                </button>
              ))}
            </div>
            {rosterSlot === "midmonth" && (
              <div className="flex rounded-md border border-border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => setMidmonthView("auto")}
                  className={cn(
                    "h-8 rounded-[5px] px-3 text-xs font-bold transition",
                    midmonthView === "auto"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  自动分组
                </button>
                <button
                  type="button"
                  onClick={() => setMidmonthView("battle")}
                  className={cn(
                    "h-8 rounded-[5px] px-3 text-xs font-bold transition",
                    midmonthView === "battle"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  争霸赛分组
                </button>
              </div>
            )}
            <div className="flex rounded-md border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => updateActiveConfig({ mode: "include" })}
                className={cn(
                  "h-8 rounded-[5px] px-3 text-xs font-bold transition",
                  activeConfig.mode === "include"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                只打名单
              </button>
              <button
                type="button"
                onClick={() => updateActiveConfig({ mode: "exclude" })}
                className={cn(
                  "h-8 rounded-[5px] px-3 text-xs font-bold transition",
                  activeConfig.mode === "exclude"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                排除名单
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Badge variant="secondary">参与 {activeRosterCount} 人</Badge>
            <Badge variant="outline">参赛文本 {includeResolution.names.length} 人</Badge>
            <Badge variant="outline">排除文本 {excludeResolution.names.length} 人</Badge>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className={cn(
            "rounded-md border p-3",
            activeConfig.mode === "include" ? "border-primary/50 bg-primary/5" : "border-border bg-muted/15"
          )}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-black">
                <ListChecks className="size-4 text-primary" />
                参赛名单文本
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateActiveConfig({ includeText: PRESET_ROSTER_TEXT, mode: "include" })}
              >
                <ClipboardPaste className="size-4" />
                使用预设
              </Button>
            </div>
            <textarea
              value={activeConfig.includeText}
              onChange={(event) => updateActiveConfig({ includeText: event.target.value })}
              placeholder="粘贴名单，每行一个名字，支持 1. 张三 / 张三 / 逗号分隔"
              className="app-no-drag h-40 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-[3px] focus:ring-ring/40"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span>匹配 {includeResolution.ids.size}/{includeResolution.names.length}</span>
              {includeResolution.unmatchedNames.length > 0 && (
                <span className="truncate text-destructive" title={includeResolution.unmatchedNames.join("、")}>
                  未匹配：{includeResolution.unmatchedNames.slice(0, 6).join("、")}
                </span>
              )}
            </div>
          </div>

          <div className={cn(
            "rounded-md border p-3",
            activeConfig.mode === "exclude" ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/15"
          )}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-black">
                <X className="size-4 text-destructive" />
                排除名单文本
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateActiveConfig({ excludeText: "" })}
              >
                清空
              </Button>
            </div>
            <textarea
              value={activeConfig.excludeText}
              onChange={(event) => updateActiveConfig({ excludeText: event.target.value })}
              placeholder="粘贴不参与名单，每行一个名字；即使使用“只打名单”，这里的人也会被排除"
              className="app-no-drag h-40 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-[3px] focus:ring-ring/40"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span>匹配 {excludeResolution.ids.size}/{excludeResolution.names.length}</span>
              {excludeResolution.unmatchedNames.length > 0 && (
                <span className="truncate text-destructive" title={excludeResolution.unmatchedNames.join("、")}>
                  未匹配：{excludeResolution.unmatchedNames.slice(0, 6).join("、")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 内容 */}
      {loading ? (
        <LoadingState label="加载 PK 数据中…" />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchRoster} />
      ) : rawMales.length === 0 && rawFemales.length === 0 ? (
        <EmptyState label={`${displayPeriod} 月暂无音浪数据`} />
      ) : rosterSlot === "midmonth" && midmonthView === "battle" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap gap-2">
              {BATTLE_STAGE_TAB_OPTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setBattleStage(item.key)}
                  className={cn(
                    "h-9 rounded-md px-3 text-sm font-bold transition",
                    battleStage === item.key
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Badge variant="secondary">
                {battleStageGroups.length} 组 ·{" "}
                {battleStageGroups.reduce((sum, group) => sum + group.members.length, 0)} 人
              </Badge>
              <Badge variant="outline">{battleStageMeta.detail}</Badge>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-muted-foreground">
            {BATTLE_STAGE_TAB_OPTIONS.find((item) => item.key === battleStage)?.description}
            {" · "}
            {battleStageMeta.note}
            {battleStageMeta.missing.length > 0 && (
              <span className="ml-2 text-destructive">
                缺：{battleStageMeta.missing.slice(0, 8).join("、")}
                {battleStageMeta.missing.length > 8 ? "…" : ""}
              </span>
            )}
          </div>

          {battleStageGroups.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {battleStageGroups.map((group, index) => (
                <GroupCard key={group.key} group={group} index={index} />
              ))}
            </div>
          ) : (
            <EmptyState
              label={
                battleStage === "promotion"
                  ? "内置晋级名单未匹配到主播，请确认 15 号白名单与当月音浪数据"
                  : "内置小组赛名单未匹配到主播"
              }
            />
          )}
        </div>
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
        excludedIds={excludeResolution.ids}
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
