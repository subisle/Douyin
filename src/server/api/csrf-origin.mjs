const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeOrigin(value) {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === "null") return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins(request, env) {
  const origins = new Set();
  for (const value of [request.url, env.APP_URL, env.NEXT_PUBLIC_API_BASE_URL]) {
    const origin = normalizeOrigin(value);
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * Cookie-authenticated state changes must prove they came from this app.
 * Origin is preferred; Referer is only a fallback for clients that omit it.
 */
export function isTrustedStateChangingRequest(request, env = process.env) {
  if (!UNSAFE_METHODS.has(String(request?.method || "").toUpperCase())) return true;

  const originHeader = request?.headers?.get?.("origin")?.trim() || "";
  const refererHeader = request?.headers?.get?.("referer")?.trim() || "";
  const supplied = originHeader || refererHeader;
  if (!supplied) return false;

  const suppliedOrigin = normalizeOrigin(supplied);
  return Boolean(suppliedOrigin && configuredOrigins(request, env).has(suppliedOrigin));
}

export { normalizeOrigin };
