"use client";

import { useState, useEffect } from "react";
import { FileUp } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { DashboardPage } from "./dashboard-page";
import { AnchorsPage } from "./anchors-page";
import { FamilyTreePage } from "./family-tree-page";
import { DataPage } from "./data-page";
import { FlowingFlagCard } from "./flowing-flag-card";
import { PkRosterPage } from "./pk-roster-page";
import { RewardPage } from "./reward-page";
import { type PageId } from "./types";
import type { DroppedImportFile } from "./import-page";

type StartupCheckStatus = "checking" | "ok" | "warning" | "error";

interface StartupCheck {
  key: "core" | "data" | "update";
  label: string;
  status: StartupCheckStatus;
  detail: string;
}

type UpdateStartupCheck = (key: StartupCheck["key"], patch: Partial<StartupCheck>) => void;

const STARTUP_ANIMATION_MS = 2600;
const STARTUP_SETTLE_MS = 450;
const STARTUP_DATA_TIMEOUT_MS = 6500;
const STARTUP_UPDATE_TIMEOUT_MS = 4500;

export function DesktopShell() {
  const [currentPage, setCurrentPage] = useState<PageId>("datacenter");
  const [collapsed, setCollapsed] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [showStartup, setShowStartup] = useState(true);
  const [droppedImportFile, setDroppedImportFile] = useState<DroppedImportFile | null>(null);

  useEffect(() => {
    let cancelled = false;
    const updateCheck: UpdateStartupCheck = () => {
      // 启动检查保留后台执行，启动界面只展示品牌文字。
    };

    const run = async () => {
      const animation = wait(STARTUP_ANIMATION_MS);
      await Promise.all([
        animation,
        runStartupChecks(updateCheck),
      ]);
      await wait(STARTUP_SETTLE_MS);
      if (!cancelled) setShowStartup(false);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // 监听来自仪表盘快捷按钮的导航事件
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail && e.detail !== currentPage) {
        setCurrentPage(e.detail);
      }
    };
    window.addEventListener("app:navigate", handler as EventListener);
    return () => window.removeEventListener("app:navigate", handler as EventListener);
  }, [currentPage]);

  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const isImportDropZone = (event: DragEvent) => {
      const target = event.target;
      return target instanceof Element && Boolean(target.closest("[data-import-drop-zone='true']"));
    };
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      setDraggingFile(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDraggingFile(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      setDraggingFile(false);
      if (isImportDropZone(event)) return;
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      setDroppedImportFile({ id: Date.now(), file });
      setCurrentPage("data");
    };

    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);

  if (showStartup) {
    return <StartupSplash />;
  }

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="absolute -left-20 top-10 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-24 bottom-0 size-80 rounded-full bg-chart-2/10 blur-3xl" />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <Topbar currentPage={currentPage} />

        <div className="flex min-h-0 flex-1">
          <Sidebar
            currentPage={currentPage}
            collapsed={collapsed}
            onNavigate={setCurrentPage}
            onToggle={() => setCollapsed((v) => !v)}
          />

          <ScrollArea className="min-w-0 flex-1">
            <main className="mx-auto max-w-7xl p-5 md:p-8">
              {currentPage === "datacenter" ? (
                <DashboardPage />
              ) : currentPage === "anchors" ? (
                <AnchorsPage />
              ) : currentPage === "family-tree" ? (
                <FamilyTreePage />
              ) : currentPage === "data" ? (
                <DataPage
                  incomingFile={droppedImportFile}
                  onIncomingFileConsumed={() => setDroppedImportFile(null)}
                />
              ) : currentPage === "flag" ? (
                <FlowingFlagCard />
              ) : currentPage === "pk" ? (
                <PkRosterPage />
              ) : currentPage === "reward" ? (
                <RewardPage />
              ) : null}
            </main>
          </ScrollArea>
        </div>
      </div>
      {draggingFile && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex min-w-80 flex-col items-center gap-3 rounded-xl border border-primary/40 bg-card px-8 py-7 shadow-2xl">
            <FileUp className="size-9 text-primary" />
            <div className="text-sm font-semibold">松开后进入数据导入预览</div>
            <div className="text-xs text-muted-foreground">默认导入前一天，可在预览中修改日期</div>
          </div>
        </div>
      )}
    </div>
  );
}

function StartupSplash() {
  return (
    <div className="startup-splash pointer-events-none fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      <div className="startup-wordmark relative flex w-full max-w-4xl flex-col items-center px-8 text-center">
        <div className="startup-title startup-text-effect text-6xl font-semibold md:text-8xl">
          鹏仔传媒
        </div>
        <div className="startup-subtitle startup-subtitle-effect mt-7 text-xl font-semibold md:text-2xl">
          主播数据管理系统
        </div>
      </div>
    </div>
  );
}

async function runStartupChecks(updateCheck: UpdateStartupCheck) {
  updateCheck("core", { status: "ok", detail: "应用资源已就绪" });

  await Promise.allSettled([
    checkStartupData(updateCheck),
    checkStartupUpdate(updateCheck),
  ]);
}

async function checkStartupData(
  updateCheck: UpdateStartupCheck
) {
  const api = window.electronAPI;
  if (!api?.getStartupHealth) {
    updateCheck("data", { status: "warning", detail: "浏览器预览模式，已跳过数据库检查" });
    return;
  }

  try {
    const result = await withTimeout(
      api.getStartupHealth(),
      STARTUP_DATA_TIMEOUT_MS,
      "数据检查超时"
    );
    if (!result.success) {
      updateCheck("data", { status: "error", detail: result.error || "数据库检查失败" });
      return;
    }

    const health = result.data;
    const issue =
      health.checks.find((check) => check.status === "error") ??
      health.checks.find((check) => check.status === "warning");
    const baseDetail = `主播 ${health.counts.persons} 人，账号 ${health.counts.accounts} 个`;
    updateCheck("data", {
      status: health.status,
      detail: issue ? `${baseDetail}，${issue.detail}` : `${baseDetail}，数据正常`,
    });
  } catch (error) {
    updateCheck("data", { status: "error", detail: getErrorMessage(error) });
  }
}

async function checkStartupUpdate(
  updateCheck: UpdateStartupCheck
) {
  const api = window.electronAPI;
  if (!api?.checkForUpdates) {
    updateCheck("update", { status: "warning", detail: "浏览器预览模式，已跳过更新检查" });
    return;
  }

  try {
    const checkResult = await withTimeout(
      api.checkForUpdates(),
      STARTUP_UPDATE_TIMEOUT_MS,
      "更新检查超时"
    );
    if (!checkResult.success) {
      updateCheck("update", { status: "warning", detail: checkResult.error || "更新检查失败" });
      return;
    }

    const statusResult = await api.getUpdateStatus?.();
    const updateStatus = statusResult?.success ? statusResult.data : null;
    if (updateStatus?.status === "available") {
      updateCheck("update", {
        status: "warning",
        detail: updateStatus.info?.version ? `发现新版本 ${updateStatus.info.version}` : "发现新版本",
      });
      return;
    }
    if (updateStatus?.status === "downloaded") {
      updateCheck("update", { status: "warning", detail: "新版本已下载，进入后可安装" });
      return;
    }
    if (updateStatus?.status === "error") {
      updateCheck("update", { status: "warning", detail: updateStatus.error || "更新检查失败" });
      return;
    }

    updateCheck("update", {
      status: "ok",
      detail: updateStatus?.status === "idle" ? "开发模式已跳过更新检查" : "当前版本检查完成",
    });
  } catch (error) {
    updateCheck("update", { status: "warning", detail: getErrorMessage(error) });
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
