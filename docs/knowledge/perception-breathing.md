---
kind: perception_breathing
name: 呼吸模拟
category: motion
scope:
  - frontend/src/scene/motion/perception-breathing.ts
source_files:
  - frontend/src/scene/motion/perception-breathing.ts
adr:
  - ADR-071
  - ADR-162
symbols:
  - _applyBreathing
  - BreathingConfig
invariants:
  - 被 perception-gaze-js/perception-observer 引用
tests: []
use_when:
  - 呼吸模拟
  - breathing
  - 胸腔起伏
  - 呼吸动画
---

## 系统概览
**呼吸模拟模块**（ADR-071/162）。为模型提供自然的呼吸动画（胸腔起伏），
被 perception-gaze-js/perception-observer 约 2 个模块引用。

## 核心职责
- `perception-breathing.ts` — 呼吸动画计算、骨骼应用。

## 对外 API（节选）
- `_applyBreathing(bones, config, deltaTime)` — 应用呼吸动画到骨骼（私有）。

## 与其他子系统关系
- 感知观察者：`./perception-observer.ts`。
- 感知主控：`./perception.ts`。
- 共享类型：`./perception-shared.ts`。

## 不变量
- 呼吸频率约 12-20 次/分钟（自然呼吸范围）。
- 呼吸幅度与模型体型联动。
