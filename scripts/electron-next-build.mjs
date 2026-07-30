#!/usr/bin/env node
/**
 * Electron static export cannot include Next.js API routes.
 * Stash src/app/api during build, then always restore.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "src/app/api");
const backupDir = path.join(root, ".api-backup-electron-build");

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function stashApiRoutes() {
  if (fs.existsSync(backupDir)) rmrf(backupDir);
  if (fs.existsSync(apiDir)) {
    console.log("[electron-build] stash API routes → .api-backup-electron-build");
    fs.renameSync(apiDir, backupDir);
  }
}

function restoreApiRoutes() {
  if (!fs.existsSync(backupDir)) return;
  console.log("[electron-build] restore API routes");
  if (fs.existsSync(apiDir)) rmrf(apiDir);
  fs.renameSync(backupDir, apiDir);
}

stashApiRoutes();
let exitCode = 1;
try {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["cross-env", "ELECTRON=true", "next", "build"],
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    }
  );
  exitCode = result.status == null ? 1 : result.status;
} finally {
  restoreApiRoutes();
}

process.exit(exitCode);
