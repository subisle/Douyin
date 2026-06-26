import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Network,
  Users,
  FileText,
  Database,
  Flag,
} from "lucide-react";

export type PageId =
  | "datacenter"
  | "family-tree"
  | "anchors"
  | "data"
  | "flag";

export interface NavItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: "datacenter",
    label: "仪表盘",
    icon: LayoutDashboard,
    description: "数据概览与趋势",
  },
  {
    id: "family-tree",
    label: "族谱",
    icon: Network,
    description: "主播归属关系",
  },
  {
    id: "anchors",
    label: "主播列表",
    icon: Users,
    description: "主播档案管理",
  },
  {
    id: "data",
    label: "数据与报告",
    icon: Database,
    description: "每日报告、导入与导出",
  },
  {
    id: "flag",
    label: "流动红旗",
    icon: Flag,
    description: "师徒小组音浪时长对比",
  },
];
