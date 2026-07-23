---
kind: transform_pick
name: 变换拾取系统
category: rendering
scope:
  - frontend/src/scene/transform/**
source_files:
  - frontend/src/scene/transform/transform-pick.ts
adr: []
---

## 系统概览
变换拾取系统：通过场景拾取（`scene.pick`）识别用户点击的 mesh 属于哪个 kind/ID，并自动附加 Gizmo。在 mesh 的 `metadata` 中存储 `transformKind` / `transformId`，拾取时沿父级链向上查找（支持容器场景）。

## 核心职责
- `transform-pick.ts` — 变换元数据读写、场景拾取、Gizmo 自动附加。

## 对外 API（节选）
- `TransformPickResult` — 拾取结果接口（kind / id）。
- `getTransformMetadata(node)` — 从 mesh 的 metadata 中提取 transform 信息（沿父级链向上查找）。
- `setTransformMetadata(node, kind, id)` — 设置 mesh 的 transform 元数据。
- `pickTransformTarget(scene, x, y)` — 场景拾取：返回命中的 kind/ID，或 null。
- `tryAttachGizmoFromPick(scene, x, y)` — 拾取并附加 Gizmo：若已拾取到当前 Gizmo 目标则跳过，否则 `attachGizmoForKind`。

## 与其他子系统关系
- 依赖 [`transform-adapter`](./transform-adapter.md) 的 `attachGizmoForKind` 与 `getGizmoTargetId`。
- 被 `scene.ts` 或事件处理模块在点击场景时调用。