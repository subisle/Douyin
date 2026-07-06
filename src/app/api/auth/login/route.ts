import { NextResponse } from "next/server";
import { apiFail } from "@/server/api/response";
import { createSessionToken, sessionCookieValue, verifyPassword } from "@/server/api/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuredUsername() {
  return process.env.ADMIN_USERNAME || process.env.WEB_USERNAME || "admin";
}

function configuredPassword() {
  return process.env.ADMIN_PASSWORD || process.env.WEB_PASSWORD || "admin123456";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) return apiFail("请输入账号和密码", 400, "BAD_REQUEST");
    if (username !== configuredUsername() || !verifyPassword(password, configuredPassword())) {
      return apiFail("账号或密码错误", 401, "UNAUTHORIZED");
    }

    const token = createSessionToken(username);
    return NextResponse.json(
      { success: true, data: { username } },
      { headers: { "Set-Cookie": sessionCookieValue(token) } }
    );
  } catch (error) {
    return apiFail(error instanceof Error ? error.message : String(error), 500, "INTERNAL_ERROR");
  }
}
