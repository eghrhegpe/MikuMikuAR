---
tier: architecture
source_files:
  - frontend/src/scene/motion/proc-motion-bridge.ts
  - frontend/src/scene/motion/proc-motion-controller.ts
  - frontend/src/scene/motion/proc-motion-params.ts
tests:
  - frontend/src/__tests__/proc-motion-bridge.test.ts
kind: proc_motion_bridge
name: 程序化动作系统
category: motion
scope:
  - frontend/src/scene/motion/proc-motion-bridge.ts
  - frontend/src/scene/motion/proc-motion-controller.ts
  - frontend/src/scene/motion/proc-motion-params.ts
adr:
  - ADR-021
  - ADR-237
symbols:
  - ProcMotionController
  - ProcMotionControllerBase
  - ProcMotionParamsMixin
  - _clearVmdData
  - activateGazeTracking
  - createProcBeatDetector
  - disposeProcMotion
  - getBpmQuantizeEnabled
  - getProcBeatDetector
  - getProcMotionState
  - isProcVmdActive
  - onModelRemoved
  - regenerateProcMotion
  - setBpmQuantizeEnabled
  - setGazeLayerActive
  - setProcMotionBoneToggle
  - setProcMotionBoneToggles
  - setProcMotionEyeTrackingEnabled
  - setProcMotionHeadTrackingEnabled
  - setProcMotionIntensity
  - setProcMotionInterpOverride
  - setProcMotionMode
  - setProcMotionSpeed
  - setProcMotionState
  - setProcMotionVpdApplyEnabled
  - stopProcMotion
  - updateProcMotion
invariants:
  - "[ADR-237 P1] 三文件拆分：bridge（转发层 135 行）/ controller（状态机核心 392 行）/ params（setter mixin 289 行）"
  - 内部使用 `ProcMotionController` 类（导出，组合 ProcMotionControllerBase + ProcMotionParamsMixin）收口状态
  - 基类 `_fallbackProcState`/`_beatDetector`/`_refProcState` 为 protected，供 params mixin 访问
  - disposeProcMotion() 一键清零全部状态并销毁单例
  - 参数存储优先级：activeMotion.procMotion > _fallbackProcState

use_when:
  - 程序化动作
  - idle 动作
  - auto dance
  - 节拍联动
  - 动作生成
  - 程序化 VMD
---

# 程序化动作系统

## 系统概览
**程序化动作生成与调度系统**（ADR-021）。负责 Idle（待机）和 Auto Dance（自动跳舞）的 VMD
生成调度、节拍联动检测、参数管理。VMD 生成器来自 `@/motion-algos/procedural-motion`，
本模块负责调度与参数管理。状态收口为模块内 `ProcMotionController` 类实例（不导出），
提供 `disposeProcMotion()` 一键清理。参数存储采用 per-motion 优先级策略。

## 核心职责
- `proc-motion-bridge.ts` — 程序化 VMD 更新调度、节拍检测管理、参数读写、生命周期。

## 对外 API（节选）
- `updateProcMotion()` — 异步更新程序化 VMD（核心调度入口，被 motion-pipeline 调用）。
- `setProcMotionState(state)` / `getProcMotionState()` — 参数读写（per-motion 优先级）。
- `setProcMotionMode(mode)` / `setProcMotionIntensity(v)` / `setProcMotionSpeed(v)` — 模式/强度/速度。
- `setProcMotionBoneToggle(cat, v)` / `setProcMotionBoneToggles(...)` — 骨骼分类开关。
- `setProcMotionVpdApplyEnabled(v)` / `setProcMotionInterpOverride(v)` — 高级参数。
- `setBpmQuantizeEnabled(v)` / `getBpmQuantizeEnabled()` — BPM 量化开关。
- `setProcMotionEyeTrackingEnabled(v)` / `setProcMotionHeadTrackingEnabled(v)` — 追踪开关。
- `activateGazeTracking()` / `setGazeLayerActive(active, intensity)` — 视线追踪（ADR-071 迁移后保留）。
- `regenerateProcMotion(modelId?)` — 重新生成程序化 VMD。
- `disposeProcMotion()` — 清理全部状态并销毁单例。
- `isProcVmdActive()` / `getProcBeatDetector()` / `createProcBeatDetector()` — 状态查询。

## 与其他子系统关系
- VMD 生成器：`@/motion-algos/procedural-motion`（`generateIdleVmd` / `generateAutoDanceVmd` / `shouldAutoDance` / `shouldIdle`）。
- 节拍检测：`@/motion-algos/beat-detector.BeatDetector`。
- 感知激活：`./perception.ts`（ADR-071）。
- 复合动画重建：`./vmd-layers.rebuildCompositeAnimation`。
- 管线注册：`./motion-pipeline.ts`（bone-override 层）。

## 不变量
- 状态封装在类私有字段，外部不可直接访问。
- disposeProcMotion() 后单例置 null，再次调用时重新创建。
- 参数写入时同步到 activeMotion（若存在）和 fallback。
