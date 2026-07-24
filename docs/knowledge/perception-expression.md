---
kind: perception_expression
name: 微表情
category: motion
scope:
  - frontend/src/scene/motion/perception-expression.ts
source_files:
  - frontend/src/scene/motion/perception-expression.ts
adr:
  - ADR-071
  - ADR-162
symbols:
  - _applyMicroExpression
  - ExpressionConfig
invariants:
  - 被 perception-observer 引用
tests: []
use_when:
  - 微表情
  - expression
  - 表情变化
  - 感知层表情
---

## 系统概览
**微表情模块**（ADR-071/162）。为模型提供自然的微表情变化（挑眉、嘴角微动等），
被 perception-observer 引用。

## 核心职责
- `perception-expression.ts` — 微表情计算、骨骼应用。

## 对外 API（节选）
- `_applyMicroExpression(bones, config, deltaTime)` — 应用微表情到骨骼（私有）。

## 与其他子系统关系
- 感知观察者：`./perception-observer.ts`。
- 感知主控：`./perception.ts`。
- 共享类型：`./perception-shared.ts`。

## 不变量
- 微表情随机触发，不干扰主要表情。
- 微表情幅度在 [-0.5, 0.5] 范围内。
