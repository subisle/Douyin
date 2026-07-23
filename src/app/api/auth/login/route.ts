import { NextResponse } from "next/server";
import { apiFail } from "@/server/api/response";
import { createSessionToken, sessionCookieValue, verifyPassword } from "@/server/api/session";
import {
  loginRateLimiter,
  loginRateLimitKeys,
} from "@/server/api/login-rate-limit.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuredUsername() {
  return (process.env.ADMIN_USERNAME || process.env.WEB_USERNAME || "").trim();
}

function configuredPassword() {
  return process.env.ADMIN_PASSWORD || process.env.WEB_PASSWORD || "";
}

export async function POST(request: Request) {
  try {
    const usernameExpected = configuredUsername();
    const passwordExpected = configuredPassword();
    if (!usernameExpected || !passwordExpected) {
      return apiFail(
        "服务端未配置 ADMIN_USERNAME/ADMIN_PASSWORD，拒绝登录",
        503,
        "AUTH_NOT_CONFIGURED"
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) return apiFail("请输入账号和密码", 400, "BAD_REQUEST");
    const rateLimitKeys = loginRateLimitKeys(request, username);
    const limited = loginRateLimiter.current(rateLimitKeys);
    if (limited.limited) {
      const response = apiFail("登录尝试过多，请稍后重试", 429, "RATE_LIMITED");
      response.headers.set("Retry-After", String(limited.retryAfterSeconds));
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const passwordValid = verifyPassword(password, passwordExpected);
    if (username !== usernameExpected || !passwordValid) {
      const failed = loginRateLimiter.recordFailure(rateLimitKeys);
      if (failed.limited) {
        const response = apiFail("登录尝试过多，请稍后重试", 429, "RATE_LIMITED");
        response.headers.set("Retry-After", String(failed.retryAfterSeconds));
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
      return apiFail("账号或密码错误", 401, "UNAUTHORIZED");
    }

    loginRateLimiter.clear(rateLimitKeys);
    const token = createSessionToken(username);
    return NextResponse.json(
      { success: true, data: { username } },
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
