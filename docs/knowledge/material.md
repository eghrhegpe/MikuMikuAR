---
tier: architecture
kind: material_system
name: 分类材质系统
category: scene
scope:
  - frontend/src/scene/manager/material.ts
source_files:
  - frontend/src/scene/manager/material.ts
symbols:
  - AlphaCtx
  - DEFAULT_MAT_PARAMS
  - MaterialCategory
  - MaterialCategoryParams
  - MaterialStateManager
  - _applyAll
  - _capture
  - _catOf
  - _catState
  - _matEnabled
  - _matState
  - applyMatState
  - applyUnlitFallback
  - disposeModelMaterialState
  - getMatCatGroups
  - getMatCatParams
  - getMatDetailList
  - getMatParams
  - getMatState
  - isMatCategoryAllEnabled
  - isMatEnabled
  - resetMatCatParams
  - resetPerMaterialParams
  - resetSingleMatParams
  - setMatCatParams
  - setMatCategoryEnabled
  - setMatEnabled
  - setMatParams
invariants:
  - 资源卸载必须 disposeModelMaterialState(id) 释放按 id 的材质状态映射，避免模型材质泄漏
  - 写入触发 triggerAutoSave
  - 材质分类参数按网格/材质名归类批量调参，由 MaterialStateManager 统一管理
tests: []
use_when:
  - 材质系统
  - 分类材质
  - 材质参数调节
  - 材质状态管理
---

## 系统概览
MikuMikuAR 材质系统：分类（category-based）与逐材质参数调整，沉淀为独立 `scene/manager/material.ts` 模块（原从 `scene.ts` 抽取）。以 `MaterialStateManager` 单例 + id-based 自由函数提供按模型 / 分类的材质状态管理。

## 核心职责
- `MaterialStateManager` 单例（L163 `_stateMgr`）管理按 id 的材质状态：`catState`（分类参数映射）/ `matState`（逐材质参数映射）/ `matEnabled`（启用开关映射）
- `disposeModelMaterialState(id)` 卸载时释放按 id 的材质状态映射，避免模型切换时的材质泄漏
- 材质分类参数 `MaterialCategoryParams`（diffuseMul 等），按网格/材质名归类批量调参
- 提供 `_capture(mat)`（供 `model-loader` 在实例创建时捕获初始材质状态）

## 对外 API（节选）
- `MaterialStateManager` 实例状态 + id-based 自由函数：`isMatEnabled` / `setMatEnabled` / `getMatCatParams` / `setMatCatParams` / `resetMatCatParams` / `getMatParams` / `setMatParams` / `getMatDetailList` / `applyMatState` / `getMatState` / `disposeModelMaterialState` / `applyUnlitFallback`
- `_capture(mat)` — 供 `model-loader` 在实例创建时捕获初始材质状态

## 关键约定
- 资源卸载必须 `disposeModelMaterialState(id)` 释放按 id 的材质状态映射，避免模型材质泄漏
- 写入触发 `triggerAutoSave`

## 与其他子系统关系
- 上游：`model-loader.ts`（`_capture`）、UI 面板（model-material.ts）
- 下游：`model-manager.ts`（`disposeModelMaterialState`）、`core/state`（`uiState` / `triggerAutoSave`）
- 状态源：`modelRegistry`（按 id 查找模型）
