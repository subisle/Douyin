export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const falsy = (value?: string) => {
    const text = String(value || "").trim().toLowerCase();
    return text === "0" || text === "false" || text === "no" || text === "off";
  };

  // 桌面端由 Electron 托管微信/QQ，Next 只当渲染进程，不要在这里拉 Bot。
  if (falsy(process.env.PROJECT_BOTS) || falsy(process.env.BOT_EMBEDDED) || process.env.ELECTRON === "true") {
    console.log("[project-bots] skipped on Next boot");
    return;
  }

  try {
    const [{ pathToFileURL }, path] = await Promise.all([
      import("url"),
      import("path"),
    ]);
    const href = pathToFileURL(path.join(process.cwd(), "src/server/bots/runtime.js")).href;
    const loaded = await import(/* webpackIgnore: true */ href) as {
      shouldSkipProjectBots?: () => boolean;
      startProjectBots?: () => Promise<unknown>;
      default?: {
        shouldSkipProjectBots?: () => boolean;
        startProjectBots?: () => Promise<unknown>;
      };
    };
    const runtime = loaded.startProjectBots ? loaded : loaded.default;
    if (!runtime?.startProjectBots) {
      throw new Error("project bots runtime missing startProjectBots");
    }
    if (runtime.shouldSkipProjectBots?.()) {
      console.log("[project-bots] skipped on Next boot");
      return;
    }
    await runtime.startProjectBots();
  } catch (error) {
    console.error("[project-bots] Next boot start failed", error);
  }
}
