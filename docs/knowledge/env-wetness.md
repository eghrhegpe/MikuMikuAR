---
kind: env_wetness
name: 湿身效果系统
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-wetness.ts
adr:
  - ADR-172
---

## 系统概览
为模型实例施加「湿身」视觉效果（皮肤 / 布料在淋雨、涉水后的反光增强与色调偏移）。
提供全局开关 + 单实例级控制，供环境系统（雨、水面）在运行时动态触发。

## 核心职责
- `env-wetness.ts` — 湿身材质的施加、移除与状态查询。

## 对外 API（节选）
- `applyWetnessToAllModels()` — 对场景内全部模型实例施加湿身。
- `removeWetnessFromAllModels()` — 移除全局湿身。
- `isWetnessActive()` — 查询当前是否处于湿身态。
- `applyWetnessToInst(inst: ModelInstance)` — 对单个模型实例施加湿身（局部触发用）。

## 与其他子系统关系
- 被环境系统（降雨、水面接触）调用，是 ADR-172 湿身体验的渲染侧落地。
- 与材质系统协作：湿身本质是对模型材质参数的临时覆盖，需在 dispose / 换装时正确清理。
