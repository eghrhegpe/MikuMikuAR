---
kind: env_facade
name: 环境系统门面（Facade）
category: env
scope:
  - frontend/src/scene/env/env.ts
source_files:
  - frontend/src/scene/env/env.ts
---

## 系统概览
Environment Facade（Phase 8）：环境系统的对外门面。所有环境调用委托给 `env-impl.ts`，外部模块**只应从此文件 import**。Time-of-Day 实际用 `env-bridge.ts` 的实现（统一 scene observer）。

## 核心职责
- `initEnvFacade(scene, pipeline)` — 由 `scene.ts` 调用一次，转发 `impl.initEnvImpl`
- 各子系统入口透传：`applySky` / `applyGround` / `applyClouds` / `applyWater` / `applyLighting` 等
- 向后兼容 re-export：`_envSys`、`registerSceneTickCallback`、`ensureEnvUpdateObserver`、`disposeEnvUpdateObserver`
- Time-of-Day：`startTimeOfDay` / `stopTimeOfDay` / `isTimeOfDayActive` / `get/setTimeOfDaySpeed`（来自 env-bridge）

## 对外 API（节选）
- `applySky(state?)` / `applyGround(state?)` / `applyClouds` / `applyWater` — 缺省取 `envState`
- `initEnvFacade(scene, pipeline)`

## 关键约定
- 外部禁止直接 import `env-impl` / `env-bridge` 内部符号，统一走本门面

## 与其他子系统关系
- 全部委托 `env-impl.ts`（实现）+ `env-bridge.ts`（时间流转/预设/重力）
- 上游调用方：`scene.ts` 编排器、各 UI 面板
