import { NextResponse } from "next/server";
import { requireApiAccess } from "@/server/api/auth";
import { callLegacyDb } from "@/server/db/legacy-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set([
  "getAnchors",
  "getFamilyTree",
  "getRosterBySurname",
  "exportFamilyRoster",
  "getDashboardSummary",
  "getStartupHealth",
  "getWaveRanking",
  "getWaveTrendByGender",
  "importWaveSnapshots",
  "importDurationSnapshots",
  "getImportPreview",
  "exportWaveSnapshots",
  "exportDurationSnapshots",
  "exportAnchors",
  "addAnchor",
  "batchImportAnchors",
  "mergeAccounts",
  "deleteAnchors",
  "findDuplicateAnchors",
  "getWaveTrendTotal",
  "getAnchorCountTrend",
  "updateAnchorName",
  "updateAnchorInfo",
  "updateAnchorMaster",
  "getAnchorDailySnapshot",
  "saveAnchorDailySnapshot",
  "getAnchorWaveTrend",
  "getAnchorsWaveTrend",
  "getFlowingFlag",
  "settleFlagScores",
  "getFlagGroups",
  "getTierRules",
  "saveTierRules",
  "getDailyWaveReport",
  "getPkRoster",
  "buildPkGroups",
  "getStarBattleScores",
  "saveStarBattleScore",
  "getFlagWinner",
  "getRewardReport",
  "getAnchorIncome",
  "getIncomePeriods",
  "importAnchorIncome",
  "saveAnchorIncomeProfile",
  "deleteAnchorIncome",
]);

export async function POST(request: Request) {
  try {
    const auth = requireApiAccess(request);
    if (auth) return auth;

    const body = await request.json();
    const method = typeof body?.method === "string" ? body.method : "";
    const args = Array.isArray(body?.args) ? body.args : [];

    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        { success: false, error: `不允许的 API 方法：${method || "<empty>"}` },
        { status: 400 }
      );
    }

    const data = await callLegacyDb(method, ...args);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[api/ipc]", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
