---
kind: perception_lipsync
name: 感知口型同步
category: motion
scope:
  - frontend/src/scene/motion/perception-lipsync.ts
source_files:
  - frontend/src/scene/motion/perception-lipsync.ts
adr:
  - ADR-071
  - ADR-162
  - ADR-166
symbols:
  - _applyLipSync
  - LipSyncConfig
invariants:
  - 被 perception-observer 引用
tests: []
use_when:
  - 感知口型
  - 口型同步
  - lipsync
  - 感知层口型
---

## 系统概览
**感知口型同步模块**（ADR-071/162/166）。提供感知层的口型同步功能，
被 perception-observer 引用。

## 核心职责
- `perception-lipsync.ts` — 口型同步计算、骨骼应用。

## 对外 API（节选）
- `_applyLipSync(bones, config, deltaTime)` — 应用口型同步到骨骼（私有）。

## 与其他子系统关系
- 感知观察者：`./perception-observer.ts`。
- 感知主控：`./perception.ts`。
- 共享类型：`./perception-shared.ts`。

## 不变量
- 口型参数与音频信号联动。
- 口型同步与 VMD 口型动作互补。
