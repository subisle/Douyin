import Papa from "papaparse";
import type { AnchorRow } from "@/types/electron";

export type ImportKind = "wave" | "duration";

export interface ParsedRow {
  anchorIdRaw: string;
  anchorName: string;
  value: number; // 音浪值 或 时长分钟
  rank: number; // 仅音浪用
}

export interface MatchedRow {
  anchorId: string; // 库里匹配到的真实 anchor_id
  name: string;
  value: number;
  rank: number;
}

export interface ParseSummary {
  matched: MatchedRow[];
  unmatched: { anchorIdRaw: string; anchorName: string; value: number }[];
  skipped: number; // 字段缺失/非法被跳过的行数
  totalRows: number;
}

/** 音浪值：支持 "12.5万" / "125000" / "12,500" */
function parseWaveValue(value: unknown): number {
  if (typeof value === "number") return value;
  const str = String(value ?? "").trim();
  if (!str) return NaN;
  if (str.includes("万")) {
    const num = parseFloat(str.replace("万", ""));
    return isNaN(num) ? NaN : Math.round(num * 10000);
  }
  const n = parseInt(str.replace(/,/g, ""), 10);
  return isNaN(n) ? NaN : n;
}

/** 时长分钟：支持 "2:30:45"(时:分:秒) / "150分钟" / "150" */
function parseDuration(value: unknown): number {
  if (typeof value === "number") return value;
  const str = String(value ?? "").trim();
  if (!str) return NaN;
  if (str.includes(":")) {
    const parts = str.split(":").map((p) => parseInt(p, 10) || 0);
    if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  const n = parseInt(str.replace(/[^\d]/g, ""), 10);
  return isNaN(n) ? NaN : n;
}

/** 解析 CSV 文件为原始行 */
export function parseCsvFile(file: File, kind: ImportKind): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows: ParsedRow[] = [];
        for (const row of results.data) {
          const anchorIdRaw = String(
            row["抖音号"] ?? row["anchor_id"] ?? row["抖音ID"] ?? ""
          ).trim();
          const anchorName = String(row["昵称"] ?? row["anchor_name"] ?? row["主播"] ?? "").trim();
          const value =
            kind === "wave"
              ? parseWaveValue(row["音浪"] ?? row["wave_value"])
              : parseDuration(row["时长"] ?? row["duration"] ?? row["duration_minutes"]);
          const rank = parseInt(String(row["排名"] ?? row["rank"] ?? "0"), 10) || 0;
          rows.push({ anchorIdRaw, anchorName, value, rank });
        }
        resolve(rows);
      },
      error: (err) => reject(err),
    });
  });
}

/** 把原始行按 anchor_id 匹配到库里主播（全匹配 → 前8位匹配） */
export function matchRows(rows: ParsedRow[], anchors: AnchorRow[]): ParseSummary {
  const byId = new Map<string, AnchorRow>();
  const byFirst8 = new Map<string, AnchorRow>();
  for (const a of anchors) {
    if (a.anchorId) {
      byId.set(a.anchorId, a);
      byFirst8.set(a.anchorId.substring(0, 8), a);
    }
  }

  const matched: MatchedRow[] = [];
  const unmatched: ParseSummary["unmatched"] = [];
  let skipped = 0;

  for (const r of rows) {
    if (!r.anchorIdRaw || isNaN(r.value)) {
      skipped++;
      continue;
    }
    const anchor =
      byId.get(r.anchorIdRaw) || byFirst8.get(r.anchorIdRaw.substring(0, 8));
    if (anchor) {
      matched.push({
        anchorId: anchor.anchorId,
        name: anchor.anchorName || anchor.name || r.anchorName,
        value: r.value,
        rank: r.rank,
      });
    } else {
      unmatched.push({
        anchorIdRaw: r.anchorIdRaw,
        anchorName: r.anchorName,
        value: r.value,
      });
    }
  }

  return { matched, unmatched, skipped, totalRows: rows.length };
}

/** 导出数据为 CSV 并触发下载（带 BOM 兼容 Excel 中文） */
export function downloadCsv(data: Record<string, unknown>[], filename: string): void {
  const csv = Papa.unparse(data);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
