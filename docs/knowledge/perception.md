---
kind: perception
name: 感知层主控
category: motion
scope:
  - frontend/src/scene/motion/perception.ts
source_files:
  - frontend/src/scene/motion/perception.ts
adr:
  - ADR-071
  - ADR-162
  - ADR-166
symbols:
  - PerceptionContext
  - PerceptionState
  - activatePerception
  - deactivatePerception
  - pinPerception
  - unpinPerception
  - getPerceptionState
  - setPerceptionState
invariants:
  - 感知层统一入口（ADR-071）
  - 活跃上下文数据存储在 Map<modelId, Context> + pin API
tests: []
use_when:
  - 感知层
  - 视线追踪
  - 眨眼
  - 呼吸
  - 口型同步
  - 重心微动
  - 感知上下文
---

## 系统概览
**感知层主控模块**（ADR-071/162/166）。整合呼吸、眨眼、视线追踪、口型同步、重心微动等
所有感知子模块，提供统一的感知激活/禁用/pin 接口。是感知层的状态中心，维护活跃上下文
数据（Map<modelId, Context>），供 `perception-observer` 消费。

## 核心职责
- `perception.ts` — 感知子模块聚合、状态读写、激活/禁用/pin 管理。

## 对外 API（节选）
- `interface PerceptionState` — 感知层全局状态。
- `activatePerception(modelId?)` — 激活指定模型（或全部）的感知。
- `deactivatePerception(modelId?)` — 禁用感知。
- `pinPerception(modelId)` / `unpinPerception(modelId)` — Pin/取消 Pin 模型（外最多可见数管控）。
- `getPerceptionState()` / `setPerceptionState(state)` — 状态读写。
- `enableAllPerception()` / `disableAllPerception()` — 全局使能/禁用。

## 与其他子系统关系
- 子模块：`perception-gaze.ts`（视线）、`perception-blinking.ts`（眨眼）、
  `perception-breathing.ts`（呼吸）、`perception-expression.ts`（表情）、
  `perception-lipsync.ts`（口型）、`perception-balance.ts`（重心）。
- 消费方：`perception-observer.ts`（逐帧施加感知修正）。
- 共享类型：`perception-shared.ts`。
- 骨骼仲裁：`bone-override-store`。

## 不变量
- 感知层统一入口（ADR-071），所有子模块通过本模块聚合。
- pin 机制：外最多可见其他实例数（mediumMaxOthers）管控多模型同屏感知预算。
