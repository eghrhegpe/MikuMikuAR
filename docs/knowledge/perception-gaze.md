---
tier: leaf
kind: perception_gaze
name: 视线追踪主模块
category: motion
scope:
  - frontend/src/scene/motion/perception-gaze.ts
source_files:
  - frontend/src/scene/motion/perception-gaze.ts
adr:
  - ADR-071
  - ADR-162
  - ADR-166
symbols:
  - EYE_BONE_CANDIDATES
  - EyeGazeWriteStrategy
  - HEAD_BONE_CANDIDATES
  - HeadGazeWriteStrategy
  - _applyEyeGazeCore
  - _applyGaze
  - _applyHeadGazeCore
  - _clampEyeGazeTarget
  - _clampGazeTargetInParentFrame
  - _clampHeadGazeTarget
  - _getGazeTarget
  - applyGazeWasm
  - getEyeGazeMaxPitch
  - getEyeGazeMaxYaw
  - getEyeGazeSmooth
invariants:
  - 视线追踪主模块
  - JS/WASM 调度
tests: []
use_when:
  - 视线追踪
  - gaze
  - 视线方向
  - 眼部跟随
  - 头部跟随
---

# 视线追踪主模块

## 系统概览
**视线追踪主模块**（ADR-071/162/166）。调度 JS/WASM 两种视线追踪实现，提供统一的视线配置接口。两路径均可用，按运行时类型自动分支（非"按性能切换"）。

## 核心职责
- `perception-gaze.ts` — 视线追踪调度入口 `_applyGaze` / `applyGazeWasm`，按 `_isWasmRuntime()` 自动分支到 JS 或 WASM 路径，并维护共用骨架（targetWorldQ 计算 / clamp / Slerp / cache）。

## 对外 API（节选）
- `initGazeTracking(modelId)` — 初始化视线追踪。
- `setGazeConfig(config)` — 设置视线配置（启用/灵敏度/模式）。
- `getGazeConfig()` — 取当前视线配置。
- `_applyGaze(...)` — 统一调度入口（perception-observer 每帧调用）。
- `applyGazeWasm(bones, cam, config, dt)` — WASM 路径直暴露（供 wasm-layers-blender 等模块直接调用）。

## 与其他子系统关系
- WASM 生产路径：`./perception-gaze-wasm.ts`（直写 frontBuffer + `_propagateChildrenWasm`）。
- JS 调试路径：`./perception-gaze-js.ts`（写 `linkedBone` + `_updateBoneChain` + `skeleton._markAsDirty`）。
- 主控：`../perception.ts`。
- 共享类型：`./perception-shared.ts`。
- Observer 注册：`./perception-observer.ts`（每帧调用 `_applyGaze`）。

## 不变量
- JS 模式和 WASM 模式**互斥**，由 `_isWasmRuntime(bone)` 检测当前 `IMmdRuntimeBone` 所属运行时类型自动分支（**非按性能切换**）。
- WASM 模式下不调 `skeleton._markAsDirty()`（直写 frontBuffer 即生效）；JS 模式必须调。
- 视线配置与感知层状态同步。
- JS 路径仅用于 `VITE_MMD_RUNTIME=js` 调试模式（无物理），保留作为 gaze 行为对比排查与 WASM 兼容性回退（[scene.ts:687](../../frontend/src/scene/scene.ts#L687) 注释明令勿删除）。
