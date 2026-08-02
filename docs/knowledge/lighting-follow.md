---
tier: architecture
source_files:
  - frontend/src/scene/render/lighting-follow.ts
tests:
  - frontend/src/__tests__/scene/lighting-follow.test.ts
kind: lighting_follow
name: 个人灯光跟随
category: rendering
scope:
  - frontend/src/scene/render/**
adr:
  - ADR-168
symbols:
  - DEFAULT_PERSONAL_LIGHT
  - PersonalLightSettings
  - attachPersonalLight
  - detachPersonalLight
  - disposeAllPersonalLights
  - getAllPersonalLights
  - getPersonalLightDefault
  - getPersonalLightState
  - resetPersonalLightDefault
  - restorePersonalLights
  - setPersonalLightDefault
  - setPersonalLightState
  - tickPersonalLights
  - tickStageLightFollow
invariants:
  - 个人灯光跟随模型腰部骨骼，每帧由 tickPersonalLights 更新位置
  - disposeAllPersonalLights 释放所有个人灯光及其光锥
  - tickStageLightFollow 每帧更新舞台灯光跟随（舞台目标骨骼跟随）
  - 个人灯光附加时自动创建光锥（_ensurePersonalCone）

  - frontend/src/__tests__/scene/lighting-follow.test.ts
  - frontend/src/__tests__/scene/lighting-follow.test.ts
  - frontend/src/__tests__/scene/lighting-follow.test.ts
  - frontend/src/__tests__/scene/lighting-follow.test.ts
use_when:
  - 个人灯光
  - 灯光跟随
  - 跟随聚光灯
---

# 个人灯光跟随

## 系统概览
个人灯光（Personal Light）系统（ADR-168）：为每个 MMD 模型附加独立的跟随聚光灯，灯光位置自动跟随模型骨骼（腰部），支持强度/颜色/锥角/高度/光锥参数调节。每帧通过 `tickPersonalLights` 更新位置跟随。

## 核心职责
- `lighting-follow.ts` — 个人灯光创建/销毁/参数调节/每帧跟随。

## 对外 API（节选）
- `PersonalLightSettings` — 个人灯光参数接口。
- `DEFAULT_PERSONAL_LIGHT` — 个人灯光默认参数。
- `setPersonalLightDefault(settings)` / `getPersonalLightDefault()` / `resetPersonalLightDefault()` — 默认参数管理。
- `attachPersonalLight(modelId, settings)` — 为模型附加个人灯光，自动跟随骨骼。
- `detachPersonalLight(modelId)` — 移除模型的个人灯光。
- `setPersonalLightState(modelId, partial)` — 更新个人灯光参数。
- `getPersonalLightState(modelId)` — 获取个人灯光当前参数。
- `tickPersonalLights()` — 每帧更新所有个人灯光位置（跟随骨骼）。
- `tickStageLightFollow()` — 每帧更新舞台灯光跟随（舞台目标骨骼跟随）。
- `disposeAllPersonalLights()` — 释放所有个人灯光。
- `getAllPersonalLights()` — 取所有个人灯光列表（序列化用）。
- `restorePersonalLights(entries)` — 恢复个人灯光（反序列化用）。

## 内部协作
- `_getLightBasePos(model, waistName)` — 获取灯光基准位置（腰部骨骼 / 模型中心）。
- `_ensurePersonalCone(modelId)` — 确保个人灯光的光锥网格存在。
- `_createPersonalLightIndicator(settings)` / `_updatePersonalLightIndicator(id)` — 灯光指示器。

## 与其他子系统关系
- 依赖 [`lighting-state`](./lighting-state.md) 的灯光状态管理。
- 依赖 [`light-cone`](./light-cone.md) 的光锥渲染。
- 依赖 [`transform-pick`](./transform-pick.md) 的变换元数据。