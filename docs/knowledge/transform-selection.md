---
kind: transform_selection
name: 变换选中物状态源
category: scene
scope:
  - frontend/src/scene/transform/transform-selection.ts
source_files:
  - frontend/src/scene/transform/transform-selection.ts
---

## 系统概览
统一「当前选中物」状态源（ADR-171 面板化核心）：记录当前面板选中的变换目标 `{kind, id}`，并据全局拖拽开关（`transform-mode.ts`）联动挂载/卸载 Gizmo。解决此前模型（`focusedModelId`）、灯光（`activeStageLightId`）、镜子（无选中态）三套分散状态源无法统一驱动 Gizmo 的问题。

## 核心职责
- 维护 `TransformTarget { kind: ResourceKind; id: string } | null`（模块级 `_selected`）
- `setSelectedTransformTarget(target)`：记录选中并 `syncDragMode()`（面板渲染 `buildTransformCard` 时声明）
- `clearSelectedTransformTarget()`：清空选中并 `detachGizmo()`（面板关闭/切换时卸载）
- `syncDragMode()`：开关关→`detachGizmo()`；开且有选中→`attachGizmoForKind(kind,id)`；开但无选中→静默

## 对外 API
- `getSelectedTransformTarget(): TransformTarget | null`
- `setSelectedTransformTarget(target: TransformTarget)`
- `clearSelectedTransformTarget()`
- `syncDragMode()`

## 关键约定
- 类型 `TransformTarget`：`{ kind: ResourceKind; id: string }`
- 卸载双保险：
  - `reconcileTransformSelection()`（`resource-detail-helpers.ts` 导出）：检测 `_activeCardEl` 是否仍挂载于 DOM（`isConnected`），否则 `clearSelectedTransformTarget()`；经菜单 `onAfterRender`（scene-menu 与 library-browse modelStack 均已挂）与 `addOnCloseAllOverlays`（menu-overlay 追加通道）触发
  - `menu-overlay.ts` 的 `closeAllOverlays()` 调用 `_extraCloseAllOverlays`（`addOnCloseAllOverlays` 追加注册的 Set，与 `setOnCloseAllOverlays` 单回调通道分离，避免与 events.ts 的 import 顺序依赖）

## 与其他子系统关系
- 依赖 `transform-mode.ts`（`isDragModeEnabled`）、`transform-adapter.ts`（`attachGizmoForKind`/`detachGizmo`）、`core/load-manager`（`ResourceKind`）
- 被 `resource-detail-helpers.ts` `buildTransformCard` 消费（渲染即声明选中）；`scene-menu.ts` 拖拽开关 onChange 调 `syncDragMode()`
- 场景点击拖拽（`scene.ts` `tryAttachGizmoFromPick`，ADR-171）与面板选中走同一 `attachGizmoForKind`，机制并存
