---
kind: scene_menu_levels
name: 场景菜单层级系统
category: ui
scope:
  - frontend/src/menus/scene-*-levels.ts
source_files:
  - frontend/src/menus/scene-menu-state.ts
  - frontend/src/menus/scene-render-levels.ts
  - frontend/src/menus/scene-render-presets.ts
  - frontend/src/menus/scene-stage-levels.ts
  - frontend/src/menus/scene-stage-lights.ts
  - frontend/src/menus/scene-prop-levels.ts
  - frontend/src/menus/scene-physics-levels.ts
  - frontend/src/menus/scene-drag-levels.ts
  - frontend/src/menus/resource-detail-helpers.ts
adr:
  - ADR-171
symbols:
  - getSceneMenu
  - reRenderSceneMenu
  - buildRenderLevel
  - buildStageLevel
  - buildPhysicsLevel
  - buildPropDetailLevel
  - buildDragLevels
  - buildTransformCard
  - buildMaterialCard
  - buildDangerCard
invariants:
  - Schema 驱动 UI，数据绑定到 sceneState
  - 场景菜单状态在 scene-menu-state.ts 中管理
tests: []
use_when:
  - 场景菜单
  - 场景层级
  - 渲染面板
  - 舞台面板
  - 道具面板
  - 物理面板
  - 拖拽层级
  - 资源详情
---

## 系统概览
**场景菜单层级系统**（Schema 驱动）。场景弹窗的各级面板（渲染设置、舞台管理、道具详情、
物理设置、拖拽层级等），每个面板为独立的 `PopupLevel`。`scene-menu-state.ts` 维护菜单实例
注册表，`resource-detail-helpers.ts` 提供资源详情卡片构建函数。

## 核心职责
- `scene-menu-state.ts` — 场景菜单状态 + 实例注册表。
- `scene-*-levels.ts` — 各场景子系统的菜单 schema 定义。
- `resource-detail-helpers.ts` — 资源详情卡片构建（变换、材质、危险操作）。

## 对外 API（节选）
- `getSceneMenu()` / `setSceneMenu(menu)` — 取/设场景菜单实例。
- `reRenderSceneMenu()` — 重渲染场景菜单。
- `buildTransformCard(model)` — 构建变换卡片。
- `buildMaterialCard(model)` — 构建材质卡片。
- `buildDangerCard()` — 构建危险操作卡片（删除等）。

## 与其他子系统关系
- 模型操作：`../scene/manager/model-ops.ts`。
- 场景状态：`../scene/scene.ts`。
- 渲染设置：`../scene/render/renderer.ts`。
- 物理：`../scene/physics/*`。
- 渲染：`render-menu.ts`。

## 不变量
- Schema 驱动 UI：所有控件定义在 `MenuNode[]` 中。
- 场景菜单状态在 `scene-menu-state.ts` 中管理，不分散到各 levels 文件。
- 危险操作（删除模型等）使用 `buildDangerCard`，有确认提示。
