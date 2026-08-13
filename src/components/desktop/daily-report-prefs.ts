/**
 * 每日报告导出偏好（标题 / 样式 / 可见列 / 列宽）
 * 桌面页与机器人 Canvas 渲染共用同一 localStorage 配置。
 */
import {
  ALL_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  type ColumnKey,
  type ColumnWidths,
  type ReportCanvasStyle,
} from "./draw-report-canvas";

export type ReportGender = "male" | "female";

export const DEFAULT_REPORT_TITLE_MALE = "星嗨艺创主播数据统计";
export const DEFAULT_REPORT_TITLE_FEMALE = "薇笑传媒主播数据统计";
export const DEFAULT_REPORT_TITLE = DEFAULT_REPORT_TITLE_MALE;

export const COLUMNS_STORAGE_KEY = "daily-report-visible-columns";
export const COLUMNS_STORAGE_VERSION_KEY = "daily-report-visible-columns-version";
// v4: 默认可见列去掉「等级」，与发送日报五列一致
export const COLUMNS_STORAGE_VERSION = "4";
export const COLUMN_WIDTHS_STORAGE_KEY = "daily-report-column-widths";
export const REPORT_STYLES_STORAGE_KEY = "daily-report-canvas-styles";
export const REPORT_STYLES_STORAGE_VERSION_KEY = "daily-report-canvas-styles-version";
export const REPORT_STYLES_STORAGE_VERSION = "2";
export const REPORT_TITLES_STORAGE_KEY = "daily-report-custom-titles";
export const EXPORT_SPLIT_STORAGE_KEY = "daily-report-export-split";
export const REPORT_SORT_STORAGE_KEY = "daily-report-sort-by";

export const DEFAULT_REPORT_STYLES: Record<ReportGender, ReportCanvasStyle> = {
  male: "apple",
  female: "classic",
};

export function defaultReportTitle(gender: ReportGender): string {
  return gender === "female" ? DEFAULT_REPORT_TITLE_FEMALE : DEFAULT_REPORT_TITLE_MALE;
}

function sanitizeColumnWidth(value: unknown): number | null {
  const width = Number(value);
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.min(800, Math.max(20, Math.round(width)));
}

export function isReportCanvasStyle(value: unknown): value is ReportCanvasStyle {
  return value === "classic" || value === "apple";
}

export function loadVisibleColumns(): ColumnKey[] {
  if (typeof window === "undefined") return DEFAULT_VISIBLE_COLUMNS;
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLUMNS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((k): k is ColumnKey => ALL_COLUMNS.some((c) => c.key === k));
      if (localStorage.getItem(COLUMNS_STORAGE_VERSION_KEY) !== COLUMNS_STORAGE_VERSION) {
        // v4 起发送日报默认五列，升级时去掉 duration/master/tier
        const migrated = new Set<ColumnKey>(
          valid.filter((k) => k !== "duration" && k !== "master" && k !== "tier")
        );
        for (const key of DEFAULT_VISIBLE_COLUMNS) migrated.add(key);
        return ALL_COLUMNS.map((c) => c.key).filter((key) => migrated.has(key));
      }
      if (valid.length > 0) return valid;
    }
  } catch {
    // ignore
  }
  return DEFAULT_VISIBLE_COLUMNS;
}

export function loadColumnWidths(): ColumnWidths {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const widths: ColumnWidths = {};
    for (const col of ALL_COLUMNS) {
      const width = sanitizeColumnWidth((parsed as Record<string, unknown>)[col.key]);
      if (width !== null) widths[col.key] = width;
    }
    return widths;
  } catch {
    return {};
  }
}

export function loadReportStyles(): Record<ReportGender, ReportCanvasStyle> {
  if (typeof window === "undefined") return { ...DEFAULT_REPORT_STYLES };
  try {
    if (localStorage.getItem(REPORT_STYLES_STORAGE_VERSION_KEY) !== REPORT_STYLES_STORAGE_VERSION) {
      return { ...DEFAULT_REPORT_STYLES };
    }
    const parsed = JSON.parse(localStorage.getItem(REPORT_STYLES_STORAGE_KEY) || "{}");
    return {
      male: isReportCanvasStyle(parsed.male) ? parsed.male : DEFAULT_REPORT_STYLES.male,
      female: isReportCanvasStyle(parsed.female) ? parsed.female : DEFAULT_REPORT_STYLES.female,
    };
  } catch {
    return { ...DEFAULT_REPORT_STYLES };
  }
}

export function loadReportTitles(): Record<ReportGender, string> {
  const defaults = {
    male: DEFAULT_REPORT_TITLE_MALE,
    female: DEFAULT_REPORT_TITLE_FEMALE,
  };
  if (typeof window === "undefined") return defaults;
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORT_TITLES_STORAGE_KEY) || "{}");
    return {
      male: typeof parsed.male === "string" && parsed.male.trim() ? parsed.male.trim() : defaults.male,
      female: typeof parsed.female === "string" && parsed.female.trim() ? parsed.female.trim() : defaults.female,
    };
  } catch {
    return defaults;
  }
}

/** 是否按「两张」导出（桌面设置）；缺省 true */
export function loadExportImageSplit(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(EXPORT_SPLIT_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * 机器人 / 桌面共用：按性别解析标题、样式、列配置。
 * 标题优先软件自定义，否则按性别默认（男团星嗨 / 女队薇笑）。
 */
export function resolveDailyReportExportPrefs(gender: ReportGender): {
  gender: ReportGender;
  customTitle: string;
  style: ReportCanvasStyle;
  visibleColumns: ColumnKey[];
  columnWidths: ColumnWidths;
  exportImageSplit: boolean;
} {
  const g: ReportGender = gender === "female" ? "female" : "male";
  const titles = loadReportTitles();
  const styles = loadReportStyles();
  return {
    gender: g,
    customTitle: titles[g] || defaultReportTitle(g),
    style: styles[g] || DEFAULT_REPORT_STYLES[g],
    visibleColumns: loadVisibleColumns(),
    columnWidths: loadColumnWidths(),
    exportImageSplit: loadExportImageSplit(),
  };
}
