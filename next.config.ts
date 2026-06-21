import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 让打包后的 Electron 通过 file:// 直接加载静态产物
  output: "export",
  // file:// 下没有图片优化服务
  images: { unoptimized: true },
  // 资源用相对路径，避免 file:// 下根路径 404
  assetPrefix: process.env.ELECTRON === "true" ? "./" : undefined,
};

export default nextConfig;
