---
kind: model_material_ui
name: 材质编辑 UI
category: ui
scope:
  - frontend/src/menus/model-material.ts
source_files:
  - frontend/src/menus/model-material.ts
adr: []
symbols:
  - buildMatBatchLevel
  - buildPerMatLevel
  - buildMatRootLevel
  - buildMatListLevel
invariants:
  - Schema 驱动 UI
tests: []
use_when:
  - 材质编辑
  - 材质菜单
  - 模型材质
  - 材质调整
---

## 系统概览
**材质编辑 UI 根层级**。提供模型的材质编辑菜单（颜色、透明度、发光、贴图偏移等），
是 model-detail 和 resource-detail-helpers 的材质面板入口。

## 核心职责
- `model-material.ts` — 材质编辑菜单 schema 定义、参数绑定。

## 对外 API（节选）
- `buildMatBatchLevel(id, modelName)` — 批量材质编辑层级。
- `buildPerMatLevel(id, modelName, matIndex)` — 单材质编辑层级。
- `buildMatRootLevel()` — 材质菜单根层级。
- `buildMatListLevel()` — 材质列表层级。

## 与其他子系统关系
- 被 `model-detail.ts` 和 `resource-detail-helpers.ts` 调用。
- 材质系统：`../../scene/manager/material.ts`。
- 渲染：`render-menu.ts`。

## 不变量
- Schema 驱动 UI：所有控件定义在 `MenuNode[]` 中。
- 参数双向绑定到模型材质状态。
