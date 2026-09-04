"use client";

import Papa from "papaparse";
import type { AnchorIncomeRow } from "@/types/electron";
import { formatDuration } from "./format";

export type IncomeExportFormat = "csv" | "xlsx";

/** XLSX 版式：template=样式1（同鹏鹏传媒样表）；modern=样式2（商务：藏青表头/斑马纹/分节合计） */
export type IncomeExportStyle = "template" | "modern";

/** combined=男女一起（一个文件）；separate=男女分开（两个文件） */
export type IncomeExportScope = "combined" | "female" | "male" | "separate";

export type IncomeExportColumnKey =
  | "name"
  | "joinDate"
  | "startDate"
  | "endDate"
  | "duration"
  | "revenue"
  | "streamerRatio"
  | "guildRatio"
  | "streamerIncome"
  | "guildIncome"
  | "prevIncome"
  | "totalIncome"
  | "nickname"
  | "douyinNo"
  | "remark";

export interface IncomeExportColumn {
  key: IncomeExportColumnKey;
  label: string;
  width: number;
  /** 数值列：XLSX 里写成数字便于求和 */
  numeric?: boolean;
}

export const INCOME_EXPORT_COLUMNS: IncomeExportColumn[] = [
  { key: "name", label: "主播名称", width: 18 },
  { key: "joinDate", label: "入会时间", width: 20 },
  { key: "startDate", label: "开始时间", width: 18 },
  { key: "endDate", label: "结束时间", width: 21 },
  { key: "duration", label: "本期时长", width: 14 },
  { key: "revenue", label: "本期流水（元）", width: 16, numeric: true },
  { key: "streamerRatio", label: "主播分成比", width: 12 },
  { key: "guildRatio", label: "公会分成比", width: 12 },
  { key: "streamerIncome", label: "本期个人收益", width: 20, numeric: true },
  { key: "guildIncome", label: "公会收入（元）", width: 14, numeric: true },
  { key: "prevIncome", label: "上期个人收益", width: 14, numeric: true },
  { key: "totalIncome", label: "个人总收益", width: 22, numeric: true },
  { key: "nickname", label: "主播昵称", width: 26 },
  { key: "douyinNo", label: "抖音号", width: 16 },
  { key: "remark", label: "备注", width: 12 },
];

/** 模板版式默认列：同鹏鹏传媒样表（主播名称/入会时间/开始时间/结束时间/本期个人收益/个人总收益） */
export const DEFAULT_INCOME_COLUMNS: IncomeExportColumnKey[] = [
  "name",
  "joinDate",
  "startDate",
  "endDate",
  "streamerIncome",
  "totalIncome",
];

export interface IncomeExportOptions {
  format: IncomeExportFormat;
  /** XLSX 版式，缺省=template */
  style?: IncomeExportStyle;
  scope: IncomeExportScope;
  columns: IncomeExportColumnKey[];
  /** 公司抬头，用于标题行与文件名前缀 */
  company: string;
  /** 首行加大标题（同 Excel 版式） */
  withTitle: boolean;
  /** 本期无收入时写「没播」 */
  markNotLive: boolean;
}

export interface IncomeExportContext {
  period: string;
  rows: AnchorIncomeRow[];
}

const GENDER_SECTIONS: { key: "female" | "male"; label: string; sheet: string }[] = [
  { key: "female", label: "女团个人收入明细", sheet: "女团" },
  { key: "male", label: "男团个人收益明细", sheet: "男团" },
];

const DEFAULT_COMPANY = "鹏仔传媒";

function companyText(value: string) {
  const text = String(value || "").trim();
  return text || DEFAULT_COMPANY;
}

/** 2026-06 → { year: "2026", monthText: "6", periodText: "2026年6月" } */
function periodText(period: string) {
  const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return { year: "", monthText: "", label: period || "" };
  return {
    year: match[1],
    monthText: String(Number(match[2])),
    label: `${match[1]}年${Number(match[2])}月`,
  };
}

function buildTitle(company: string, period: string, sectionLabel: string) {
  const { year, monthText } = periodText(period);
  return `${companyText(company)}${year}年${monthText}月份${sectionLabel}`;
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** 本期无收入：按选项显示「没播」或留空 */
function notLiveText(row: AnchorIncomeRow, options: IncomeExportOptions) {
  if (!options.markNotLive) return "";
  return row.totalIncome > 0 ? "没播" : "";
}

function cellValue(
  row: AnchorIncomeRow,
  key: IncomeExportColumnKey,
  options: IncomeExportOptions
): { text: string; number: number | null } {
  switch (key) {
    case "name":
      return { text: row.name, number: null };
    case "joinDate":
      return { text: row.joinDate || "", number: null };
    case "startDate":
      return { text: row.startDate || "", number: null };
    case "endDate":
      return { text: row.endDate || "", number: null };
    case "duration":
      return { text: row.durationMinutes > 0 ? formatDuration(row.durationMinutes) : "", number: null };
    case "revenue":
      return row.hasIncome
        ? { text: String(roundMoney(row.revenue)), number: roundMoney(row.revenue) }
        : { text: notLiveText(row, options), number: null };
    case "streamerRatio":
      return { text: row.streamerRatio || "", number: null };
    case "guildRatio":
      return { text: row.guildRatio || "", number: null };
    case "streamerIncome":
      return row.hasIncome
        ? { text: String(roundMoney(row.streamerIncome)), number: roundMoney(row.streamerIncome) }
        : { text: notLiveText(row, options), number: null };
    case "guildIncome":
      return row.hasIncome
        ? { text: String(roundMoney(row.guildIncome)), number: roundMoney(row.guildIncome) }
        : { text: notLiveText(row, options), number: null };
    case "prevIncome":
      return { text: String(roundMoney(row.prevIncome)), number: roundMoney(row.prevIncome) };
    case "totalIncome":
      return { text: String(roundMoney(row.totalIncome)), number: roundMoney(row.totalIncome) };
    case "nickname":
      return { text: row.nickname || "", number: null };
    case "douyinNo":
      return { text: row.douyinNo || "", number: null };
    case "remark":
      return { text: row.remark || "", number: null };
    default:
      return { text: "", number: null };
  }
}

function selectedColumns(options: IncomeExportOptions): IncomeExportColumn[] {
  const order = new Map(INCOME_EXPORT_COLUMNS.map((col, index) => [col.key, index]));
  return INCOME_EXPORT_COLUMNS.filter((col) => options.columns.includes(col.key)).sort(
    (a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)
  );
}

/** 「本期个人收益」表头带上月份：6月个人收益 */
function headerLabel(column: IncomeExportColumn, period: string) {
  if (column.key === "streamerIncome") {
    const { monthText } = periodText(period);
    return monthText ? `${monthText}月个人收益` : column.label;
  }
  return column.label;
}

function pickRows(rows: AnchorIncomeRow[], gender: "female" | "male") {
  return rows.filter((row) => row.gender === gender);
}

function sortedRows(rows: AnchorIncomeRow[]) {
  return [...rows].sort((a, b) => b.totalIncome - a.totalIncome);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildCsvMatrix(
  rows: AnchorIncomeRow[],
  columns: IncomeExportColumn[],
  period: string,
  options: IncomeExportOptions
): string[][] {
  const header = columns.map((col) => headerLabel(col, period));
  const body = sortedRows(rows).map((row) =>
    columns.map((col) => cellValue(row, col.key, options).text)
  );
  return [header, ...body];
}

function csvFileName(company: string, period: string, section: string) {
  const { label } = periodText(period);
  return `${companyText(company)}${label}_${section}.csv`;
}

function xlsxFileName(company: string, period: string, section: string) {
  const { label } = periodText(period);
  return `${companyText(company)}${label}_${section}.xlsx`;
}

export async function exportAnchorIncome(
  context: IncomeExportContext,
  options: IncomeExportOptions
): Promise<{ files: string[]; rowCount: number }> {
  const columns = selectedColumns(options);
  if (columns.length === 0) throw new Error("至少选择一列");
  const { period, rows } = context;

  const sections =
    options.scope === "female"
      ? GENDER_SECTIONS.filter((s) => s.key === "female")
      : options.scope === "male"
        ? GENDER_SECTIONS.filter((s) => s.key === "male")
        : GENDER_SECTIONS;

  const files: string[] = [];
  let rowCount = 0;

  if (options.format === "csv") {
    const asOneFile = options.scope === "combined";
    if (asOneFile) {
      const matrix: string[][] = [];
      if (options.withTitle) {
        matrix.push([buildTitle(options.company, period, "个人收入明细")]);
      }
      for (const section of sections) {
        const sectionRows = pickRows(rows, section.key);
        if (matrix.length > 0) matrix.push([]);
        matrix.push([section.label]);
        matrix.push(
          ...buildCsvMatrix(sectionRows, columns, period, options)
        );
        rowCount += sectionRows.length;
      }
      const csv = Papa.unparse(matrix);
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const filename = csvFileName(options.company, period, "个人收入明细");
      triggerDownload(blob, filename);
      files.push(filename);
      return { files, rowCount };
    }

    for (const section of sections) {
      const sectionRows = pickRows(rows, section.key);
      const matrix: string[][] = [];
      if (options.withTitle) {
        matrix.push([buildTitle(options.company, period, section.label)]);
      }
      matrix.push(...buildCsvMatrix(sectionRows, columns, period, options));
      const csv = Papa.unparse(matrix);
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const filename = csvFileName(options.company, period, section.label);
      triggerDownload(blob, filename);
      files.push(filename);
      rowCount += sectionRows.length;
      if (sections.length > 1) await delay(400);
    }
    return { files, rowCount };
  }

  // XLSX：combined 合成一个工作簿（女团/男团两个 Sheet），其余每个团一个文件
  const xlsxGroups: (typeof GENDER_SECTIONS)[] =
    options.scope === "combined" ? [sections] : sections.map((section) => [section]);

  for (const group of xlsxGroups) {
    await exportXlsx(context, options, columns, group);
    for (const section of group) {
      rowCount += pickRows(rows, section.key).length;
    }
    const filename =
      group.length === 1
        ? xlsxFileName(options.company, period, group[0].label)
        : `${companyText(options.company)}${periodText(period).label}_个人收入明细.xlsx`;
    files.push(filename);
    if (xlsxGroups.length > 1) await delay(400);
  }
  return { files, rowCount };
}

/* ---------------- XLSX（模板版式：同鹏鹏传媒 .et 样表） ---------------- */

interface XlsxColumn {
  width: number;
}

interface XlsxCell {
  font?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  border?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  numFmt?: string;
  value?: unknown;
}

interface XlsxRowHandle {
  height?: number;
  getCell: (col: number) => XlsxCell;
}

interface XlsxSheet {
  columns: XlsxColumn[];
  getRow: (n: number) => XlsxRowHandle;
  mergeCells: (range: string) => void;
  views?: { state: string; ySplit?: number }[];
}

interface XlsxModule {
  Workbook: new () => {
    addWorksheet: (name: string) => XlsxSheet;
    xlsx: { writeBuffer: () => Promise<ArrayBuffer> };
  };
}

function columnName(index: number) {
  let n = index + 1;
  let text = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    text = String.fromCharCode(65 + rem) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

async function loadExcelJs(): Promise<XlsxModule> {
  const loaded = (await import("exceljs/dist/exceljs.min.js")) as unknown as
    | XlsxModule
    | { default: XlsxModule };
  const mod = (loaded as { default?: XlsxModule }).default ?? (loaded as XlsxModule);
  if (!mod?.Workbook) throw new Error("XLSX 组件加载失败，请改用 CSV 导出");
  return mod;
}

const THIN_BORDER = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

const DATA_FONT = { name: "微软雅黑", size: 11 };

/** 模板配色（取自鹏鹏传媒 .et 样表） */
const FILL_TITLE = { type: "pattern", pattern: "solid", fgColor: { argb: "FF993366" } };
const FILL_BAND = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFCC" } };
const FILL_NAME = { type: "pattern", pattern: "solid", fgColor: { argb: "FF99CCFF" } };
const FILL_INCOME = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF8080" } };
const FILL_TOTAL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };

/** 数据列填充色：主播名称浅蓝、收益浅红、总收益黄，其余浅黄（同模板） */
function columnFill(col: IncomeExportColumn) {
  if (col.key === "name") return FILL_NAME;
  if (col.key === "totalIncome") return FILL_TOTAL;
  if (col.numeric) return FILL_INCOME;
  return FILL_BAND;
}

/** "2026-06-01" → Date（解析失败返回 null，按文本写）。
 * exceljs 按 UTC 时间换算日期序列号，取当日正午可保证任何时区下都显示同一天 */
function parseDateText(text: string): Date | null {
  const match = String(text || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

/** 单元格取值：日期列写真实日期，数值列写数字，其余写文本 */
function dataCellValue(
  row: AnchorIncomeRow,
  col: IncomeExportColumn,
  options: IncomeExportOptions
): string | number | Date | null {
  const { text, number } = cellValue(row, col.key, options);
  if (col.key === "startDate" || col.key === "endDate") {
    return parseDateText(text) ?? (text || null);
  }
  if (col.numeric && number !== null) return number;
  return text === "" ? null : text;
}

function dataAlignment(col: IncomeExportColumn) {
  if (col.key === "startDate" || col.key === "endDate") {
    return { horizontal: "center", vertical: "middle" };
  }
  if (col.numeric) return { horizontal: "right", vertical: "middle" };
  return { horizontal: "left", vertical: "middle" };
}

async function exportXlsx(
  context: IncomeExportContext,
  options: IncomeExportOptions,
  columns: IncomeExportColumn[],
  sections: typeof GENDER_SECTIONS
) {
  if (options.style === "modern") {
    return exportXlsxModern(context, options, columns, sections);
  }
  return exportXlsxTemplate(context, options, columns, sections);
}

/* ---------------- 样式2：商务版式（藏青表头/斑马纹/分节合计） ---------------- */

const MODERN_NAVY = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
const MODERN_SECTION = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDEEBF7" } };
const MODERN_ZEBRA = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F7FC" } };
const MODERN_TOTAL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };

async function exportXlsxModern(
  context: IncomeExportContext,
  options: IncomeExportOptions,
  columns: IncomeExportColumn[],
  sections: typeof GENDER_SECTIONS
) {
  const ExcelJS = await loadExcelJs();
  const { period, rows } = context;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("个人收入明细");

  const lastColIndex = columns.length; // 样式2 无留白列，从 A 列开始
  const lastColLetter = columnName(columns.length - 1);

  sheet.columns = columns.map((col) => ({ width: col.width }));
  let cursor = 0;

  // 大标题
  cursor += 1;
  const titleText =
    sections.length > 1
      ? buildTitle(options.company, period, "个人收入明细")
      : buildTitle(options.company, period, sections[0].label);
  const titleRow = sheet.getRow(cursor);
  titleRow.getCell(1).value = titleText;
  sheet.mergeCells(`A${cursor}:${lastColLetter}${cursor}`);
  titleRow.height = 30;
  for (let c = 1; c <= lastColIndex; c++) {
    const cell = titleRow.getCell(c);
    cell.font = { name: "微软雅黑", size: 15, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = MODERN_NAVY;
  }

  // 表头
  cursor += 1;
  const headerRowIndex = cursor;
  const headerRow = sheet.getRow(cursor);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(1 + i);
    cell.value = headerLabel(col, period);
    cell.font = { name: "微软雅黑", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = MODERN_NAVY;
    cell.border = THIN_BORDER;
  });
  sheet.views = [{ state: "frozen", ySplit: headerRowIndex }];

  // 分节数据：节色带 + 斑马纹 + 合计行
  for (const section of sections) {
    const sectionRows = sortedRows(pickRows(rows, section.key));

    cursor += 1;
    const labelRow = sheet.getRow(cursor);
    labelRow.getCell(1).value = section.label;
    sheet.mergeCells(`A${cursor}:${lastColLetter}${cursor}`);
    for (let c = 1; c <= lastColIndex; c++) {
      const cell = labelRow.getCell(c);
      cell.font = { name: "微软雅黑", size: 11, bold: true, color: { argb: "FF1F3864" } };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      cell.fill = MODERN_SECTION;
      cell.border = THIN_BORDER;
    }

    const totals = new Map<IncomeExportColumnKey, number>();
    sectionRows.forEach((row, index) => {
      cursor += 1;
      const sheetRow = sheet.getRow(cursor);
      const zebra = index % 2 === 1 ? MODERN_ZEBRA : undefined;
      columns.forEach((col, i) => {
        const cell = sheetRow.getCell(1 + i);
        cell.value = dataCellValue(row, col, options);
        cell.font = DATA_FONT;
        cell.alignment = dataAlignment(col);
        cell.border = THIN_BORDER;
        if (zebra) cell.fill = zebra;
        if (col.numeric && typeof cell.value === "number") {
          cell.numFmt = "#,##0.00";
          totals.set(col.key, (totals.get(col.key) || 0) + cell.value);
        }
        if (
          (col.key === "startDate" || col.key === "endDate") &&
          cell.value instanceof Date
        ) {
          cell.numFmt = "yyyy/m/d";
        }
      });
    });

    // 合计行
    if (sectionRows.length > 0) {
      cursor += 1;
      const totalRow = sheet.getRow(cursor);
      columns.forEach((col, i) => {
        const cell = totalRow.getCell(1 + i);
        cell.font = { name: "微软雅黑", size: 11, bold: true };
        cell.fill = MODERN_TOTAL;
        cell.border = THIN_BORDER;
        if (i === 0) {
          cell.value = `合计（${sectionRows.length} 人）`;
          cell.alignment = { horizontal: "left", vertical: "middle" };
        } else if (col.numeric && totals.has(col.key)) {
          cell.value = Math.round((totals.get(col.key) || 0) * 100) / 100;
          cell.numFmt = "#,##0.00";
          cell.alignment = { horizontal: "right", vertical: "middle" };
        }
      });
    }

    if (sections.length > 1 && section.key === "female") cursor += 1; // 段间空行
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const { label } = periodText(period);
  const filename =
    sections.length === 1
      ? xlsxFileName(options.company, period, sections[0].label)
      : `${companyText(options.company)}${label}_个人收入明细.xlsx`;
  triggerDownload(blob, filename);
}

/* ---------------- 样式1：模板版式（同鹏鹏传媒 .et 样表） ---------------- */

async function exportXlsxTemplate(
  context: IncomeExportContext,
  options: IncomeExportOptions,
  columns: IncomeExportColumn[],
  sections: typeof GENDER_SECTIONS
) {
  const ExcelJS = await loadExcelJs();
  const { period, rows } = context;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("个人收入明细");

  const firstDataCol = 2; // 数据从 B 列开始（A 列为窄留白，同模板）
  const lastColIndex = columns.length + 1;
  const lastColLetter = columnName(columns.length);

  sheet.columns = [
    { width: 2 }, // A 列窄留白（同模板）
    ...columns.map((col) => ({ width: col.width })),
  ];

  let cursor = 1; // 第 1 行整行留空（同模板）

  if (options.withTitle) {
    cursor += 1;
    const titleText =
      sections.length > 1
        ? buildTitle(options.company, period, "个人收入明细")
        : buildTitle(options.company, period, sections[0].label);
    const titleRow = sheet.getRow(cursor);
    titleRow.getCell(firstDataCol).value = titleText;
    sheet.mergeCells(`B${cursor}:${lastColLetter}${cursor}`);
    titleRow.height = 26;
    for (let c = firstDataCol; c <= lastColIndex; c++) {
      const cell = titleRow.getCell(c);
      cell.font = { name: "宋体", size: 14 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = THIN_BORDER;
      cell.fill = FILL_TITLE;
    }

    // 标题下的空白行（带边框，同模板）
    cursor += 1;
    const blankRow = sheet.getRow(cursor);
    for (let c = firstDataCol; c <= lastColIndex; c++) {
      blankRow.getCell(c).border = THIN_BORDER;
      blankRow.getCell(c).fill = FILL_BAND;
    }
    sheet.mergeCells(`B${cursor}:${lastColLetter}${cursor}`);
  }

  // 表头行
  cursor += 1;
  const headerRow = sheet.getRow(cursor);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(firstDataCol + i);
    cell.value = headerLabel(col, period);
    cell.font = { name: "仿宋", size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = THIN_BORDER;
    cell.fill = FILL_BAND;
  });

  // 数据区：女团行 → 空行 → 「男团个人收益明细」标签 → 男团行（同模板单表连排）
  for (const section of sections) {
    if (section.key === "male") {
      if (sections.length > 1) cursor += 1; // 段间空行
      cursor += 1;
      const labelRow = sheet.getRow(cursor);
      labelRow.getCell(firstDataCol).value = section.label;
      sheet.mergeCells(`B${cursor}:${lastColLetter}${cursor}`);
      for (let c = firstDataCol; c <= lastColIndex; c++) {
        const cell = labelRow.getCell(c);
        cell.font = DATA_FONT;
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = THIN_BORDER;
        cell.fill = FILL_BAND;
      }
    }

    for (const row of sortedRows(pickRows(rows, section.key))) {
      cursor += 1;
      const sheetRow = sheet.getRow(cursor);
      columns.forEach((col, i) => {
        const cell = sheetRow.getCell(firstDataCol + i);
        cell.value = dataCellValue(row, col, options);
        cell.font = DATA_FONT;
        cell.alignment = dataAlignment(col);
        cell.border = THIN_BORDER;
        cell.fill = columnFill(col);
        if (
          (col.key === "startDate" || col.key === "endDate") &&
          cell.value instanceof Date
        ) {
          cell.numFmt = "yyyy/m/d";
        }
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const { label } = periodText(period);
  const filename =
    sections.length === 1
      ? xlsxFileName(options.company, period, sections[0].label)
      : `${companyText(options.company)}${label}_个人收入明细.xlsx`;
  triggerDownload(blob, filename);
}
