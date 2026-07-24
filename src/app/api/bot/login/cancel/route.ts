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

export async function POST(req: NextRequest) {
  try {
    const denied = requireApiAccess(req);
    if (denied) return denied;
    const principal = authenticateApiRequest(req);
    if (!principal) return apiFail("未登录或缺少有效 API Token", 401, "UNAUTHORIZED");

    const body = await req.json().catch(() => ({}));
    const loginSlotId = String(body.loginSlotId || body.slot || "default").trim() || "default";
    const actorId = `${principal.kind}:${principal.id}`;

    const { getIlinkRuntimeContext } = require("../../../../../../scripts/ilink-runtime-db.js");
    const runtime = getIlinkRuntimeContext(process.env);

    // Ensure the actor owns the slot before cancel (getLoginResult enforces actor).
    const peek = await runtime.loginStore.getLoginResult({
      workspaceId: runtime.workspaceId,
      loginSlotId,
      actorId,
    });
    if (!peek?.ok) {
      const status =
        peek?.code === "FORBIDDEN" ? 403 : peek?.code === "NOT_FOUND" ? 404 : 400;
      return noStore(
        NextResponse.json(
          { success: false, error: peek?.error || "failed", code: peek?.code },
          { status }
        )
      );
    }

    const cancelled = await runtime.loginStore.cancelLoginRequest({
      workspaceId: runtime.workspaceId,
      loginSlotId,
      actorId,
    });
    if (!cancelled?.ok) {
      return noStore(
        NextResponse.json(
          { success: false, error: cancelled?.error || "cancel failed", code: cancelled?.code },
          { status: 400 }
        )
      );
    }

    return noStore(apiOk({ loginSlotId, cancelled: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return noStore(apiFail(message, 500, "LOGIN_CANCEL_FAILED"));
  }
}
