---
kind: perception_observer
name: 感知观察者（感知层）
category: motion
scope:
  - frontend/src/scene/motion/**
source_files:
  - frontend/src/scene/motion/perception-observer.ts
adr:
  - ADR-162
  - ADR-166
---

## 系统概览
感知层（perception）的**观察者逻辑**：按层级（tier）收集当前活跃的感知上下文，并将感知修正
（如视线朝向、遮挡响应）应用到目标模型。同时控制「单模型外最多可见其他实例数」，管理多模型同屏的
感知预算。是 ADR-162 引入、ADR-166 收口完成的感知子系统核心。

## 核心职责
- `perception-observer.ts` — 活跃上下文收集、分层施加感知修正、外部实例数上限管控。

## 对外 API（节选）
- `getMediumMaxOthers()` / `setMediumMaxOthers(v)` — 查询 / 设置「其他实例」上限。
- `_getActiveContextsByTier(...)` — 按层级取活跃感知上下文。
- `_applyPerceptionForContext(...)` — 对单个上下文施加感知修正。

## 与其他子系统关系
- 与 `perception-lipsync.ts` 协作：口型同步是感知修正的一类具体表现。
- 骨骼占用经 `bone-override-store` 仲裁；其冲突信息由本层上抛 UI 做可视化（ADR-162/166）。
- 活跃上下文数据来源为感知层上下文存储（ADR-162 的 `Map<modelId, Context>` + pin API）。
