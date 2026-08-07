"use client";

import { getDataApi } from "@/client/http-electron-api";
import { useEffect, useState } from "react";
import {
  FileUp,
  GitMerge,
  Minus,
  RefreshCw,
  Square,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getNavLabel, isMonitorPage, type PageId } from "./types";

interface TopbarProps {
  currentPage: PageId;
}

export function Topbar({ currentPage }: TopbarProps) {
  const pageLabel = getNavLabel(currentPage);
  const subtitle = isMonitorPage(currentPage) ? `监控 · ${pageLabel}` : pageLabel;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = getDataApi();
    if (!api) return;
    api.windowIsMaximized().then(setMaximized);
    return api.onMaximizeChange(setMaximized);
  }, []);

  const handleMinimize = () => getDataApi()?.windowMinimize();
  const handleMaximize = async () => {
    const result = await getDataApi()?.windowMaximize();
    if (typeof result === "boolean") setMaximized(result);
  };
  const handleClose = () => getDataApi()?.windowClose();

  return (
    <header className="app-drag flex h-16 shrink-0 items-center justify-between border-b border-border/70 bg-background/80 px-5 backdrop-blur-xl md:px-8">
      <div className="app-no-drag flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-chart-1 text-primary-foreground shadow-lg shadow-primary/20">
            <span className="text-sm font-bold">主</span>
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-semibold text-foreground">
              主播数据管理
            </h1>
            <p className="text-xs text-muted-foreground">
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="app-no-drag flex items-center gap-3">
        {currentPage === "anchors" && (
          <div className="hidden items-center gap-2 md:flex">
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => window.dispatchEvent(new CustomEvent("anchors:openAdd"))}
            >
              <UserPlus className="size-4" />
              添加主播
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => window.dispatchEvent(new CustomEvent("anchors:openMerge"))}
            >
              <GitMerge className="size-4" />
              账号合并
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => window.dispatchEvent(new CustomEvent("anchors:openImport"))}
            >
              <FileUp className="size-4" />
              从文件导入
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => window.dispatchEvent(new CustomEvent("app:refresh"))}
            >
              <RefreshCw className="size-4" />
              同步数据
            </Button>
          </div>
        )}

        <div className="ml-2 flex items-center gap-1">
          <button
            onClick={handleMinimize}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="最小化"
          >
            <Minus className="size-4" />
          </button>
          <button
            onClick={handleMaximize}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title={maximized ? "还原" : "最大化"}
          >
            <Square className="size-3.5" />
          </button>
          <button
            onClick={handleClose}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive hover:text-destructive-foreground"
            title="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
