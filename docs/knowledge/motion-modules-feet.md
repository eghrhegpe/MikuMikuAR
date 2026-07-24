---
kind: motion_modules_feet
name: 动作模块 — 脚部调整
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/feet-adjustment-module.ts
source_files:
  - frontend/src/scene/motion/motion-modules/feet-adjustment-module.ts
adr: []
symbols:
  - getFeetStateForModel
  - createFeetAdjustmentModule
  - FEET_ADJUSTMENT_DEF
invariants:
  - 依赖 feet-adjustment 引擎已初始化
tests: []
use_when:
  - 脚部调整模块
  - 脚部 IK
  - 地面跟随动作
---

## 系统概览
**脚部调整动作模块**。将脚部地面跟随逻辑封装为动作管线模块，每帧计算脚部目标位置并应用。
底层使用 `feet-adjustment.ts` 的 IK 解算。

## 核心职责
- `feet-adjustment-module.ts` — 脚部调整动作模块封装。

## 对外 API（节选）
- `class FeetAdjustmentModule` — 动作模块实现。
- `applyFeetAdjustment(context, bones)` — 应用脚部调整。

## 与其他子系统关系
- 底层引擎：`../feet-adjustment.ts`。
- 地面高度：`../../env/env-impl.getGroundHeightAt`。
- 注册表：`./registry.ts`。

## 不变量
- 仅当 feet-adjustment 引擎运行时才执行。
- 脚 IK 骨骼匹配依赖 `matchBone`。
