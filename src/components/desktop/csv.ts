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

export interface ImportableRow {
  anchorId: string;
  anchorName: string;
  value: number;
  rank: number;
  matched: boolean;
}

export interface ParseSummary {
  importable: ImportableRow[];
  matched: MatchedRow[];
  unmatched: { anchorIdRaw: string; anchorName: string; value: number }[];
  skipped: number; // 字段缺失/非法被跳过的行数
  totalRows: number;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_＿\-—–·.。:：/\\|()[\]{}（）【】<>《》]/g, "");
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

/** 时长分钟：支持 "2:30:45"(时:分:秒) / "150分钟" / "150" / "37小时16分钟5秒" / "1小时30分" */
function parseDuration(value: unknown): number {
  if (typeof value === "number") return value;
  const str = String(value ?? "").trim();
  if (!str) return NaN;

  // 中文格式：X小时Y分钟Z秒
  const cnMatch = str.match(/(?:(\d+)\s*小时)?(?:(\d+)\s*分[钟]?)?(?:(\d+)\s*秒)?/);
  if (cnMatch && (cnMatch[1] || cnMatch[2] || cnMatch[3])) {
    const h = parseInt(cnMatch[1] || "0", 10);
    const m = parseInt(cnMatch[2] || "0", 10);
    const s = parseInt(cnMatch[3] || "0", 10);
    return h * 60 + m + Math.round(s / 60);
  }

  // 时:分:秒 格式
  if (str.includes(":")) {
    const parts = str.split(":").map((p) => parseInt(p, 10) || 0);
    if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }

  // 纯数字或 "150分钟"
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
        // 列名映射：按优先级尝试多种可能的列名（大小写不敏感）
        const findCol = (...names: string[]) => {
          const normalizedNames = names.map(normalizeHeader);
          for (const key of Object.keys(results.data[0] ?? {})) {
            if (normalizedNames.includes(normalizeHeader(key))) return key;
          }
          return undefined;
        };
        const findNameCol = () => {
          const direct = findCol(
            "主播名",
            "主播名称",
            "主播昵称",
            "昵称",
            "用户昵称",
            "用户名称",
            "用户",
            "姓名",
            "名字",
            "抖音昵称",
            "抖音名",
            "抖音名称",
            "账号昵称",
            "账号名称",
            "达人昵称",
            "达人名称",
            "作者昵称",
            "作者名称",
            "成员",
            "成员名称",
            "主播",
            "anchor_name",
            "anchorName",
            "name",
            "nickname",
            "nick_name",
            "nickName"
          );
          if (direct) return direct;

          return Object.keys(results.data[0] ?? {}).find((key) => {
            const k = normalizeHeader(key);
            if (!k) return false;
            if (/(id|uid|rank|wave|duration|value|time)/i.test(k)) return false;
            if (/[号码值数额次分秒时长音浪排名]/.test(k)) return false;
            return ["昵称", "名称", "姓名", "名字", "主播名", "用户名", "达人名", "作者名"].some((token) =>
              k.includes(token)
            );
          });
        };

        for (const row of results.data) {
          // 主播 ID：支持「主播id / 主播ID / 抖音号 / 抖音ID / anchor_id / uid」
          const idCol = findCol("主播id", "主播ID", "主播账号", "抖音号", "抖音ID", "anchor_id", "anchorId", "uid");
          const anchorIdRaw = String(row[idCol ?? ""] ?? "").trim();
          // 名称（仅用于展示，不影响匹配）
          const nameCol = findNameCol();
          const anchorName = String(row[nameCol ?? ""] ?? "").trim();
          // 数值列：音浪或时长
          const valCol = kind === "wave"
            ? findCol("音浪", "wave_value", "wave", "总音浪")
            : findCol("时长", "duration", "duration_minutes", "直播时长", "开播有效时长", "有效时长", "开播时长");
          const value =
            kind === "wave"
              ? parseWaveValue(row[valCol ?? ""] ?? "")
              : parseDuration(row[valCol ?? ""] ?? "");
          const rankCol = findCol("排名", "rank");
          const rank = parseInt(String(row[rankCol ?? ""] ?? "0"), 10) || 0;
          rows.push({ anchorIdRaw, anchorName, value, rank });
        }
        resolve(rows);
      },
      error: (err) => reject(err),
    });
  });
}

/** 把原始行按 anchor_id 匹配到库里主播（全匹配 → douyinNo 匹配 → 名称精确匹配）
 *  历史上还做过「anchorId 前 8 位前缀」和「名称双向 includes」匹配，但都会因为前缀碰撞
 *  或一字姓名而把数据写到错误的人头上，已下线 —— 宁可让用户在 unmatched 里手动确认。
 */
export function matchRows(rows: ParsedRow[], anchors: AnchorRow[]): ParseSummary {
  const byId = new Map<string, AnchorRow>();
  const byDouyinNo = new Map<string, AnchorRow>();
  // 同名主播无法靠名字唯一定位，落到 nameDup 里跳过名称匹配，避免误写。
  const byName = new Map<string, AnchorRow>();
  const nameDup = new Set<string>();
  for (const a of anchors) {
    if (!a.anchorId) continue;
    byId.set(a.anchorId, a);
    if (a.douyinNo) byDouyinNo.set(a.douyinNo, a);
    const nm = (a.name || "").trim();
    if (nm) {
      if (byName.has(nm)) nameDup.add(nm);
      else byName.set(nm, a);
    }
  }

  const importable: ImportableRow[] = [];
  const matched: MatchedRow[] = [];
  const unmatched: ParseSummary["unmatched"] = [];
  let skipped = 0;

  for (const r of rows) {
    // 清理原始值：去除空格、引号
    const rawId = r.anchorIdRaw.replace(/["'\s]/g, "");
    if (!rawId || isNaN(r.value)) {
      skipped++;
      continue;
    }
    const nm = r.anchorName.trim();
    let anchor: AnchorRow | undefined =
      byId.get(rawId) || byDouyinNo.get(rawId);
    // 仅在名称非空、库内唯一时才用名称兜底
    if (!anchor && nm && !nameDup.has(nm)) {
      anchor = byName.get(nm);
    }
    if (anchor) {
      importable.push({
        anchorId: anchor.anchorId,
        anchorName: anchor.anchorName || anchor.name || r.anchorName,
        value: r.value,
        rank: r.rank,
        matched: true,
      });
      matched.push({
        anchorId: anchor.anchorId,
        name: anchor.anchorName || anchor.name || r.anchorName,
        value: r.value,
        rank: r.rank,
      });
    } else {
      importable.push({
        anchorId: rawId,
        anchorName: r.anchorName,
        value: r.value,
        rank: r.rank,
        matched: false,
      });
      unmatched.push({
        anchorIdRaw: rawId,
        anchorName: r.anchorName,
        value: r.value,
      });
    }
  }

  return { importable, matched, unmatched, skipped, totalRows: rows.length };
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
  // 延迟释放 URL，确保浏览器完成下载（立即 revoke 会导致下载失败）
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/** 从 CSV 提取主播信息（anchorId / douyinNo / name），按 anchorId 去重合并 */
export interface AnchorImportRow {
  anchorId: string;
  douyinNo: string;
  name: string;
}

export interface AnchorImportSummary {
  rows: AnchorImportRow[];
  totalRows: number;
  skipped: number;
  duplicateRows: number;
}

export function parseAnchorsCsvWithSummary(file: File): Promise<AnchorImportSummary> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const findCol = (...names: string[]) => {
          const normalizedNames = names.map(normalizeHeader);
          for (const key of Object.keys(results.data[0] ?? {})) {
            if (normalizedNames.includes(normalizeHeader(key))) return key;
          }
          return undefined;
        };

        // anchorId 列：优先主播id/anchor_id/uid，回退到抖音号
        const idCol = findCol("主播id", "主播ID", "主播账号", "anchor_id", "anchorId", "uid");
        const dyCol = findCol("抖音号", "抖音ID", "douyin_no", "douyin_id", "douyinNo");
        const nameCol = findCol(
          "主播名",
          "主播名称",
          "主播昵称",
          "昵称",
          "用户昵称",
          "用户名称",
          "用户",
          "姓名",
          "名字",
          "抖音昵称",
          "抖音名",
          "抖音名称",
          "账号昵称",
          "账号名称",
          "达人昵称",
          "达人名称",
          "作者昵称",
          "作者名称",
          "成员",
          "成员名称",
          "主播",
          "anchor_name",
          "anchorName",
          "name",
          "nickname",
          "nick_name",
          "nickName"
        );

        const map = new Map<string, AnchorImportRow>();
        let skipped = 0;
        let duplicateRows = 0;

        for (const row of results.data) {
          let anchorId = String(row[idCol ?? ""] ?? "").trim();
          const douyinNo = String(row[dyCol ?? ""] ?? "").trim();
          const name = String(row[nameCol ?? ""] ?? "").trim();

          // 如果没有主播id列，用抖音号作为 anchorId
          if (!anchorId && douyinNo) anchorId = douyinNo;
          if (!anchorId) {
            skipped++;
            continue;
          }

          const existing = map.get(anchorId);
          if (existing) {
            duplicateRows++;
            // 合并：填充缺失字段
            if (!existing.name && name) existing.name = name;
            if (!existing.douyinNo && douyinNo) existing.douyinNo = douyinNo;
          } else {
            map.set(anchorId, { anchorId, douyinNo, name });
          }
        }

        resolve({
          rows: Array.from(map.values()),
          totalRows: results.data.length,
          skipped,
          duplicateRows,
        });
      },
      error: (err) => reject(err),
    });
  });
}

export function parseAnchorsCsv(file: File): Promise<AnchorImportRow[]> {
  return parseAnchorsCsvWithSummary(file).then((summary) => summary.rows);
}
