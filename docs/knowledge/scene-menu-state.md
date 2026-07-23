---
kind: scene_menu_state
name: 场景菜单共享状态
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/scene-menu-state.ts
adr: []
---

## 系统概览
场景菜单的共享状态模块，从 `scene-menu.ts` 拆分而来，切断 `scene-menu` ↔ `env-ground-levels` 的双向 import 依赖。对标 `env-menu-state.ts`，纯状态模块，零 UI 依赖。

## 核心职责
- `scene-menu-state.ts` — 场景菜单实例注册表、reRender 便捷函数、refreshRoot 注册表。

## 对外 API（节选）
- `setSceneMenu(menu)` / `getSceneMenu()` — 场景菜单实例的注册与获取。
- `reRenderSceneMenu()` — 触发场景菜单重渲染。
- `setRefreshSceneRoot(fn)` / `refreshSceneRoot()` — 根级 items 重建函数的注册与触发（由 `registerPopupMenu` 返回）。

## 与其他子系统关系
- 被 `scene-*-levels.ts`（场景各子菜单层级）用来获取菜单实例后调用 `reRender()`。