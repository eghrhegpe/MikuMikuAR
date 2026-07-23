---
kind: model_detail
name: 模型子菜单构建
category: ui
scope:
  - frontend/src/menus/model-detail.ts
source_files:
  - frontend/src/menus/model-detail.ts
---

## 系统概览
Model 子菜单：从 `library.ts` 提取。职责：模型各层级构建（外观/信息/标签/表情/材质）。聚合模型详情所需的全部子面板与动作入口。

## 核心职责
- 层级构建：外观、信息（`addInfoGrid`/`addInfoCard`）、标签、表情（morph：`getModelMorphs`/`setModelMorphWeight`/`resetModelMorphs`）、材质（`buildMatRootLevel`）
- `buildTransformCard`（来自 `resource-detail-helpers`）— 模型变换卡片统一入口
- 联动：`modelManager`（来自 scene）、`removeModel`（来自 model-ops）、`buildOutfitLevel`（outfit-ui）、`buildVirtualSkirtLevel`（motion-cloth-levels）、`buildPhysicsDebugLevel`（scene-physics-levels）
- 个人光：`getPersonalLightState` / `setPersonalLightState`（来自 lighting-follow）
- 标签：`GetTagsByModel` / `AddTag` / `RemoveTag`（backend 代理）
- 预设：`savePresetToLibDialog` / `buildPresetListLevel`（model-preset）

## 对外 API（节选）
- 各模型层级构建器（外观/信息/标签/表情/材质）
- `buildModelDetailLevel(...)`（根层级）

## 关键约定
- 详情页复用 `buildTransformCard` 统一变换交互
- 表情 morph 写回经 `model-ops` 集中管理

## 与其他子系统关系
- 依赖 `scene/manager/model-ops.ts`（morph/remove）、`scene/manager/model-manager.ts`
- 依赖 `model-material.ts`、`outfit-ui.ts`、`motion-cloth-levels.ts`、`scene-physics-levels.ts`
- 状态源：`core/config`（`modelRegistry` / `focusedModelId`）、`core/state`
