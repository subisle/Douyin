#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const requiredEvidence = [
  "data/rag/bot_help.json",
  "electron/local-paths.js",
  "electron/runtime-env.js",
  "electron/db-config.js",
  "electron/weixin-bot-analytics.js",
  "electron/weixin-bot-mode.js",
  "electron/weixin-bot-rag.js",
  "electron/weixin-bot-runner-lock.js",
  "electron/weixin-bot-server-agent.js",
  "electron/weixin-bot-session-store.js",
  "scripts/bot-worker.js",
  "scripts/migrate.js",
  "scripts/migration-runner.js",
  "migrations/001_ilink_runtime.js",
  "migrations/002_outbox_tenant_fk.js",
  "src/app/agent/page.tsx",
  "src/app/bot/page.tsx",
  "src/app/knowledge/page.tsx",
  "src/app/api/agent/chat/route.ts",
  "src/app/api/bot/status/route.ts",
  "src/app/api/rag/documents/route.ts",
  "src/app/api/rag/search/route.ts",
  "src/server/bot-core/rag.js",
  "src/server/api/auth.ts",
];

const requiredIgnoredPaths = [
  ".env",
  ".env.local",
  "data/runtime/release-check.json",
  "data/local-bench/release-check.json",
  "data/backups/release-check.sql",
  "data/rag/custom.json",
  "release/release-check.app",
];

const requiredPackagePatterns = [
  "electron/**/*",
  "!electron/**/*.test.js",
  "!electron/**/*-test.js",
  "!electron/dist/**/*",
  "assets/**/*",
  "!assets/fonts/**/*",
  "!assets/posters/**/*",
  "data/rag/bot_help.json",
  "out/**/*",
  "package.json",
];

const missing = [];
const untracked = [];
const unignored = [];
const packagePatternErrors = [];

for (const file of requiredEvidence) {
  if (!fs.existsSync(file)) {
    missing.push(file);
    continue;
  }
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", file], {
      stdio: "ignore",
    });
  } catch {
    untracked.push(file);
  }
}

for (const file of requiredIgnoredPaths) {
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--no-index", "--", file], {
      stdio: "ignore",
    });
  } catch {
    unignored.push(file);
  }
}

try {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const configuredPatterns = new Set(packageJson?.build?.files || []);
  for (const pattern of requiredPackagePatterns) {
    if (!configuredPatterns.has(pattern)) packagePatternErrors.push(pattern);
  }
} catch (error) {
  packagePatternErrors.push(`package.json (${error.message})`);
}

if (missing.length || untracked.length || unignored.length || packagePatternErrors.length) {
  if (missing.length) console.error(`Missing release evidence:\n- ${missing.join("\n- ")}`);
  if (untracked.length) console.error(`Untracked release evidence:\n- ${untracked.join("\n- ")}`);
  if (unignored.length) console.error(`Unprotected local release paths:\n- ${unignored.join("\n- ")}`);
  if (packagePatternErrors.length) {
    console.error(`Missing Electron package boundary patterns:\n- ${packagePatternErrors.join("\n- ")}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Release baseline verified (${requiredEvidence.length} tracked paths, `
      + `${requiredIgnoredPaths.length} ignored local paths, `
      + `${requiredPackagePatterns.length} package patterns).`,
  );
}
