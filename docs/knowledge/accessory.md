---
kind: accessory
name: 道具骨骼锚定系统
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/accessory.ts
adr: []
---

## 系统概览
将外部道具（prop）的 mesh 挂载到 MMD 模型的指定骨骼上，随骨骼变换实时跟随。利用 Babylon.js 原生 `attachToBone` 实现（POC 已验证 standard PMX 的 linkedBone 即为原生 Bone）。

## 核心职责
- `accessory.ts` — 道具挂载/解除/重连/批量卸载。

## 对外 API（节选）
- `attachPropToBone(propId, boneName, targetModelId, offset, rotation)` — 将道具附着到目标模型的骨骼，设置局部偏移与旋转。
- `detachPropFromBone(propId)` — 解除骨骼锚定，回到场景坐标模式，保持视觉位置不变。
- `reattachAllAccessories()` — 场景恢复时重新挂载所有骨骼锚定的道具。
- `detachModelAccessories(modelId)` — 模型卸载时移除其所有骨骼锚定道具（契约：在 destroyMmdModel 之后调用，不访问已销毁的模型实例）。

## 与其他子系统关系
- 依赖 `propRegistry` / `modelRegistry`（`core/config`）查询道具与模型实例。
- 道具挂载后通过 `triggerAutoSave` 触发持久化。