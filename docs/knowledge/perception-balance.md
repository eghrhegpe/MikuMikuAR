---
tier: leaf
kind: perception_balance
name: 重心微动
category: motion
scope:
  - frontend/src/scene/motion/perception-balance.ts
source_files:
  - frontend/src/scene/motion/perception-balance.ts
adr:
  - ADR-079
  - ADR-161
  - ADR-164
symbols:
  - _resetBalanceSwayState
  - _applyBalanceSway
invariants:
  - 重心微动幅度在 [-1, 1] 范围内
  - balanceSwayPeriod 有独立 setter 与默认值（2.0s），与呼吸参数无联动（知识卡旧「与呼吸频率联动」不成立）
  - _applyBalanceSway 为私有函数，仅被 perception-observer 调用
tests:
  - frontend/src/__tests__/perception/balance-sway-pin.int.test.ts
use_when:
  - 重心微动
  - 平衡摇摆
  - balanceSway
  - 躯干微晃
---

# 重心微动

## 系统概览
**重心微动模块**（ADR-161）。为躯干骨骼提供自然的平衡微晃（balanceSway），
被 perception-observer/perception 约 2 个模块引用。

## 核心职责
- `perception-balance.ts` — 重心微动计算、骨骼应用。

## 对外 API（节选）
- `_applyBalanceSway(mmdModel, time, ctx, centerClaimed?, upper2Claimed?, waistClaimed?, tier?)` — 应用重心微动到骨骼（私有；签名含可认领骨骼参数与性能档位）。
- `_resetBalanceSwayState(state)` — 重置平衡摇摆状态。
- `interface BalanceSwayState` — 平衡摇摆状态。

## 与其他子系统关系
- 感知观察者：`./perception-observer.ts`。
- 感知主控：`./perception.ts`。
- 共享类型：`./perception-shared.ts`。

## 不变量
- 重心微动幅度在 [-1, 1] 范围内。
- 微动频率与呼吸频率联动。
