---
kind: perception_blinking
name: 眨眼模拟
category: motion
scope:
  - frontend/src/scene/motion/perception-blinking.ts
source_files:
  - frontend/src/scene/motion/perception-blinking.ts
adr:
  - ADR-071
  - ADR-162
symbols:
  - _applyBlinking
  - BlinkingConfig
invariants:
  - 被 perception-observer 引用
tests: []
use_when:
  - 眨眼模拟
  - blinking
  - 眼部闭合
  - 感知层眨眼
---

## 系统概览
**眨眼模拟模块**（ADR-071/162）。为模型提供自然的眨眼动画，
被 perception-observer 引用。

## 核心职责
- `perception-blinking.ts` — 眨眼动画计算、骨骼应用。

## 对外 API（节选）
- `_applyBlinking(model, time, ctx)` — 应用眨眼动画到骨骼（私有）。

## 与其他子系统关系
- 感知观察者：`./perception-observer.ts`。
- 感知主控：`./perception.ts`。
- 共享类型：`./perception-shared.ts`。

## 不变量
- 眨眼频率约 15-20 次/分钟（自然眨眼范围）。
- 眨眼幅度与眼睛大小联动。
