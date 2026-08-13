import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const filename = typeof __filename === "string"
    ? __filename
    : fileURLToPath(import.meta.url);
  const require = createRequire(filename);
  const runtime = require("./server/bots/runtime.js") as {
    shouldSkipProjectBots: () => boolean;
    startProjectBots: () => Promise<unknown>;
  };

  if (runtime.shouldSkipProjectBots()) {
    console.log("[project-bots] skipped on Next boot");
    return;
  }

  try {
    await runtime.startProjectBots();
  } catch (error) {
    console.error("[project-bots] Next boot start failed", error);
  }
}
