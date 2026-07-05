#!/usr/bin/env bash
# macOS (Darwin) 桌面构建脚本
# 用法: ./scripts/build-darwin.sh [--production] [--clean]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$REPO_ROOT"
BIN_DIR="$PROJECT_DIR/bin"
BIN_NAME="MikuMikuAR"

PRODUCTION=false
CLEAN=false
for arg in "$@"; do
  case $arg in
    --production) PRODUCTION=true ;;
    --clean) CLEAN=true ;;
  esac
done

# 读取版本号
VERSION=$(node -e "console.log(require('$REPO_ROOT/package.json').version)")
echo "[build-darwin] 版本: $VERSION"

# 同步 config.yml version
CONFIG_YML="$PROJECT_DIR/build/config.yml"
if [ -f "$CONFIG_YML" ]; then
  sed -i '' "s/^\(\s*version:\s*\)\".*\"/\1\"$VERSION\"/" "$CONFIG_YML"
  echo "[build-darwin] 同步 config.yml version -> $VERSION"
fi

# 清理
if [ "$CLEAN" = true ]; then
  echo "[build-darwin] 清理构建产物..."
  rm -rf "$BIN_DIR"
fi

# 确保 dist 目录
DIST_DIR="$REPO_ROOT/dist"
mkdir -p "$DIST_DIR"

cd "$PROJECT_DIR"

# 前端构建
echo "[build-darwin] 构建前端..."
cd frontend
npm ci --quiet
npx vite build
cd "$PROJECT_DIR"

# Go 编译
BUILD_TAGS="debug"
LDFLAGS="-X main.AppVersion=$VERSION"
if [ "$PRODUCTION" = true ]; then
  BUILD_TAGS="production"
  LDFLAGS="$LDFLAGS -s -w"
fi

echo "[build-darwin] 编译 Go (tags=$BUILD_TAGS)..."
go build \
  -tags "$BUILD_TAGS" \
  -trimpath \
  -buildvcs=false \
  -ldflags "$LDFLAGS" \
  -o "$BIN_DIR/$BIN_NAME"

# 重命名产物
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  ARCH_STR="amd64" ;;
  arm64)   ARCH_STR="arm64" ;;
  *)       ARCH_STR="$ARCH" ;;
esac
DST_BIN="$DIST_DIR/mikumikuar-$VERSION-darwin-$ARCH_STR"
if [ -f "$BIN_DIR/$BIN_NAME" ]; then
  cp "$BIN_DIR/$BIN_NAME" "$DST_BIN"
  chmod +x "$DST_BIN"
  SIZE=$(du -h "$DST_BIN" | cut -f1)
  echo ""
  echo "[build-darwin] 构建完成"
  echo "   产物: $DST_BIN"
  echo "   大小: $SIZE"
else
  echo "[build-darwin] 错误: 未找到构建产物: $BIN_DIR/$BIN_NAME" >&2
  exit 1
fi

cd "$REPO_ROOT"
