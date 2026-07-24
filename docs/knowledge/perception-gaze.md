---
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
  - initGazeTracking
  - setGazeConfig
  - getGazeConfig
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

## 系统概览
**视线追踪主模块**（ADR-071/162/166）。调度 JS/WASM 两种视线追踪实现，提供统一的视线配置接口。

## 核心职责
- `perception-gaze.ts` — 视线追踪调度、JS/WASM 模式切换、配置管理。

## 对外 API（节选）
- `initGazeTracking(modelId)` — 初始化视线追踪。
- `setGazeConfig(config)` — 设置视线配置（启用/灵敏度/模式）。
- `getGazeConfig()` — 取当前视线配置。

## 与其他子系统关系
- WASM 实现：`./perception-gaze-wasm.ts`。
- JS 实现：`./perception-gaze-js.ts`。
- 主控：`../perception.ts`。
- 共享类型：`./perception-shared.ts`。

## 不变量
- JS 模式和 WASM 模式互斥，根据性能自动切换。
- 视线配置与感知层状态同步。
