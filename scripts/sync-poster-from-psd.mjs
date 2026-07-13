#!/usr/bin/env node
/**
 * Thin launcher for offline PSD poster sync (方案 A).
 * Prefers the local psd-tools venv, falls back to python3.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pyScript = path.join(root, "scripts", "sync-poster-from-psd.py");
const venvPy = path.join(root, ".codex-temp", "psd-venv", "bin", "python");
const python = existsSync(venvPy) ? venvPy : "python3";

const args = process.argv.slice(2);
const result = spawnSync(python, [pyScript, ...args], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
