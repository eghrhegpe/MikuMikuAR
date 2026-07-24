---
kind: render_menu
name: 菜单渲染引擎
category: ui
scope:
  - frontend/src/menus/render-menu.ts
source_files:
  - frontend/src/menus/render-menu.ts
adr:
  - ADR-093
symbols:
  - renderMenu
  - MenuNode
invariants:
  - Schema 驱动渲染，不硬编码 DOM
  - 支持多种控件类型（slider/toggle/dropdown 等）
tests: []
use_when:
  - 菜单渲染
  - schema 渲染
  - 控件渲染
  - 数据绑定
---

## 系统概览
**菜单渲染引擎**（ADR-093 Schema 驱动）。将 `MenuNode[]` schema 渲染为实际的 DOM UI 控件，
支持 slider、toggle、dropdown、color 等多种控件类型，通过 `bind` 属性实现数据双向绑定。

## 核心职责
- `render-menu.ts` — Schema 到 DOM 的渲染转换、控件绑定、事件处理。

## 对外 API（节选）
- `interface MenuNode` — 菜单节点定义（kind、label、control、bind 等）。
- `renderMenu(schema, container, bindings)` — 渲染菜单 schema。
- 支持控件类型：`slider` / `toggle` / `dropdown` / `color` / `button` / `folder`。

## 与其他子系统关系
- 被所有 `*-levels.ts` 调用。
- 数据绑定：`envState` / `uiState` / `sceneState`。
- Schema 类型：`menu-schema.ts`。

## 不变量
- Schema 驱动渲染：所有 UI 由 `MenuNode[]` 定义，不硬编码 DOM。
- `bind` 属性实现双向数据绑定，数据变化自动更新 UI，UI 变化自动更新数据。
- 控件类型扩展：新增控件类型只需添加渲染分支。
