import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "module";
import {
  authenticateApiRequest,
  requireApiAccess,
} from "@/server/api/auth";
import { apiFail, apiOk } from "@/server/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(req: NextRequest) {
  try {
    const denied = requireApiAccess(req);
    if (denied) return denied;
    const principal = authenticateApiRequest(req);
    if (!principal) return apiFail("未登录或缺少有效 API Token", 401, "UNAUTHORIZED");

    const loginSlotId =
      String(req.nextUrl.searchParams.get("slot") || req.nextUrl.searchParams.get("loginSlotId") || "default").trim()
      || "default";
    const actorId = `${principal.kind}:${principal.id}`;

    const { getIlinkRuntimeContext } = require("../../../../../../scripts/ilink-runtime-db.js");
    const runtime = getIlinkRuntimeContext(process.env);

    const result = await runtime.loginStore.getLoginResult({
      workspaceId: runtime.workspaceId,
      loginSlotId,
      actorId,
    });

    if (!result?.ok) {
      const status =
        result?.code === "FORBIDDEN" ? 403 : result?.code === "NOT_FOUND" ? 404 : 400;
      return noStore(
        NextResponse.json(
          { success: false, error: result?.error || "failed", code: result?.code },
          { status }
        )
      );
    }

    // Never cache QR payloads.
    return noStore(
      apiOk({
        loginSlotId,
        requestId: result.requestId,
        status: result.status,
        controlStatus: result.controlStatus,
        result: result.result,
        errorMessage: result.errorMessage,
        expiresAt: result.expiresAt,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return noStore(apiFail(message, 500, "LOGIN_STATUS_FAILED"));
  }
}
