---
tier: architecture
source_files:
  - frontend/src/scene/manager/model-manager.ts
tests:
  - frontend/src/__tests__/model-manager.bone-overlay.test.ts
  - frontend/src/__tests__/model-manager.constructor.test.ts
  - frontend/src/__tests__/model-manager.focus.test.ts
  - frontend/src/__tests__/model-manager.physics-categories.test.ts
  - frontend/src/__tests__/model-manager.physics.test.ts
  - frontend/src/__tests__/model-manager.transform.test.ts
  - frontend/src/__tests__/model-manager.vmd-morph.test.ts
adr:
  - ADR-049
  - ADR-126
  - ADR-215
kind: model_manager
name: 模型注册表与生命周期管理
category: scene
scope:
  - frontend/src/scene/manager/model-manager.ts
symbols:
  - FormationType
  - ModelManager
  - getFormationLabels
invariants:
  - 模型状态完全封装，外部只能经 ModelManager 方法访问，不直接读写 modelRegistry
  - 物理分类规则 PHYSICS_CAT_RULES（skirt/chest/hair/accessory 多语言关键词），加载时构建 PHYSICS_CAT_PATTERNS；注：uiState.physicsCategoryMap 覆盖机制为历史注释声明，当前源码未实现
  - 不直接 import triggerAutoSave / scene.ts → 经构造函数注入回调，防循环依赖
  - dispose 级联释放骨骼覆盖（lineSystem/joints/overrideLines）、override 材质、outfit overlay；VMD 数据仅由 clearVmdData 显式清除（dispose 不清理）

use_when:
  - 模型注册表
  - 模型生命周期
  - 模型属性
  - 物理分类
---

# 模型注册表与生命周期管理

## 系统概览
Model Manager：封装 `modelRegistry`、`focusedModelId`、per-model 状态 map，提供模型 CRUD、属性设置、骨骼覆盖、物理类别、Morph 操作。消费者为 `scene.ts`（编排器）、`model-detail.ts`（UI）、serialization。

## 核心职责
- 模型状态完全封装，外部只能经方法访问
- 物理分类规则 `PHYSICS_CAT_RULES`（skirt/chest/hair/accessory 多语言关键词），可被 `uiState.physicsCategoryMap` 覆盖（格式同 `materialCategoryMap`）
- 骨骼覆盖、Morph、Formation 类型（`FormationType` / `getFormationLabels`）
- 属性设置经 `observer-handle` 订阅、避免循环依赖（不直接 import `scene.ts` / `triggerAutoSave`，后者经构造函数注入回调）

## 对外 API（节选）
- `modelManager` 单例 — `add` / `remove` / `get` / `list` 等注册表操作
- 物理类别判定：`ModelManager` 内部经 `PHYSICS_CAT_RULES` 关键词规则匹配（可经 `uiState.physicsCategoryMap` 覆盖）
- 属性：`setModelProperty` 系列（骨骼覆盖、Morph、formation）
- `getFormationLabels()` — Formation 类型人类可读标签

## 设计原则（防循环依赖）
- 不直接 import `triggerAutoSave` → 经注入回调触发自动保存
- 不引用 `scene.ts` 任何符号 → 无循环依赖

## 与其他子系统关系
- 上游：`model-loader.ts` 调用注册；`model-ops.ts` 调用 `remove`
- 下游：`material.ts`（`disposeModelMaterialState`）、`scene/manager/outfit-overlay`、`env/env-wetness`（`applyWetnessToInst`）
- 状态源：`core/state.ts`（`modelRegistry` / `focusedModelId`）
