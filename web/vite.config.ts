import { defineConfig } from "vite";

// 前后端分离：前端不碰数据库，只通过 HTTP 调 Go 后端。
// 开发时由 Vite 代理 /api 到后端，避免跨域；生产用同一个域名反代。
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
