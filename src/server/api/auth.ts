import { apiFail } from "./response";
import { parseSessionToken, readCookie, sessionCookieName } from "./session";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

function hasValidApiToken(request: Request) {
  const tokens = configuredTokens();
  if (tokens.length === 0) return false;
  const token = requestToken(request);
  return Boolean(token && tokens.includes(token));
}

function hasValidSession(request: Request) {
  return Boolean(parseSessionToken(readCookie(request, sessionCookieName())));
}

export function isWriteRequest(request: Request) {
  return WRITE_METHODS.has(request.method.toUpperCase());
}

export function requireApiAccess(request: Request, options: { public?: boolean } = {}) {
  if (options.public) return null;
  if (hasValidSession(request) || hasValidApiToken(request)) return null;
  return apiFail("未登录或缺少有效 API Token", 401, "UNAUTHORIZED");
}

export function requireApiToken(request: Request) {
  return requireApiAccess(request, { public: !isWriteRequest(request) });
}
