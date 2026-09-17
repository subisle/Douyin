# ---------------------------------------------------------------------------
# RK3318 BOX — Rockchip RK3318 (aarch64 / arm64, 4x Cortex-A53)
#   Host : Armbian 26.2.0-trunk.488 trixie (Debian 13)
#   Kernel: 6.18.13-current-rockchip64
#   Docker: 29.x, 原生平台 linux/aarch64, overlayfs + cgroup v2
#
# 本机原生构建（在盒子上）:
#   docker build --platform linux/arm64 -t douyin-data-manager:arm64 .
# 交叉构建（x64 开发机 → arm64，buildx + QEMU）:
#   bash scripts/docker-build-arm64.sh --save release/douyin-arm64.tar
#   scp release/douyin-arm64.tar root@<box>:/tmp/ && ssh root@<box> 'docker load -i /tmp/douyin-arm64.tar'
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

# ---------------------------------------------------------------------------
# build-tools：只给 deps / build 阶段用。
# 提供 g++ / python3 兜底：若 sharp / better-sqlite3 的 arm64 预编译包下载失败，
# node-gyp 可现场编译。该层不会进入最终镜像。
# ---------------------------------------------------------------------------
FROM base AS build-tools
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------------------------------------------------------------------------
# deps：仅生产依赖。sharp 在此拿到 @img/sharp-linux-arm64 预编译二进制。
# ---------------------------------------------------------------------------
FROM build-tools AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# build：编译 Next.js。
# --ignore-scripts 跳过 dev 原生依赖（better-sqlite3 仅桌面备份脚本用），
# 盒子 4×A53 上省下几分钟编译时间。
# NODE_OPTIONS 限制堆：RK3318 通常 2–4 GB RAM，next build 不设限容易 OOM。
# ---------------------------------------------------------------------------
FROM build-tools AS build
ARG BUILD_NODE_OPTIONS="--max-old-space-size=2048"
ENV NODE_OPTIONS=${BUILD_NODE_OPTIONS}
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build \
 && rm -rf node_modules .next/cache

# ---------------------------------------------------------------------------
# runtime
#   fonts-noto-cjk：日报 / PK 分组图出图必须有中文字体，否则方框乱码。
# ---------------------------------------------------------------------------
FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl tzdata fontconfig fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=1024" \
    PORT=3000 \
    PROJECT_BOTS=0
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/. ./
# slim 镜像不含 typescript（devDep）。next start 读取 next.config.ts 时会现场
# npm install typescript，导致启动极慢。这里用等价 JS 配置替换（构建期已用
# 原配置产出 .next，运行时只需同构的 config）。
RUN printf '%s\n' \
      'const isElectron = process.env.ELECTRON === "true";' \
      'const nextConfig = {' \
      '  output: isElectron ? "export" : undefined,' \
      '  images: { unoptimized: true },' \
      '  assetPrefix: isElectron ? "./" : undefined,' \
      '};' \
      'export default nextConfig;' \
      > next.config.mjs \
 && rm -f next.config.ts
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" || exit 1
CMD ["npm", "run", "start"]
