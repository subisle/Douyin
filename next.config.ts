import type { NextConfig } from "next";

const isElectron = process.env.ELECTRON === "true";

const nextConfig: NextConfig = {
  // Electron 打包时导出静态产物；服务器/Web 版本保留 Next.js API Route 能力
  output: isElectron ? "export" : undefined,
  // file:// 下没有图片优化服务
  images: { unoptimized: true },
  // 资源用相对路径，避免 file:// 下根路径 404
  assetPrefix: isElectron ? "./" : undefined,
  // 这些包含原生扩展或运行时探测的包不要打进 bundle：
  // ws 被打包后探测不到原生 bufferutil，会在运行时报 “bufferUtil.mask is not a function”。
  serverExternalPackages: ["ws", "sharp", "mysql2", "better-sqlite3"],
};

export default nextConfig;
