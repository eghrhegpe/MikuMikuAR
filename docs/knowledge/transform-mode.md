---
kind: transform_mode
name: 拖拽变换模式开关
category: scene
scope:
  - frontend/src/scene/transform/transform-mode.ts
source_files:
  - frontend/src/scene/transform/transform-mode.ts
---

## 系统概览
变换拖拽模式开关：控制是否启用 Gizmo 拖拽粗调。状态持久在 `localStorage`（`miku.dragModeEnabled`），切换经 `reactivity.scheduleRefresh()` 触发 UI 刷新。

## 核心职责
- `isDragModeEnabled()` / `setDragModeEnabled(v)` / `toggleDragMode()`
- 同值短路（`if (_dragModeEnabled === enabled) return`）
- 切换写入 localStorage 并 `scheduleRefresh()` 通知菜单 `updateControls()`

## 对外 API（节选）
- `isDragModeEnabled(): boolean`
- `setDragModeEnabled(enabled: boolean)`
- `toggleDragMode()`

## 关键约定
- 持久化键 `miku.dragModeEnabled`（'1'/'0'）
- 与 `reactivity` 刷新总线联动，UI 状态实时同步

## 与其他子系统关系
- 依赖 `core/reactivity`（`scheduleRefresh`）
- 被变换相关 UI（`buildTransformCard`）读取以决定是否显示 Gizmo 拖拽入口
- 与 `transform-adapter.ts` / `transform-pick.ts` / `render/transform-gizmo.ts` 协同实现双模态（拖拽 + 滑杆）
