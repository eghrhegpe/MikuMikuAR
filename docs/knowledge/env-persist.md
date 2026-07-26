---
kind: env_persist
name: 环境与 UI 状态防抖持久化
category: env
scope:
  - frontend/src/scene/env/env-persist.ts
source_files:
  - frontend/src/scene/env/env-persist.ts
adr:
  - ADR-148
  - ADR-176
symbols:
  - persistEnvState
  - flushEnvState
  - schedulePersistEnvState
  - cancelEnvPersistTimer
  - persistUIState
  - flushUIState
  - schedulePersistUI
invariants:
  - envState/uiState 持久化必须传普通对象副本（{...envState}），避免 Proxy 在 JSON.stringify 枚举不完整
  - 持久化失败必须 catch + logWarn + feedbackStatus('env.persistFailed')，不得静默吞错
  - 模块加载期调用 setUIPersistCallback(schedulePersistUI) 注册回调，state.ts 通过此回调触发 UI 持久化（避免循环依赖）
  - 防抖定时器 500ms，关闭/隐藏页面时调用 flush* 立即刷写
tests:
  - frontend/src/__tests__/env-bridge.test.ts
use_when:
  - envState 持久化
  - uiState 持久化
  - SetEnvState
  - SetUIState
  - 防抖持久化
  - 持久化失败
---

## 系统概览
Env Persist：envState/uiState 防抖持久化模块。从 `env-bridge.ts` 拆出（ADR-148 Phase 5），将所有 I/O 关注点（防抖调度、立即 flush、错误提示）从业务逻辑中剥离。仅依赖 core 层，不反向依赖 env-bridge。

## 核心职责
- `env-persist.ts` — envState/uiState 防抖调度（500ms）+ 立即 flush + 启动期回调注册
- 经 `resolveBackend()` 路由到 Go 后端 `SetEnvState` / `SetUIState`（ADR-176 第 2 步）
- 持久化失败统一上抛 → 调用方 catch + `feedbackStatus('env.persistFailed')` 提示用户

## 对外 API（节选）
- `schedulePersistEnvState()` — setEnvState 内部调用，500ms 防抖调度
- `flushEnvState()` — 立即刷写（关闭页面时调用），返回 Promise 供调用方可选 await
- `cancelEnvPersistTimer()` — HMR 重入清理用（ADR-106 D3）
- `schedulePersistUI()` — uiState 修改后调度持久化（由 state.ts 回调触发）
- `flushUIState()` — 立即刷写 UI state
- `persistEnvState(payload)` / `persistUIState(payload)` — 底层持久化函数（上抛错误，调用方负责 catch）

## 关键约定
- 防抖定时器使用 `DebouncedTimer`（core/utils），flush 前必须 cancel 防止重复刷写
- payload 必须是普通对象副本（`{ ...envState }`），传 reactive Proxy 会导致 JSON.stringify 枚举不完整
- Go 端 `SetUIState` 语义是 json.Unmarshal 合并（缺省字段保留原值），payload 用 `Partial<UIState>` 表达部分字段是安全的

## 与其他子系统关系
- 依赖 `core/backend`（`resolveBackend`）、`core/config`（`envState`/`triggerAutoSave`）、`core/state`（`uiState`/`setUIPersistCallback`）、`core/feedback`（`feedbackStatus`）、`core/utils`（`logWarn`/`DebouncedTimer`）
- 被 `env-bridge.ts`（setEnvState 内部调度）和 `env-time-of-day.ts`（stopTimeOfDay/presetAnim 完成后立即 flush）调用
- 模块加载期通过 `setUIPersistCallback(schedulePersistUI)` 与 state.ts 建立单向回调绑定
