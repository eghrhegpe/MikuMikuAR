---
kind: env_dispatcher
name: 环境变更调度层（破循环依赖）
category: env
scope:
  - frontend/src/scene/env/env-dispatcher.ts
source_files:
  - frontend/src/scene/env/env-dispatcher.ts
adr:
  - ADR-138
---

## 系统概览
环境变更调度层：**纯调度、无状态**（ADR-138）。目的是破除 `env-bridge ↔ env-impl/env-water` 的循环依赖——`env-bridge` 只 import dispatcher，不 import env-impl/env-water。各子系统通过 `registerEnvCallback` 注册响应回调，变化发生时由 `dispatchEnvChange` 统一调度。

## 核心职责
- `registerEnvCallback(fn)` — 子系统注册响应回调（延迟绑定避免循环导入），返回清理函数（dispose 时调用，防泄漏）
- `clearAllEnvCallbacks()` — 场景销毁 / HMR 重入兜底清理
- `dispatchEnvChange(changed, state)` — `setEnvState` 调用此分发；`changed` 为变化 key 集合（null=全量），遍历回调 `try/catch` 容错
- 场景 tick 回调注册表（从 env-context 迁入）：`registerSceneTickCallback` / `clearSceneTickCallbacks` / `runSceneTickCallbacks`

## 对外 API（节选）
- `registerEnvCallback(fn): () => void` — 返回反注册函数
- `dispatchEnvChange(changed: Set<string> | null, state: EnvState)`
- `clearAllEnvCallbacks()`

## 关键约定
- 回调异常被 `console.warn` 吞掉，不影响其他子系统调度（容错但可观测）

## 与其他子系统关系
- 被 `env-bridge.ts`（`setEnvState` / time-of-day）调用分发
- 被 `env-impl.ts`（tick 回调）汇聚
- 各 env 子系统（sky/ground/water/...）经此处注册响应，避免与 bridge 循环依赖
