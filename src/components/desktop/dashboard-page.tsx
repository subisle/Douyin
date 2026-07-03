"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  CartesianGrid,
  XAxis,
  YAxis,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Users,
  Waves,
  Clock,
  Upload,
  Download,
  ArrowRight,
  ChevronDown,
  Search,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useElectronData } from "./use-electron-data";
import type { DataState } from "./use-electron-data";
import { formatWave, formatDuration, formatNumber } from "./format";
import type { TrendPoint, AnchorRow, WaveTrendByGender } from "@/types/electron";
import {
  BrowserModeState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./states";

const totalWaveConfig = {
  total: { label: "总音浪", color: "var(--chart-3)" },
} satisfies ChartConfig;

const maleConfig = {
  total: { label: "男主播音浪", color: "var(--chart-1)" },
} satisfies ChartConfig;

const femaleConfig = {
  total: { label: "女主播音浪", color: "var(--chart-2)" },
} satisfies ChartConfig;

// 多人趋势的颜色方案
const PERSON_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#e879f9",
  "#fb7185",
  "#34d399",
  "#fbbf24",
  "#60a5fa",
];

type TrendTab = "person" | "total" | "male" | "female";

type PersonTrendData = {
  anchorId: string;
  name: string;
  data: { date: string; total: number; rank: number }[];
};

export function DashboardPage() {
  const summary = useElectronData((api) => api.getDashboardSummary());
  const genderTrend = useElectronData((api) => api.getWaveTrendByGender());
  const totalTrend = useElectronData((api) => api.getWaveTrendTotal());
  const anchorsRes = useElectronData((api) => api.getAnchors());
  const rankingRes = useElectronData((api) => api.getWaveRanking(10));
  const [trendTab, setTrendTab] = useState<TrendTab>("person");

  // 多人趋势状态
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [personTrends, setPersonTrends] = useState<PersonTrendData[] | null>(null);
  const [personLoading, setPersonLoading] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchPersonTrends = useCallback(async (ids: string[]) => {
    if (!ids || ids.length === 0) {
      setPersonTrends(null);
      return;
    }
    const api = window.electronAPI;
    if (!api) return;
    setPersonLoading(true);
    setPersonError(null);
    try {
      const res = await api.getAnchorsWaveTrend(ids);
      if (res.success) {
        setPersonTrends(res.data);
      } else {
        setPersonError(res.error || "加载失败");
        setPersonTrends(null);
      }
    } catch (e) {
      setPersonError(e instanceof Error ? e.message : String(e));
      setPersonTrends(null);
    } finally {
      setPersonLoading(false);
    }
  }, []);

  // 排序后的主播列表
  const sortedAnchors = useMemo(() => {
    if (!anchorsRes.data) return [];
    return [...anchorsRes.data].sort((a, b) =>
      a.name.localeCompare(b.name, "zh-CN")
    );
  }, [anchorsRes.data]);

  // 当主播列表加载完成后，默认选音浪榜前10（保证有数据），榜单为空时回退到列表前10
  useEffect(() => {
    if (selectedIds.length > 0) return;
    const topIds = (rankingRes.data ?? [])
      .map((r) => r.anchorId)
      .filter(Boolean)
      .slice(0, 10);
    if (topIds.length > 0) {
      setSelectedIds(topIds);
      fetchPersonTrends(topIds);
      return;
    }
    // 榜单加载完成但为空（无音浪数据）时，回退到主播列表前10
    if (!rankingRes.loading && sortedAnchors.length > 0) {
      const first10 = sortedAnchors.slice(0, 10).map((a) => a.anchorId);
      setSelectedIds(first10);
      fetchPersonTrends(first10);
    }
  }, [
    rankingRes.data,
    rankingRes.loading,
    sortedAnchors,
    selectedIds.length,
    fetchPersonTrends,
  ]);

  const toggleAnchor = (anchor: AnchorRow) => {
    setSelectedIds((prev) => {
      const exists = prev.includes(anchor.anchorId);
      let next: string[];
      if (exists) {
        next = prev.filter((id) => id !== anchor.anchorId);
      } else {
        next = [...prev, anchor.anchorId];
      }
      if (next.length > 0) {
        fetchPersonTrends(next);
      } else {
        setPersonTrends(null);
      }
      return next;
    });
  };

  // 合并多人趋势数据为折线图所需格式：[{ date, [anchorId]: value, ... }]
  const mergedTrendData = useMemo(() => {
    if (!personTrends || personTrends.length === 0) return [];
    const dateMap = new Map<string, Record<string, number | string>>();
    for (const pt of personTrends) {
      for (const point of pt.data) {
        if (!dateMap.has(point.date)) {
          dateMap.set(point.date, { date: point.date });
        }
        dateMap.get(point.date)![pt.anchorId] = point.total;
      }
    }
    return Array.from(dateMap.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );
  }, [personTrends]);

  // 选中主播的名称映射
  const selectedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const pt of personTrends || []) {
      m.set(pt.anchorId, pt.name);
    }
    // 也从 sortedAnchors 补充
    for (const a of sortedAnchors) {
      if (selectedIds.includes(a.anchorId) && !m.has(a.anchorId)) {
        m.set(a.anchorId, a.name);
      }
    }
    return m;
  }, [personTrends, sortedAnchors, selectedIds]);

  // 统计卡片数据
  const stats = summary.data
    ? [
        {
          label: "主播总数",
          value: formatNumber(summary.data.totalAnchors),
          icon: Users,
          hint: "在管主播",
          accent: "text-foreground",
        },
        {
          label: "总音浪",
          value: formatWave(summary.data.totalWave),
          icon: Waves,
          hint: "累计",
          accent: "text-primary",
        },
        {
          label: "总时长",
          value: formatDuration(summary.data.totalDuration),
          icon: Clock,
          hint: "累计",
          accent: "text-chart-2",
        },
      ]
    : [];

  const goDataPage = () => {
    window.dispatchEvent(new CustomEvent("app:navigate", { detail: "data" }));
  };

  // 过滤搜索
  const filteredAnchors = useMemo(() => {
    if (!searchQuery.trim()) return sortedAnchors;
    const q = searchQuery.trim().toLowerCase();
    return sortedAnchors.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.anchorId.toLowerCase().includes(q)
    );
  }, [sortedAnchors, searchQuery]);

  if (summary.unavailable) {
    return (
      <Card>
        <CardContent>
          <BrowserModeState />
        </CardContent>
      </Card>
    );
  }
  if (summary.loading) {
    return (
      <Card>
        <CardContent>
          <LoadingState label="正在加载仪表盘数据…" />
        </CardContent>
      </Card>
    );
  }
  if (summary.error || !summary.data) {
    return (
      <Card>
        <CardContent>
          <ErrorState
            message={summary.error ?? "加载失败"}
            onRetry={summary.reload}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="gap-2 py-4">
              <CardHeader className="px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    {stat.label}
                  </CardTitle>
                  <Icon className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="px-4">
                <p className={`truncate text-xl font-bold ${stat.accent}`}>
                  {stat.value}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {stat.hint}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 快捷按钮 */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={goDataPage} className="gap-2">
          <Upload className="size-4" />
          导入数据
          <ArrowRight className="size-3" />
        </Button>
        <Button variant="outline" onClick={goDataPage} className="gap-2">
          <Download className="size-4" />
          导出报表
          <ArrowRight className="size-3" />
        </Button>
      </div>

      {/* ====== 趋势图（人员对比 / 总音浪 / 男 / 女） ====== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <TrendTabs value={trendTab} onChange={setTrendTab} />
            {trendTab === "person" && (
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen((v) => !v)}
                  className="app-no-drag flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  <span className="max-w-[240px] truncate">
                    {selectedIds.length === 0
                      ? "选择主播"
                      : `已选 ${selectedIds.length} 人`}
                  </span>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </button>
                {dropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => {
                        setDropdownOpen(false);
                        setSearchQuery("");
                      }}
                    />
                    <div className="app-no-drag absolute right-0 top-full z-20 mt-1 w-80 rounded-xl border border-border bg-popover shadow-2xl">
                      <div className="border-b border-border p-2">
                        <div className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5">
                          <Search className="size-4 text-muted-foreground" />
                          <input
                            autoFocus
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="搜索主播名或ID..."
                            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                          />
                        </div>
                      </div>
                      {selectedIds.length > 0 && (
                        <div className="flex flex-wrap gap-1 border-b border-border p-2">
                          {selectedIds.map((id) => {
                            const name = selectedMap.get(id) || id;
                            const idx = selectedIds.indexOf(id);
                            const color = PERSON_COLORS[idx % PERSON_COLORS.length];
                            return (
                              <span
                                key={id}
                                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                                style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
                              >
                                {name}
                                <button
                                  onClick={() => {
                                    const anchor = sortedAnchors.find(
                                      (a) => a.anchorId === id
                                    );
                                    if (anchor) toggleAnchor(anchor);
                                  }}
                                  className="hover:opacity-70"
                                >
                                  <X className="size-3" />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <div className="max-h-60 overflow-auto p-1">
                        {filteredAnchors.map((a) => {
                          const isSelected = selectedIds.includes(a.anchorId);
                          const idx = selectedIds.indexOf(a.anchorId);
                          const color = PERSON_COLORS[idx % PERSON_COLORS.length];
                          return (
                            <button
                              key={a.id}
                              onClick={() => toggleAnchor(a)}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-accent ${
                                isSelected ? "bg-accent/50 font-medium" : ""
                              }`}
                            >
                              <span className="flex items-center gap-2 truncate">
                                {isSelected && (
                                  <span
                                    className="size-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: color }}
                                  />
                                )}
                                <span className="truncate">{a.name}</span>
                              </span>
                              {a.gender === "male" ? (
                                <Badge className="ml-2 shrink-0 bg-chart-2/15 text-chart-2 hover:bg-chart-2/15">
                                  男
                                </Badge>
                              ) : a.gender === "female" ? (
                                <Badge className="ml-2 shrink-0 bg-chart-1/15 text-chart-1 hover:bg-chart-1/15">
                                  女
                                </Badge>
                              ) : null}
                            </button>
                          );
                        })}
                        {filteredAnchors.length === 0 && (
                          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                            未找到匹配主播
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {trendTab === "person" ? (
            personLoading ? (
              <LoadingState label="加载人员趋势…" />
            ) : personError ? (
              <ErrorState
                message={personError}
                onRetry={() => fetchPersonTrends(selectedIds)}
              />
            ) : !personTrends ||
              personTrends.length === 0 ||
              mergedTrendData.length === 0 ? (
              <EmptyState label="暂无音浪数据" />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <Badge variant="secondary">{mergedTrendData.length} 期</Badge>
                  {personTrends.map((pt, i) => {
                    const color = PERSON_COLORS[i % PERSON_COLORS.length];
                    const total = pt.data.reduce((s, p) => s + p.total, 0);
                    return (
                      <span
                        key={pt.anchorId}
                        className="flex items-center gap-1.5 text-xs font-medium"
                        style={{ color }}
                      >
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        {pt.name}
                        <span className="text-muted-foreground">
                          {formatWave(total)}
                        </span>
                      </span>
                    );
                  })}
                </div>
                <div className="h-[360px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={mergedTrendData}
                      margin={{ left: 4, right: 12, top: 8, bottom: 0 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                        tickFormatter={(v: string) => v.slice(5)}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={56}
                        tickFormatter={(v: number) => formatWave(v)}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: "8px",
                          border: "1px solid var(--border)",
                          backgroundColor: "var(--popover)",
                        }}
                        labelFormatter={(label) => `日期 ${label}`}
                        formatter={(value, key) => {
                          const name = selectedMap.get(String(key)) || String(key);
                          return [formatWave(Number(value)), name];
                        }}
                      />
                      {personTrends.map((pt, i) => {
                        const color = PERSON_COLORS[i % PERSON_COLORS.length];
                        return (
                          <Line
                            key={pt.anchorId}
                            dataKey={pt.anchorId}
                            type="monotone"
                            stroke={color}
                            strokeWidth={2}
                            dot={{ r: 3, fill: color }}
                            activeDot={{ r: 5 }}
                            connectNulls
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )
          ) : (
            <SummaryTrend
              tab={trendTab}
              totalTrend={totalTrend}
              genderTrend={genderTrend}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 趋势图 Tab 切换 */
function TrendTabs({
  value,
  onChange,
}: {
  value: TrendTab;
  onChange: (v: TrendTab) => void;
}) {
  const tabs: { id: TrendTab; label: string }[] = [
    { id: "person", label: "人员对比" },
    { id: "total", label: "总音浪" },
    { id: "male", label: "男主播" },
    { id: "female", label: "女主播" },
  ];
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            value === t.id
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** 汇总趋势（总音浪 / 男 / 女）—— 内嵌于合并后的趋势卡片 */
function SummaryTrend({
  tab,
  totalTrend,
  genderTrend,
}: {
  tab: TrendTab;
  totalTrend: DataState<TrendPoint[]>;
  genderTrend: DataState<WaveTrendByGender>;
}) {
  if (totalTrend.error || genderTrend.error) {
    return (
      <ErrorState
        message={totalTrend.error || genderTrend.error || "趋势加载失败"}
        onRetry={() => {
          totalTrend.reload();
          genderTrend.reload();
        }}
      />
    );
  }

  const cfg =
    tab === "total"
      ? { data: totalTrend.data ?? [], config: totalWaveConfig }
      : tab === "male"
        ? { data: genderTrend.data?.male ?? [], config: maleConfig }
        : { data: genderTrend.data?.female ?? [], config: femaleConfig };

  const loading = tab === "total" ? totalTrend.loading : genderTrend.loading;
  const cumulative = cfg.data.reduce((s, p) => s + p.total, 0);

  return (
    <>
      <div className="mb-3 flex items-center">
        <Badge variant="secondary" className="ml-auto">
          累计 {formatWave(cumulative)}
        </Badge>
      </div>
      <TrendChart
        loading={loading}
        data={cfg.data}
        config={cfg.config}
        color="var(--color-total)"
      />
    </>
  );
}

/** 曲线图（音浪） */
function TrendChart({
  loading,
  data,
  config,
  color,
}: {
  loading: boolean;
  data: TrendPoint[];
  config: ChartConfig;
  color: string;
}) {
  if (loading) return <LoadingState label="加载趋势…" />;
  if (data.length === 0)
    return <EmptyState label="暂无数据（请先导入音浪快照）" />;
  return (
    <ChartContainer config={config} className="aspect-auto h-[360px] w-full">
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => formatWave(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => `日期 ${label}`}
              formatter={(value) => formatWave(Number(value))}
            />
          }
        />
        <Line
          dataKey="total"
          type="monotone"
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3, fill: color }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
