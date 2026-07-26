---
kind: motion_pipeline
name: 动作管线（逐帧合成）
category: motion
scope:
  - frontend/src/scene/motion/**
source_files:
  - frontend/src/scene/motion/motion-pipeline.ts
adr:
  - ADR-147
  - ADR-116
---

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

## 与其他子系统关系
- 上游接入 VMD 播放器、程序化动作生成器、感知层修正（`perception-observer` / `perception-lipsync`）。
- 骨骼占用需经 `bone-override-store` 仲裁，避免多动作源写同一骨骼。
