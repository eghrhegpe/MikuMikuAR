---
kind: camera_state
name: 相机状态管理
category: scene
scope:
  - frontend/src/scene/camera/camera-state.ts
source_files:
  - frontend/src/scene/camera/camera-state.ts
adr: []
symbols:
  - CameraState
  - getCameraState
  - setCameraState
invariants:
  - 相机状态在模型切换时保持
tests: []
use_when:
  - 相机状态
  - 相机模式
  - 相机位置保存
---

## 系统概览
**相机状态管理模块**。保存和恢复相机的位置、角度、模式等状态，支持模型切换时状态保持。

## 核心职责
- `camera-state.ts` — 相机状态存储、序列化、恢复。

## 对外 API（节选）
- `interface CameraState` — 相机状态描述。
- `getCameraState()` — 取当前相机状态。
- `setCameraState(state)` — 设置相机状态。
- `saveCameraState()` / `restoreCameraState()` — 保存/恢复。

## 与其他子系统关系
- 被 `camera.ts` 调用。
- 场景序列化：`scene-serialize.ts`。

## 不变量
- 相机状态在模型切换时保持，不随模型重置。
