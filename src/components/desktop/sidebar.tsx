"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NAV_TREE,
  isMonitorPage,
  isNavGroup,
  type NavEntry,
  type NavItem,
  type PageId,
  type AppRole,
} from "./types";

interface SidebarProps {
  currentPage: PageId;
  collapsed: boolean;
  onNavigate: (page: PageId) => void;
  onToggle: () => void;
  userRole: AppRole;
}

function entryVisible(entry: NavEntry, userRole: AppRole) {
  if (entry.adminOnly && userRole === "guest") return false;
  return true;
}

function childVisible(item: NavItem, userRole: AppRole) {
  if (item.adminOnly && userRole === "guest") return false;
  return true;
}

export function Sidebar({
  currentPage,
  collapsed,
  onNavigate,
  onToggle,
  userRole,
}: SidebarProps) {
  const monitorActive = isMonitorPage(currentPage);
  const [monitorOpen, setMonitorOpen] = useState(monitorActive);

  useEffect(() => {
    if (monitorActive) setMonitorOpen(true);
  }, [monitorActive]);

  const visibleEntries = NAV_TREE.filter((entry) => entryVisible(entry, userRole));

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-border/70 bg-sidebar/80 backdrop-blur-xl transition-all duration-300",
        collapsed ? "w-12" : "w-12 sm:w-36"
      )}
    >
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 py-2">
        {visibleEntries.map((entry) => {
          if (isNavGroup(entry)) {
            const children = entry.children.filter((child) => childVisible(child, userRole));
            if (children.length === 0) return null;
            const GroupIcon = entry.icon;
            const groupActive = monitorActive;
            const expanded = !collapsed && monitorOpen;

            return (
              <div key={entry.id} className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (collapsed) {
                      onNavigate(entry.defaultPage);
                      return;
                    }
                    if (!monitorOpen) {
                      setMonitorOpen(true);
                      if (!groupActive) onNavigate(entry.defaultPage);
                      return;
                    }
                    // 已展开：再点父项仍进默认子页，并保持展开
                    onNavigate(entry.defaultPage);
                  }}
                  title={entry.label}
                  aria-label={entry.label}
                  aria-expanded={expanded}
                  className={cn(
                    "group relative flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-all duration-200",
                    groupActive
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                  )}
                >
                  <GroupIcon
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      groupActive ? "scale-110 text-primary" : "group-hover:scale-110"
                    )}
                  />
                  {!collapsed && (
                    <>
                      <span className="hidden min-w-0 flex-1 truncate text-[13px] font-medium leading-tight sm:block">
                        {entry.label}
                      </span>
                      <ChevronDown
                        className={cn(
                          "hidden size-3.5 shrink-0 opacity-60 transition-transform sm:block",
                          expanded && "rotate-180"
                        )}
                      />
                    </>
                  )}
                </button>

                {expanded &&
                  children.map((child) => {
                    const ChildIcon = child.icon;
                    const isActive = currentPage === child.id;
                    return (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => onNavigate(child.id)}
                        title={child.label}
                        aria-label={child.label}
                        className={cn(
                          "group relative flex w-full items-center gap-2 rounded-md py-1.5 pl-4 pr-2 text-left transition-all duration-200",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-md"
                            : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                        )}
                      >
                        <ChildIcon
                          className={cn(
                            "size-3.5 shrink-0 transition-transform",
                            isActive ? "scale-110" : "group-hover:scale-110"
                          )}
                        />
                        <span className="hidden min-w-0 flex-1 truncate text-[12px] font-medium leading-tight sm:block">
                          {child.label}
                        </span>
                        {isActive && (
                          <span className="absolute right-2.5 hidden size-1.5 rounded-full bg-primary-foreground sm:block" />
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          }

          const Icon = entry.icon;
          const isActive = currentPage === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onNavigate(entry.id)}
              title={entry.label}
              aria-label={entry.label}
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
                  {entry.label}
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
          type="button"
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
