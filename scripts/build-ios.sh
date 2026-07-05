#!/usr/bin/env bash
# iOS 构建脚本（占位）
# 注意: iOS 构建需要 Xcode 并在 macOS 环境下运行。
# 真实构建请使用: task ios:build 或 Xcode 项目。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[build-ios] ============================================"
echo "[build-ios] iOS 构建需要 Xcode + macOS 环境"
echo "[build-ios] 请在 macOS 上使用以下命令构建："
echo "[build-ios]   cd $REPO_ROOT && wails3 task ios:build"
echo "[build-ios] 或参考 build/ios/Taskfile.yml"
echo "[build-ios] ============================================"
echo ""
echo "[build-ios] 前置条件:"
echo "  1. macOS + Xcode 15+"
echo "  2. go 1.25+ with iOS cross-compilation toolchain"
echo "  3. 前端依赖已安装 (npm ci)"
echo ""
echo "[build-ios] 当前平台: $(uname -s) $(uname -m)"
echo "[build-ios] 跳过构建"
