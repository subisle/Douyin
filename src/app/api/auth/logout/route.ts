import { NextResponse } from "next/server";
import { clearSessionCookieValue } from "@/server/api/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { success: true, data: { ok: true } },
    { headers: { "Set-Cookie": clearSessionCookieValue() } }
  );
}
