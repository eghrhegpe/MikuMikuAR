---
kind: bone_override
name: 骨骼覆盖核心 API
category: motion
scope:
  - frontend/src/scene/motion/bone-override.ts
source_files:
  - frontend/src/scene/motion/bone-override.ts
adr:
  - ADR-061
  - ADR-116
  - ADR-123
  - ADR-126
symbols:
  - BoneOverrideEntry
  - computeOverride
  - setBoneOverride
  - applyBoneOverrideIK
  - clearBoneOverride
  - getOverride
  - clearAllOverrides
invariants:
  - 被 6 个 motion-modules 子模块引用
  - 与 bone-override-store 协作（所有权仲裁）
tests: []
use_when:
  - 骨骼覆盖
  - bone override
  - 骨骼编辑
  - 动作覆盖
  - 欧拉角覆盖
  - 混合权重
---

## 系统概览
**骨骼覆盖核心 API**（ADR-061/116/123/126）。提供骨骼覆盖的增删改查接口，是 UI 编辑和
动作模块的底层入口。与 `bone-override-store` 协作：本模块负责覆盖数据的管理和应用，
`bone-override-store` 负责多模块的所有权仲裁。

## 核心职责
- `bone-override.ts` — 骨骼覆盖数据管理、应用、序列化。

## 对外 API（节选）
- `type BoneOverrideEntry` — 单条骨骼覆盖描述（欧拉角 + 权重 + 绝对模式）。
- `computeOverride(boneName, euler, weight, modelId?)` — 计算覆盖。
- `setBoneOverride(boneName, euler, weight, absolute?, modelId?)` — 设置骨骼覆盖。
- `applyBoneOverrideIK()` — 应用覆盖到 IK 系统。
- `clearBoneOverride(boneName, modelId?)` — 清除指定骨骼覆盖。
- `getOverride(boneName, modelId?)` — 取指定骨骼覆盖。
- `clearAllOverrides(modelId?)` — 清除全部覆盖。

## 与其他子系统关系
- 所有权仲裁：`bone-override-store`（ADR-084）。
- 被 motion-modules 子模块引用（body-posture/feet-adjustment/finger-pose 等）。
- UI 编辑：`menus/model-detail.ts` / `model-material.ts`。
- 类型定义：`../core/types.ts`（BoneOverrideEntry）。

## 不变量
- 覆盖数据按模型 ID 隔离。
- 应用覆盖时不改变骨骼原始值，使用 `setOverride` 机制。
