---
kind: env_impl
name: 环境系统实现核心（barrel + observer + fog）
category: env
scope:
  - frontend/src/scene/env/env-impl.ts
source_files:
  - frontend/src/scene/env/env-impl.ts
---

## 系统概览
环境系统实现核心（从原 env-impl 拆分而来）。本文件保留：observer、fog、barrel re-export。天空→`env-sky.ts`、地面→`env-ground.ts`、共享上下文→`env-context.ts`，各子系统经本文件 barrel 汇聚。

## 核心职责
- 汇聚 re-export：water（`createWater`/`disposeWater`/`refreshWaterRenderList`/ripple 系列）、clouds（`createClouds`/`disposeClouds`）、mirror（`createMirror`/`disposeMirror`/`isMirrorActive`/`updateMirrorClearColor`）
- 环境 observer：`ensureEnvUpdateObserver` / `disposeEnvUpdateObserver`（由门面 re-export 供 scene 清理）
- fog 应用（`applyFog`）、共享上下文 `_envSys` / `getScene` / `getPipeline` / `resolveStaticAsset` / `isInitialized`（后 5 者为来自 `env-context` 的 barrel 重导出）
- 场景 tick 回调 **barrel 重导出**（定义见 `env-dispatcher`）：`registerSceneTickCallback` / `clearSceneTickCallbacks` / `runSceneTickCallbacks`，observer 每帧调用 `runSceneTickCallbacks()`，`disposeEnvUpdateObserver` 中调用 `clearSceneTickCallbacks()`

## 对外 API（节选）
本文件**自身定义**：
- `ensureEnvUpdateObserver()` / `disposeEnvUpdateObserver()` — 每帧 observer 的注册与级联释放
- `applyFog(state: EnvState)` — 按 `fogMode`/`fogDensity` 等应用雾

本文件为 **barrel 重导出**（定义见上游模块）：
- `initEnvImpl(scene, pipeline)`（定义于 `env-context`）
- `registerSceneTickCallback(cb)` / `clearSceneTickCallbacks()` / `runSceneTickCallbacks()`（定义于 `env-dispatcher`，**无参数**）
- water/clouds/mirror/sky/ground/particles 各子系统 API（定义于各自 `env-*` 模块）

## 关键约定
- dispose 链路级联释放 water/clouds/mirror 子资源（见各子系统卡）
- observer 句柄经 `observer-handle` 管理，场景销毁时移除

## 与其他子系统关系
- 被 `env.ts` 门面 barrel 透传
- 依赖 `env-context.ts`（共享上下文）、`env-dispatcher.ts`（tick 回调）
- 下游：env-sky/ground/clouds/water/terrain/texture 各子系统
