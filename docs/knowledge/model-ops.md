---
kind: model_ops
name: 模型生命周期操作
category: scene
scope:
  - frontend/src/scene/manager/model-ops.ts
source_files:
  - frontend/src/scene/manager/model-ops.ts
---

## 系统概览
模型运行时操作层：删除模型、聚焦切换、播放态联动、变换适配器注册、VPD 应用。是 UI 动作与 `model-manager` / 播放子系统之间的桥梁。

## 核心职责
- `removeModel(id)` — 经 `modelManager.remove` 删除、刷新水面渲染列表、模型清空时复位播放态（`setIsPlaying(false)` / `setAutoLoop(true)` / `disposeAudio`）、隐藏播放条
- `removeFocusedModel()` — 删除当前聚焦模型
- 相机模式联动：最后一个模型移除且处于 `concert` 模式时退回 `orbit`
- 注册 `registerTransformAdapter`（见 `transform-adapter.ts`），使模型支持 Gizmo 拖拽/数值滑杆
- VPD 应用：`VPDBoneData` / `VPDMorphData` 解析后写回模型姿态

## 对外 API（节选）
- `removeModel(id)` / `removeFocusedModel()`
- VPD 姿态应用（bone + morph 写回）
- 经 `modelManager`、播放态 store、`camera/camera`、`motion/playback` 协同

## 关键约定
- 模型清空时强制复位播放态，避免「无模型仍显示播放条」的幽灵 UI
- 依赖 `motion/motion-modules/registry.setTargetModel`（ADR-116）切换目标模型

## 与其他子系统关系
- 依赖 `model-manager.ts`（注册表操作）、`core/state`（播放/聚焦 store）
- 依赖 `camera/camera`（模式切换）、`motion/playback`（UI 刷新）、`transform/transform-adapter`（注册）
- 下游：`env/env`（水面渲染列表）、`outfit/audio`（伴音释放）
