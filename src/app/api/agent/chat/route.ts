import { createRequire } from "module";
import { NextRequest, NextResponse } from "next/server";
import {
  authenticateApiRequest,
  requireApiAccess,
  scopeApiSessionId,
} from "@/server/api/auth";
import { apiFail, apiOk } from "@/server/api/response";

export const runtime = "nodejs";

const require = createRequire(import.meta.url);

export async function POST(req: NextRequest) {
  try {
    const auth = requireApiAccess(req);
    if (auth) return auth;
    const principal = authenticateApiRequest(req);
    if (!principal) return apiFail("未登录或缺少有效 API Token", 401, "UNAUTHORIZED");

    const body = await req.json().catch(() => ({}));
    const message = String(body.message || body.text || "").trim();
    const sessionId = scopeApiSessionId(principal, body.sessionId, "agent");
    if (!message) {
      return apiFail("message 不能为空", 400, "BAD_REQUEST");
    }

    const { handleServerAgentChat } = require("../../../../../electron/weixin-bot-server-agent.js");
    const sessionStore = require("../../../../../electron/weixin-bot-session-store.js");

    const result = await sessionStore.runSessionExclusive(sessionId, async () => {
      const session = sessionStore.getSession(sessionId);
      const history = (session.messages || []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      }));

      const agentResult = await handleServerAgentChat({ message, sessionId, history });
      if (agentResult?.success) {
        sessionStore.appendSession(sessionId, "user", message);
        sessionStore.appendSession(sessionId, "assistant", agentResult.data?.reply || "");
      }
      return agentResult;
    });
    if (!result?.success) {
      return NextResponse.json(result || { success: false, error: "unknown" }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[api/agent/chat]", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const auth = requireApiAccess(req);
  if (auth) return auth;
  return apiOk({
    service: "agent-chat",
    phase: "P1-tools",
    features: ["fast-route", "analytics-tools", "rag", "optional-llm-loop", "file-session"],
  });
}
