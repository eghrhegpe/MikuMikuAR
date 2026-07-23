---
kind: model_manager
name: 模型注册表与生命周期管理
category: scene
scope:
  - frontend/src/scene/manager/model-manager.ts
source_files:
  - frontend/src/scene/manager/model-manager.ts
---

## 系统概览
Model Manager：封装 `modelRegistry`、`focusedModelId`、per-model 状态 map，提供模型 CRUD、属性设置、骨骼覆盖、物理类别、Morph 操作。消费者为 `scene.ts`（编排器）、`model-detail.ts`（UI）、serialization。

## 核心职责
- 模型状态完全封装，外部只能经方法访问
- 物理分类规则 `PHYSICS_CAT_RULES`（skirt/chest/hair/accessory 多语言关键词），可被 `uiState.physicsCategoryMap` 覆盖（格式同 `materialCategoryMap`）
- 骨骼覆盖、Morph、Formation 类型（`FormationType` / `getFormationLabels`）
- 属性设置经 `observer-handle` 订阅、避免循环依赖（不直接 import `scene.ts` / `triggerAutoSave`，后者经构造函数注入回调）

## 对外 API（节选）
- `modelManager` 单例 — `add` / `remove` / `get` / `list` 等注册表操作
- 物理类别判定：`classifyPhysics(id)` 按网格/骨骼名匹配规则
- 属性：`setModelProperty` 系列（骨骼覆盖、Morph、formation）
- `getFormationLabels()` — Formation 类型人类可读标签

## 设计原则（防循环依赖）
- 不直接 import `triggerAutoSave` → 经注入回调触发自动保存
- 不引用 `scene.ts` 任何符号 → 无循环依赖

## 与其他子系统关系
- 上游：`model-loader.ts` 调用注册；`model-ops.ts` 调用 `remove`
- 下游：`material.ts`（`disposeModelMaterialState`）、`outfit/outfit-overlay`、`env/env-wetness`（`applyWetnessToInst`）
- 状态源：`core/state.ts`（`modelRegistry` / `focusedModelId`）
