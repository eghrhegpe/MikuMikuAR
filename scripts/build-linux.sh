#!/usr/bin/env bash
# Linux 桌面构建脚本
# 用法: ./scripts/build-linux.sh [--production] [--clean]
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
echo "[build-linux] 版本: $VERSION"

# 同步 config.yml version
CONFIG_YML="$PROJECT_DIR/build/config.yml"
if [ -f "$CONFIG_YML" ]; then
  sed -i "s/^\(\s*version:\s*\)\".*\"/\1\"$VERSION\"/" "$CONFIG_YML"
  echo "[build-linux] 同步 config.yml version -> $VERSION"
fi

# 清理
if [ "$CLEAN" = true ]; then
  echo "[build-linux] 清理构建产物..."
  rm -rf "$BIN_DIR"
fi

# 确保 dist 目录
DIST_DIR="$REPO_ROOT/dist"
mkdir -p "$DIST_DIR"

cd "$PROJECT_DIR"

# 启用 MPR 多线程物理（ADR-099）
# 前端 Vite define 注入 __MMD_ENABLE_MPR__ 门控 MPR/SPR 路径；
# Go 侧通过 "mpr" build tag 启用 CoopCoepMiddleware 注入 COOP/COEP 双头。
export VITE_MMD_WASM_MT=1

# 前端构建
echo "[build-linux] 构建前端..."
cd frontend
npm ci --quiet
npx vite build
cd "$PROJECT_DIR"

# Go 编译
BUILD_TAGS="debug mpr"
LDFLAGS="-X main.AppVersion=$VERSION"
if [ "$PRODUCTION" = true ]; then
  BUILD_TAGS="production mpr"
  LDFLAGS="$LDFLAGS -s -w"
fi

echo "[build-linux] 编译 Go (tags=$BUILD_TAGS)..."
go build \
  -tags "$BUILD_TAGS" \
  -trimpath \
  -buildvcs=false \
  -ldflags "$LDFLAGS" \
  -o "$BIN_DIR/$BIN_NAME"

# 重命名产物
DST_BIN="$DIST_DIR/mikumikuar-$VERSION-linux-amd64"
if [ -f "$BIN_DIR/$BIN_NAME" ]; then
  cp "$BIN_DIR/$BIN_NAME" "$DST_BIN"
  chmod +x "$DST_BIN"
  SIZE=$(du -h "$DST_BIN" | cut -f1)
  echo ""
  echo "[build-linux] 构建完成"
  echo "   产物: $DST_BIN"
  echo "   大小: $SIZE"
else
  echo "[build-linux] 错误: 未找到构建产物: $BIN_DIR/$BIN_NAME" >&2
  exit 1
fi

cd "$REPO_ROOT"
