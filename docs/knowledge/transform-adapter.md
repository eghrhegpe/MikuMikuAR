---
kind: transform_adapter
name: 变换适配器注册表
category: rendering
scope:
  - frontend/src/scene/transform/**
source_files:
  - frontend/src/scene/transform/transform-adapter.ts
adr:
  - ADR-126
---

## 系统概览
跨 kind 拖拽/数值双模态变换适配器注册表（ADR-126）。把「某 kind 支持哪些变换能力 + 如何读写」抽象为 `TransformAdapter` 接口，同构的 Gizmo 调度与滑杆渲染收敛到此，消除 `buildTransformCard` 的 9 段 if/else。各 kind 模块（model-ops / props / lighting）反向调用 `registerTransformAdapter` 注册，载入即完成注册（ADR-121 依赖方向）。

## 核心职责
- `transform-adapter.ts` — 变换适配器注册/查询、Gizmo 统一入口、底层 Gizmo API 透传。

## 对外 API（节选）
- `TransformCapability` — 变换能力枚举（'slider-scale' | 'slider-opacity'）。
- `TransformAdapter` — 变换适配器接口（kinds / getNode / gizmoTypes / onPositionDragEnd / capabilities / getScale / setScale 等）。
- `registerTransformAdapter(a)` — 注册变换适配器（同一适配器可声明多个 kind）。
- `getTransformAdapter(kind)` — 查询指定 kind 的适配器。
- `attachGizmoForKind(kind, id)` — 统一 Gizmo 入口：替代三个 attachXxxGizmo，根据 kind 取适配器 → 取 node → attachGizmo（独占策略，自动 detach 上一个）。
- 透传：`detachGizmo` / `isGizmoActive` / `isGizmoDragging` / `getGizmoTargetId` / `onGizmoDragObservable` / `getGizmoNode` / `getActiveGizmoTypes` / `setGizmoSnapDistance` / `getGizmoSnapConfig`。

## 与其他子系统关系
- 不 import 任何 kind 模块（避免循环依赖）。
- 被 `model-ops` / `props` / `lighting` 等模块反向注册。
- 被 [`transform-pick`](./transform-pick.md) 引用以统一 Gizmo 入口。
- 被 `model-ops` / [`props`](./props.md) / `lighting` 等模块反向注册。