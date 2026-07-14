import { createHash, randomBytes, timingSafeEqual } from "crypto";

const SESSION_COOKIE = "douyin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function secret() {
  const value = (process.env.SESSION_SECRET || process.env.JWT_SECRET || "").trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("缺少 SESSION_SECRET/JWT_SECRET，生产环境拒绝签发会话");
  }
  // 仅开发环境允许临时密钥，避免本地阻塞；生产必须显式配置。
  return "douyin-dev-session-secret";
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function sign(payload: string) {
  return sha256(`${payload}.${secret()}`);
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyPassword(input: string, expected: string) {
  if (!expected) return false;
  const value = input || "";
  if (expected.startsWith("sha256:")) return safeEqual(`sha256:${sha256(value)}`, expected);
  return safeEqual(value, expected);
}

export function createSessionToken(username: string) {
  const payload = Buffer.from(
    JSON.stringify({
      u: username,
      iat: Date.now(),
      nonce: randomBytes(8).toString("hex"),
    })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string | undefined | null) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: string;
      iat?: number;
    };
    if (!data.u || !data.iat) return null;
    if (Date.now() - data.iat > SESSION_MAX_AGE_SECONDS * 1000) return null;
    return { username: data.u };
  } catch {
    return null;
  }
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export function sessionCookieValue(token: string) {
  const secure = process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookieValue() {
  const secure = process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}
