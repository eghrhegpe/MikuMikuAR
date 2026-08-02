---
tier: architecture
kind: transform_selection
name: 变换选中物状态源
category: scene
scope:
  - frontend/src/scene/transform/transform-selection.ts
source_files:
  - frontend/src/scene/transform/transform-selection.ts
adr:
  - ADR-171
invariants:
  - 三个详情面板（模型/舞台/灯光）共用 buildTransformCard，渲染即声明选中；场景开关 scene:dragMode 只做总闸（ADR-171）
  - 依赖方向：本模块 import transform-adapter/transform-mode，无反向依赖
use_when:
  - 选中状态
  - 选中物
  - 变换选择
  - selection 状态
---

# 变换选中物状态源

## 系统概览
统一「当前选中物」状态源（ADR-171 面板化核心）：记录当前面板选中的变换目标 `{kind, id}`，并据全局拖拽开关（`transform-mode.ts`）联动挂载/卸载 Gizmo。解决此前模型（`focusedModelId`）、灯光（`activeStageLightId`）、镜子（无选中态）三套分散状态源无法统一驱动 Gizmo 的问题。

## 核心职责
- 维护 `TransformTarget { kind: ResourceKind; id: string } | null`（模块级 `_selected`）
- `setSelectedTransformTarget(target)`：记录选中并 `syncDragMode()`（面板渲染 `buildTransformCard` 时声明）。**同 kind+id 重复声明跳过 syncDragMode**（避免面板无关重渲染触发独占式 gizmo 重建抖动）
- `clearSelectedTransformTarget()`：清空选中并 `detachGizmo()`（面板关闭/切换时卸载）
- `syncDragMode()`：开关关→`detachGizmo()`；开且有选中→若 `getGizmoTargetId() === _selected.id` 则跳过重复 attach（防场景点击 setSelected 后 detach+重建闪烁）**并清空 pending**，否则 `attachGizmoForKind(kind,id)`；开但无选中→静默
- `retryPendingAttachment()`：`attachGizmoForKind` 返回 false（节点未就绪）时记录 `_pendingRetry`，模型加载完成（`registerLoadRefreshHook`）后补挂。**守卫：只要当前已挂任何 gizmo 目标（`getGizmoTargetId() !== null`，无论是否 pending 本身）即视为达成并放弃重试**——retry 唯一目的是「当前无 gizmo 时补挂」，已有目标（场景点击挂载或其他路径）则避免重复 detach+重建闪烁（P2 修复）

## 对外 API
- `getSelectedTransformTarget(): TransformTarget | null`
- `setSelectedTransformTarget(target: TransformTarget)`
- `clearSelectedTransformTarget()`
- `syncDragMode()`
- `retryPendingAttachment()`

## 关键约定
- 类型 `TransformTarget`：`{ kind: ResourceKind; id: string }`
- 同目标去重：`sameTarget(a,b)` 比较 kind+id，未变则不重挂
- 卸载双保险（**两条通道互补，勿合并**）：
  - `reconcileTransformSelection()`（`resource-detail-helpers.ts` 导出）：检测 `_activeCardEl` 是否仍挂载于 DOM（`isConnected`）——**仅捕「DOM 移除」场景**（面板 pop 回根层 panel 重建）。ESC/closeAllOverlays 只去 `.visible` class、DOM 仍挂载，此分支捕不到
  - `closeAllOverlays()`（ESC / 外部关闭）经 `addOnCloseAllOverlays` 注册的**无条件清理**回调（`_activeCardEl = null; clearSelectedTransformTarget()`）——`menu-overlay.ts` 的 `_extraCloseAllOverlays` Set 通道（与 `setOnCloseAllOverlays` 单回调通道分离，避免与 events.ts 的 import 顺序依赖）

## 与其他子系统关系
- 依赖 `transform-mode.ts`（`isDragModeEnabled`）、`transform-adapter.ts`（`attachGizmoForKind`/`detachGizmo`/`getGizmoTargetId`）、`core/load-manager`（`ResourceKind`）
- 被 `resource-detail-helpers.ts` `buildTransformCard` 消费（渲染即声明选中）；`scene-menu.ts` 拖拽开关 onChange 调 `syncDragMode()`
- 被 `transform-pick.ts` `tryAttachGizmoFromPick` 消费：场景点击挂载成功后 `setSelectedTransformTarget(result)` 同步选中态（同向依赖，无循环）
- 被 `model-ops.ts` `removeModel` 消费：删除的正是当前选中物时 `clearSelectedTransformTarget()`（P4 防御）
- 场景点击拖拽（`scene.ts` `tryAttachGizmoFromPick`，ADR-171）与面板选中走同一 `attachGizmoForKind`，机制并存
