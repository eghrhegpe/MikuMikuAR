---
kind: perception_shared
name: 感知层共享类型
category: motion
scope:
  - frontend/src/scene/motion/perception-shared.ts
source_files:
  - frontend/src/scene/motion/perception-shared.ts
adr:
  - ADR-071
  - ADR-162
symbols:
  - PerceptionContext
  - PerceptionTier
  - BONE_GAZE_CANDIDATES
  - BONE_LOOK_AT_CANDIDATES
invariants:
  - 被所有 perception-* 子模块引用
tests: []
use_when:
  - 感知共享
  - 感知类型
  - 骨骼候选
  - 视线骨骼
  - 注视骨骼
---

## 系统概览
**感知层共享类型和工具**。定义感知上下文、层级、骨骼候选列表等共享数据结构，
提供对象池和工具函数，被所有 perception-* 子模块引用。

## 核心职责
- `perception-shared.ts` — 感知共享类型、骨骼候选列表、对象池、工具函数。

## 对外 API（节选）
- `interface PerceptionContext` — 感知上下文（模型、层级、状态）。
- `enum PerceptionTier` — 感知层级（near/medium/far）。
- `BONE_GAZE_CANDIDATES` — 视线骨骼候选列表。
- `BONE_LOOK_AT_CANDIDATES` — 注视骨骼候选列表。

## 与其他子系统关系
- 被 `perception-gaze` / `perception-blinking` / `perception-breathing` / `perception-expression` / `perception-lipsync` / `perception-balance` 全部引用。
- 主控：`perception.ts`。
- 观察者：`perception-observer.ts`。

## 不变量
- 纯类型和常量定义，不含运行时状态。
- 骨骼候选列表覆盖常见 MMD 骨骼命名变体。
