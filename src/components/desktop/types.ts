import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Network,
  Users,
  Upload,
  Download,
} from "lucide-react";

export type PageId =
  | "datacenter"
  | "family-tree"
  | "anchors"
  | "import"
  | "export";

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
    id: "import",
    label: "导入数据",
    icon: Upload,
    description: "导入音浪 / 时长",
  },
  {
    id: "export",
    label: "导出数据",
    icon: Download,
    description: "导出 CSV 报表",
  },
];
