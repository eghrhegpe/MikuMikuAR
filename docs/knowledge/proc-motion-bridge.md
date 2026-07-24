---
kind: proc_motion_bridge
name: 程序化动作系统
category: motion
scope:
  - frontend/src/scene/motion/proc-motion-bridge.ts
source_files:
  - frontend/src/scene/motion/proc-motion-bridge.ts
adr:
  - ADR-021
symbols:
  - ProcMotionController
  - ProcMotionState
  - generateIdleVmd
  - generateAutoDanceVmd
invariants:
  - 8 个模块级 let 已收口为 ProcMotionController 类实例
  - dispose() 一键清零全部状态并销毁单例
  - 参数存储优先级：activeMotion.procMotion > _fallbackProcState
tests: []
use_when:
  - 程序化动作
  - idle 动作
  - auto dance
  - 节拍联动
  - 动作生成
  - 程序化 VMD
---

## 系统概览
**程序化动作生成与调度系统**。负责 Idle（待机）和 Auto Dance（自动跳舞）的 VMD 生成、
节拍联动检测、参数管理。状态收口为 `ProcMotionController` 类实例，替代 8 个模块级变量，
提供 `dispose()` 一键清理。参数存储采用 per-motion 优先级策略。

## 核心职责
- `proc-motion-bridge.ts` — Idle/Auto Dance VMD 生成、节拍检测、参数读写、状态生命周期。

## 对外 API（节选）
- `ProcMotionController` — 状态 + 逻辑收口类。
- `generateIdleVmd(state)` — 生成 Idle VMD。
- `generateAutoDanceVmd(state, beatDetector)` — 生成节拍联动的 Auto Dance VMD。
- `setProcMotionState(state)` / `getProcMotionState()` — 参数读写（per-motion 优先级）。
- `shouldAutoDance()` / `shouldIdle()` — 动作触发条件判断。
- `dispose()` — 清理全部状态并销毁单例。

## 与其他子系统关系
- 使用 `@/motion-algos/procedural-motion` 的 VMD 生成器。
- 节拍检测：`@/motion-algos/beat-detector.BeatDetector`。
- 音频同步：`@/outfit/audio.isAudioPlaying`。
- 视线追踪：已迁移至 `./perception.ts`（ADR-071）。
- 感知激活：`./perception.setGazeConfig` / `activatePerception`。
- 复合动画重建：`./vmd-layers.rebuildCompositeAnimation`。

## 不变量
- 状态封装在类私有字段，外部不可直接访问。
- dispose() 后单例置 null，再次调用时重新创建。
- 参数写入时同步到 activeMotion（若存在）和 fallback。
