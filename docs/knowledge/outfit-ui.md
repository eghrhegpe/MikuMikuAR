---
kind: outfit_ui
name: 换装 UI 构建器
category: ui
scope:
  - frontend/src/menus/outfit-ui.ts
source_files:
  - frontend/src/menus/outfit-ui.ts
adr: []
symbols:
  - buildOutfitLevel
invariants:
  - 换装 UI 构建器
tests: []
use_when:
  - 换装 UI
  - outfit
  - 服装编辑
  - 配饰编辑
---

## 系统概览
**换装 UI 构建器**。提供换装菜单的层级构建（服装、配饰、姿势等），是 outfit 编辑的入口。

## 核心职责
- `outfit-ui.ts` — 换装菜单层级构建、参数绑定。

## 对外 API（节选）
- `buildOutfitLevel(modelId)` — 构建换装层级。

## 与其他子系统关系
- 渲染：`render-menu.ts`。
- 道具系统：`../../scene/env/props.ts`。
- 环境弹窗：`env-menu.ts`（换装子菜单）。

## 不变量
- Schema 驱动 UI：所有控件定义在 `MenuNode[]` 中。
- 换装参数与模型状态绑定。
