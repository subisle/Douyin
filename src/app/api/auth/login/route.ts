import { NextResponse } from "next/server";
import { apiFail } from "@/server/api/response";
import { createSessionToken, sessionCookieValue, verifyPassword } from "@/server/api/session";
import {
  loginRateLimiter,
  loginRateLimitKeys,
} from "@/server/api/login-rate-limit.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuredPassword() {
  const value = (process.env.ADMIN_PASSWORD || process.env.WEB_PASSWORD || "").trim();
  // 未配置时回落到固定密码，单密码登录，无账号概念。
  return value || "200309";
}

export async function POST(request: Request) {
  try {
    const passwordExpected = configuredPassword();

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const password = String(body.password || "");

    if (!password) return apiFail("请输入密码", 400, "BAD_REQUEST");
    const rateLimitKeys = loginRateLimitKeys(request, "web");
    const limited = loginRateLimiter.current(rateLimitKeys);
    if (limited.limited) {
      const response = apiFail("登录尝试过多，请稍后重试", 429, "RATE_LIMITED");
      response.headers.set("Retry-After", String(limited.retryAfterSeconds));
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const passwordValid = verifyPassword(password, passwordExpected);
    if (!passwordValid) {
      const failed = loginRateLimiter.recordFailure(rateLimitKeys);
      if (failed.limited) {
        const response = apiFail("登录尝试过多，请稍后重试", 429, "RATE_LIMITED");
        response.headers.set("Retry-After", String(failed.retryAfterSeconds));
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
      return apiFail("密码错误", 401, "UNAUTHORIZED");
    }

    loginRateLimiter.clear(rateLimitKeys);
    const token = createSessionToken("admin");
    return NextResponse.json(
      { success: true, data: { username: "admin" } },
      {
        headers: {
          "Set-Cookie": sessionCookieValue(token),
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return apiFail(error instanceof Error ? error.message : String(error), 500, "INTERNAL_ERROR");
  }
}
