"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { DashboardPage } from "./dashboard-page";
import { AnchorsPage } from "./anchors-page";
import { FamilyTreePage } from "./family-tree-page";
import { ImportPage } from "./import-page";
import { ExportPage } from "./export-page";
import { type PageId } from "./types";

export function DesktopShell() {
  const [currentPage, setCurrentPage] = useState<PageId>("datacenter");
  const [collapsed, setCollapsed] = useState(false);

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
              ) : currentPage === "import" ? (
                <ImportPage />
              ) : (
                <ExportPage />
              )}
            </main>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
