---
kind: ui_focus_trap
name: 焦点陷阱工具
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/ui-focus-trap.ts
adr:
  - ADR-153
---

## 系统概览
为弹窗/对话框提供焦点陷阱（Focus Trap）与焦点恢复功能（ADR-153 Phase 1）。Tab 键在容器内循环，Shift+Tab 反向循环，Escape 触发关闭回调。返回的 restore 函数在弹窗关闭后恢复焦点到之前的位置，避免焦点丢失到 `<body>`。

## 核心职责
- `ui-focus-trap.ts` — 焦点陷阱创建、焦点恢复。

## 对外 API（节选）
- `createFocusTrap({ container, onEscape })` — 创建焦点陷阱，返回 restore 函数。
  - 自动获取 `document.activeElement` 作为 `previousFocus`。
  - Tab 在可聚焦元素间循环，Shift+Tab 反向循环。
  - Escape 触发 `onEscape` 回调。
  - restore() 移除 keydown 监听器，若 previousFocus 仍可聚焦则回打焦点。

## 与其他子系统关系
- 被弹窗/对话框组件（dialog、fullscreen-overlay 等）引用。