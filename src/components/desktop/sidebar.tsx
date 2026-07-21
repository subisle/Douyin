"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, type PageId, type AppRole } from "./types";

interface SidebarProps {
  currentPage: PageId;
  collapsed: boolean;
  onNavigate: (page: PageId) => void;
  onToggle: () => void;
  userRole: AppRole;
}

export function Sidebar({
  currentPage,
  collapsed,
  onNavigate,
  onToggle,
  userRole,
}: SidebarProps) {
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && userRole === "guest") return false;
    return true;
  });
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-border/70 bg-sidebar/80 backdrop-blur-xl transition-all duration-300",
        collapsed ? "w-12" : "w-12 sm:w-36"
      )}
    >
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 py-2">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={item.label}
              aria-label={item.label}
              className={cn(
                "group relative flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0 transition-transform",
                  isActive ? "scale-110" : "group-hover:scale-110"
                )}
              />
              {!collapsed && (
                <span className="hidden min-w-0 flex-1 truncate text-[13px] font-medium leading-tight sm:block">
                  {item.label}
                </span>
              )}
              {isActive && !collapsed && (
                <span className="absolute right-2.5 hidden size-1.5 rounded-full bg-primary-foreground sm:block" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="hidden border-t border-border/70 px-2 py-2 sm:block">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center rounded-md p-2 text-muted-foreground transition-all duration-200 hover:bg-background/70 hover:text-foreground"
          title={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
