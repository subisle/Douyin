"use client";

import Papa from "papaparse";
import type { AnchorIncomeRow } from "@/types/electron";
import { formatDuration } from "./format";

export type IncomeExportFormat = "csv" | "xlsx";

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
  { key: "name", label: "主播名称", width: 20 },
  { key: "joinDate", label: "入会时间", width: 16 },
  { key: "startDate", label: "开始时间", width: 13 },
  { key: "endDate", label: "结束时间", width: 13 },
  { key: "duration", label: "本期时长", width: 14 },
  { key: "revenue", label: "本期流水（元）", width: 16, numeric: true },
  { key: "streamerRatio", label: "主播分成比", width: 12 },
  { key: "guildRatio", label: "公会分成比", width: 12 },
  { key: "streamerIncome", label: "本期个人收益", width: 14, numeric: true },
  { key: "guildIncome", label: "公会收入（元）", width: 14, numeric: true },
  { key: "prevIncome", label: "上期个人收益", width: 14, numeric: true },
  { key: "totalIncome", label: "个人总收益", width: 14, numeric: true },
  { key: "nickname", label: "主播昵称", width: 26 },
  { key: "douyinNo", label: "抖音号", width: 16 },
  { key: "remark", label: "备注", width: 12 },
];

/** 样例版式默认列：主播名称/入会时间/开始时间/结束时间/本期时长/本期个人收益/个人总收益 */
export const DEFAULT_INCOME_COLUMNS: IncomeExportColumnKey[] = [
  "name",
  "joinDate",
  "startDate",
  "endDate",
  "duration",
  "streamerIncome",
  "totalIncome",
];

export interface IncomeExportOptions {
  format: IncomeExportFormat;
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

/* ---------------- XLSX ---------------- */

interface XlsxColumn {
  width: number;
}

interface XlsxCellStyle {
  font?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  border?: Record<string, unknown>;
}

interface XlsxRowHandle extends XlsxCellStyle {
  height?: number;
  eachCell: (cb: (cell: XlsxCellStyle) => void) => void;
  values: (string | number | null)[];
}

interface XlsxSheet {
  columns: XlsxColumn[];
  addRow: (values: (string | number | null)[]) => XlsxRowHandle;
  getRow: (n: number) => XlsxRowHandle;
  mergeCells: (range: string) => void;
}

interface XlsxModule {
  Workbook: new () => {
    addWorksheet: (name: string) => XlsxSheet;
    xlsx: { writeBuffer: () => Promise<ArrayBuffer> };
  };
}

interface XlsxSheetSpec {
  name: string;
  title?: string;
  header: string[];
  rows: { text: string; number: number | null }[][];
  columns: XlsxColumn[];
  numericFlags: boolean[];
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

function buildSheetSpec(
  sheetName: string,
  title: string | undefined,
  columns: IncomeExportColumn[],
  rows: AnchorIncomeRow[],
  period: string,
  options: IncomeExportOptions
): XlsxSheetSpec {
  return {
    name: sheetName,
    title,
    header: columns.map((col) => headerLabel(col, period)),
    rows: sortedRows(rows).map((row) => columns.map((col) => cellValue(row, col.key, options))),
    columns: columns.map((col) => ({ width: col.width })),
    numericFlags: columns.map((col) => Boolean(col.numeric)),
  };
}

async function exportXlsx(
  context: IncomeExportContext,
  options: IncomeExportOptions,
  columns: IncomeExportColumn[],
  sections: typeof GENDER_SECTIONS
) {
  const ExcelJS = await loadExcelJs();
  const { period, rows } = context;
  const workbook = new ExcelJS.Workbook();
  const specList: XlsxSheetSpec[] = sections.map((section) =>
    buildSheetSpec(
      section.sheet,
      options.withTitle ? buildTitle(options.company, period, section.label) : undefined,
      columns,
      pickRows(rows, section.key),
      period,
      options
    )
  );

  for (const spec of specList) {
    const sheet = workbook.addWorksheet(spec.name);
    sheet.columns = spec.columns;
    let cursor = 0;
    if (spec.title) {
      cursor += 1;
      const titleRow = sheet.addRow([spec.title]);
      titleRow.font = { bold: true, size: 14 };
      titleRow.alignment = { horizontal: "center", vertical: "middle" };
      sheet.mergeCells(`A${cursor}:${columnName(spec.header.length - 1)}${cursor}`);
      sheet.getRow(cursor).height = 26;
    }
    cursor += 1;
    const headerRow = sheet.addRow(spec.header);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };
    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    for (const row of spec.rows) {
      sheet.addRow(
        row.map((cell, index) => (spec.numericFlags[index] && cell.number !== null ? cell.number : cell.text))
      );
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const { label } = periodText(period);
  const filename =
    specList.length === 1
      ? xlsxFileName(options.company, period, specList[0].name)
      : `${companyText(options.company)}${label}_个人收入明细.xlsx`;
  triggerDownload(blob, filename);
}
