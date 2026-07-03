"use client";

import { useMemo, useState } from "react";
import {
  Award,
  CalendarDays,
  Clock,
  Coins,
  Download,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Trash2,
  Trophy,
  Waves,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useElectronData } from "./use-electron-data";
import { formatDuration, formatNumber, formatWave } from "./format";
import { BrowserModeState, EmptyState, ErrorState, LoadingState } from "./states";
import type { RewardConfig, RewardRow } from "@/types/electron";

const REWARD_CONFIG_STORAGE_KEY = "reward-page-config";
type RewardFilter = "all" | "rewarded" | "wave" | "duration";

const DEFAULT_REWARD_CONFIG: RewardConfig = {
  waveRules: [
    { label: "600万以上", minWave: 6000000, maxWave: null, amount: 5000 },
    { label: "400万-500万", minWave: 4000000, maxWave: 5000000, amount: 4000 },
    { label: "200万-300万", minWave: 2000000, maxWave: 3000000, amount: 3000 },
  ],
  durationRule: {
    thresholdMinutes: 136 * 60,
    firstPrize: 500,
  },
};

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMoney(value: number): string {
  return `¥${formatNumber(value)}`;
}

function genderText(gender: string): string {
  if (gender === "male") return "男";
  if (gender === "female") return "女";
  return "-";
}

function loadRewardConfig(): RewardConfig {
  if (typeof window === "undefined") return DEFAULT_REWARD_CONFIG;
  try {
    const raw = localStorage.getItem(REWARD_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_REWARD_CONFIG;
    const parsed = JSON.parse(raw) as RewardConfig;
    if (!Array.isArray(parsed.waveRules) || !parsed.durationRule) {
      return DEFAULT_REWARD_CONFIG;
    }
    return parsed;
  } catch {
    return DEFAULT_REWARD_CONFIG;
  }
}

function saveRewardConfig(config: RewardConfig) {
  localStorage.setItem(REWARD_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export function RewardPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [config, setConfig] = useState<RewardConfig>(() => loadRewardConfig());
  const [editingConfig, setEditingConfig] = useState<RewardConfig>(() => loadRewardConfig());
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<RewardFilter>("rewarded");
  const [query, setQuery] = useState("");
  const report = useElectronData(
    (api) => api.getRewardReport(period, config),
    [period, config]
  );

  const rows = useMemo(() => report.data?.rows ?? [], [report.data?.rows]);
  const waveWinners = useMemo(() => rows.filter((r) => r.waveReward > 0), [rows]);
  const durationWinner = useMemo(
    () => rows.find((r) => r.durationReward > 0) ?? null,
    [rows]
  );
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "rewarded" && row.totalReward <= 0) return false;
      if (filter === "wave" && row.waveReward <= 0) return false;
      if (filter === "duration" && row.durationReward <= 0) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.anchorId.toLowerCase().includes(q)
      );
    });
  }, [filter, query, rows]);

  const exportCsv = () => {
    if (!report.data || rows.length === 0) return;
    const headers = [
      "主播",
      "性别",
      "主播ID",
      "音浪排名",
      "月音浪",
      "音浪档位",
      "音浪奖励",
      "时长排名",
      "月时长(分钟)",
      "时长奖励",
      "合计奖励",
      "月份",
    ];
    const body = rows.map((r) => [
      r.name,
      genderText(r.gender),
      r.anchorId,
      r.waveRank,
      r.wave,
      r.waveRewardLabel,
      r.waveReward,
      r.durationRank,
      r.duration,
      r.durationReward,
      r.totalReward,
      period,
    ]);
    const csv = [headers, ...body]
      .map((line) => line.map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${period}_奖励结算_${rows.length}人.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (report.unavailable) {
    return (
      <Card>
        <CardContent>
          <BrowserModeState />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/70 bg-gradient-to-r from-background via-muted/30 to-background">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
                <Award className="size-5" />
              </div>
              <div>
                <CardTitle className="text-base">奖励机制</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  月度音浪档位与时长冠军结算
                </p>
              </div>
            </div>
            <div className="app-no-drag flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <CalendarDays className="size-4 text-muted-foreground" />
                <input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="bg-transparent text-sm outline-none"
                />
              </div>
              <Button
                variant="outline"
                className="gap-2"
                disabled={!report.data || rows.length === 0}
                onClick={exportCsv}
              >
                <Download className="size-4" />
                导出 CSV
              </Button>
              <Button
                variant={showSettings ? "default" : "outline"}
                className="gap-2"
                onClick={() => {
                  setEditingConfig(config);
                  setShowSettings((v) => !v);
                }}
              >
                <Settings className="size-4" />
                规则设置
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5">
          {showSettings && (
            <RewardSettings
              value={editingConfig}
              onChange={setEditingConfig}
              onReset={() => setEditingConfig(DEFAULT_REWARD_CONFIG)}
              onCancel={() => {
                setEditingConfig(config);
                setShowSettings(false);
              }}
              onSave={() => {
                setConfig(editingConfig);
                saveRewardConfig(editingConfig);
                setShowSettings(false);
              }}
            />
          )}

          {report.loading ? (
            <LoadingState label="正在计算奖励…" />
          ) : report.error ? (
            <ErrorState message={report.error} onRetry={report.reload} />
          ) : !report.data || rows.length === 0 ? (
            <EmptyState label="暂无主播数据" />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] gap-4">
                <div className="rounded-xl border border-border bg-gradient-to-br from-amber-500/10 via-background to-background p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">本月预计奖金</p>
                      <p className="mt-2 text-4xl font-black tracking-normal text-amber-600">
                        {formatMoney(report.data.summary.totalBonus)}
                      </p>
                    </div>
                    <div className="flex size-12 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
                      <Coins className="size-6" />
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <SummaryTile
                      icon={Waves}
                      label="音浪获奖"
                      value={`${report.data.summary.waveWinners} 人`}
                      tone="text-primary"
                    />
                    <SummaryTile
                      icon={Clock}
                      label="时长门槛"
                      value={report.data.summary.durationQualified ? "已达成" : "未达成"}
                      tone={report.data.summary.durationQualified ? "text-emerald-600" : "text-muted-foreground"}
                    />
                    <SummaryTile
                      icon={Trophy}
                      label="时长第一"
                      value={durationWinner ? durationWinner.name : "-"}
                      tone="text-chart-2"
                    />
                  </div>
                </div>

                <RewardFocus
                  waveWinners={waveWinners}
                  durationWinner={durationWinner}
                  durationQualified={report.data.durationRule.qualified}
                />
              </div>

              <RuleSummary
                waveRules={report.data.waveRules}
                thresholdMinutes={report.data.durationRule.thresholdMinutes}
                firstPrize={report.data.durationRule.firstPrize}
              />

              <div className="rounded-xl border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">结算明细</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      当前显示 {filteredRows.length} / {rows.length} 人
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <FilterTabs value={filter} onChange={setFilter} />
                    <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3">
                      <Search className="size-4 text-muted-foreground" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="搜索主播"
                        className="w-36 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>
                </div>
                <RewardTable rows={filteredRows} />
              </div>

              {waveWinners.length === 0 && !durationWinner && (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  当前月份暂无奖励达标主播
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className={`mt-2 truncate text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function FilterTabs({
  value,
  onChange,
}: {
  value: RewardFilter;
  onChange: (value: RewardFilter) => void;
}) {
  const tabs: { id: RewardFilter; label: string }[] = [
    { id: "rewarded", label: "获奖" },
    { id: "all", label: "全部" },
    { id: "wave", label: "音浪" },
    { id: "duration", label: "时长" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            value === tab.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function RewardFocus({
  waveWinners,
  durationWinner,
  durationQualified,
}: {
  waveWinners: RewardRow[];
  durationWinner: RewardRow | null;
  durationQualified: boolean;
}) {
  const topWaveWinners = waveWinners
    .slice()
    .sort((a, b) => b.waveReward - a.waveReward || b.wave - a.wave)
    .slice(0, 4);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Award className="size-4 text-amber-600" />
          <span className="text-sm font-semibold">获奖焦点</span>
        </div>
        <Badge variant={durationQualified ? "default" : "secondary"}>
          {durationQualified ? "时长已达标" : "时长未达标"}
        </Badge>
      </div>
      <div className="space-y-3 p-4">
        {topWaveWinners.length > 0 ? (
          topWaveWinners.map((row) => (
            <div key={row.personId} className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.waveRewardLabel} · {formatWave(row.wave)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-bold text-amber-600">
                {formatMoney(row.waveReward)}
              </span>
            </div>
          ))
        ) : (
          <p className="rounded-lg bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
            暂无音浪奖励
          </p>
        )}

        <div className="rounded-lg border border-border px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 text-chart-2" />
            时长第一
          </div>
          {durationWinner ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{durationWinner.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDuration(durationWinner.duration)}
                </p>
              </div>
              <span className="shrink-0 font-bold text-chart-2">
                {formatMoney(durationWinner.durationReward)}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">全员时长达标后自动产生</p>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleSummary({
  waveRules,
  thresholdMinutes,
  firstPrize,
}: {
  waveRules: RewardConfig["waveRules"];
  thresholdMinutes: number;
  firstPrize: number;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-4">
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Waves className="size-4 text-primary" />
          <span className="text-sm font-semibold">音浪规则</span>
        </div>
        <div className="grid gap-2 p-3 md:grid-cols-3">
          {waveRules.map((rule, index) => (
            <div key={`${rule.label}-${index}`} className="rounded-lg bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{rule.label}</p>
                <span className="shrink-0 text-sm font-bold text-amber-600">
                  {formatMoney(rule.amount)}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatWave(rule.minWave)}
                {rule.maxWave ? ` - ${formatWave(rule.maxWave)}` : " 以上"}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Clock className="size-4 text-chart-2" />
          <span className="text-sm font-semibold">时长规则</span>
        </div>
        <div className="space-y-2 p-3">
          <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">全员门槛</span>
            <span className="text-sm font-semibold">{formatDuration(thresholdMinutes)}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">第一奖励</span>
            <span className="text-sm font-semibold text-amber-600">
              {formatMoney(firstPrize)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RewardSettings({
  value,
  onChange,
  onReset,
  onCancel,
  onSave,
}: {
  value: RewardConfig;
  onChange: (value: RewardConfig) => void;
  onReset: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const updateRule = (
    index: number,
    patch: Partial<RewardConfig["waveRules"][number]>
  ) => {
    onChange({
      ...value,
      waveRules: value.waveRules.map((rule, i) =>
        i === index ? { ...rule, ...patch } : rule
      ),
    });
  };

  const removeRule = (index: number) => {
    if (value.waveRules.length <= 1) return;
    onChange({
      ...value,
      waveRules: value.waveRules.filter((_, i) => i !== index),
    });
  };

  const addRule = () => {
    onChange({
      ...value,
      waveRules: [
        ...value.waveRules,
        { label: "自定义档位", minWave: 0, maxWave: null, amount: 0 },
      ],
    });
  };

  return (
    <div className="mb-5 rounded-xl border border-border bg-muted/25 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">自定义奖励规则</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            修改后会保存为本机默认规则，当前月份会立即按新规则重新计算。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onReset}>
            <RotateCcw className="size-3.5" />
            恢复默认
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" className="gap-1.5" onClick={onSave}>
            <Save className="size-3.5" />
            保存规则
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">音浪档位</span>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={addRule}>
              <Plus className="size-3.5" />
              新增
            </Button>
          </div>
          <div className="space-y-2 p-3">
            {value.waveRules.map((rule, index) => (
              <div
                key={index}
                className="grid grid-cols-[1.1fr_1fr_1fr_0.9fr_auto] items-center gap-2"
              >
                <input
                  value={rule.label}
                  onChange={(e) => updateRule(index, { label: e.target.value })}
                  className="rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  placeholder="档位名称"
                />
                <input
                  type="number"
                  value={rule.minWave}
                  onChange={(e) => updateRule(index, { minWave: Number(e.target.value) || 0 })}
                  className="rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  placeholder="最低音浪"
                />
                <input
                  type="number"
                  value={rule.maxWave ?? ""}
                  onChange={(e) =>
                    updateRule(index, {
                      maxWave: e.target.value === "" ? null : Number(e.target.value) || 0,
                    })
                  }
                  className="rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  placeholder="最高音浪"
                />
                <input
                  type="number"
                  value={rule.amount}
                  onChange={(e) => updateRule(index, { amount: Number(e.target.value) || 0 })}
                  className="rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  placeholder="金额"
                />
                <button
                  onClick={() => removeRule(index)}
                  disabled={value.waveRules.length <= 1}
                  className="flex size-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-destructive hover:text-destructive-foreground disabled:opacity-40"
                  title="删除"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2">
            <span className="text-sm font-medium">时长奖励</span>
          </div>
          <div className="space-y-3 p-3">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">全员超过小时数</span>
              <input
                type="number"
                value={Math.round(value.durationRule.thresholdMinutes / 60)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    durationRule: {
                      ...value.durationRule,
                      thresholdMinutes: (Number(e.target.value) || 0) * 60,
                    },
                  })
                }
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">时长第一奖励金额</span>
              <input
                type="number"
                value={value.durationRule.firstPrize}
                onChange={(e) =>
                  onChange({
                    ...value,
                    durationRule: {
                      ...value.durationRule,
                      firstPrize: Number(e.target.value) || 0,
                    },
                  })
                }
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function RewardTable({ rows }: { rows: RewardRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        没有符合当前筛选条件的主播
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-3 text-left font-medium">主播</th>
            <th className="px-3 py-3 text-center font-medium">音浪排名</th>
            <th className="px-3 py-3 text-right font-medium">月音浪</th>
            <th className="px-3 py-3 text-center font-medium">音浪档位</th>
            <th className="px-3 py-3 text-right font-medium">月时长</th>
            <th className="px-3 py-3 text-center font-medium">时长排名</th>
            <th className="px-3 py-3 text-right font-medium">奖励合计</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.personId} className="border-t border-border/70">
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                    {genderText(row.gender)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.anchorId || "-"}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-center">
                <Badge variant={row.waveRank <= 3 ? "default" : "secondary"}>
                  #{row.waveRank}
                </Badge>
              </td>
              <td className="px-3 py-3 text-right font-medium">{formatWave(row.wave)}</td>
              <td className="px-3 py-3 text-center">
                {row.waveReward > 0 ? (
                  <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15">
                    {row.waveRewardLabel} / {formatMoney(row.waveReward)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </td>
              <td className="px-3 py-3 text-right">{formatDuration(row.duration)}</td>
              <td className="px-3 py-3 text-center">
                <Badge variant={row.durationRank === 1 ? "default" : "outline"}>
                  #{row.durationRank}
                </Badge>
              </td>
              <td className="px-3 py-3 text-right text-base font-bold">
                {row.totalReward > 0 ? formatMoney(row.totalReward) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
