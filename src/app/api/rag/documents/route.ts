import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import { requireApiAccess } from "@/server/api/auth";
import { apiFail, apiOk } from "@/server/api/response";
import { readJsonObject, ApiRequestError } from "@/server/api/request";

export const runtime = "nodejs";
const require = createRequire(import.meta.url);
const {
  resolveRagCustomPath,
  ragCustomMaxBytes,
} = require("../../../../../electron/local-paths.js");
const { appendCustomDocument } = require("../../../../../electron/weixin-bot-rag-store.js");

const MAX_TITLE_CHARS = 256;
const MAX_ID_CHARS = 128;
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;

type RagDocument = {
  id?: unknown;
  collection?: unknown;
  title?: unknown;
  text?: unknown;
};

function customPath() {
  return resolveRagCustomPath();
}

export async function GET(req: NextRequest) {
  const auth = requireApiAccess(req);
  if (auth) return auth;

  const { loadRagDocuments } = require("../../../../../electron/weixin-bot-rag.js");
  const documents = loadRagDocuments().map((document: RagDocument) => ({
    id: String(document.id || ""),
    collection: String(document.collection || ""),
    title: String(document.title || ""),
    text: String(document.text || ""),
  }));
  return apiOk({ documents });
}

export async function POST(req: NextRequest) {
  const auth = requireApiAccess(req);
  if (auth) return auth;

  let body;
  try {
    body = await readJsonObject(req, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return apiFail(error.message, error.status, error.code);
    }
    throw error;
  }
  if (body.title !== undefined && typeof body.title !== "string") {
    return apiFail("title 必须是字符串", 400, "BAD_REQUEST");
  }
  if (body.text !== undefined && typeof body.text !== "string") {
    return apiFail("text 必须是字符串", 400, "BAD_REQUEST");
  }
  if (body.id !== undefined && typeof body.id !== "string") {
    return apiFail("id 必须是字符串", 400, "BAD_REQUEST");
  }
  const title = String(body.title || "").trim();
  const text = String(body.text || "").trim();
  const requestedId = String(body.id || "").trim();
  if (!title || !text) {
    return apiFail("title/text 必填", 400, "BAD_REQUEST");
  }
  if (title.length > MAX_TITLE_CHARS) {
    return apiFail(`title 不能超过 ${MAX_TITLE_CHARS} 个字符`, 400, "BAD_REQUEST");
  }
  if (text.length > MAX_REQUEST_BYTES) {
    return apiFail("text 超过请求大小上限", 413, "PAYLOAD_TOO_LARGE");
  }
  if (requestedId.length > MAX_ID_CHARS || /[\u0000-\u001f\u007f]/.test(requestedId)) {
    return apiFail(`id 不能超过 ${MAX_ID_CHARS} 个字符且不得包含控制字符`, 400, "BAD_REQUEST");
  }
  const id = requestedId || `custom-${randomUUID()}`;
  try {
    await appendCustomDocument(
      { id, title, text },
      { file: customPath(), maxBytes: ragCustomMaxBytes() }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/超过容量上限/.test(message)) {
      return apiFail(message, 413, "PAYLOAD_TOO_LARGE");
    }
    if (/ID 已存在/.test(message)) {
      return apiFail(message, 400, "BAD_REQUEST");
    }
    if (/文件格式损坏|不是普通文件/.test(message)) {
      return apiFail("知识库文件不可写，请先检查存储文件", 409, "BAD_REQUEST");
    }
    throw error;
  }
  return apiOk({ id });
}
