"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import { formatWave, formatDuration, formatNumber } from "./format";
import type { TrendPoint, AnchorRow } from "@/types/electron";
import {
  BrowserModeState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./states";

const totalWaveConfig = {
  total: { label: "总音浪", color: "var(--chart-3)" },
} satisfies ChartConfig;

const anchorCountConfig = {
  total: { label: "主播人数", color: "var(--chart-4)" },
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

type TrendTab = "male" | "female" | "total" | "count";

type PersonTrendData = {
  anchorId: string;
  name: string;
  data: { date: string; total: number; rank: number }[];
};

export function DashboardPage() {
  const summary = useElectronData((api) => api.getDashboardSummary());
  const genderTrend = useElectronData((api) => api.getWaveTrendByGender());
  const totalTrend = useElectronData((api) => api.getWaveTrendTotal());
  const countTrend = useElectronData((api) => api.getAnchorCountTrend());
  const anchorsRes = useElectronData((api) => api.getAnchors());
  const [trendTab, setTrendTab] = useState<TrendTab>("total");

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

  // 当主播列表加载完成后，默认选前5个
  useEffect(() => {
    if (sortedAnchors.length > 0 && selectedIds.length === 0) {
      const first5 = sortedAnchors.slice(0, 5).map((a) => a.anchorId);
      setSelectedIds(first5);
      fetchPersonTrends(first5);
    }
  }, [sortedAnchors, selectedIds.length, fetchPersonTrends]);

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

      {/* ====== 人员音浪趋势（多选） ====== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">人员音浪趋势</CardTitle>
            {/* 主播多选下拉 */}
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
                    {/* 搜索框 */}
                    <div className="border-b border-border p-2">
                      <div className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5">
                        <Search className="size-4 text-muted-foreground" />
                        <input
                          autoFocus
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="搜索主播名或ID…"
                          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                      </div>
                    </div>
                    {/* 已选标签 */}
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
                    {/* 列表 */}
                    <div className="max-h-60 overflow-auto p-1">
                      {filteredAnchors.map((a) => {
                        const isSelected = selectedIds.includes(a.anchorId);
                        const idx = selectedIds.indexOf(a.anchorId);
                        const color =
                          PERSON_COLORS[idx % PERSON_COLORS.length];
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
                              <Badge className="bg-chart-2/15 text-chart-2 hover:bg-chart-2/15 ml-2 shrink-0">
                                男
                              </Badge>
                            ) : a.gender === "female" ? (
                              <Badge className="bg-chart-1/15 text-chart-1 hover:bg-chart-1/15 ml-2 shrink-0">
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
          </div>
        </CardHeader>
        <CardContent>
          {personLoading ? (
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
              {/* 图例 */}
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <Badge variant="secondary">{mergedTrendData.length} 期</Badge>
                {personTrends!.map((pt, i) => {
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
              {/* 多线折线图 */}
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
                    {personTrends!.map((pt, i) => {
                      const color =
                        PERSON_COLORS[i % PERSON_COLORS.length];
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
          )}
        </CardContent>
      </Card>

      {/* ====== 汇总趋势图区域（下方） ====== */}
      {genderTrend.error || totalTrend.error || countTrend.error ? (
        <Card>
          <CardContent>
            <ErrorState
              message={
                genderTrend.error ||
                totalTrend.error ||
                countTrend.error ||
                "趋势加载失败"
              }
              onRetry={() => {
                genderTrend.reload();
                totalTrend.reload();
                countTrend.reload();
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <TrendTabs value={trendTab} onChange={setTrendTab} />
            <Badge variant="secondary" className="ml-auto">
              {trendTab === "total"
                ? `累计 ${formatWave(
                    totalTrend.data?.reduce((s, p) => s + p.total, 0) ?? 0
                  )}`
                : trendTab === "count"
                  ? `最新 ${formatNumber(
                      countTrend.data?.at(-1)?.total ?? 0
                    )} 人`
                  : `累计 ${formatWave(
                      (trendTab === "male"
                        ? genderTrend.data?.male
                        : genderTrend.data?.female
                      )?.reduce((s, p) => s + p.total, 0) ?? 0
                    )}`}
            </Badge>
          </div>

          {trendTab === "total" && (
            <TrendChart
              title="总音浪趋势"
              accent="text-chart-3"
              loading={totalTrend.loading}
              data={totalTrend.data ?? []}
              config={totalWaveConfig}
              color="var(--color-total)"
            />
          )}
          {trendTab === "count" && (
            <CountChart
              title="活跃主播人数趋势"
              loading={countTrend.loading}
              data={countTrend.data ?? []}
              config={anchorCountConfig}
            />
          )}
          {trendTab === "male" && (
            <TrendChart
              title="男主播音浪趋势"
              accent="text-chart-1"
              loading={genderTrend.loading}
              data={genderTrend.data?.male ?? []}
              config={maleConfig}
              color="var(--color-total)"
            />
          )}
          {trendTab === "female" && (
            <TrendChart
              title="女主播音浪趋势"
              accent="text-chart-2"
              loading={genderTrend.loading}
              data={genderTrend.data?.female ?? []}
              config={femaleConfig}
              color="var(--color-total)"
            />
          )}
        </>
      )}
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
    { id: "total", label: "总音浪" },
    { id: "count", label: "人数趋势" },
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

/** 面积图（音浪） */
function TrendChart({
  title,
  accent,
  loading,
  data,
  config,
  color,
}: {
  title: string;
  accent: string;
  loading: boolean;
  data: TrendPoint[];
  config: ChartConfig;
  color: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className={`text-base ${accent}`}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState label="加载趋势…" />
        ) : data.length === 0 ? (
          <EmptyState label="暂无数据（请先导入音浪快照）" />
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-[300px] w-full"
          >
            <AreaChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
              <defs>
                <linearGradient id={`fill-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.5} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.05} />
                </linearGradient>
              </defs>
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
              <Area
                dataKey="total"
                type="monotone"
                stroke={color}
                strokeWidth={2}
                fill={`url(#fill-${title})`}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/** 柱状图（人数） */
function CountChart({
  title,
  loading,
  data,
  config,
}: {
  title: string;
  loading: boolean;
  data: TrendPoint[];
  config: ChartConfig;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState label="加载趋势…" />
        ) : data.length === 0 ? (
          <EmptyState label="暂无数据（请先导入音浪快照）" />
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-[300px] w-full"
          >
            <BarChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
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
                width={40}
                allowDecimals={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => `日期 ${label}`}
                    formatter={(value) => `${value} 人`}
                  />
                }
              />
              <Bar
                dataKey="total"
                fill="var(--color-total)"
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
