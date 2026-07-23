---
kind: ar_camera
name: AR 摄像头视频透传
category: scene
scope:
  - frontend/src/scene/ar/ar-camera.ts
source_files:
  - frontend/src/scene/ar/ar-camera.ts
adr:
  - ADR-055
---

## 系统概览
AR Camera：摄像头视频流管理（ADR-055）。提供 `start` / `stop` / `switchFacing` 接口，维护 `<video>` 元素。渲染合成策略为透明 canvas + CSS `<video>` 底层（S2 方案，性能最优）。

## 核心职责
- `startARCamera()` / `stopARCamera()` / `captureARScreenshot()` / `isARActive()`
- 维护内部状态 `ARCameraState`（`active` / `facing` / `streamId`）+ `<video>` 元素
- `CameraFacing = 'user' | 'environment'`，支持前后摄切换
- 镜像覆盖标记 `_mirrorOverridden`（用户手动设置过镜像）

## 并发与竞态防御（关键）
- **代数令牌 `_arGen`**：每次发起/终止 AR 自增；`startARCamera` await `getUserMedia` 后检测 `myGen !== _arGen` 即丢弃流并 `return false`，杜绝「幽灵 AR」（已离开 AR 但 `isARActive()===true`）
- **防重入 `_starting`**：避免并发双 `getUserMedia` 泄漏摄像头流
- Android 经 `window.__onArcCameraPermission` 回调桥接权限结果（`ensureAndroidCameraPermission`）

## 对外 API（节选）
- `startARCamera(): Promise<boolean>` / `stopARCamera()`
- `switchFacing()` — 切换前后摄像头
- `captureARScreenshot()` — AR 截图
- `onARModeChange(cb)` — 注册 AR 模式变更监听（`_listeners`）

## 与其他子系统关系
- 依赖 `core/config`（`dom` / `setStatus`）、`core/platform`（`isAndroidPlatform`）、`core/i18n`
- 上游：`ar-scene.ts`（场景级协调）、`scene/ar` 整体
