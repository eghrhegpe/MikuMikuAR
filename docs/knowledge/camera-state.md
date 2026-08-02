---
tier: architecture
kind: camera_state
name: 相机状态管理 + 运行时上下文
category: scene
scope:
  - frontend/src/scene/camera/camera-state.ts
source_files:
  - frontend/src/scene/camera/camera-state.ts
  - frontend/src/core/freefly-state.ts
adr:
  - ADR-100
  - ADR-148
symbols:
  - CameraBehavior
  - CameraControl
  - CameraMode
  - CameraPreset
  - ConcertParams
  - FreeflyParams
  - OrbitParams
  - ScriptedSubMode
  - SurroundParams
  - clearCameraVmdState
  - defaultCameraPreset
  - freeflyInput
  - getAutoCameraBeatCount
  - getAutoCameraPresetIdx
  - getCameraBehavior
  - getCameraCanvas
  - getCameraControl
  - getCameraMode
  - getCameraPreset
  - getCameraScene
  - getCameraVmdName
  - getCameraVmdPath
  - getConcertParams
  - getConcertPaused
  - getCurrentCamera
  - getFocusCenterY
  - getFov
  - getFreeflyParams
  - getOrbitParams
  - getPreviousMode
  - getScriptedSubMode
  - getSurroundParams
  - getSurroundPaused
  - getViewMatrixHandle
  - hasCameraVmd
  - isAutoCameraEnabled
  - isTouchDevice
  - setAutoCameraBeatCount
  - setAutoCameraEnabledFlag
  - setAutoCameraPresetIdx
  - setCameraBehavior
  - setCameraCanvas
  - setCameraControl
  - setCameraMode
  - setCameraPreset
  - setCameraScene
  - setCameraVmdState
  - setConcertPaused
  - setCurrentCamera
  - setFocusCenterY
  - setFov
  - setPreviousMode
  - setScriptedSubMode
  - setSurroundPaused
  - setViewMatrixHandle
invariants:
  - 相机状态在模型切换时保持
  - scene/canvas 引用是运行时上下文（非纯状态），下沉到此处的目的是切断 camera 子模块间的循环依赖
  - 双轴（CameraControl × CameraBehavior）是 ADR-100 后的权威状态，CameraMode 降为兼容别名
  - freeflyInput 为双方共享状态（camera.ts 读/写，events.ts 键盘写入），定义在此切断循环依赖
tests:
  - frontend/src/__tests__/camera.test.ts
use_when:
  - 相机状态
  - 相机位置保存
  - scene/canvas 引用共享
  - freefly 输入状态
---

# 相机状态管理 + 运行时上下文

## 系统概览
**相机纯状态 + 运行时上下文模块**。承担两类职责：
1. 纯状态变量：`_currentPreset` / `_fov` / `_cameraMode` / `_cameraControl` / `_cameraBehavior` / `_scriptedSubMode` / `_currentCamera` / `_focusCenterY` / `_concertPaused` / `_surroundPaused` / `_cameraVmdName` / `_cameraVmdPath` / `_autoCameraEnabled` / `_autoCameraBeatCount` / `_autoCameraPresetIdx`
2. 运行时上下文：`_scene` / `_canvas` / `_previousMode` / `_viewMatrixHandle`——供所有 camera-*.ts 子模块共享，避免互相 import

`freeflyInput`（核心零依赖叶）作为自由飞行键盘输入状态，由 camera.ts 和 events.ts 共享，定义在此切断二者间的循环依赖。

ADR-148 阶段 3（2026-07-20 抽离）：原本只为 camera.ts 内部状态；阶段 3 续拆（2026-07-26）后承担"运行时上下文共享层"职责，让 camera-vmd/factory/behaviors/bone-lock/auto 单向依赖 camera-state，不再回引 camera.ts。

## 核心职责
- 类型定义：`CameraMode` / `CameraControl` / `CameraBehavior` / `ScriptedSubMode` / `OrbitParams` / `FreeflyParams` / `SurroundParams` / `ConcertParams` / `CameraPreset`（单源定义，camera.ts re-export 复用）
- 默认值：`defaultCameraPreset()` / `defaultOrbitParams` 等
- 纯状态 getter/setter：`getCameraPreset` / `setCameraPreset` / `getOrbitParams` / `setOrbitParams` / `getCameraMode` / `setCameraMode` / `getCameraControl` / `setCameraControl` / `getCameraBehavior` / `setCameraBehavior` / `getScriptedSubMode` / `setScriptedSubMode` / `getFov` / `setFov` / `getCurrentCamera` / `setCurrentCamera` / `getFocusCenterY` / `setFocusCenterY` / `getConcertPaused` / `setConcertPaused` / `getSurroundPaused` / `setSurroundPaused` / `getCameraVmdName` / `getCameraVmdPath` / `hasCameraVmd` / `setCameraVmdState` / `clearCameraVmdState` / `isAutoCameraEnabled` / `setAutoCameraEnabledFlag` / `getAutoCameraBeatCount` / `setAutoCameraBeatCount` / `getAutoCameraPresetIdx` / `setAutoCameraPresetIdx`
- 运行时上下文：`getCameraScene` / `setCameraScene` / `getCameraCanvas` / `setCameraCanvas` / `getPreviousMode` / `setPreviousMode` / `getViewMatrixHandle` / `setViewMatrixHandle`
- 工具：`isTouchDevice()`

## 对外 API
所有 getter/setter 均通过 `camera.ts` barrel re-export 暴露给下游消费者。

## 与其他子系统关系
- 被 `camera.ts` / `camera-vmd.ts` / `camera-factory.ts` / `camera-behaviors.ts` / `camera-bone-lock.ts` / `camera-auto.ts` 单向依赖（共享状态 + 运行时上下文）
- 不反向 import 任何 camera 子模块（保持纯状态层独立性）
- 被 `scene-serialize.ts` 间接调用（通过 camera.ts 的 `getCameraState` / `setCameraState`）

## 不变量
- 相机状态在模型切换时保持，不随模型重置
- 双轴（CameraControl × CameraBehavior）是 ADR-100 后的权威状态，CameraMode 降为兼容别名
- scene/canvas 引用是运行时上下文，不属于"纯状态"——放在此处是务实选择，目的是切断 camera 子模块间的循环依赖
- 所有 setter 仅修改状态，不触发副作用（持久化由 camera.ts 的 viewMatrix observer 驱动；模式切换的副作用由 camera.ts 的 switchCameraMode 编排）
