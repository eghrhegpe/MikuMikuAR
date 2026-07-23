---
kind: performance_env_bridge
name: 性能降级 — 环境桥接
category: rendering
scope:
  - frontend/src/scene/render/**
source_files:
  - frontend/src/scene/render/performance-env-bridge.ts
adr:
  - ADR-130
---

## 系统概览
打破 `performance.ts` ↔ `env-bridge.ts` 循环依赖的桥接模块（ADR-130 Phase 2.3）。`performance.ts` 设置自动降级标志，`env-bridge.ts` 读取标志识别自动降级 vs 用户手动操作。同时提供 `setEnvState` 的延迟绑定，避免循环导入。

## 核心职责
- `performance-env-bridge.ts` — 自动降级标志、setEnvState 延迟绑定。

## 对外 API（节选）
- `setAutoDegradingReflection(value)` — 设置当前反射质量变更来自自动降级（`performance.ts` 调用）。
- `isAutoDegradingReflection()` — 检查当前是否处于自动降级中（`env-bridge.ts` 调用）。
- `registerSetEnvState(fn)` — 注册 setEnvState 函数（`env-bridge.ts` 初始化时调用）。
- `setEnvStateForPerformance(partial, skipAutoSave?)` — `performance.ts` 通过此函数设置 envState（延迟绑定，避免循环导入）。

## 与其他子系统关系
- `performance.ts` 调用 `setAutoDegradingReflection` / `setEnvStateForPerformance`。
- `env-bridge.ts` 调用 `isAutoDegradingReflection` / `registerSetEnvState`。