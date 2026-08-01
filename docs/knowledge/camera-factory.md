---
tier: leaf
kind: camera_factory
name: 相机工厂 + 用户输入
category: scene
scope:
  - frontend/src/scene/camera/camera-factory.ts
source_files:
  - frontend/src/scene/camera/camera-factory.ts
adr:
  - ADR-148
symbols:
  - createOrbitCamera
  - createFreeflyCamera
  - createSurroundCamera
  - createConcertCamera
  - createOneshotCamera
  - applyCameraUserSettings
  - refreshCameraUserSettings
  - disposeViewMatrixHandle
  - setSchedulePersistCallback
invariants:
  - 每个相机创建函数返回 Babylon Camera 实例并 attachControl
  - viewMatrix 句柄通过 _bindViewMatrixPersist 绑定，触发 scheduleCameraPersist 防抖保存
  - disposeViewMatrixHandle 在 switchCameraMode 切换相机前显式调用，避免 observer 累积
tests:
  - frontend/src/__tests__/camera.test.ts
use_when:
  - 创建相机实例
  - 用户输入设置（键盘/鼠标/触摸）
  - 视角变化持久化
---

# 相机工厂 + 用户输入

## 系统概览
**相机工厂 + 用户输入模块**（ADR-148 阶段 3 续拆，2026-07-26）。从 camera.ts 抽出相机实例化逻辑：根据模式创建对应 Babylon Camera（ArcRotateCamera / UniversalCamera），配置输入参数（键盘 / 鼠标 / 触摸），并绑定 viewMatrix observer 触发防抖保存。

## 核心职责
- `createOrbitCamera(scene, canvas)` — 创建 ArcRotateCamera（默认 orbit 模式相机）
- `createFreeflyCamera(scene, canvas)` — 创建 UniversalCamera（自由飞行模式）
- `createSurroundCamera(scene)` — 创建 surround（环绕/转台）模式的 ArcRotateCamera
- `createConcertCamera(scene)` — 创建 concert（粉丝机位）模式的 ArcRotateCamera
- `createOneshotCamera(scene, canvas)` — 创建 oneshot 模式相机（一次性 VMD 切入）
- `applyCameraUserSettings(cam)` — 应用键盘 / 鼠标 / 触摸输入设置到相机
- `refreshCameraUserSettings()` — 用户设置变更后刷新所有相机的输入参数
- `disposeViewMatrixHandle()` — 显式释放 viewMatrix observer 句柄
- `setSchedulePersistCallback(cb)` — camera.ts 在 `initCameraSystem` 时注入 `scheduleCameraPersist` 回调，破除循环依赖

## 与其他子系统关系
- 依赖 `camera-state.ts`（`getCameraPreset` / `getFocusCenterY` / `getFov` / `isTouchDevice` / `getViewMatrixHandle` / `setViewMatrixHandle`）
- 依赖 `invertablePointersInput`（反 Y 轴指针输入）
- 被 `camera.ts` 调用（`initCameraSystem` / `switchCameraMode` 在各 case 分支调用对应工厂函数）

## 不变量
- 每个相机创建函数返回 Babylon Camera 实例并 `attachControl(canvas)`
- viewMatrix 句柄通过 `_bindViewMatrixPersist(cam)` 绑定，相机视角变化时触发 `scheduleCameraPersist`（500ms 防抖保存）
- `disposeViewMatrixHandle()` 在 `switchCameraMode` 切换相机前显式调用，避免 observer 累积（虽然 cam.dispose 也会清理，但双保险）
- 工厂函数不修改 `_currentCamera` / `_cameraMode` 等状态（这些由 camera.ts 的 switchCameraMode 统一提交）
