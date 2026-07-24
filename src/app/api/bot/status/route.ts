import { NextRequest } from "next/server";
import fs from "fs";
import { createRequire } from "module";
import { requireApiAccess } from "@/server/api/auth";
import { apiOk } from "@/server/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);
const { resolveWorkerStatusPath } = require("../../../../../electron/local-paths.js");

function readWorkerStatus() {
  const statusPath = resolveWorkerStatusPath();
  try {
    const stat = fs.statSync(statusPath);
    if (stat.size > 64 * 1024) throw new Error("状态文件超过 64KB");
    const raw = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    const rawExpiry = raw.leaseExpiresAt;
    const expiryMs = typeof rawExpiry === "number" || /^\d+$/.test(String(rawExpiry || "").trim())
      ? Number(rawExpiry)
      : Date.parse(String(rawExpiry || ""));
    const leaseExpiresAt = Number.isFinite(expiryMs)
      ? new Date(expiryMs).toISOString()
      : null;
    const leaseExpired = raw.phase === "running"
      && (!leaseExpiresAt || expiryMs <= Date.now());
    return {
      phase: leaseExpired ? "stale" : String(raw.phase || "unknown"),
      runner: String(raw.runner || process.env.BOT_RUNNER || "server"),
      workerRunning: raw.phase === "running" && !leaseExpired,
      startedAt: raw.startedAt || null,
      stoppedAt: raw.stoppedAt || null,
      lastHeartbeatAt: raw.lastHeartbeatAt || null,
      leaseExpiresAt,
      lastError: raw.lastError || (leaseExpired ? "Worker 租约已过期" : null),
      persistence: String(raw.persistence || "not_connected"),
      statusUpdatedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return {
      phase: missing ? "not_started" : "status_error",
      runner: process.env.BOT_RUNNER || "server",
      workerRunning: false,
      startedAt: null,
      stoppedAt: null,
      lastHeartbeatAt: null,
      leaseExpiresAt: null,
      lastError: missing
        ? null
        : error instanceof Error ? error.message : String(error),
      persistence: "not_connected",
      statusUpdatedAt: null,
    };
  }
}

export async function GET(req: NextRequest) {
  const auth = requireApiAccess(req);
  if (auth) return auth;

  return apiOk({
    ...readWorkerStatus(),
    connected: false,
    transport: "not_connected",
    message:
      "实验路径：文本 transport / 可选 MySQL lease·Inbox·Outbox·登录控制可能已接线（见 worker status 字段与 env 开关）。persistence=mysql 不代表生产可用；租约或心跳存在也不代表微信会话一定在线。",
    agentChat: "/api/agent/chat",
    rag: "/api/rag/search",
  });
}
