---
kind: scene_drag_levels
name: 场景拖拽层级菜单
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/scene-drag-levels.ts
adr:
  - ADR-171
---

## 系统概览
构建「场景拖拽模式」的弹出菜单层级（`PopupLevel`），让用户切换对选中模型的拖拽 / 旋转 / 缩放
交互模式。是 ADR-171「场景级拖拽」在 UI 侧的入口。

## 核心职责
- `scene-drag-levels.ts` — 组装拖拽模式切换菜单，回写交互状态。

## 对外 API（节选）
- `buildDragModeLevel(): PopupLevel` — 构建并返回拖拽模式弹出层级。

## 与其他子系统关系
- 菜单采用声明式 Schema（ADR-093），`PopupLevel` 由菜单架构统一渲染。
- 选择的拖拽模式驱动场景内 Gizmo / 指针交互逻辑。
