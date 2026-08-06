---
tier: architecture
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
  - applyEnvStateFacade
  - registerEnvStateMiddleware
  - setEnvState
  - setPresetAnimActive
invariants:
  - setEnvState 是环境状态主写入入口（白名单迁移 + 中间件链 + dispatchEnvChange 分发 + schedulePersistEnvState 防抖持久化）；注：env-time-of-day.ts:82 直接写 envState.sunAngle 绕过 setEnvState（仅 facade 补偿派发），「唯一入口」表述不严格
  - registerEnvStateMiddleware 注册的中间件按 phase 执行（pre-facade / post-facade），syncEnvSunAngle 等
  - applyEnvStateFacade 是 setEnvState 的轻量版（跳过防抖持久化 + 中间件链），供 time-of-day tick 高频调用
  - _presetAnimActive 标记预设动画运行中，applyEnvStateFacade 据此跳过方向光同步（动画自己管光照）；动画异常中断时经 observer try/catch 复位标志（防方向光同步永久跳过）
  - 模块加载时 registerSceneAction('setEnvState') 暴露给 core/action-defs 调用（经白名单迁移收窄）
tests:
  - frontend/src/__tests__/env-bridge/facade.int.test.ts
  - frontend/src/__tests__/env-bridge/middleware.int.test.ts
use_when:
  - setEnvState
  - 环境状态写入
  - 中间件注册
  - 预设动画状态
---

# 环境状态写入入口（setEnvState + 中间件链）

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
