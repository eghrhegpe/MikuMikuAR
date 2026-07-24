---
kind: motion_modules_riding
name: 动作模块 — 骑乘模型
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/riding-model.ts
source_files:
  - frontend/src/scene/motion/motion-modules/riding-model.ts
adr: []
symbols:
  - RidingModelModule
  - applyRidingModel
invariants:
  - 骑乘模型骨骼需与主模型骨骼匹配
  - 骑乘动作优先级高
tests: []
use_when:
  - 骑乘模型
  - 载具动作
  - 骑乘骨骼同步
---

## 系统概览
**骑乘模型动作模块**。处理骑乘载具时模型骨骼与载具的同步，确保骑乘姿态正确。

## 核心职责
- `riding-model.ts` — 骑乘模型动作模块封装。

## 对外 API（节选）
- `class RidingModelModule` — 动作模块实现。
- `applyRidingModel(context, bones, vehicle)` — 应用骑乘姿态。

## 与其他子系统关系
- 注册表：`./registry.ts`。
- 骨骼匹配：`@/motion-algos/proc-motion-shared.matchBone`。

## 不变量
- 骑乘模型骨骼必须与载具骨骼匹配。
- 骑乘动作优先级高于普通动作。
