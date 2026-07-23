import type { ApiErrorCode } from "./response";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(message: string, status: number, code: ApiErrorCode) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function requestError(message: string) {
  return new ApiRequestError(message, 400, "BAD_REQUEST");
}

function payloadTooLarge(maxBytes: number) {
  return new ApiRequestError(
    `请求体不能超过 ${maxBytes} 字节`,
    413,
    "PAYLOAD_TOO_LARGE"
  );
}

export async function readJsonObject(
  request: Request,
  maxBytes: number
): Promise<Record<string, unknown>> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("JSON 请求体上限配置无效");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isInteger(declaredBytes) || declaredBytes < 0) {
      throw requestError("Content-Length 无效");
    }
    if (declaredBytes > maxBytes) throw payloadTooLarge(maxBytes);
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maxBytes) {
          await reader.cancel();
          throw payloadTooLarge(maxBytes);
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const raw = Buffer.concat(chunks, receivedBytes).toString("utf8");
  if (!raw.trim()) return {};

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw requestError("请求体不是有效 JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw requestError("请求体必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}
