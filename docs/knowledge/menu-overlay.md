---
tier: architecture
kind: menu_overlay
name: 菜单 Overlay 与 Wrapper 管理
category: ui
scope:
  - frontend/src/menus/menu-overlay.ts
source_files:
  - frontend/src/menus/menu-overlay.ts
adr:
  - ADR-191
symbols:
  - addOnCloseAllOverlays
  - clearAllMenuWrappers
  - closeAllOverlays
  - disposeMenuWrapper
  - getMenuWrapper
  - setOnCloseAllOverlays
invariants:
  - disposeMenuWrapper 必须同时移除 DOM 节点并从 _menuWrapperRegistry 删除，避免泄漏
  - getMenuWrapper 切换时仅显示当前 menuId 的 wrapper，其余 display:none
  - closeAllOverlays 重置 popup 状态（setPopupOpen(false)）+ aria-expanded + dialog overlay，并触发注册的回调
  - overlay 关闭时 inert=true，防止键盘/AI 聚焦到不可见元素
tests: []
use_when:
  - 菜单 overlay
  - 弹窗 wrapper
  - 关闭所有浮层
---

## 系统概览
管理菜单 overlay 浮层与 `.menu-wrapper` 容器。从 `@/core/utils` 抽出（ADR-191 去桶化），因依赖 DOM 与 popup 状态而置于 menus 子系统而非 core。

## 核心职责
- `_onCloseAllOverlays` 回调钩子（`setOnCloseAllOverlays` 注册，供外部统一拦截关闭）
- `closeAllOverlays()` — 关闭所有 `[data-overlay].visible`、重置 `setPopupOpen(false)`、`aria-expanded=false`、隐藏 `mmd-dialog-overlay`，最后触发回调
- `_menuWrapperRegistry: Map<menuId, HTMLElement>`：`getMenuWrapper(menuId)` 惰性创建 `.menu-wrapper` 挂到 `dom.sceneOverlay` 并仅显示当前；`disposeMenuWrapper(menuId)` 移除并删除；`clearAllMenuWrappers()` 全清

## 对外 API（节选）
- `setOnCloseAllOverlays(fn)`
- `closeAllOverlays()`
- `getMenuWrapper(menuId)` / `disposeMenuWrapper(menuId)` / `clearAllMenuWrappers()`

## 关键约定
- `disposeMenuWrapper` 必须配对 DOM 移除与 registry 删除
- overlay 关闭时 `inert=true`，防止键盘/AI 聚焦不可见元素

## 与其他子系统关系
- 依赖 `core/dom`（`dom.sceneOverlay`）、`core/state`（`setPopupOpen`）
- 被各菜单 / 弹窗浮层消费
