---
kind: transform_adapter
name: 变换适配器注册表（双模态去重）
category: scene
scope:
  - frontend/src/scene/transform/transform-adapter.ts
source_files:
  - frontend/src/scene/transform/transform-adapter.ts
adr:
  - ADR-126
  - ADR-121
---

## 系统概览
Transform Adapter Registry（ADR-126）：把「某 kind 支持哪些变换能力 + 如何读写」抽象为 `TransformAdapter` 接口，同构的 Gizmo 调度与滑杆渲染收敛到此，消除 `buildTransformCard` 的 9 段 if/else。

## 核心职责
- `TransformAdapter` 接口：声明服务的 `kinds`、`getNode(id)`、`gizmoTypes(id)`、`onPositionDragEnd` / `onRotationDragEnd` / `onScaleDragEnd`、能力声明 `capabilities`（`slider-scale` / `slider-opacity`）、`getScale`/`setScale`/`getOpacity`/`setOpacity`
- `registerTransformAdapter(a)` — 各 kind 模块（model-ops / props / lighting）反向注册，**载入即完成注册**（ADR-121 依赖方向）
- `adapters: Map<ResourceKind, TransformAdapter>` — 单例注册表

## 对外 API（节选）
- `registerTransformAdapter(adapter)`
- `getAdapter(kind)` / `attachGizmoForKind` / `getGizmoTargetId`（gizmo 调度收敛点）
- `TransformCapability` 类型 + `TransformAdapter` 接口

## 依赖方向（防循环依赖）
- 本文件不 import 任何 kind 模块；由各 kind 模块反向调用注册
- Gizmo 底层经 `render/transform-gizmo`（`attachGizmo` / `isGizmoActive` / `onGizmoDragObservable` 等）

## 与其他子系统关系
- 注册方：`model-ops.ts`（模型适配器）、props/lighting 模块
- 依赖 `render/transform-gizmo.ts`（Gizmo 实现）、`core/load-manager`（`ResourceKind`）
- 联动：`transform-mode.ts`（拖拽开关）、`transform-pick.ts`（目标识别）
