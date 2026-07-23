import { NextRequest } from "next/server";
import { requireApiAccess } from "@/server/api/auth";
import { apiFail, apiOk } from "@/server/api/response";
import { ragSearch } from "@/server/bot-core/rag";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = requireApiAccess(req);
  if (auth) return auth;

  const body = await req.json().catch(() => ({}));
  const query = String(body.query || body.message || "").trim();
  if (!query) {
    return apiFail("query 不能为空", 400, "BAD_REQUEST");
  }
  const data = ragSearch(query, {
    topK: Number(body.topK) || 4,
    collection: body.collection || null,
  });
  return apiOk(data);
}
