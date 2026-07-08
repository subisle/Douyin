#!/bin/bash
set -e
cd "$(dirname "$0")/.."

API_DIR="src/app/api"
BACKUP_DIR=".api-backup"

echo "📦 Electron 打包脚本"
echo "─────────────────────"

# 1. 临时移走 API routes
if [ -d "$API_DIR" ]; then
  echo "1. 临时移除 API routes..."
  rm -rf "$BACKUP_DIR"
  mv "$API_DIR" "$BACKUP_DIR"
fi

# 2. 打包
echo "2. 执行 next build + electron-builder..."
trap 'echo "❌ 打包失败"' ERR

npm run electron:build && npx electron-builder --mac --win --x64

# 3. 恢复 API routes
if [ -d "$BACKUP_DIR" ]; then
  echo "3. 恢复 API routes..."
  rm -rf "$API_DIR"
  mv "$BACKUP_DIR" "$API_DIR"
fi

echo "✅ 打包完成！"
