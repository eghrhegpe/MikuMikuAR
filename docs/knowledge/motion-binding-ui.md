---
kind: motion_binding_ui
name: 动作绑定 UI
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/motion-binding-ui.ts
adr: []
---

## 系统概览
动作绑定与模型动作管理的 UI 层。管理动作槽位（`ensureMotionSlots`）、意图应用（`applyIntentToModel`）、动作广播（`initMotionBroadcast`）、模块切换列表渲染（`renderModuleToggleList`）以及动作绑定层级构建（`buildActionBindingLevel`）。

## 核心职责
- `motion-binding-ui.ts` — 动作绑定、模型动作意图应用、动作槽位管理、模块切换 UI。

## 对外 API（节选）
- `renderModuleToggleList(container, inst)` — 渲染模块开关列表（程序化动作模块的启用/禁用）。
- `resetFocusedLayerId()` — 重置聚焦图层 ID。
- `DEFAULT_MOTION_SLOTS` — 默认动作槽位定义。
- `ensureMotionSlots(inst)` — 确保模型实例具有动作槽位。
- `applyIntentToModel(id, intent, gen)` — 应用动作意图到模型（含 generation 防过期）。
- `initMotionBroadcast()` — 初始化动作广播监听。
- `buildActionBindingLevel(id)` — 构建动作绑定弹窗层级。
- `handleModelAction(action, id)` — 处理模型动作回调（如绑定/解绑动作）。

## 与其他子系统关系
- 依赖 `motion-intent` 的意图管理。
- 依赖 `motion-popup` 的动作菜单。
- 依赖 `render-menu` 渲染菜单。
- 依赖 `load-manager` 获取模型加载状态。