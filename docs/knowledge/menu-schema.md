---
kind: menu_schema
name: 声明式菜单 Schema
category: ui
scope:
  - frontend/src/menus/menu-schema.ts
source_files:
  - frontend/src/menus/menu-schema.ts
adr:
  - ADR-093
---

## 系统概览
Menu Declarative Schema（ADR-093）：单一数据源 + 单渲染器，消除命令式 builder 膨胀。当前状态 P0+P1+P2 全量落地（57 面板），P3 类型化增强中。

## 核心职责
- `StatePath` — 类型化状态路径（`env.*` / `render.*` / `light.*` / `ui.*` / `perception.*` / `motionModule.*`），由解析器按前缀映射到 reactive state 对象
- `MenuKind` — `folder` / `slider` / `colorSlider` / `toggle` / `modeSlider` / `modeRow` / `sectionTitle` / `divider` / `custom`
- `ControlSpec` — `bind`(StatePath) + `min/max/step/icon/options` + 衍生 `get/set`（状态值↔控件值转换，如 windDirection→角度）+ `onChange` 副作用（如 reflectionQuality 变化后重建水体）
- `MenuNode` — 声明式菜单节点树，由单渲染器 `renderMenu` 统一渲染

## 对外 API（节选）
- `StatePath` / `MenuKind` / `ControlSpec` / `MenuNode` 类型
- 状态路径解析器（前缀 → reactive state 映射）
- `renderMenu`（统一渲染器，被各菜单消费）

## 关键约定
- 控件与状态双向绑定经 `get/set` 衍生转换，避免硬编码转换逻辑散落
- `onChange` 副作用需幂等（重复触发安全）

## 与其他子系统关系
- 被 `env-menu.ts` / `scene-menu.ts` / `settings.ts` 等消费的菜单声明
- 状态源来自 `core/config`（`envState`/`uiState`）、`scene/render/lighting`、`scene/motion/perception`、`motion-modules/registry`
- 渲染经 `render-menu.ts`
