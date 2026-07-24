---
kind: perception_balance
name: 重心微动
category: motion
scope:
  - frontend/src/scene/motion/perception-balance.ts
source_files:
  - frontend/src/scene/motion/perception-balance.ts
adr:
  - ADR-161
symbols:
  - _resetBalanceSwayState
  - _applyBalanceSway
  - BalanceSwayState
invariants:
  - 被 perception-observer/perception 引用
tests: []
use_when:
  - 重心微动
  - 平衡摇摆
  - balanceSway
  - 躯干微晃
---

## 系统概览
**重心微动模块**（ADR-161）。为躯干骨骼提供自然的平衡微晃（balanceSway），
被 perception-observer/perception 约 2 个模块引用。

## 核心职责
- `perception-balance.ts` — 重心微动计算、骨骼应用。

## 对外 API（节选）
- `_applyBalanceSway(bones, config, deltaTime)` — 应用重心微动到骨骼（私有）。
- `_resetBalanceSwayState(state)` — 重置平衡摇摆状态。
- `interface BalanceSwayState` — 平衡摇摆状态。

## 与其他子系统关系
- 感知观察者：`./perception-observer.ts`。
- 感知主控：`./perception.ts`。
- 共享类型：`./perception-shared.ts`。

## 不变量
- 重心微动幅度在 [-1, 1] 范围内。
- 微动频率与呼吸频率联动。
