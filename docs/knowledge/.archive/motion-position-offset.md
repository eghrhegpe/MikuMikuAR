---
kind: motion_position_offset
name: 位置偏移模块
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/position-offset.ts
source_files:
  - frontend/src/scene/motion/motion-modules/position-offset.ts
adr:
  - ADR-116
symbols:
  - POSITION_OFFSET_DEF
  - createPositionOffsetModule
invariants:
  - 被 registry/tests 引用
tests: []
use_when:
  - 位置偏移
  - position offset
  - 位置调整
  - 动作偏移
---

## 系统概览
**位置偏移模块**（ADR-116）。为模型骨骼提供位置偏移调整，
被 registry/tests 引用。

## 核心职责
- `position-offset.ts` — 骨骼位置偏移计算。

## 对外 API（节选）
- `POSITION_OFFSET_DEF` — 模块定义常量。
- `createPositionOffsetModule(modelId)` — 创建位置偏移模块实例。

## 与其他子系统关系
- 注册表：`./registry.ts`。
- 骨骼覆盖：`../bone-override.ts`。
- 动作模块基类：`./module-base.ts`。

## 不变量
- 位置偏移在 [-1, 1] 范围内。
- 偏移与 VMD 动作互补。
