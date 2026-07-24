---
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
  - 被 perception-gaze 引用
tests: []
use_when:
  - WASM 视线追踪
  - 视线追踪 WASM
  - gaze WASM
  - 视线方向
---

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
- WASM 模式与 JS 模式互斥，由 perception-gaze 调度。
- WASM 模式性能优于 JS 模式。
