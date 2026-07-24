---
kind: motion_modules_finger
name: 动作模块 — 手指姿态
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/finger-pose.ts
source_files:
  - frontend/src/scene/motion/motion-modules/finger-pose.ts
adr: []
symbols:
  - FingerPoseModule
  - applyFingerPose
invariants:
  - 手指骨骼按预设姿态映射
  - 与 VMD 手指动作互补
tests: []
use_when:
  - 手指姿态
  - 手势动作
  - 手指骨骼
---

## 系统概览
**手指姿态动作模块**。为模型提供预设的手指姿态（如握拳、张开、指点等），作为 VMD 动作的补充。

## 核心职责
- `finger-pose.ts` — 手指姿态动作模块封装。

## 对外 API（节选）
- `class FingerPoseModule` — 动作模块实现。
- `applyFingerPose(context, bones, preset)` — 应用预设手指姿态。

## 与其他子系统关系
- 注册表：`./registry.ts`。
- 骨骼匹配：`@/motion-algos/proc-motion-shared.matchBone`。

## 不变量
- 手指姿态与 VMD 手指动作不冲突，作为 fallback。
