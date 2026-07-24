---
kind: env_menu_levels
name: 环境菜单层级系统
category: ui
scope:
  - frontend/src/menus/env-*-levels.ts
source_files:
  - frontend/src/menus/env-level-helpers.ts
  - frontend/src/menus/env-menu-state.ts
  - frontend/src/menus/env-cloud-levels.ts
  - frontend/src/menus/env-fog-levels.ts
  - frontend/src/menus/env-ground-levels.ts
  - frontend/src/menus/env-preset-levels.ts
  - frontend/src/menus/env-shadow-levels.ts
  - frontend/src/menus/env-sky-levels.ts
  - frontend/src/menus/env-water-levels.ts
  - frontend/src/menus/env-wind-levels.ts
  - frontend/src/menus/env-experimental-levels.ts
adr: []
symbols:
  - PopupLevel
  - buildLevel
  - buildCloudLevel
  - buildFogLevel
  - buildGroundLevel
  - buildSkyLevel
  - buildWaterLevel
  - buildWindLevel
  - EnvTextureBindingTarget
  - setEnvTextureBindingTarget
  - getEnvMenu
  - reRenderEnvMenu
invariants:
  - Schema 驱动 UI，数据绑定到 envState
  - 菜单实例注册表在 env-menu.ts 中注册
tests: []
use_when:
  - 环境菜单
  - 环境层级
  - 云层面板
  - 地面面板
  - 天空面板
  - 水面面板
  - 风力面板
  - 贴图绑定
---

## 系统概览
**环境菜单层级系统**（Schema 驱动）。环境弹窗的各级面板（云、雾、地面、天空、水面、风力等），
每个面板为独立的 `PopupLevel`，由 `MenuNode[]` schema 定义 UI 控件，通过 `bind` 属性数据绑定到 `envState`。
`env-level-helpers.ts` 提供通用构建函数，`env-menu-state.ts` 维护菜单实例注册表。

## 核心职责
- `env-level-helpers.ts` — 通用层级构建函数 `_buildLevel`。
- `env-menu-state.ts` — 菜单状态（EnvTextureBindingTarget）+ 菜单实例注册表。
- `env-*-levels.ts` — 各环境子系统的菜单 schema 定义。

## 对外 API（节选）
- `interface PopupLevel` — 弹窗层级描述（title、schema、actions）。
- `buildLevel(title, schemaFactory)` — 构建环境层级。
- `getEnvMenu()` / `setEnvMenu(menu)` — 取/设环境菜单实例。
- `reRenderEnvMenu()` — 重渲染环境菜单。
- `getEnvTextureBindingTarget()` / `setEnvTextureBindingTarget(target)` — 贴图绑定目标。

## 与其他子系统关系
- 数据绑定：`envState`（各种环境参数）。
- 渲染：`render-menu.ts` 的 `renderMenu` 函数。
- 菜单引擎：`menu.ts` 的 `SlideMenu`。
- 环境实现：`../scene/env/env-impl.ts`。
- Schema 类型：`menu-schema.ts` 的 `MenuNode`。

## 不变量
- Schema 驱动 UI：所有控件定义在 `MenuNode[]` 中，不硬编码 DOM。
- `bind` 属性指向 `envState` 路径，实现双向数据绑定。
- 菜单实例注册表在 `env-menu.ts` 初始化时注册。
