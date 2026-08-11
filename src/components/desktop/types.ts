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
  Activity,
  Radio,
  Download,
} from "lucide-react";

export type PageId =
  | "datacenter"
  | "family-tree"
  | "anchors"
  | "data"
  | "flag"
  | "pk"
  | "pk-group-stage"
  | "pk-monitor"
  | "collect-monitor"
  | "multi-monitor"
  | "import-monitor"
  | "reward"
  | "poster-board"
  | "bot"
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

export interface NavGroup {
  type: "group";
  id: "monitor";
  label: string;
  icon: LucideIcon;
  description: string;
  adminOnly?: boolean;
  /** 点击父项默认进入的子页 */
  defaultPage: PageId;
  children: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "type" in entry && entry.type === "group";
}

export const MONITOR_PAGE_IDS: PageId[] = [
  "pk-monitor",
  "collect-monitor",
  "multi-monitor",
  "import-monitor",
];

export function isMonitorPage(page: PageId): boolean {
  return MONITOR_PAGE_IDS.includes(page);
}

export const MONITOR_NAV_ITEMS: NavItem[] = [
  {
    id: "pk-monitor",
    label: "PK 监控",
    icon: MonitorPlay,
    description: "实时音浪与对局状态",
    adminOnly: true,
  },
  {
    id: "collect-monitor",
    label: "采集监控",
    icon: Activity,
    description: "观众抖音号与礼物采集",
    adminOnly: true,
  },
  {
    id: "multi-monitor",
    label: "多主播监控",
    icon: Radio,
    description: "多选主播并行分数",
    adminOnly: true,
  },
  {
    id: "import-monitor",
    label: "外部导入监控",
    icon: Download,
    description: "外部源观众与礼物",
    adminOnly: true,
  },
];

/** 扁平列表：顶栏标题 / 查找 label 用 */
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
    id: "pk-group-stage",
    label: "小组赛",
    icon: Trophy,
    description: "内置 8 组记分 · 四阶段出线",
    adminOnly: true,
  },
  ...MONITOR_NAV_ITEMS,
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
    id: "bot",
    label: "机器人",
    icon: Bot,
    description: "微信 iLink + QQ 开放平台",
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

/** 侧栏树：监控收成一组 */
export const NAV_TREE: NavEntry[] = [
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
    id: "pk-group-stage",
    label: "小组赛",
    icon: Trophy,
    description: "内置 8 组记分 · 四阶段出线",
    adminOnly: true,
  },
  {
    type: "group",
    id: "monitor",
    label: "监控",
    icon: MonitorPlay,
    description: "PK / 采集 / 多主播 / 外部导入",
    adminOnly: true,
    defaultPage: "pk-monitor",
    children: MONITOR_NAV_ITEMS,
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
    id: "bot",
    label: "机器人",
    icon: Bot,
    description: "微信 iLink + QQ 开放平台",
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


/** 旧版侧栏 id 兼容：合并前 weixin-bot / qq-bot → bot */
export function normalizePageId(page: string | null | undefined): PageId | null {
  const raw = String(page || "").trim();
  if (!raw) return null;
  if (raw === "weixin-bot" || raw === "qq-bot") return "bot";
  const known = NAV_ITEMS.some((item) => item.id === raw);
  return known ? (raw as PageId) : null;
}

export function getNavLabel(page: PageId): string {
  const item = NAV_ITEMS.find((entry) => entry.id === page);
  return item?.label ?? "";
}
