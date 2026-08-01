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

**ADR-171 面板化后**：开关是 Gizmo 生成的唯一总闸，与面板选中联动。开启时若已有「当前选中物」（`transform-selection.ts`），自动挂载其 Gizmo；关闭时卸载。各面板独立的「拖拽定位」按钮已移除（`buildTransformCard`），拖拽一律从场景开关 + 面板选中进入。

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
- 开关状态由 `scene-menu.ts` 拖拽 folder 的 headerToggle 呈现；onChange 只做 `setDragModeEnabled(v); syncDragMode()`，不再 `closeAllOverlays()`（面板为主，开关不关面板）

## 与其他子系统关系
- 依赖 `core/reactivity`（`scheduleRefresh`）
- 被 `transform-selection.ts`（`syncDragMode`）消费：开关状态决定选中物是否挂 Gizmo
- 场景点击拖拽入口仍在 `scene.ts` `_bindSceneEvents`（ADR-171，`isDragModeEnabled()` 时 POINTERUP 位移<5px 触发 `tryAttachGizmoFromPick`），与面板化机制并存
- 与 `transform-selection.ts` / `transform-adapter.ts` / `transform-pick.ts` / `render/transform-gizmo.ts` 协同实现「场景开关 + 面板选中」驱动的拖拽
