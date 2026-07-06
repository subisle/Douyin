import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Network,
  Users,
  Database,
  Flag,
  MonitorPlay,
  Sparkles,
  Swords,
  Settings,
  Trophy,
} from "lucide-react";

export type PageId =
  | "datacenter"
  | "family-tree"
  | "anchors"
  | "data"
  | "flag"
  | "pk"
  | "douyin-monitor"
  | "star-battle"
  | "reward"
  | "settings";

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
    id: "anchors",
    label: "主播列表",
    icon: Users,
    description: "主播档案管理",
  },
  {
    id: "data",
    label: "导入导出",
    icon: Database,
    description: "数据导入、导出与每日报告",
  },
  {
    id: "flag",
    label: "流动红旗",
    icon: Flag,
    description: "师徒小组音浪时长对比",
  },
  {
    id: "pk",
    label: "PK名单",
    icon: Swords,
    description: "按月音浪分组",
  },
  {
    id: "douyin-monitor",
    label: "抖音监控",
    icon: MonitorPlay,
    description: "直播画面与事件流",
  },
  {
    id: "star-battle",
    label: "星嗨争霸赛",
    icon: Sparkles,
    description: "赛事阵营与赛程",
  },
  {
    id: "reward",
    label: "奖励机制",
    icon: Trophy,
    description: "音浪与时长奖励结算",
  },
  {
    id: "family-tree",
    label: "族谱",
    icon: Network,
    description: "主播归属关系",
  },
  {
    id: "settings",
    label: "设置",
    icon: Settings,
    description: "更新、状态与关于",
  },
];
