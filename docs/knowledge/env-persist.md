---
kind: env_persist
name: 环境状态防抖持久化
category: env
scope:
  - frontend/src/scene/env/env-persist.ts
source_files:
  - frontend/src/scene/env/env-persist.ts
adr:
  - ADR-148
  - ADR-176
---

## 系统概览
Env Persist：从 env-bridge 拆出的 envState / uiState 防抖持久化模块（ADR-148 Phase 5 瘦身）。职责单一：防抖调度（500ms）+ 立即 flush + HMR 清理，经 `resolveBackend()` 路由到 Go 后端。仅依赖 core 层，无 env-bridge 反向依赖。

## 核心职责
- envState 防抖持久化：`schedulePersistEnvState()` → `DebouncedTimer` → `persistEnvState()`
- uiState 防抖持久化：`schedulePersistUI()` → `flushUIState()`
- 立即刷写：`flushEnvState()` / `flushUIState()`（无防抖，关闭/隐藏页面时调用）
- HMR 重入清理：`cancelEnvPersistTimer()`（ADR-106 D3）

## 对外 API（节选）
- `persistEnvState(payload)` — 持久化 envState 到后端（上抛错误）
- `flushEnvState()` — 立即刷写 env state
- `schedulePersistEnvState()` — 500ms 防抖调度 envState 持久化
- `cancelEnvPersistTimer()` — 取消挂起定时器
- `persistUIState(payload)` — 持久化 UI state 到后端（上抛错误）
- `flushUIState()` — 立即刷写 UI state
- `schedulePersistUI()` — 500ms 防抖调度 uiState 持久化

## 不变量
- 持久化载荷传 `{ ...envState }`（普通对象副本），避免 JSON.stringify 对 reactive Proxy 枚举不完整
- `persistUIState` 的 payload 是 `Partial<UIState>`，强转后传入 Go 端是安全的（Go 端 json.Unmarshal 合并语义）
- 防抖回调中的 `persistEnvState` 用 `void ... .catch()` 捕获，不上抛（不中断后续调度）
- `flushUIState` 在 payload 为空对象时直接返回（nothing to persist）
- `schedulePersistUI` 通过 `setUIPersistCallback()` 注册到 state.ts（避免循环依赖）

## 与其他子系统关系
- 依赖 `core/backend.ts` 的 `resolveBackend()`（ADR-176 路由）
- 依赖 `core/state.ts` 的 `uiState` + `setUIPersistCallback()`
- 被 `env-bridge.ts` 的 `setEnvState()` 内部调用（`schedulePersistEnvState`）
- 被 `core/state.ts` 的 `setUIState()` 间接调用（通过回调）

## 验证入口
- 命令：`cd frontend && npm run test`
