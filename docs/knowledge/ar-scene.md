---
kind: ar_scene
name: AR 模式场景级协调
category: scene
scope:
  - frontend/src/scene/ar/ar-scene.ts
source_files:
  - frontend/src/scene/ar/ar-scene.ts
adr:
  - ADR-055
---

## 系统概览
AR Scene：切换 AR 模式时同步调整场景状态（清屏颜色、天空可见性、视线追踪）。依赖 `ar-camera.ts`（摄像头流）+ `scene`（清屏色）+ `env-impl`（天空网格）+ `proc-motion-bridge`（视线追踪）。

## 核心职责
- 进入 AR：保存原清屏色（`_originalClearColor`）、隐藏天空、挂起反射（`setReflectionARSuspended`）、激活感知（眼/头追踪 `activatePerception`）
- 退出 AR：恢复清屏色、天空可见性、视线追踪原状态（`_prevGazeState`）
- **AR 接触阴影**（blob-shadow）：AR passthrough 无平面检测，模型悬浮显「飘」；用贴脚的半透明径向渐变「假阴影」在视觉上把模型「踩稳」（Unity blob-shadow projector 同思路的轻量替代，无需 ARCore/ARKit）
- 阴影每帧经 `onBeforeRenderObservable` 句柄（ObserverHandle）按当前 AABB 等比缩放，避免重建 mesh

## 对外 API（节选）
- `setARMode(active: boolean)` — 场景级 AR 进入/退出协调（`true` 进入、`false` 退出），由 `scene.ts` re-export
- `takeARScreenshot()` / `isARModeActive()` — AR 截图与状态查询（re-export）
- 依赖 `startARCamera` / `stopARCamera` / `isARActive` / `captureARScreenshot`（来自 `ar-camera.ts`）

## 关键约定
- 接触阴影 mesh 与每帧句柄在退出 AR 时经 `safeDispose` 释放，避免泄漏
- 视线追踪状态在退出时精确还原（记录 `_prevGazeState`）

## 与其他子系统关系
- 依赖 `ar-camera.ts`、`env/env-impl`、`env/env-reflection`、`motion/perception`（视线追踪）
- 依赖 `core/observer-handle`（每帧阴影句柄）、`core/dispose-helpers`
- 状态源：`core/config`（`focusedModelId` / `modelRegistry`）
