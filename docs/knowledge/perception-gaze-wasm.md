---
tier: leaf
kind: perception_gaze_wasm
name: WASM 端视线追踪
category: motion
scope:
  - frontend/src/scene/motion/perception-gaze-wasm.ts
source_files:
  - frontend/src/scene/motion/perception-gaze-wasm.ts
adr:
  - ADR-071
  - ADR-162
symbols:
  - _applyHeadGazeWasm
  - _applyEyeGazeWasm
invariants:
  - WASM 模式与 JS 模式互斥，由 _isWasmRuntime() 自动分支
  - 写入策略：直写 frontBuffer + _propagateChildrenWasm，无需 _markAsDirty()
  - 生产默认路径（VITE_MMD_RUNTIME 未设或非 js 时）
tests: []
use_when:
  - WASM 视线追踪
  - 视线追踪 WASM
  - gaze WASM
  - 视线方向
---

# WASM 端视线追踪

## 系统概览
**WASM 端视线追踪**（ADR-071/162）。提供基于 WASM 的高性能视线追踪实现，
被 perception-gaze 调度。

## 核心职责
- `perception-gaze-wasm.ts` — WASM 视线追踪计算、骨骼应用。

## 对外 API（节选）
- `_applyHeadGazeWasm(model, time, ctx)` — 应用头部视线（WASM 模式）。
- `_applyEyeGazeWasm(model, time, ctx)` — 应用眼部视线（WASM 模式）。

## 与其他子系统关系
- 视线追踪主模块：`./perception-gaze.ts`（调度）。
- 共享类型：`./perception-shared.ts`。
- 骨骼候选：`BONE_GAZE_CANDIDATES`。

## 不变量
- WASM 模式与 JS 模式互斥，由 `perception-gaze.ts:_applyGaze` 通过 `_isWasmRuntime()` 自动分支。
- **生产默认路径**（`VITE_MMD_RUNTIME` 未设或非 `js`）。
- 写入策略：**直写 frontBuffer**（`_writeMatToBuffer`）+ `_propagateChildrenWasm` 递归传播子骨骼，绕过双缓冲覆盖（与 JS 路径写 `linkedBone` 不同）。
- 无需 `skeleton._markAsDirty()`（直写 frontBuffer 即生效）。
