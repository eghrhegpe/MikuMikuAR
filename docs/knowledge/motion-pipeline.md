---
kind: motion_pipeline
name: 动作管线（逐帧合成）
tier: architecture
category: motion
scope:
  - frontend/src/scene/motion/**
source_files:
  - frontend/src/scene/motion/motion-pipeline.ts
adr:
  - ADR-147
  - ADR-116
symbols:
  - MotionPipeline
  - getMotionPipeline
  - FrameContext
  - PipelineStage
  - PipelineLayer
invariants:
  - 管线按 (stageIndex, order) 升序统一执行，与注册时序彻底解耦
  - 阶段常量：vmd-base / vmd-layers / proc-motion / bone-override / perception（Ragdoll 已永久移除）
  - 骨骼占用经 bone-override-store 仲裁，避免多动作源写同一骨骼
  - register 返回 unregister 函数，用于 HMR/测试 teardown
tests:
  - frontend/src/__tests__/scene/motion-pipeline.test.ts
  - frontend/src/__tests__/scene/motion-pipeline.test.ts
use_when:
  - 动作管线
  - 逐帧合成
  - 骨骼写入顺序
  - PipelineStage / PipelineLayer
---

# 动作管线（逐帧合成）

## 系统概览
动作系统的**显式管线调度器**（ADR-147）。治理根因：骨骼写入层顺序靠 `import` 顺序 + `await` 顺序 + `onBeforeRenderObservable` 注册时序三层隐式耦合。本调度器按 `(stageIndex, order)` 升序统一执行，与注册时序彻底解耦。阶段常量（`vmd-base` / `vmd-layers` / `proc-motion` / `bone-override` / `perception`）来源 ADR-116 §一的 6 层动作管线（Ragdoll 已永久移除）。

## 核心职责
- `motion-pipeline.ts` — 管线定义、层注册、逐帧推进与合成。

## 对外 API（节选）
- `interface FrameContext` — 单帧上下文（时间、模型、外部环境）。
- `type PipelineStage` — 阶段枚举（如预计算 / 应用 / 后修正）。
- `interface PipelineLayer` — 一层动作来源（优先级 + 应用函数）。
- `class MotionPipeline` — 管线主体（注册层、运行阶段）。
- `getMotionPipeline()` — 取全局管线实例。

## UI 入口
- 动作菜单（加载/程序化动作/相机/姿势等）：入口 `buildMotionRootLevel()`（`menus/motion-root-ui.ts`），层级见 [menu-map.md](./menu-map.md) 的 motion-root-ui.ts 节。

## 与其他子系统关系
- 上游接入 VMD 播放器、程序化动作生成器、感知层修正（`perception-observer` / `perception-lipsync`）。
- 骨骼占用需经 `bone-override-store` 仲裁，避免多动作源写同一骨骼。
