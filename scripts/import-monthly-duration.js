"use strict";
/**
 * 导入月度时长快照（按「月」整体覆盖）。
 *
 * 用法:
 *   node scripts/import-monthly-duration.js <csv路径> <YYYY-MM> [--dry-run]
 *
 * 示例:
 *   node scripts/import-monthly-duration.js "7月的时长.csv" 2026-07 --dry-run
 *   node scripts/import-monthly-duration.js "7月的时长.csv" 2026-07
 *
 * 逻辑与 electron/weixin-bot-commands.js 的微信 CSV 导入一致：
 *   decodeCsv -> inferImportKind -> parseCsvText -> matchImportRows -> importDurationSnapshots
 */
const fs = require("fs");
const path = require("path");
const { importDurationSnapshots, getAnchors } = require("../electron/db");
const {
  inferImportKind,
  parseCsvText,
  matchImportRows,
  buildImportMeta,
} = require("../electron/weixin-bot-commands");

function decodeCsv(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("gb18030").decode(buffer).replace(/^\uFEFF/, "");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((a) => a.toLowerCase().endsWith(".csv"));
  const month = args.find((a) => /^\d{4}-\d{2}$/.test(a));
  if (!filePath || !month) {
    console.error("用法: node scripts/import-monthly-duration.js <csv路径> <YYYY-MM> [--dry-run]");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  const text = decodeCsv(buffer);
  const fileName = path.basename(filePath);
  const kind = inferImportKind(text, fileName, month);
  if (kind !== "duration") {
    console.error(`[中止] 该文件被识别为「${kind}」，本脚本仅支持时长(duration)导入。`);
    process.exit(1);
  }

  const parsed = parseCsvText(text, kind);
  const anchors = await getAnchors();
  const matched = matchImportRows(parsed.rows, anchors);

  console.log(`=== ${fileName} → ${month}（${dryRun ? "DRY-RUN 预览，不写库" : "实际导入"}）===\n`);
  console.log(`解析行: ${parsed.totalRows}  有效行: ${parsed.rows.length}  非法行: ${parsed.skipped}`);
  console.log(`匹配主播: ${matched.rows.length}  未匹配: ${matched.unmatched.length}  重复行: ${matched.duplicateRows}`);

  if (matched.unmatched.length > 0) {
    console.log("\n未匹配到主播的行（不会导入）:");
    for (const row of matched.unmatched) {
      console.log(`  - ID=${row.anchorIdRaw || "(空)"}  昵称=${row.anchorName || "(空)"}  时长值=${row.value}`);
    }
  }

  if (matched.rows.length === 0) {
    console.error("\n[中止] 没有可导入的匹配行。");
    process.exit(1);
  }

  const meta = buildImportMeta(buffer, fileName, kind, matched.rows);
  const importRows = matched.rows.map((row) => ({ anchorId: row.anchorId, totalMinutes: row.value }));

  if (dryRun) {
    const totalMinutes = importRows.reduce((sum, r) => sum + (r.totalMinutes || 0), 0);
    console.log(`\n[DRY-RUN] 将导入 ${importRows.length} 条到 ${month}（月末快照点），累计 ${totalMinutes} 分钟。`);
    console.log("[DRY-RUN] 未写库。加 --dry-run 以外的参数前请先确认。");
    process.exit(0);
  }

  const result = await importDurationSnapshots(month, importRows, meta);
  console.log(`\n[完成] 已导入 ${month} 时长: ${result.inserted} 条受影响。`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[失败]", err && err.message ? err.message : err);
  process.exit(1);
});
