---
kind: env_bridge
name: 环境系统与场景桥接层
category: env
scope:
  - frontend/src/scene/env/env-bridge.ts
source_files:
  - frontend/src/scene/env/env-bridge.ts
---

## 系统概览
Env Bridge：环境系统与场景的桥接层。职责：`envAutoLink`、太阳角、时间流转、环境预设、`setEnvState`、重力控制。从 `scene.ts` 静态导入但仅函数体内访问（ES module live binding 安全）。

## 核心职责
- `setEnvState(patch)` — 单一写入入口，经 `dispatchEnvChange` 分发到各子系统回调（env-dispatcher），并触发自动保存 / 持久化（`SetEnvState` / `SetUIState` backend 代理）
- `envAutoLink` — 环境自动联动（如太阳角→光照）
- 太阳角 / 时间流转（Time-of-Day）：`startTimeOfDay` / `stopTimeOfDay` / `setTimeOfDaySpeed`
- 环境预设：`deriveLighting` / `TIME_OF_DAY_PRESETS` / `CategorizedEnvPreset`（来自 env-lighting）
- 重力控制：`applyGroundCollision`（来自 physics/ground-collision）、`setGravity`
- 性能联动：`isAutoDegradingReflection` / `registerSetEnvState`（performance-env-bridge）

## 对外 API（节选）
- `setEnvState(patch: Partial<EnvState>)` — 环境状态唯一写入入口
- `envAutoLink(...)` / 太阳角计算
- `startTimeOfDay()` / `stopTimeOfDay()` / `setTimeOfDaySpeed(v)`

## 关键约定
- 从 `scene.ts` 静态导入但仅函数体内访问，避免顶层循环依赖
- `setEnvState` 经 dispatcher 分发；预设动画有取消机制（见历史审计）

## 与其他子系统关系
- 依赖 `env-dispatcher.ts`（破循环依赖）、`env-lighting.ts`、`render/lighting.ts`、`render/renderer.ts`、`render/quality-profile.ts`
- 依赖 `physics/ground-collision.ts`（重力/地面碰撞）、`render/performance-env-bridge.ts`
- 被 `env.ts` 门面 re-export 的 Time-of-Day 接口
