export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  // 这是桌面项目：微信/QQ 由 Electron 托管，Next 只做渲染，不在这里拉 Bot。
  console.log("[project-bots] skipped on Next boot");
}
