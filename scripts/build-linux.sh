#!/usr/bin/env bash
# Linux 桌面构建脚本
# 用法: ./scripts/build-linux.sh [--production] [--clean]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$REPO_ROOT/MikuMikuAR"

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
echo "[build-linux] 版本: $VERSION"

# 同步 config.yml version（Wails 框架会读取此字段）
CONFIG_YML="$PROJECT_DIR/build/config.yml"
if [ -f "$CONFIG_YML" ]; then
  sed -i "s/^\(\s*version:\s*\)\".*\"/\1\"$VERSION\"/" "$CONFIG_YML"
  echo "[build-linux] 同步 config.yml version -> $VERSION"
fi

# 清理
if [ "$CLEAN" = true ]; then
  echo "[build-linux] 清理构建产物..."
  rm -rf "$PROJECT_DIR/bin"
fi

cd "$PROJECT_DIR"

# 前端构建
echo "[build-linux] 构建前端..."
cd frontend
npm ci --quiet
npx vite build
cd "$PROJECT_DIR"

# Go 编译
LDFLAGS="-X main.AppVersion=$VERSION"
BUILD_TAGS="debug"
if [ "$PRODUCTION" = true ]; then
  LDFLAGS="$LDFLAGS -s -w"
  BUILD_TAGS="production"
fi

echo "[build-linux] 编译 Go (tags=$BUILD_TAGS, ldflags=$LDFLAGS)..."
wails3 build -platform linux/amd64 -ldflags "$LDFLAGS"

# 重命名产物
DIST_DIR="$REPO_ROOT/dist"
mkdir -p "$DIST_DIR"

SRC_BIN="$PROJECT_DIR/bin/MikuMikuAR"
DST_BIN="$DIST_DIR/mikumikuar-$VERSION-linux-amd64"

if [ -f "$SRC_BIN" ]; then
  cp "$SRC_BIN" "$DST_BIN"
  chmod +x "$DST_BIN"
  SIZE=$(du -h "$DST_BIN" | cut -f1)
  echo ""
  echo "[build-linux] 构建完成"
  echo "   产物: $DST_BIN"
  echo "   大小: $SIZE"
else
  echo "[build-linux] 错误: 未找到构建产物: $SRC_BIN" >&2
  exit 1
fi

cd "$REPO_ROOT"
