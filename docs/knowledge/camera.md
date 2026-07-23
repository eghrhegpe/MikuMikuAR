---
kind: camera_mode_manager
name: 相机模式管理系统（MmdCamera）
category: scene
scope:
  - frontend/src/scene/camera/**
source_files:
  - frontend/src/scene/camera/camera.ts
adr:
  - ADR-035
---

## 系统概览
相机模式管理系统（[doc:architecture]）。负责相机模式切换（orbit / freefly / surround / concert / oneshot / vmd / ar）、自动构图、自由飞行输入。封装 babylon-mmd 的 `MmdCamera` 并管理其生命周期（含 `dispose` 释放，避免卸载泄漏）。复用 `invertablePointersInput` 实现反 Y 轴指针。

## 核心职责
- `camera.ts` — 相机模式管理、自动构图、自由飞行输入、相机 VMD 播放、FOV 控制

## 对外 API（节选）
- 相机模式：`getCameraMode` / `setCameraMode`（orbit/freefly/surround/concert/oneshot/vmd/ar）
- 相机控制/行为：`getCameraControl` / `setCameraControl`、`getCameraBehavior` / `setCameraBehavior`
- 自动构图：`setAutoCameraEnabledFlag` / beat 计数（与 ProcMotion 节拍检测联动）
- 脚本子模式：`getScriptedSubMode` / `setScriptedSubMode`（loop/oneshot）
- 相机 VMD：`setCameraVmdState` / `clearCameraVmdState`；FOV：`getFov` / `setFov`
- 纯状态函数来自 `camera-state.ts`（`defaultCameraPreset` / `getCameraPreset` 等）

## 与其他子系统关系
- 依赖 `camera-state.ts`（纯状态）、`invertablePointersInput`（反 Y 轴指针）、`scene`（focusModel / reattachPipeline / setARMode）
- 由 `scene-serialize` 持久化相机状态
