import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Network,
  Users,
  Database,
  Flag,
  MonitorPlay,
  Swords,
  Settings,
  Trophy,
  Image,
  Bot,
  MessageCircle,
} from "lucide-react";

export type PageId =
  | "datacenter"
  | "family-tree"
  | "anchors"
  | "data"
  | "flag"
  | "pk"
  | "douyin-monitor"
  | "reward"
  | "poster-board"
  | "weixin-bot"
  | "qq-bot"
  | "settings";

export type AppRole = "admin" | "guest";

export interface NavItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
  description: string;
  /** guest 角色不显示的页面 */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: "datacenter",
    label: "仪表盘",
    icon: LayoutDashboard,
    description: "数据概览与趋势",
    adminOnly: true,
  },
  {
    id: "anchors",
    label: "主播",
    icon: Users,
    description: "主播档案管理",
    adminOnly: true,
  },
  {
    id: "data",
    label: "数据",
    icon: Database,
    description: "数据导入、导出与每日报告",
  },
  {
    id: "flag",
    label: "红旗",
    icon: Flag,
    description: "师徒小组音浪时长对比",
    adminOnly: true,
  },
  {
    id: "pk",
    label: "PK 分组",
    icon: Swords,
    description: "男团自动分组",
    adminOnly: true,
  },
  {
    id: "douyin-monitor",
    label: "监控",
    icon: MonitorPlay,
    description: "分数监控、直播画面与事件流",
    adminOnly: true,
  },
  {
    id: "reward",
    label: "奖励",
    icon: Trophy,
    description: "音浪与时长奖励结算",
    adminOnly: true,
  },
  {
    id: "family-tree",
    label: "族谱",
    icon: Network,
    description: "主播归属关系",
    adminOnly: true,
  },
  {
    id: "poster-board",
    label: "海报",
    icon: Image,
    description: "男团模板海报导出",
    adminOnly: true,
  },
  {
    id: "weixin-bot",
    label: "微信机器人",
    icon: Bot,
    description: "微信 iLink 消息连接与回复",
    adminOnly: true,
  },
  {
    id: "qq-bot",
    label: "QQ 机器人",
    icon: MessageCircle,
    description: "官方 QQ 开放平台机器人",
    adminOnly: true,
  },
  {
    id: "settings",
    label: "设置",
    icon: Settings,
    description: "更新、状态与关于",
    adminOnly: true,
  },
];
