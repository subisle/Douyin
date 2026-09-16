#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 构建 linux/arm64 镜像（RK3318 BOX: aarch64, Armbian 13 trixie, Docker 29）
#
#   bash scripts/docker-build-arm64.sh --native          # 在盒子上原生构建（推荐）
#   bash scripts/docker-build-arm64.sh --load            # x64 开发机 buildx 交叉构建并载入本地
#   bash scripts/docker-build-arm64.sh --save release/douyin-arm64.tar
#   bash scripts/docker-build-arm64.sh --push ghcr.io/<owner>/douyin:arm64
#
# 说明：交叉构建依赖 QEMU binfmt。Docker Desktop 自带；Linux 宿主先执行
#   docker run --privileged --rm tonistiigi/binfmt --install arm64
# ---------------------------------------------------------------------------
set -euo pipefail

IMAGE="${IMAGE:-douyin-data-manager:arm64}"
MODE="load"
FILE="release/douyin-arm64.tar"
PUSH_REF=""
PLATFORM="linux/arm64"

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --native) MODE="native"; shift ;;
    --load)   MODE="load";   shift ;;
    --save)   MODE="save";   FILE="${2:-$FILE}"; shift 2 ;;
    --push)   MODE="push";   PUSH_REF="${2:-}";  shift 2 ;;
    --image)  IMAGE="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数: $1" >&2; usage ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "$MODE" in
  native)
    echo "[build] 原生构建 $PLATFORM → $IMAGE"
    docker build --platform "$PLATFORM" -t "$IMAGE" .
    ;;
  load)
    echo "[build] buildx 交叉构建 $PLATFORM → $IMAGE (--load)"
    docker buildx build --platform "$PLATFORM" -t "$IMAGE" --load .
    ;;
  save)
    echo "[build] buildx 交叉构建 $PLATFORM → $IMAGE，导出 $FILE"
    docker buildx build --platform "$PLATFORM" -t "$IMAGE" --load .
    mkdir -p "$(dirname "$FILE")"
    docker save "$IMAGE" -o "$FILE"
    echo "[build] 拷贝到盒子后执行: docker load -i $(basename "$FILE")"
    ;;
  push)
    [[ -n "$PUSH_REF" ]] || { echo "--push 需要仓库地址" >&2; exit 2; }
    echo "[build] buildx 交叉构建 $PLATFORM → $PUSH_REF (--push)"
    docker buildx build --platform "$PLATFORM" -t "$PUSH_REF" --push .
    ;;
esac

echo "[build] 完成: $IMAGE ($PLATFORM)"
