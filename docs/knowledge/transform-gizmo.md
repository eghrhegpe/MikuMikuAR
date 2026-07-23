---
kind: transform_gizmo
name: 3D 拖拽 Gizmo 统一抽象
category: rendering
scope:
  - frontend/src/scene/render/transform-gizmo.ts
source_files:
  - frontend/src/scene/render/transform-gizmo.ts
adr:
  - ADR-048
  - ADR-126
---

## 系统概览
Transform Gizmo（ADR-048）：模型/道具/灯光 3D 拖拽 Gizmo 统一抽象。封装 PositionGizmo / RotationGizmo / ScaleGizmo 生命周期，**一次只允许一个实体激活 Gizmo（独占策略）**。调用方：lighting.ts / model-ops.ts / scene-prop-levels.ts。

## 核心职责
- `GizmoType = 'position' | 'rotation' | 'scale'`
- 模块级单例状态：`_posGizmo` / `_rotGizmo` / `_scaleGizmo` / `_gizmoTargetId` / `_gizmoNode`（独占）
- `initTransformGizmo(scene)` — 初始化（由 lighting.ts 调用）
- `attachGizmo(type, node, id)` / `detachGizmo()` / `isGizmoActive()` / `isGizmoDragging()` / `getGizmoTargetId()` / `getGizmoNode()`
- 网格吸附（ADR-126 Phase 3）：`setGizmoSnapDistance` / `getGizmoSnapConfig`，position 以场景单位步进（snapDistance=0 即禁用，零副作用）
- `onGizmoDragObservable` — 拖拽连续可观察量（每帧触发），供数值滑杆实时同步显示（不含持久化回写，防 `triggerAutoSave` 风暴）

## 对外 API（节选）
- `attachGizmo(type, node, id)` / `detachGizmo()`
- `onGizmoDragObservable` / `setGizmoSnapDistance(step)`
- `isGizmoActive()` / `getGizmoTargetId()`

## 关键约定
- 独占策略：同时仅一个实体可激活 Gizmo
- 拖拽连续 observable 仅作显示同步，不触发自动保存

## 与其他子系统关系
- 被 `transform-adapter.ts`（attachGizmoForKind 收敛点）、`lighting.ts`、`model-ops.ts` 调用
- 与 `transform-mode.ts`（拖拽开关）、`transform-pick.ts`（目标识别）协同双模态（拖拽 + 滑杆）
- 依赖 `core/dispose-helpers`（Gizmo 释放）
