---
kind: camera_mode_manager
name: 相机模式管理系统（MmdCamera）
category: scene
scope:
  - frontend/src/scene/camera/**
source_files:
  - frontend/src/scene/camera/camera.ts
  - frontend/src/scene/camera/camera-state.ts
  - frontend/src/scene/camera/camera-vmd.ts
  - frontend/src/scene/camera/camera-factory.ts
  - frontend/src/scene/camera/camera-behaviors.ts
  - frontend/src/scene/camera/camera-bone-lock.ts
  - frontend/src/scene/camera/camera-auto.ts
adr:
  - ADR-035
  - ADR-100
  - ADR-148
---

## 系统概览
相机模式管理系统（[doc:architecture]）。负责相机模式切换（orbit / freefly / surround / concert / oneshot / vmd / ar）、自动构图、自由飞行输入、VMD 相机动画、骨骼锁定、节拍驱动自动运镜。封装 babylon-mmd 的 `MmdCamera` 并管理其生命周期（含 `dispose` 释放，避免卸载泄漏）。复用 `invertablePointersInput` 实现反 Y 轴指针。

ADR-148 阶段 3 续拆（2026-07-26）：原 1373 行 `camera.ts` 拆为 7 文件（camera.ts 715 + camera-state.ts 262 + camera-vmd.ts 80 + camera-factory.ts 198 + camera-behaviors.ts 231 + camera-bone-lock.ts 130 + camera-auto.ts 166）。`camera.ts` 退化为 barrel 入口 + 主调度（switchCameraMode / 双轴派生 / 序列化）。

## 核心职责
- `camera.ts`(715) — 相机模式切换调度（`switchCameraMode`）、双轴派生（`_syncAxesFromMode` / `LEGACY_MODE_MAP` / `deriveLegacyMode`）、`setCameraControl` / `setCameraBehavior` 双轴写入入口、`CameraState` 序列化、子模块回调注入、barrel re-export
- `camera-state.ts`(262) — 纯状态变量 + 运行时上下文（scene/canvas 引用 + `_viewMatrixHandle` 等共享句柄）
- `camera-vmd.ts`(80) — VMD 相机动画：`loadCameraVmd` / `clearCameraVmd` / `animateCameraVmd` / `createVmdCamera`
- `camera-factory.ts`(198) — 相机工厂：`createOrbitCamera` / `createFreeflyCamera` / `createSurroundCamera` / `createConcertCamera` / `createOneshotCamera` / `applyCameraUserSettings` / `refreshCameraUserSettings`
- `camera-behaviors.ts`(231) — 行为循环：`initFreeflyUpdate` / `initFreeflyTouch` / `stopFreefly` / `startSurround` / `stopSurround` / `startConcert` / `stopConcert`
- `camera-bone-lock.ts`(130) — 骨骼锁定：`setOrbitBoneLock` / `getOrbitBoneLock` / `setBoneLockDamping` / `getBoneLockDamping` / `getFocusedModelBoneNames`
- `camera-auto.ts`(166) — 节拍驱动 beatcut：`setAutoCameraEnabled` / `setAutoCameraBeatsPerSwitch` / `getAutoCameraBeatsPerSwitch` / `restoreAutoCameraState` / AUTO_CAMERA_PRESETS 池

## 对外 API（节选）
- 相机模式：`getCameraMode` / `setCameraMode`（orbit/freefly/surround/concert/oneshot/vmd/ar/beatcut）
- 相机控制/行为（ADR-100 双轴）：`getCameraControl` / `setCameraControl`、`getCameraBehavior` / `setCameraBehavior`
- 自动运镜：`setAutoCameraEnabled` / `isAutoCameraEnabled`（与 ProcMotion 节拍检测联动）
- 脚本子模式：`getScriptedSubMode` / `setScriptedSubMode`（loop/oneshot）
- 相机 VMD：`loadCameraVmd` / `clearCameraVmd` / `animateCameraVmd`；FOV：`getFov` / `setFov`
- 序列化：`getCameraState` / `setCameraState`
- 骨骼锁：`setOrbitBoneLock` / `getOrbitBoneLock` / `setBoneLockDamping` / `getBoneLockDamping` / `getFocusedModelBoneNames`

## 子模块回调注入（破除循环依赖）
`initCameraSystem` 在启动时向三个子模块注入回调，让它们能调用 camera.ts 内部的协调函数而无需反向 import：
- `setSwitchCameraModeCallback(switchCameraMode)` → camera-vmd.ts
- `setSchedulePersistCallback(scheduleCameraPersist)` → camera-factory.ts
- `setSyncAxesCallback(() => _syncAxesFromMode(getCameraMode()))` → camera-auto.ts

## 与其他子系统关系
- 依赖 `camera-state.ts`（纯状态 + 运行时上下文）、`invertablePointersInput`（反 Y 轴指针）、`scene`（focusModel / reattachPipeline / setARMode）
- 由 `scene-serialize` 持久化相机状态
- 被 `motion-camera-levels.ts` / `model-ops.ts` / `playback.ts` / `vmd-loader.ts` / `settings-controls.ts` / `settings-system.ts` / `init.ts` 消费（所有下游消费者统一从 `'./camera/camera'` barrel 入口导入）

## 不变量
- `_syncAxesFromMode` 是双轴状态唯一写入点（`switchCameraMode` / `setCameraControl` / `setCameraBehavior` / `setCameraState` 均经此派生）
- `camera.ts` 作为 barrel 入口，对外暴露全部公开符号；下游消费者禁止直接 import 子模块
- 子模块之间禁止互相 import，共享状态走 `camera-state.ts`
