---
tier: architecture
source_files:
  - frontend/src/scene/env/env-impl.ts
tests:
  - frontend/src/__tests__/scene/env-impl.test.ts（注：该文件仅测试 getGroundHeightAt——定义于 env-ground.ts 的 barrel re-export；ensureEnvUpdateObserver/disposeEnvUpdateObserver/applyFog 等本文件核心编排逻辑无直接单测）
kind: env_impl
name: 环境系统实现核心（barrel + observer + fog）
category: env
scope:
  - frontend/src/scene/env/env-impl.ts
adr:
  - ADR-138
  - ADR-106
symbols:
  - _envSys
  - addGroundRipple
  - addRipple
  - applyFog
  - applyGround
  - applySky
  - clearGroundRipples
  - clearRipples
  - createClouds
  - createParticleEmitter
  - createWater
  - disposeClouds
  - disposeEnvUpdateObserver
  - disposeParticles
  - disposeWater
  - ensureEnvUpdateObserver
  - getGroundHeightAt
  - getScene
  - initEnvImpl
  - refreshWaterRenderList
  - registerSceneTickCallback
  - setOnGroundChanged
  - setOnTerrainReady
  - updateParticleTexture
  - updateParticleWind
  - updateWaterAnimSpeed
invariants:
  - 本文件为 barrel 重导出枢纽：汇聚 env-water/env-clouds/env-sky/env-ground/env-terrain/env-context/env-dispatcher 的各子系统符号
  - dispose 链路级联释放 water/clouds/mirror 子资源；observer 句柄经 observer-handle 管理
  - disposeEnvUpdateObserver 中调用 clearSceneTickCallbacks 清除所有 tick 回调
  - 外部模块只应经 env.ts 门面访问本文件导出的符号

use_when:
  - 环境实现
  - observer
  - fog
  - barrel 重导出
---

# 环境系统实现核心（barrel + observer + fog）

## 系统概览
环境系统实现核心（从原 env-impl 拆分而来）。本文件保留：observer、fog、barrel re-export。天空→`env-sky.ts`、地面→`env-ground.ts`、共享上下文→`env-context.ts`，各子系统经本文件 barrel 汇聚。

## 核心职责
- 汇聚 re-export：water（`createWater`/`disposeWater`/`refreshWaterRenderList`/ripple 系列）、clouds（`createClouds`/`disposeClouds`）；mirror 符号（`createMirror`/`disposeMirror`/`isMirrorActive`/`updateMirrorClearColor`）仅为本文件内部 `import`（调用点见 `:106-109`/`:92-93`），**不经本文件 re-export**，对外经 `env.ts` 暴露子集
- 环境 observer：`ensureEnvUpdateObserver` / `disposeEnvUpdateObserver`（由门面 re-export 供 scene 清理）
- fog 应用（`applyFog`）、共享上下文：`_envSys` / `getScene` 为来自 `_shared/env-context` 的 barrel 重导出；`getPipeline` / `resolveStaticAsset` / `isInitialized` 需直接 `import` 自 `_shared/env-context`（本文件不重导出）
- 场景 tick 回调：`registerSceneTickCallback` 为来自 `_bridge/env-dispatcher` 的 barrel 重导出（返回反注册函数 `() => void`）；`clearSceneTickCallbacks` / `runSceneTickCallbacks` 仅为本文件内部 `import`（定义见 `env-dispatcher`），observer 每帧调用 `runSceneTickCallbacks()`，`disposeEnvUpdateObserver` 中调用 `clearSceneTickCallbacks()`

## 对外 API（节选）
本文件**自身定义**：
- `ensureEnvUpdateObserver()` / `disposeEnvUpdateObserver()` — 每帧 observer 的注册与级联释放
- `applyFog(state: EnvState)` — 按 `fogMode`/`fogDensity` 等应用雾

本文件为 **barrel 重导出**（定义见上游模块）：
- `initEnvImpl(scene, pipeline)`（定义于 `env-context`）
- `registerSceneTickCallback(cb: () => void): () => void` — 来自 `env-dispatcher` 的 barrel 重导出，返回反注册函数；`clearSceneTickCallbacks()` / `runSceneTickCallbacks()` 仅为本文件内部 `import`，非重导出
- water/clouds/sky/ground/particles 各子系统 API（定义于各自 `env-*` 模块，经本文件 barrel 透传；mirror 不经本文件透传）

## 关键约定
- dispose 链路级联释放 water/clouds/mirror 子资源（见各子系统卡）
- observer 句柄经 `observer-handle` 管理，场景销毁时移除

## 与其他子系统关系
- 被 `env.ts` 门面 barrel 透传
- 依赖 `env-context.ts`（共享上下文）、`env-dispatcher.ts`（tick 回调）
- 下游：env-sky/ground/clouds/water/terrain/texture 各子系统
