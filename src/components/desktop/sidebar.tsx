"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, type PageId } from "./types";

interface SidebarProps {
  currentPage: PageId;
  collapsed: boolean;
  onNavigate: (page: PageId) => void;
  onToggle: () => void;
}

export function Sidebar({
  currentPage,
  collapsed,
  onNavigate,
  onToggle,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-border/70 bg-sidebar/80 backdrop-blur-xl transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "size-5 shrink-0 transition-transform",
                  isActive ? "scale-110" : "group-hover:scale-110"
                )}
              />
              {!collapsed && (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium leading-tight">
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "truncate text-xs leading-tight",
                      isActive
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground/70"
                    )}
                  >
                    {item.description}
                  </span>
                </span>
              )}
              {isActive && !collapsed && (
                <span className="absolute right-3 size-1.5 rounded-full bg-primary-foreground" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border/70 px-2 py-3">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center rounded-2xl p-3 text-muted-foreground transition-all duration-200 hover:bg-background/70 hover:text-foreground"
          title={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? (
            <ChevronRight className="size-5" />
          ) : (
            <ChevronLeft className="size-5" />
          )}
        </button>
      </div>
    </aside>
  );
}
