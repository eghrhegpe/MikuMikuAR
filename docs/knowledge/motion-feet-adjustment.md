---
kind: motion_feet_adjustment
name: 脚部地面跟随（MMD-native IK）
category: motion
scope:
  - frontend/src/scene/motion/feet-adjustment.ts
source_files:
  - frontend/src/scene/motion/feet-adjustment.ts
adr:
  - ADR-085
symbols:
  - FeetModelProvider
  - FeetState
  - solveFootTarget
  - detectFootLanding
  - isFeetAdjustmentRunning
invariants:
  - 脚 IK 为自动约束基础，手动 Override 叠加其上
  - 注册为 MotionPipeline bone-override 层（order=5）
tests: []
use_when:
  - 脚部跟随
  - 脚 IK
  - 地面高度
  - 脚部调整引擎
---

## 系统概览
**脚部地面跟随引擎（MMD-native IK）**。每帧驱动左/右足 IK 骨骼到地面高度，重解该腿 IK。
注册为 MotionPipeline bone-override 层（order=5），在帧钩子之前执行。脚 IK 为自动约束基础，
手动 Override 叠加其上。

## 核心职责
- `feet-adjustment.ts` — 脚部 IK 目标骨骼世界坐标到地面 + 重解 IK。

## 对外 API（节选）
- `type FeetModelProvider` — 注入函数，返回需要处理脚部调整的模型及 bones。
- `interface FeetState` — 脚部状态。
- `solveFootTarget(input)` — 纯数学解算（无 Babylon 依赖）。
- `detectFootLanding(event)` — 落地事件检测。
- `isFeetAdjustmentRunning()` — 查询引擎运行状态。
- `setOnFootLand(callback)` — 注册落地事件回调。

## 与其他子系统关系
- 底层数学：`@/motion-algos/feet-adjustment-math.solveFootTarget`。
- 落地检测：`@/motion-algos/footstep-detect.detectFootLanding`。
- 地面高度：`../env/env-impl.getGroundHeightAt`。
- 骨骼候选：`@/motion-algos/proc-motion-shared.BONE_LEG_IK_*_CANDIDATES`。
- 管线注册：`./motion-pipeline.ts`。
- 下游消费：`./footstep.ts`（脚步声）。

## 不变量
- 脚 IK 骨骼必须是 IK 目标骨骼（左足IK/右足IK）。
- 重解 IK 在动画解算后同帧执行。
- VMD 下一帧覆盖 IK 骨骼后由本模块再次重解。
