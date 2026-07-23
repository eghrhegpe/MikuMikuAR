---
kind: ui_state
name: UI 持久化状态
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/ui-state.ts
adr:
  - ADR-141
---

## 系统概览
UI 持久化存储（ADR-141 从 `core/state.ts` 拆分）。管理弹窗状态（`popupOpen`）、UI 状态对象（`uiState`）及持久化回调。`uiState` 通过 `setUIState` 写入并触发持久化；`activeTimeOfDayPreset` 为预设芯片高亮提供唯一来源，在 env-menu 顶层与 sky 子菜单间共享。

## 核心职责
- `ui-state.ts` — 弹窗状态、UI 状态对象、持久化回调、time-of-day 预设记忆。

## 对外 API（节选）
- `popupOpen` / `setPopupOpen(v)` — 弹窗开闭状态读写。
- `uiState` — UI 状态对象（`UIState` 类型），由 `setUIState` 写入。
- `setUIPersistCallback(cb)` — 注册持久化回调（由 `env-bridge` 在初始化时注册，避免循环依赖）。
- `setUIState(state)` — 合并写入 UI 状态并触发持久化（持久化异常不阻塞 UI 更新）。
- `activeTimeOfDayPreset` / `setActiveTimeOfDayPreset(v)` — 当前选中的 time-of-day 预设 key，预设芯片高亮唯一来源。

## 与其他子系统关系
- 持久化回调由 `env-bridge.ts` 注册。
- `activeTimeOfDayPreset` 被 env-menu 与 sky 子菜单共享。