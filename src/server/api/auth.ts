import { createHash, timingSafeEqual } from "crypto";
import { apiFail } from "./response";
import { parseSessionToken, readCookie, sessionCookieName } from "./session";
import { isTrustedStateChangingRequest } from "./csrf-origin.mjs";

function configuredTokens() {
  return (process.env.API_TOKENS || process.env.API_TOKEN || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function requestToken(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  return bearer || request.headers.get("x-api-token")?.trim() || "";
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function principalId(kind: "session" | "api-token", value: string) {
  return createHash("sha256").update(`${kind}\0${value}`).digest("hex").slice(0, 24);
}

export type ApiPrincipal = {
  kind: "session" | "api-token";
  id: string;
};

function apiTokenPrincipal(request: Request): ApiPrincipal | null {
  const tokens = configuredTokens();
  if (tokens.length === 0) return null;
  const token = requestToken(request);
  const matched = token && tokens.find((candidate) => safeEqual(candidate, token));
  return matched ? { kind: "api-token", id: principalId("api-token", matched) } : null;
}

function sessionPrincipal(request: Request): ApiPrincipal | null {
  try {
    const session = parseSessionToken(readCookie(request, sessionCookieName()));
    return session
      ? { kind: "session", id: principalId("session", session.username) }
      : null;
  } catch {
    return null;
  }
}

export function authenticateApiRequest(request: Request): ApiPrincipal | null {
  // An explicit service token must not be shadowed by an ambient browser cookie.
  return apiTokenPrincipal(request) || sessionPrincipal(request);
}

export function scopeApiSessionId(
  principal: ApiPrincipal,
  clientSessionId: unknown,
  namespace = "agent"
) {
  const clientId = String(clientSessionId || "default").trim().slice(0, 256) || "default";
  const clientHash = createHash("sha256").update(clientId).digest("hex").slice(0, 24);
  const safeNamespace = namespace.replace(/[^a-z0-9_-]/gi, "").slice(0, 24) || "session";
  return `${safeNamespace}:${principal.id}:${clientHash}`;
}

export function requireApiAccess(request: Request, options: { public?: boolean } = {}) {
  if (options.public) return null;
  const principal = authenticateApiRequest(request);
  if (!principal) return apiFail("未登录或缺少有效 API Token", 401, "UNAUTHORIZED");
  if (principal.kind === "session" && !isTrustedStateChangingRequest(request)) {
    return apiFail("请求来源不受信任", 403, "FORBIDDEN");
  }
  return null;
}
