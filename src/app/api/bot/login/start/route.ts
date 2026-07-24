import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "module";
import { randomUUID } from "crypto";
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
    const ttlMs = Number(body.ttlMs) > 0 ? Number(body.ttlMs) : 120_000;
    const accountId =
      body.accountId == null || body.accountId === ""
        ? null
        : Number(body.accountId);

    const { getIlinkRuntimeContext } = require("../../../../../../scripts/ilink-runtime-db.js");
    const runtime = getIlinkRuntimeContext(process.env);
    const actorId = `${principal.kind}:${principal.id}`;

    const created = await runtime.loginStore.createLoginRequest({
      workspaceId: runtime.workspaceId,
      loginSlotId,
      actorId,
      accountId,
      ttlMs,
      requestId: randomUUID(),
    });

    if (!created?.ok) {
      return noStore(
        NextResponse.json(
          { success: false, error: created?.error || "create failed", code: created?.code },
          { status: 400 }
        )
      );
    }

    return noStore(
      apiOk({
        loginSlotId: created.loginSlotId,
        requestId: created.requestId,
        status: created.status,
        expiresAt: created.expiresAt,
        workspaceId: runtime.workspaceId,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return noStore(apiFail(message, 500, "LOGIN_START_FAILED"));
  }
}
