---
kind: env_dispatcher
name: 环境调度器
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-dispatcher.ts
adr:
  - ADR-138
---

## 系统概览
纯调度层，无状态。破除 `env-bridge` ↔ `env-impl`/`env-water` 的循环依赖：`env-bridge` 只 import dispatcher，不直接 import 各子系统实现。各子系统通过回调注册被动响应变化，由 `dispatchEnvChange` 统一调度。

## 核心职责
- `env-dispatcher.ts` — Env 变化回调注册与分发、场景 tick 回调注册与执行。

## 对外 API（节选）
- `registerEnvCallback(fn)` — 子系统注册响应回调，返回清理函数（dispose 时调用避免泄漏）。
- `clearAllEnvCallbacks()` — 清空所有 env 回调（场景销毁 / HMR 重入时兜底清理）。
- `dispatchEnvChange(changed, state)` — `setEnvState` 调用此函数分发变化，null 表示全量分发。
- `registerSceneTickCallback(cb)` — 场景每帧 tick 回调注册（从 env-context 迁入），返回清理函数。
- `clearSceneTickCallbacks()` — 清空所有 tick 回调。
- `runSceneTickCallbacks()` — 执行所有 tick 回调（由 `ensureEnvUpdateObserver` 每帧调用），单个回调抛错不中断同帧其他回调。

## 与其他子系统关系
- `env-bridge` 在 `setEnvState` 后调用 `dispatchEnvChange`。
- `env-impl` 的 `ensureEnvUpdateObserver` 每帧调用 `runSceneTickCallbacks`。
- 各 env 子系统（env-water / env-sky / env-ground 等）通过 `registerEnvCallback` 注册响应。