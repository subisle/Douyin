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

export function DesktopShell() {
  const [currentPage, setCurrentPage] = useState<PageId>("datacenter");
  const [collapsed, setCollapsed] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [droppedImportFile, setDroppedImportFile] = useState<DroppedImportFile | null>(null);

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
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      setDroppedImportFile({ id: Date.now(), file });
      setCurrentPage("data");
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

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
