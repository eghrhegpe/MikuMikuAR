---
kind: platform_detection
name: 平台能力探测
category: core
scope:
  - frontend/src/core/platform.ts
source_files:
  - frontend/src/core/platform.ts
adr:
  - ADR-176
symbols:
  - isAndroidPlatform
  - isWebPlatform
  - awaitWailsBridge
  - openExternalURL
  - guardExternalAction
invariants:
  - 平台探测函数保持无副作用；启动期桥接选择必须使用 awaitWailsBridge 或 resolveBackend
  - Android 与纯浏览器均禁止外部桌面应用动作
use_when:
  - Android、Web、Wails、平台判断、外部链接、Blender 不可用
---

## 系统概览
跨平台运行时探测与降级工具，隔离 Android WebView、纯浏览器和桌面 Wails 环境的差异。模块保持无副作用，避免测试或菜单仅为读取平台而触发应用启动副作用。

## 对外 API（节选）
- `isAndroidPlatform()` — 检测 Wails Android 平台。
- `isWebPlatform()` — 同步检测纯浏览器；不适用于 Android 冷启动阶段。
- `awaitWailsBridge(timeout)` — 等待 WebView 注入 `window.wails`，超时返回 `false`。
- `openExternalURL(url)` — Android 使用临时 `<a>` 打开外部链接，桌面返回 `false` 交给调用方走 Wails Browser。
- `guardExternalAction(label)` — 拦截 Android/Web 的 Blender、MMD 等桌面应用动作。

## 不变量
- `isWebPlatform()` 只做稳定期同步判定，启动期后端选型不得依赖它。
- 轮询超时后必须停止继续解析，避免定时器泄漏。

## 验证入口
- 测试：平台模块暂无专属测试，优先通过 backend 解析与启动测试间接验证。

