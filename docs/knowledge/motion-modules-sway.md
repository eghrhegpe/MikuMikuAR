---
kind: motion_modules_sway
name: 动作模块 — 身体摇摆
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/sway-motion.ts
source_files:
  - frontend/src/scene/motion/motion-modules/sway-motion.ts
adr: []
symbols:
  - createSwayMotionModule
  - SWAY_MOTION_DEF
invariants:
  - 摇摆幅度由参数控制
tests: []
use_when:
  - 身体摇摆
  - sway 动作
  - 节拍摇摆
---

## 系统概览
**身体摇摆动作模块**。为 Idle 状态下的模型提供自然的身体摇摆动画，可配置幅度和节拍联动。

## 核心职责
- `sway-motion.ts` — 身体摇摆动作模块封装。

## 对外 API（节选）
- `class SwayMotionModule` — 动作模块实现。
- `createSwayMotionModule(modelId)` — 创建身体摇摆动作模块实例。
- `SWAY_MOTION_DEF` — 模块定义常量。

## 与其他子系统关系
- 注册表：`./registry.ts`。
- 节拍：`@/motion-algos/beat-detector`。

## 不变量
- 摇摆幅度在 [-1, 1] 范围内。
- 仅在 Idle 状态下生效。
