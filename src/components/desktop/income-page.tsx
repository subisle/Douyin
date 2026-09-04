"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  Download,
  FileUp,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getDataApi } from "@/client/http-electron-api";
import { useElectronData } from "./use-electron-data";
import { BrowserModeState, EmptyState, ErrorState, LoadingState } from "./states";
import { formatDuration, formatNumber } from "./format";
import {
  DEFAULT_INCOME_COLUMNS,
  INCOME_EXPORT_COLUMNS,
  exportAnchorIncome,
  type IncomeExportColumnKey,
  type IncomeExportFormat,
  type IncomeExportOptions,
  type IncomeExportScope,
} from "./export-income";
import type {
  AnchorIncomeData,
  AnchorIncomeRow,
  AnchorRow,
  IncomeImportRow,
  IncomePeriodItem,
} from "@/types/electron";

const EXPORT_PREFS_KEY = "income-page-export-prefs";

type GroupFilter = "all" | "female" | "male";

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMoney(value: number) {
  const n = Number(value) || 0;
  if (!n) return "0";
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function genderText(gender: string) {
  if (gender === "male") return "男团";
  if (gender === "female") return "女团";
  return "未分组";
}

function normalizeHeader(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_＿\-—–·.。:：/\\|()[\]{}（）【】<>《》]/g, "");
}

function findColumn(headers: string[], names: string[]) {
  const targets = names.map(normalizeHeader);
  return headers.find((h) => targets.includes(normalizeHeader(h)));
}

/** 清洗 Excel 导出的 ="123" 包裹 */
function cleanCell(value: unknown) {
  let text = String(value ?? "").trim();
  text = text.replace(/^="(.*)"$/, "$1").replace(/^=(.*)$/, "$1").trim();
  return text === "-" || text === "—" ? "" : text;
}

function parseMoneyCell(value: unknown) {
  const text = cleanCell(value).replace(/,/g, "");
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

interface ParsedIncomeFile {
  fileName: string;
  rows: IncomeImportRow[];
  totalRows: number;
  skipped: number;
}

async function parseIncomeCsv(file: File): Promise<ParsedIncomeFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = Object.keys(results.data[0] ?? {});
        const col = (...names: string[]) => findColumn(headers, names);
        const uidCol = col("主播UID", "主播uid", "主播ID", "主播id", "UID", "uid");
        const douyinCol = col("主播抖音号", "抖音号", "抖音ID");
        const nickCol = col("主播昵称", "主播名称", "昵称", "主播名");
        const dateCol = col("起止日期", "结算周期", "周期");
        const revenueCol = col("本期流水（元）", "本期流水", "流水", "本期流水(元)");
        const streamerRatioCol = col("主播分成比", "主播分成比例");
        const guildRatioCol = col("公会分成比", "公会分成比例");
        const streamerIncomeCol = col("主播收入（元）", "主播收入", "本期主播收入");
        const guildIncomeCol = col("公会收入（元）", "公会收入");
        const incomeNameCol = col("收入名称");
        const feeTypeCol = col("费用类型");
        const remarkCol = col("备注");

        const rows: IncomeImportRow[] = [];
        let skipped = 0;
        for (const raw of results.data) {
          const anchorId = cleanCell(uidCol ? raw[uidCol] : "");
          if (!anchorId) {
            skipped += 1;
            continue;
          }
          rows.push({
            anchorId,
            douyinNo: cleanCell(douyinCol ? raw[douyinCol] : ""),
            nickname: cleanCell(nickCol ? raw[nickCol] : ""),
            dateRange: cleanCell(dateCol ? raw[dateCol] : ""),
            incomeName: cleanCell(incomeNameCol ? raw[incomeNameCol] : ""),
            feeType: cleanCell(feeTypeCol ? raw[feeTypeCol] : ""),
            revenue: parseMoneyCell(revenueCol ? raw[revenueCol] : ""),
            streamerRatio: cleanCell(streamerRatioCol ? raw[streamerRatioCol] : ""),
            guildRatio: cleanCell(guildRatioCol ? raw[guildRatioCol] : ""),
            streamerIncome: parseMoneyCell(streamerIncomeCol ? raw[streamerIncomeCol] : ""),
            guildIncome: parseMoneyCell(guildIncomeCol ? raw[guildIncomeCol] : ""),
            remark: cleanCell(remarkCol ? raw[remarkCol] : ""),
          });
        }
        resolve({ fileName: file.name, rows, totalRows: results.data.length, skipped });
      },
      error: (err) => reject(err),
    });
  });
}

/** 用现有主播档案给导入行做匹配（主播UID → 抖音号 → 昵称） */
function buildMatchers(anchors: AnchorRow[]) {
  const byId = new Map<string, AnchorRow>();
  const byDouyin = new Map<string, AnchorRow>();
  const byNickname = new Map<string, AnchorRow>();
  const dupNickname = new Set<string>();
  for (const a of anchors) {
    if (a.anchorId) byId.set(a.anchorId, a);
    if (a.douyinNo) byDouyin.set(a.douyinNo, a);
    const nm = (a.anchorName || "").trim();
    if (nm) {
      if (byNickname.has(nm)) dupNickname.add(nm);
      else byNickname.set(nm, a);
    }
  }
  return { byId, byDouyin, byNickname, dupNickname };
}

function matchRow(row: IncomeImportRow, matchers: ReturnType<typeof buildMatchers>) {
  return (
    (row.anchorId ? matchers.byId.get(row.anchorId) : undefined) ||
    (row.douyinNo ? matchers.byDouyin.get(row.douyinNo) : undefined) ||
    (row.nickname && !matchers.dupNickname.has(row.nickname)
      ? matchers.byNickname.get(row.nickname)
      : undefined) ||
    null
  );
}

interface ExportPrefs {
  format: IncomeExportFormat;
  scope: IncomeExportScope;
  columns: IncomeExportColumnKey[];
  company: string;
  withTitle: boolean;
  markNotLive: boolean;
}

const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  format: "xlsx",
  scope: "combined",
  columns: DEFAULT_INCOME_COLUMNS,
  company: "鹏仔传媒",
  withTitle: true,
  markNotLive: true,
};

function loadExportPrefs(): ExportPrefs {
  if (typeof window === "undefined") return DEFAULT_EXPORT_PREFS;
  try {
    const raw = localStorage.getItem(EXPORT_PREFS_KEY);
    if (!raw) return DEFAULT_EXPORT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ExportPrefs>;
    const columns = Array.isArray(parsed.columns)
      ? parsed.columns.filter((key): key is IncomeExportColumnKey =>
          INCOME_EXPORT_COLUMNS.some((col) => col.key === key)
        )
      : DEFAULT_INCOME_COLUMNS;
    return {
      ...DEFAULT_EXPORT_PREFS,
      ...parsed,
      columns: columns.length ? columns : DEFAULT_INCOME_COLUMNS,
    };
  } catch {
    return DEFAULT_EXPORT_PREFS;
  }
}

function saveExportPrefs(prefs: ExportPrefs) {
  localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(prefs));
}

/* ------------------------------ 弹层 ------------------------------ */

function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ 主页面 ------------------------------ */

export function IncomePage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [group, setGroup] = useState<GroupFilter>("all");
  const [query, setQuery] = useState("");
  const [onlyWithIncome, setOnlyWithIncome] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editing, setEditing] = useState<AnchorIncomeRow | null>(null);

  const income = useElectronData((api) => api.getAnchorIncome(period), [period]);
  const anchors = useElectronData((api) => api.getAnchors(), []);
  const periods = useElectronData((api) => api.getIncomePeriods(), [period]);

  const rows = useMemo(() => income.data?.rows ?? [], [income.data?.rows]);
  const anchorList = useMemo(() => anchors.data ?? [], [anchors.data]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (group !== "all" && row.gender !== group) return false;
      if (onlyWithIncome && !row.hasIncome && row.totalIncome <= 0) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.nickname.toLowerCase().includes(q) ||
        row.douyinNo.toLowerCase().includes(q)
      );
    });
  }, [group, onlyWithIncome, query, rows]);

  if (income.unavailable) {
    return (
      <Card>
        <CardContent>
          <BrowserModeState />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">主播收入</h3>
          <Badge variant="outline" className="font-mono text-[11px]">
            {period}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-8 w-[140px]"
          />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => income.reload()}>
            <RotateCcw className="size-3.5" />
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setImportOpen(true)}
          >
            <FileUp className="size-3.5" />
            导入明细
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setExportOpen(true)}>
            <Download className="size-3.5" />
            导出
          </Button>
        </div>
      </div>

      {periods.data && periods.data.length > 0 && (
        <PeriodQuickPick
          periods={periods.data}
          current={period}
          onPick={(next) => setPeriod(next)}
        />
      )}

      {message && (
        <Card className="border-chart-2/40">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-chart-2">
            <CheckCircle2 className="size-4" />
            {message}
          </CardContent>
        </Card>
      )}
      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </CardContent>
        </Card>
      )}

      <SummaryCards data={income.data} />

      {income.data && income.data.orphans.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="flex flex-wrap items-center gap-2 py-3 text-sm text-amber-700">
            <AlertTriangle className="size-4" />
            <span>
              有 {income.data.orphans.length} 行收入未匹配到主播（共 ¥
              {formatNumber(
                income.data.orphans.reduce((sum, o) => sum + (Number(o.streamerIncome) || 0), 0)
              )}
              ），先在「主播」页补录账号，再重新导入即可归并。
            </span>
            <span className="text-xs text-muted-foreground">
              {income.data.orphans
                .slice(0, 6)
                .map((o) => o.nickname || o.anchorId)
                .join("、")}
              {income.data.orphans.length > 6 ? " …" : ""}
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {(
                [
                  ["all", "全部"],
                  ["female", "女团"],
                  ["male", "男团"],
                ] as [GroupFilter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setGroup(key)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition",
                    group === key
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索主播 / 昵称 / 抖音号"
                className="h-8 w-[220px] pl-8"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyWithIncome}
                onChange={(e) => setOnlyWithIncome(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              只看本期有收入 / 有累计
            </label>
            <span className="ml-auto text-xs text-muted-foreground">
              共 {filteredRows.length} 人
            </span>
          </div>

          {income.loading ? (
            <LoadingState label="加载收入数据…" />
          ) : income.error ? (
            <ErrorState message={income.error} onRetry={income.reload} />
          ) : filteredRows.length === 0 ? (
            <EmptyState label="该月份暂无收入数据，先导入平台导出的个人明细" />
          ) : (
            <IncomeTable rows={filteredRows} onEdit={(row) => setEditing(row)} />
          )}
        </CardContent>
      </Card>

      {importOpen && (
        <ImportDialog
          period={period}
          anchors={anchorList}
          onClose={() => setImportOpen(false)}
          onDone={(msg) => {
            setImportOpen(false);
            setMessage(msg);
            income.reload();
            periods.reload();
          }}
        />
      )}

      {exportOpen && income.data && (
        <ExportDialog
          period={period}
          rows={rows}
          onClose={() => setExportOpen(false)}
          onDone={(msg) => {
            setExportOpen(false);
            setMessage(msg);
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {editing && (
        <ProfileDialog
          row={editing}
          period={period}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            income.reload();
            periods.reload();
            setMessage("已保存");
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------ 子组件 ------------------------------ */

function PeriodQuickPick({
  periods,
  current,
  onPick,
}: {
  periods: IncomePeriodItem[];
  current: string;
  onPick: (period: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">已导入：</span>
      {periods.map((item) => (
        <button
          key={item.period}
          type="button"
          onClick={() => onPick(item.period)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
            item.period === current
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
          )}
        >
          {item.period} · {item.rowCount} 行
        </button>
      ))}
    </div>
  );
}

function SummaryCards({ data }: { data: AnchorIncomeData | null }) {
  const summary = data?.summary;
  const items = [
    { label: "主播总数", value: formatNumber(summary?.total ?? 0), icon: Users },
    { label: "本期有收入", value: formatNumber(summary?.incomeCount ?? 0), icon: Coins },
    { label: "本期流水", value: `¥${formatNumber(summary?.totalRevenue ?? 0)}`, icon: Coins },
    {
      label: "主播收入",
      value: `¥${formatNumber(summary?.totalStreamerIncome ?? 0)}`,
      icon: Coins,
    },
    { label: "公会收入", value: `¥${formatNumber(summary?.totalGuildIncome ?? 0)}`, icon: Coins },
    {
      label: "本期时长",
      value: formatDuration(summary?.totalDuration ?? 0),
      icon: Clock,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.label}>
            <CardContent className="flex items-center gap-2 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[11px] text-muted-foreground">{item.label}</p>
                <p className="truncate text-sm font-semibold">{item.value}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function IncomeTable({
  rows,
  onEdit,
}: {
  rows: AnchorIncomeRow[];
  onEdit: (row: AnchorIncomeRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1080px] text-xs">
        <thead className="bg-secondary/60 text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left font-medium">主播</th>
            <th className="px-2 py-2 text-left font-medium">昵称</th>
            <th className="px-2 py-2 text-left font-medium">入会时间</th>
            <th className="px-2 py-2 text-right font-medium">本期时长</th>
            <th className="px-2 py-2 text-right font-medium">本期流水</th>
            <th className="px-2 py-2 text-center font-medium">分成比</th>
            <th className="px-2 py-2 text-right font-medium">本期个人收益</th>
            <th className="px-2 py-2 text-right font-medium">公会收入</th>
            <th className="px-2 py-2 text-right font-medium">上期收益</th>
            <th className="px-2 py-2 text-right font-medium">个人总收益</th>
            <th className="px-2 py-2 text-center font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.personId} className="border-t border-border/70 hover:bg-secondary/40">
              <td className="px-2 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{row.name}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "px-1.5 py-0 text-[10px]",
                      row.gender === "female"
                        ? "border-pink-300 text-pink-600"
                        : "border-sky-300 text-sky-600"
                    )}
                  >
                    {genderText(row.gender)}
                  </Badge>
                </div>
              </td>
              <td className="max-w-[180px] truncate px-2 py-2 text-muted-foreground">
                {row.nickname || "-"}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                {row.joinDate || "-"}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right">
                {row.durationMinutes > 0 ? formatDuration(row.durationMinutes) : "-"}
              </td>
              <td className="px-2 py-2 text-right">{row.hasIncome ? formatMoney(row.revenue) : "-"}</td>
              <td className="whitespace-nowrap px-2 py-2 text-center text-muted-foreground">
                {row.streamerRatio || "-"}
              </td>
              <td className="px-2 py-2 text-right font-medium">
                {row.hasIncome ? formatMoney(row.streamerIncome) : "-"}
              </td>
              <td className="px-2 py-2 text-right text-muted-foreground">
                {row.hasIncome ? formatMoney(row.guildIncome) : "-"}
              </td>
              <td className="px-2 py-2 text-right text-muted-foreground">
                {formatMoney(row.prevIncome)}
              </td>
              <td className="px-2 py-2 text-right font-semibold">{formatMoney(row.totalIncome)}</td>
              <td className="px-2 py-2 text-center">
                <button
                  type="button"
                  onClick={() => onEdit(row)}
                  className="rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  title="编辑入会时间 / 期初累计"
                >
                  <Pencil className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportDialog({
  period,
  anchors,
  onClose,
  onDone,
}: {
  period: string;
  anchors: AnchorRow[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedIncomeFile | null>(null);
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [replace, setReplace] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const matchers = useMemo(() => buildMatchers(anchors), [anchors]);
  const resolved = useMemo(() => {
    if (!parsed) return null;
    const matched: { row: IncomeImportRow; anchor: AnchorRow }[] = [];
    const unmatched: { index: number; row: IncomeImportRow }[] = [];
    parsed.rows.forEach((row, index) => {
      const assigned = assignments[index];
      if (assigned) {
        const anchor = anchors.find((a) => String(a.id) === assigned);
        if (anchor) {
          matched.push({ row, anchor });
          return;
        }
      }
      const hit = matchRow(row, matchers);
      if (hit) matched.push({ row, anchor: hit });
      else unmatched.push({ index, row });
    });
    return { matched, unmatched };
  }, [anchors, assignments, matchers, parsed]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setParsing(true);
    try {
      const result = await parseIncomeCsv(file);
      if (result.rows.length === 0) throw new Error("没有解析到有效行，请确认文件包含「主播UID」列");
      setParsed(result);
      setAssignments({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (!parsed || !resolved) return;
    const api = getDataApi();
    if (!api?.importAnchorIncome) {
      setError("当前环境不支持导入，请用桌面端打开");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const rows = parsed.rows.map((row, index) => {
        const assigned = assignments[index];
        if (assigned) return { ...row, personId: Number(assigned) };
        return row;
      });
      const res = await api.importAnchorIncome({ period, rows, replace });
      if (!res.success) throw new Error(res.error);
      const { saved, matched, unmatched } = res.data;
      const orphans = unmatched.length;
      onDone(
        `已导入 ${saved} 行（覆盖模式：${replace ? "是" : "否"}），匹配主播 ${matched} 行` +
          (orphans ? `，${orphans} 行未匹配到主播` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`导入 ${period} 个人明细`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={!parsed || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            确认导入
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div
          data-import-drop-zone="true"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-7 text-center transition hover:border-primary/50"
        >
          <FileUp className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">点击选择或拖入 CSV</p>
          <p className="text-xs text-muted-foreground">
            平台导出的「个人明细」，需包含：主播UID、主播昵称、本期流水、主播收入（元）
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>

        {parsing && <LoadingState label="解析文件…" />}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </div>
        )}

        {parsed && resolved && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{parsed.fileName}</Badge>
              <Badge variant="outline">有效 {parsed.rows.length} 行</Badge>
              {parsed.skipped > 0 && (
                <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15">
                  跳过 {parsed.skipped}
                </Badge>
              )}
              <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">
                已匹配 {resolved.matched.length}
              </Badge>
              {resolved.unmatched.length > 0 && (
                <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15">
                  待指派 {resolved.unmatched.length}
                </Badge>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              覆盖该月已有数据（取消勾选则只追加/更新匹配到的账号）
            </label>

            {resolved.unmatched.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium">未匹配到主播的行 — 可手工指派</p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
                  {resolved.unmatched.map(({ index, row }) => (
                    <div
                      key={`${row.anchorId}-${index}`}
                      className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/40 px-2 py-1.5"
                    >
                      <span className="max-w-[190px] truncate text-xs font-medium">
                        {row.nickname || row.anchorId}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {row.anchorId}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ¥{formatNumber(Number(row.streamerIncome ?? 0))}
                      </span>
                      <select
                        value={assignments[index] ?? ""}
                        onChange={(e) =>
                          setAssignments((prev) => ({ ...prev, [index]: e.target.value }))
                        }
                        className="ml-auto h-7 rounded-md border border-border bg-card px-2 text-xs"
                      >
                        <option value="">不指派（按未匹配导入）</option>
                        {anchors.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                            {a.anchorName && a.anchorName !== a.name ? `（${a.anchorName}）` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function ExportDialog({
  period,
  rows,
  onClose,
  onDone,
  onError,
}: {
  period: string;
  rows: AnchorIncomeRow[];
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [prefs, setPrefs] = useState<ExportPrefs>(() => loadExportPrefs());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    saveExportPrefs(prefs);
  }, [prefs]);

  const toggleColumn = (key: IncomeExportColumnKey) => {
    setPrefs((prev) => ({
      ...prev,
      columns: prev.columns.includes(key)
        ? prev.columns.filter((k) => k !== key)
        : [...prev.columns, key],
    }));
  };

  const run = async () => {
    setBusy(true);
    try {
      const result = await exportAnchorIncome({ period, rows }, prefs as IncomeExportOptions);
      onDone(
        `已导出 ${result.rowCount} 行：${result.files.join("、")}`
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const scopeOptions: [IncomeExportScope, string, string][] = [
    ["combined", "男女一起", "CSV 单文件 / XLSX 单工作簿双 Sheet"],
    ["separate", "男女分开", "按女团、男团各导出一个文件"],
    ["female", "仅女团", "只导出女团"],
    ["male", "仅男团", "只导出男团"],
  ];

  return (
    <Modal
      title={`导出 ${period} 个人收入明细`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={run} disabled={busy || prefs.columns.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            导出
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium">文件格式</p>
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["csv", "xlsx"] as IncomeExportFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setPrefs((prev) => ({ ...prev, format: fmt }))}
                className={cn(
                  "px-4 py-1.5 text-xs font-medium uppercase transition",
                  prefs.format === fmt
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-secondary"
                )}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium">导出范围</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {scopeOptions.map(([key, label, desc]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPrefs((prev) => ({ ...prev, scope: key }))}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition",
                  prefs.scope === key
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                )}
              >
                <p className="text-xs font-medium">{label}</p>
                <p className="text-[11px] text-muted-foreground">{desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">导出列</p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPrefs((prev) => ({ ...prev, columns: DEFAULT_INCOME_COLUMNS }))}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                样例版式（同模板）
              </button>
              <button
                type="button"
                onClick={() =>
                  setPrefs((prev) => ({
                    ...prev,
                    columns: INCOME_EXPORT_COLUMNS.map((c) => c.key),
                  }))
                }
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                全选
              </button>
            </div>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {INCOME_EXPORT_COLUMNS.map((col) => (
              <label
                key={col.key}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
              >
                <input
                  type="checkbox"
                  checked={prefs.columns.includes(col.key)}
                  onChange={() => toggleColumn(col.key)}
                  className="size-3.5 accent-primary"
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium">其它</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              公司抬头
              <Input
                value={prefs.company}
                onChange={(e) => setPrefs((prev) => ({ ...prev, company: e.target.value }))}
                className="h-7 w-[160px]"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={prefs.withTitle}
                onChange={(e) => setPrefs((prev) => ({ ...prev, withTitle: e.target.checked }))}
                className="size-3.5 accent-primary"
              />
              首行加标题
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={prefs.markNotLive}
                onChange={(e) => setPrefs((prev) => ({ ...prev, markNotLive: e.target.checked }))}
                className="size-3.5 accent-primary"
              />
              无收入记「没播」
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            文件名示例：{prefs.company || "鹏仔传媒"}
            {period.slice(0, 4)}年{Number(period.slice(5, 7))}月_
            {prefs.scope === "female" ? "女团" : prefs.scope === "male" ? "男团" : "个人"}
            收入明细.{prefs.format}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function ProfileDialog({
  row,
  period,
  onClose,
  onSaved,
}: {
  row: AnchorIncomeRow;
  period: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [joinDate, setJoinDate] = useState(row.joinDate);
  const [openingTotal, setOpeningTotal] = useState(String(row.openingTotal ?? 0));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const api = getDataApi();
    if (!api?.saveAnchorIncomeProfile) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.saveAnchorIncomeProfile({
        personId: row.personId,
        joinDate,
        openingTotal: Number(openingTotal) || 0,
      });
      if (!res.success) throw new Error(res.error);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const api = getDataApi();
    if (!api?.deleteAnchorIncome) return;
    if (!window.confirm(`确定清空 ${row.name} 在本期的收入记录？`)) return;
    setDeleting(true);
    try {
      const res = await api.deleteAnchorIncome(period, [row.personId]);
      if (!res.success) throw new Error(res.error);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      title={`${row.name} · 收入档案`}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={remove}
            disabled={saving || deleting || !row.hasIncome}
            className="mr-auto gap-1.5 text-destructive"
          >
            <Trash2 className="size-3.5" />
            清空本期
          </Button>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">入会时间</label>
          <Input
            value={joinDate}
            onChange={(e) => setJoinDate(e.target.value)}
            placeholder="如 2023年/4/5"
          />
          <p className="text-[11px] text-muted-foreground">按原文填写，仅用于导出展示</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">期初累计个人收益</label>
          <Input
            value={openingTotal}
            onChange={(e) => setOpeningTotal(e.target.value)}
            inputMode="decimal"
          />
          <p className="text-[11px] text-muted-foreground">
            个人总收益 = 期初累计 + 系统内已导入的各期收益之和（当前合计 {formatMoney(row.totalIncome)}）
          </p>
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
