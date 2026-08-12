---
tier: architecture
source_files:
  - frontend/src/scene/motion/feet-adjustment.ts
tests:
  - frontend/src/__tests__/feet-adjustment.test.ts
  - frontend/src/__tests__/feet-adjustment.engine.test.ts
kind: motion_feet_adjustment
name: 脚部地面跟随（MMD-native IK）
category: motion
scope:
  - frontend/src/scene/motion/feet-adjustment.ts
adr:
  - ADR-085
  - ADR-088
  - ADR-202
  - ADR-238
symbols:
  - FeetModelProvider
  - FootLandEvent
  - SolveFootInput
  - SolveFootOutput
  - isFeetAdjustmentRunning
  - setOnFootLand
  - solveFootTarget
  - startFeetAdjustment
  - stopFeetAdjustment
invariants:
  - 脚 IK 为自动约束基础，手动 Override 叠加其上
  - 注册为 MotionPipeline bone-override 层（order=5）
  - 运动模块非零参数 / 激活 bone override 时跳过自动贴地（用户手动覆盖优先，ADR-202 §六）

use_when:
  - 脚部跟随
  - 脚 IK
  - 地面高度
  - 脚部调整引擎
---

# 脚部地面跟随（MMD-native IK）

## 系统概览
**脚部地面跟随引擎（MMD-native IK）**。每帧驱动左/右足 IK 骨骼到地面高度，重解该腿 IK。
注册为 MotionPipeline bone-override 层（order=5），在帧钩子之前执行。脚 IK 为自动约束基础，
手动 Override 叠加其上。

## 核心职责
- `feet-adjustment.ts` — 脚部 IK 目标骨骼世界坐标到地面 + 重解 IK。

## JS/WASM 双模式重解（ADR-202 §六）
统一流程：`ik.setWorldTranslation(target)` 把 IK 目标骨骼世界坐标写到地面高度（保留 XZ），再按运行时重解该腿 IK。
- **JS 模式**：直接调 `ikSolver.solve(false)`，solve 内部回写踝 + 链骨骼 `worldMatrix`；随后 `_markAsDirty()` 通知 skeleton 重算蒙皮。
- **WASM 模式**：`setWorldTranslation` 直写 IK 目标骨骼的 `worldMatrix` buffer，经 `getWasmIkResolver()`（bone-override 注册）调 `mmdModelSolveIk` 重解原生 IK 链——求解器读同一 buffer 作为 IK 目标（双缓冲一致性要点：写入必须落在 IK 求解器读取的缓冲，否则修改不生效）。WASM 直写 buffer，无需 `_markAsDirty`（只会造成冗余重算）。
- **IK 骨骼名解析**：用 `matchBone(names, BONE_LEG_IK_L/R_CANDIDATES)` 按模型解析实际骨骼名（首帧惰性匹配，结果缓存于 per-model cache）。
- **调试日志**：`[A-skip]` / `[WASM-DEBUG]` / `[WASM-ERROR]` 均 `feetDebug` 门控 + 帧节流（%60），热路径不裸打日志（ADR-248）。

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
