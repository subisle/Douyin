/* eslint-disable @typescript-eslint/no-require-imports */
import { shouldSkipProjectBots, startProjectBots } from "./server/bots/runtime.js";

/** 只用到 qqBots 列表，这里给个最小结构类型，避免依赖 CJS 模块的类型推导 */
type StartedBots = { qqBots?: Array<{ key?: string }> } | null;

/**
 * Next 服务端启动钩子。
 *
 * 桌面 Electron 由 Electron 主进程托管微信 / QQ；
 * 服务器（Docker / 裸机）由本进程内嵌启动机器人，条件：PROJECT_BOTS=1（或 BOT_EMBEDDED=1）且非 Electron。
 * 是否跳过由 runtime.js 的 shouldSkipProjectBots 统一判断，避免两处规则分叉。
 *
 * 注意：这里必须是 **静态字面量 require/import**，动态路径会被 webpack 替换成运行时桩函数并抛
 * MODULE_NOT_FOUND（构建产物里可以看到 c(16379)(a) 这种占位）。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  if (shouldSkipProjectBots()) {
    console.log("[project-bots] skipped (desktop 或 PROJECT_BOTS=0)");
    return;
  }

  try {
    const bots: StartedBots = await startProjectBots();
    if (bots) {
      const keys = Array.isArray(bots.qqBots)
        ? bots.qqBots.map((item: { key?: string }) => String(item?.key || ""))
        : [];
      console.log(
        `[project-bots] 已启动：微信 + ${keys.length} 个 QQ 机器人${keys.length ? ` (${keys.join(", ")})` : ""}`
      );
    }
  } catch (error) {
    // 机器人启动失败不应拖垮 Web 服务：记录后继续提供页面与 API
    console.error("[project-bots] 启动失败：", error instanceof Error ? error.message : error);
  }
}
