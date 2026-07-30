import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "MISSING_IDS"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "PAYLOAD_TOO_LARGE"
  | "AUTH_NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "LOGIN_START_FAILED"
  | "LOGIN_STATUS_FAILED"
  | "LOGIN_CANCEL_FAILED"
  | "INTERNAL_ERROR";

export function apiOk(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiFail(message: string, status = 400, code: ApiErrorCode = "BAD_REQUEST", detail?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, detail } },
    { status }
  );
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
