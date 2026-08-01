---
tier: architecture
kind: model_ops
name: 模型生命周期操作
category: scene
scope:
  - frontend/src/scene/manager/model-ops.ts
source_files:
  - frontend/src/scene/manager/model-ops.ts
symbols:
  - ReplaceSnapshot
  - applyInheritedState
  - applyVPDPose
  - arrangeModels
  - captureInheritedState
  - focusModel
  - focusedMmdModel
  - focusedModel
  - getActiveFormation
  - getActiveFormationSpacing
  - getFormationLabels
  - getModelMorphWeight
  - getModelMorphs
  - getModelOrbit
  - getModelPosition
  - getModelPositionMode
  - getPhysicsCatState
  - getPhysicsCategories
  - isPhysicsCategoryEnabled
  - removeFocusedModel
  - removeModel
  - resetModelMorphs
  - resetModelTransform
  - setModelBoneJointsVis
  - setModelBoneLinesVis
  - setModelFormation
  - setModelMorphWeight
  - setModelOpacity
  - setModelOrbit
  - setModelPhysics
  - setModelPosition
  - setModelPositionMode
  - setModelRotation
  - setModelRotationY
  - setModelScaling
  - setModelVisibility
  - setModelWireframe
  - setPhysicsCategory
  - stopVMD
invariants:
  - removeModel 删除后刷新水面渲染列表；模型清空时复位播放态（setIsPlaying(false) / setAutoLoop(true)）
  - 最后一个模型移除且处于 concert 模式时退回 orbit
  - 模型清空时强制复位播放态，避免「无模型仍显示播放条」的幽灵 UI
  - applyVPDPose 解析 VPDBoneData / VPDMorphData 后写回模型姿态
  - captureInheritedState / applyInheritedState 用于场景打包时继承模型状态
tests: []
use_when:
  - 删除模型
  - 聚焦模型
  - 模型变换（位置/旋转/缩放）
  - VPD 姿态应用
---

## 系统概览
模型运行时操作层：删除模型、聚焦切换、播放态联动、变换适配器注册、VPD 应用。是 UI 动作与 `model-manager` / 播放子系统之间的桥梁。

## 核心职责
- `removeModel(id)` — 经 `modelManager.remove` 删除、刷新水面渲染列表、模型清空时复位播放态（`setIsPlaying(false)` / `setAutoLoop(true)` / `disposeAudio`）、隐藏播放条
- `removeFocusedModel()` — 删除当前聚焦模型
- 相机模式联动：最后一个模型移除且处于 `concert` 模式时退回 `orbit`
- 注册 `registerTransformAdapter`（见 `transform-adapter.ts`），使模型支持 Gizmo 拖拽/数值滑杆
- VPD 应用：`VPDBoneData` / `VPDMorphData` 解析后写回模型姿态
- 阵型：`setModelFormation(type, spacing?)` / `arrangeModels()`；取值器 `getActiveFormation()` / `getActiveFormationSpacing()` / `getFormationLabels`
- 骨骼调试显隐：`setModelBoneLinesVis(id, show)` / `setModelBoneJointsVis(id, show)`
- 物理分类开关：`setModelPhysics(id, enabled)` 总闸；`getPhysicsCategories(id)` / `getPhysicsCatState(id)` / `isPhysicsCategoryEnabled(id, cat)` / `setPhysicsCategory(id, cat, enabled)` 按分类精细控制
- 变换（薄封装委托 `modelManager`）：`setModelScaling` / `setModelRotationY` / `setModelRotation` / `setModelPosition` / `getModelPosition`（缺省 `[0,0,0]` 兜底）
- 球面轨道位姿（ADR-049）：`setModelOrbit(id, azimuth, elevation, distance)` / `getModelOrbit(id)` / `setModelPositionMode(id, 'cartesian'|'orbit')` / `getModelPositionMode(id)`（缺省 `cartesian`）
- 表情：`getModelMorphs(id)` / `setModelMorphWeight(id, name, w)` / `getModelMorphWeight(id, name)`（缺省 `0`） / `resetModelMorphs(id)`

## 对外 API（节选）
- `removeModel(id)` / `removeFocusedModel()`
- VPD 姿态应用（bone + morph 写回）
- 阵型 / 骨骼显隐 / 物理分类开关 / 双位模式（cartesian↔orbit）/ 表情取值器 —— 全套委托 `modelManager` 的薄封装，含缺省兜底
- 经 `modelManager`、播放态 store、`camera/camera`、`motion/playback` 协同

## 关键约定
- 模型清空时强制复位播放态，避免「无模型仍显示播放条」的幽灵 UI
- 依赖 `motion/motion-modules/registry.setTargetModel`（ADR-116）切换目标模型

## 与其他子系统关系
- 依赖 `model-manager.ts`（注册表操作）、`core/state`（播放/聚焦 store）
- 依赖 `camera/camera`（模式切换）、`motion/playback`（UI 刷新）、`transform/transform-adapter`（注册）
- 下游：`env/env`（水面渲染列表）、`outfit/audio`（伴音释放）
