"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  AlertCircle,
  BadgeInfo,
  CheckCircle2,
  ChevronRight,
  CloudDownload,
  Database,
  Download,
  FileImage,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AppInfo, StartupHealthResult, UpdateStatus } from "@/types/electron";
import type { PageId } from "./types";

const FALLBACK_UPDATE: UpdateStatus = {
  status: "idle",
  info: null,
  progress: null,
  error: null,
};

const UPDATE_TEXT: Record<UpdateStatus["status"], string> = {
  idle: "等待检查",
  checking: "正在检查",
  available: "发现新版本",
  "not-available": "已是最新",
  downloading: "正在下载",
  downloaded: "更新已下载",
  error: "检查失败",
};

export function SettingsPage() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [health, setHealth] = useState<StartupHealthResult | null>(null);
  const [healthError, setHealthError] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(FALLBACK_UPDATE);
  const [busyAction, setBusyAction] = useState<"check" | "download" | "install" | "health" | null>(null);
  const [message, setMessage] = useState("");
  const [showAbout, setShowAbout] = useState(false);

  const api = getDataApi();
  const isElectron = Boolean(api);

  useEffect(() => {
    if (!api) return;
    void api.getAppInfo?.().then(setAppInfo).catch(() => undefined);
    void refreshHealth();
    void api.getUpdateStatus().then((res) => {
      if (res.success) setUpdateStatus(res.data);
    });
    return api.onUpdateStatus((status) => setUpdateStatus(status));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshHealth() {
    if (!api?.getStartupHealth) {
      setHealthError("浏览器预览模式，无法读取数据库状态");
      return;
    }
    setBusyAction("health");
    setHealthError("");
    try {
      const res = await api.getStartupHealth();
      if (res.success) setHealth(res.data);
      else setHealthError(res.error || "状态检查失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function runUpdateAction(action: "check" | "download" | "install") {
    if (!api) return;
    setBusyAction(action);
    setMessage("");
    try {
      const res =
        action === "check"
          ? await api.checkForUpdates()
          : action === "download"
            ? await api.downloadUpdate()
            : await api.installUpdate();
      if (!res.success) {
        setMessage(res.error || "操作失败");
        return;
      }
      const latest = await api.getUpdateStatus();
      if (latest.success) setUpdateStatus(latest.data);
      setMessage(action === "install" ? "正在重启安装更新" : "操作完成");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-sm">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-8 h-px w-2/3 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
              <Sparkles className="size-3" />
              系统设置
            </Badge>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">鹏仔传媒 · 主播数据管理系统</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                我建议设置页先放高频维护功能：更新检查、数据库状态、导入导出入口、关于信息。后续再加主题和导出默认参数。
              </p>
            </div>
          </div>
          <Button onClick={() => setShowAbout(true)} className="rounded-full">
            <Info className="size-4" />
            关于软件
          </Button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden border-border/70">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CloudDownload className="size-4 text-primary" />
                检查更新
              </CardTitle>
              <StatusBadge status={updateStatus.status === "error" ? "error" : updateStatus.status === "available" || updateStatus.status === "downloaded" ? "warning" : "ok"}>
                {UPDATE_TEXT[updateStatus.status]}
              </StatusBadge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{getUpdateTitle(updateStatus)}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    当前 v{appInfo?.version || "-"} · {updateStatus.feed || "自动线路"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runUpdateAction("check")}
                    disabled={!isElectron || busyAction !== null || updateStatus.status === "checking"}
                  >
                    {busyAction === "check" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    检查
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => runUpdateAction("download")}
                    disabled={!isElectron || busyAction !== null || updateStatus.status !== "available"}
                  >
                    {busyAction === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    下载
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => runUpdateAction("install")}
                    disabled={!isElectron || busyAction !== null || updateStatus.status !== "downloaded"}
                  >
                    安装
                  </Button>
                </div>
              </div>
              {updateStatus.status === "downloading" && updateStatus.progress && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>下载中</span>
                    <span>{Math.round(updateStatus.progress.percent)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.max(2, Math.min(100, updateStatus.progress.percent))}%` }}
                    />
                  </div>
                </div>
              )}
              {(message || updateStatus.error) && (
                <div className="text-xs text-muted-foreground">{message || updateStatus.error}</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="size-4 text-primary" />
                数据状态
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={refreshHealth}
                disabled={busyAction !== null}
                className="rounded-full"
              >
                {busyAction === "health" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                刷新
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {health ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <InfoTile label="主播人数" value={`${health.counts.persons}`} />
                  <InfoTile label="账号数量" value={`${health.counts.accounts}`} />
                  <InfoTile label="音浪记录" value={`${health.counts.waveSnapshots}`} />
                  <InfoTile label="时长记录" value={`${health.counts.durationSnapshots}`} />
                </div>
                <div className="space-y-2">
                  {health.checks.slice(0, 4).map((check) => (
                    <div key={check.key} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{check.label}</div>
                        <div className="truncate text-xs text-muted-foreground">{check.detail}</div>
                      </div>
                      <StatusBadge status={check.status}>{check.status === "ok" ? "正常" : check.status === "warning" ? "注意" : "异常"}</StatusBadge>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {healthError || "正在读取状态..."}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <QuickAction
          icon={UploadCloud}
          title="导入数据"
          desc="拖入文件后预览日期、音浪、时长变化。"
          page="data"
        />
        <QuickAction
          icon={FileImage}
          title="导出图片"
          desc="每日报告、PK名单、族谱海报统一从这里进入。"
          page="data"
        />
        <QuickAction
          icon={ShieldCheck}
          title="主播维护"
          desc="修改姓名、师傅、账号合并和补数据。"
          page="anchors"
        />
      </div>

      {showAbout && (
        <AboutDialog appInfo={appInfo} onClose={() => setShowAbout(false)} />
      )}
    </div>
  );
}

function StatusBadge({
  status,
  children,
}: {
  status: "ok" | "warning" | "error";
  children: ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0",
        status === "ok" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
        status === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-700",
        status === "error" && "border-red-500/30 bg-red-500/10 text-red-700"
      )}
    >
      {status === "ok" ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
      {children}
    </Badge>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  title,
  desc,
  page,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  page: PageId;
}) {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("app:navigate", { detail: page }))}
      className="group flex items-center gap-4 rounded-3xl border border-border/70 bg-card/80 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{desc}</div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

function AboutDialog({ appInfo, onClose }: { appInfo: AppInfo | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/55 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <BadgeInfo className="size-4 text-primary" />
            关于软件
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-3xl bg-gradient-to-br from-primary/12 to-transparent p-5">
            <div className="text-xl font-semibold">鹏仔传媒</div>
            <div className="mt-1 text-sm text-muted-foreground">主播数据管理系统</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InfoTile label="版本" value={appInfo?.version ? `v${appInfo.version}` : "未知"} />
            <InfoTile label="平台" value={appInfo ? `${appInfo.platform}/${appInfo.arch}` : "未知"} />
            <InfoTile label="Electron" value={appInfo?.electron || "未知"} />
            <InfoTile label="更新代理" value={appInfo?.updateProxy || "akams"} />
          </div>
          <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            内部数据工具，仅用于主播数据维护、报告导出和分组管理。
          </div>
        </div>
      </div>
    </div>
  );
}

function getUpdateTitle(status: UpdateStatus) {
  if (status.status === "available") {
    return status.info?.version ? `新版本 v${status.info.version}` : "发现新版本";
  }
  if (status.status === "downloaded") {
    return "更新已下载";
  }
  if (status.status === "downloading") {
    return "正在下载";
  }
  if (status.status === "error") {
    return "检查失败";
  }
  if (status.status === "not-available") {
    return "已是最新版本";
  }
  if (status.status === "checking") {
    return "正在检查";
  }
  return "手动检查更新";
}
