---
kind: env_bridge
name: 环境状态写入入口（setEnvState + 中间件链）
category: env
scope:
  - frontend/src/scene/env/_bridge/env-bridge.ts
source_files:
  - frontend/src/scene/env/_bridge/env-bridge.ts
adr:
  - ADR-138
  - ADR-148
symbols:
  - setEnvState
  - applyEnvStateFacade
  - registerEnvStateMiddleware
  - setPresetAnimActive
invariants:
  - setEnvState 是环境状态唯一写入入口；内部经 dispatchEnvChange 分发，触发 schedulePersistEnvState 防抖持久化
  - registerEnvStateMiddleware 注册的中间件按 phase 执行（pre-facade / post-facade），syncEnvSunAngle 等
  - applyEnvStateFacade 是 setEnvState 的轻量版（跳过防抖持久化 + 中间件链），供 time-of-day tick 高频调用
  - _presetAnimActive 标记预设动画运行中，applyEnvStateFacade 据此跳过方向光同步（动画自己管光照）
tests:
  - frontend/src/__tests__/env-bridge.test.ts
use_when:
  - setEnvState
  - 环境状态写入
  - 中间件注册
  - 预设动画状态
---

## 系统概览
Env Bridge：环境系统核心调度层。ADR-148 Phase 5 拆分后聚焦于 `setEnvState`、中间件注册、`applyEnvStateFacade` 轻量应用。重力/持久化/时间流转已分别拆到 `env-gravity.ts`、`env-persist.ts`、`env-time-of-day.ts`，本模块仅保留调度核心。

## 核心职责
- `setEnvState(patch, skipPersist?)` — 环境状态唯一写入入口，合并 envState → 中间件链 → dispatchEnvChange → schedulePersistEnvState
- `applyEnvStateFacade(state, partial?)` — 轻量应用（time-of-day tick 专用，跳过防抖持久化与中间件链）
- `registerEnvStateMiddleware({name, phase, fn})` — 中间件注册（pre-facade / post-facade），供子系统注入副作用
- `setPresetAnimActive(active)` — 标记预设动画运行中，applyEnvStateFacade 据此跳过方向光同步

## 对外 API（节选）
- `setEnvState(patch: Partial<EnvState>, skipPersist?: boolean)`
- `applyEnvStateFacade(state: EnvState, partial?: Partial<EnvState>)`
- `registerEnvStateMiddleware(mw: EnvStateMiddleware)`
- `setPresetAnimActive(active: boolean)`

## 关键约定
- 从 `scene.ts` 静态导入但仅函数体内访问，避免顶层循环依赖
- setEnvState 经 dispatcher 分发；中间件链在 dispatch 之前执行
- applyEnvStateFacade 直接调用 dispatchEnvChange，不走 setEnvState 全链路（避免每帧防抖持久化）
- 预设动画期间 setPresetAnimActive(true)，applyEnvStateFacade 跳过方向光同步（动画自己管光照过渡）

## 与其他子系统关系
- 依赖 `env-dispatcher.ts`（破循环依赖，ADR-138）、`env-persist.ts`（持久化）、`render/lighting.ts`、`render/renderer.ts`、`render/quality-profile.ts`、`render/performance-env-bridge.ts`
- 被 `env-gravity.ts` / `env-time-of-day.ts` / 各菜单 levels 调用 setEnvState
- 被 `env.ts` 门面 re-export 暴露给上层
- 拆分前职责（重力/时间流转/持久化）已迁至独立模块，参见对应知识卡
