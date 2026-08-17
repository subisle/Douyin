import "dotenv/config";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const db = require("../electron/db.js");
const { buildPkGroups, formatGroupsText } = require("../electron/pk-group-engine");
const { renderPkGroupsPng } = require("../electron/pk-group-image");
const { PRESET_BATTLE_META } = require("../shared/pk-preset-battle-groups");

const period = process.argv[2] || "2026-07";
const roster = await db.getPkRoster(period, 8);
const pool = [...(roster.males || [])];
const built = buildPkGroups({
  members: pool,
  mode: "preset",
  scoreField: "latestWave",
  firstStart: PRESET_BATTLE_META.firstStart,
  stepMinutes: PRESET_BATTLE_META.stepMinutes,
});
console.log(formatGroupsText(built));
const outDir = path.join("data", "runtime", "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `星嗨艺创_${PRESET_BATTLE_META.label}_${period}.png`);
const png = await renderPkGroupsPng(built, {
  period,
  title: "星嗨艺创",
  rosterSource: PRESET_BATTLE_META.source,
  constraints: built.constraints,
});
fs.writeFileSync(outFile, png);
console.log("WROTE", path.resolve(outFile), png.length);
process.exit(0);
