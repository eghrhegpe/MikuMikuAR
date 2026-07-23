---
kind: transform_pick
name: 变换目标拾取与元数据
category: scene
scope:
  - frontend/src/scene/transform/transform-pick.ts
source_files:
  - frontend/src/scene/transform/transform-pick.ts
---

## 系统概览
变换拾取与元数据：在节点树中沿 parent 链向上查找 `transformKind` / `transformId` 元数据，把任意 mesh 关联到它所属的「可变换资源」（model/prop/light 等），并支持屏幕坐标拾取。

## 核心职责
- `TransformMetadata` — `{ transformKind: ResourceKind, transformId: string }`，挂在 `node.metadata`
- `getTransformMetadata(node)` — 从当前节点沿 parent 向上回溯源 `transformKind` / `transformId`
- `setTransformMetadata(node, kind, id)` — 写回元数据（模型加载时由 `model-loader` 调用）
- `pickTransformTarget(scene, x, y)` — `scene.pick` 过滤：仅 `isPickable` 或带变换元数据的 mesh 命中，返回 `{ kind, id }`

## 对外 API（节选）
- `getTransformMetadata(node): TransformMetadata | null`
- `setTransformMetadata(node, kind, id)`
- `pickTransformTarget(scene, x, y): TransformPickResult | null`

## 关键约定
- 元数据挂在父节点上即可让全部子 mesh 继承，避免逐 mesh 标注
- 拾取过滤保证只有「可变换资源」能被 Gizmo 选中

## 与其他子系统关系
- 写入方：`model-loader.ts`（`setTransformMetadata`）
- 依赖 `core/load-manager`（`ResourceKind` 类型）、`transform-adapter.ts`（`attachGizmoForKind` / `getGizmoTargetId`）
- 下游：Gizmo 拖拽选中逻辑经此处识别目标 kind/id
