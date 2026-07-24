---
kind: perception_gaze_js
name: JS 端视线追踪
category: motion
scope:
  - frontend/src/scene/motion/perception-gaze-js.ts
source_files:
  - frontend/src/scene/motion/perception-gaze-js.ts
adr:
  - ADR-071
  - ADR-162
symbols:
  - _applyHeadGazeJS
  - _applyEyeGazeJS
invariants:
  - 被 perception-gaze 引用
tests: []
use_when:
  - JS 视线追踪
  - 视线追踪 JS
  - gaze JS
  - 视线方向
---

## 系统概览
**JS 端视线追踪**（ADR-071/162）。提供基于 JavaScript 的视线追踪实现，
被 perception-gaze 调度。

## 核心职责
- `perception-gaze-js.ts` — JS 视线追踪计算、骨骼应用。

## 对外 API（节选）
- `_applyHeadGazeJS(model, time, ctx)` — 应用头部视线（JS 模式）。
- `_applyEyeGazeJS(model, time, ctx)` — 应用眼部视线（JS 模式）。

## 与其他子系统关系
- 视线追踪主模块：`./perception-gaze.ts`（调度）。
- 共享类型：`./perception-shared.ts`。
- 骨骼候选：`BONE_GAZE_CANDIDATES`。

## 不变量
- JS 模式与 WASM 模式互斥，由 perception-gaze 调度。
- 视线追踪频率约 30 FPS。
