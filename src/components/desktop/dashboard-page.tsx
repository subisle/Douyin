"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Users,
  Waves,
  Clock,
  TrendingUp,
  Timer,
  Database,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useElectronData } from "./use-electron-data";
import { formatWave, formatDuration, formatNumber } from "./format";
import type { TrendPoint } from "@/types/electron";
import {
  BrowserModeState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./states";

const maleConfig = {
  total: { label: "男主播音浪", color: "var(--chart-1)" },
} satisfies ChartConfig;

const femaleConfig = {
  total: { label: "女主播音浪", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function DashboardPage() {
  const summary = useElectronData((api) => api.getDashboardSummary());
  const trend = useElectronData((api) => api.getWaveTrendByGender());

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

  const s = summary.data;
  const stats = [
    { label: "主播总数", value: formatNumber(s.totalAnchors), icon: Users, hint: "在管主播", accent: "text-foreground" },
    { label: "总音浪", value: formatWave(s.totalWave), icon: Waves, hint: "累计", accent: "text-primary" },
    { label: "总时长", value: formatDuration(s.totalDuration), icon: Clock, hint: "累计", accent: "text-chart-2" },
    { label: "平均音浪", value: formatWave(s.avgWave), icon: TrendingUp, hint: "人均", accent: "text-chart-1" },
    { label: "平均时长", value: formatDuration(s.avgDuration), icon: Timer, hint: "人均", accent: "text-chart-4" },
    { label: "数据条目", value: formatNumber(s.dataCount), icon: Database, hint: "已入库", accent: "text-foreground" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
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
                <p className="mt-0.5 text-xs text-muted-foreground">{stat.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {trend.error ? (
        <Card>
          <CardContent>
            <ErrorState message={trend.error} onRetry={trend.reload} />
          </CardContent>
        </Card>
      ) : (
        <>
          <TrendChart
            title="男主播音浪趋势"
            accent="text-chart-1"
            loading={trend.loading}
            data={trend.data?.male ?? []}
            config={maleConfig}
          />
          <TrendChart
            title="女主播音浪趋势"
            accent="text-chart-2"
            loading={trend.loading}
            data={trend.data?.female ?? []}
            config={femaleConfig}
          />
        </>
      )}
    </div>
  );
}

function TrendChart({
  title,
  accent,
  loading,
  data,
  config,
}: {
  title: string;
  accent: string;
  loading: boolean;
  data: TrendPoint[];
  config: ChartConfig;
}) {
  const total = data.reduce((sum, p) => sum + p.total, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className={`text-base ${accent}`}>{title}</CardTitle>
          <Badge variant="secondary">累计 {formatWave(total)}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState label="加载趋势…" />
        ) : data.length === 0 ? (
          <EmptyState label="暂无音浪数据（快照表为空）" />
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
            <AreaChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
              <defs>
                <linearGradient id={`fill-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.05} />
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
                width={48}
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
                stroke="var(--color-total)"
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
