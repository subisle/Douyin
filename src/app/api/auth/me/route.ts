import { apiFail, apiOk } from "@/server/api/response";
import { parseSessionToken, readCookie, sessionCookieName } from "@/server/api/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = parseSessionToken(readCookie(request, sessionCookieName()));
  if (!session) return apiFail("未登录", 401, "UNAUTHORIZED");
  return apiOk({ username: session.username });
}
