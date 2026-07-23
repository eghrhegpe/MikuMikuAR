---
kind: motion_pipeline
name: 动作管线（逐帧合成）
category: motion
scope:
  - frontend/src/scene/motion/**
source_files:
  - frontend/src/scene/motion/motion-pipeline.ts
adr:
  - ADR-129
---

## 系统概览
动作系统的**逐帧合成管线**。将 VMD 播放、程序化动作、感知修正等多路来源，按分层
（`PipelineLayer`）与阶段（`PipelineStage`）统一合成为每帧的骨骼姿态。是 ADR-129 程序化动作架构的
核心调度器。

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
