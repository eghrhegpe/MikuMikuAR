---
kind: menu_schema
tier: architecture
source_files:
  - frontend/src/menus/menu-schema.ts
  - frontend/src/scene/shared/menu-node-types.ts
tests:
  - frontend/src/__tests__/menu-schema.conflict.test.ts
  - frontend/src/__tests__/menu-schema.integrity.test.ts
  - frontend/src/__tests__/menu-schema.test.ts
name: 声明式菜单 Schema
category: ui
scope:
  - frontend/src/menus/menu-schema.ts
adr:
  - ADR-093
symbols:
  - StatePath
  - ActionMenuCtx
  - MenuKind
  - ControlSpec
  - MenuNode
  - getStateValue
  - setStateValue
  - getBindFn
invariants:
  - StatePath 由解析器按前缀映射到 reactive state 对象（env/render/light/ui/perception/motionModule）
  - getStateValue/setStateValue 经 get/set 衍生转换（如 windDirection→角度），避免硬编码转换逻辑散落
  - onChange 副作用需幂等（重复触发安全）
  - MenuNode 构成声明式树，由 renderMenu（render-menu.ts）统一渲染，本模块只定义类型与解析

use_when:
  - 菜单声明
  - 控件配置
  - 状态绑定
  - 菜单节点
---

# 声明式菜单 Schema

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

## UI 入口

- 菜单层级 / 入口函数 / 快捷键统一由 [menu-map.md](./menu-map.md) 机器生成（勿手改）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）无法静态提取，缺口由本卡正文说明。
