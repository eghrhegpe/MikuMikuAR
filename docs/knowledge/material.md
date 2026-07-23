---
kind: material_system
name: 分类材质系统
category: scene
scope:
  - frontend/src/scene/manager/material.ts
source_files:
  - frontend/src/scene/manager/material.ts
---

## 系统概览
MikuMikuAR 材质系统：分类（category-based）与逐材质参数调整。从 `scene.ts` L1674-1978 抽取。让 prop/non-model 资源也能复用 id-based 材质 API。

## 核心职责
- 外部材质目标注册表 `_externalMeshes`（propRegistry 等经 `registerMaterialTarget` 注册，卸载时 `unregisterMaterialTarget` 释放并 `disposeModelMaterialState`）
- `_getMeshesById` — 先 `modelRegistry`，后外部注册表兜底
- 材质分类参数 `MaterialCategoryParams`（diffuseMul 等），按网格/材质名归类批量调参
- 提供 `_capture`（供 `model-loader` 在实例创建时捕获初始材质状态）

## 对外 API（节选）
- `registerMaterialTarget(id, meshes)` / `unregisterMaterialTarget(id)`
- `getMaterialMeshes(id)` — UI 层（model-material.ts）按 id 拿 meshes，不依赖 modelRegistry
- 分类调参 / 逐材质 setter（被 UI 面板调用）

## 关键约定
- 资源卸载必须 `unregisterMaterialTarget` 以释放 `_externalMeshes` 与材质状态，避免 prop 材质泄漏
- 写入触发 `triggerAutoSave`

## 与其他子系统关系
- 上游：`model-loader.ts`（`_capture`）、UI 面板（model-material.ts）
- 下游：`model-manager.ts`（`disposeModelMaterialState`）、`core/state`（`uiState` / `triggerAutoSave`）
- 状态源：`modelRegistry` + 外部注册表
