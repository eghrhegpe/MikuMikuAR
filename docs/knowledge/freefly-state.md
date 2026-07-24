---
kind: freefly_state
name: 自由飞行状态
category: core
scope:
  - frontend/src/core/freefly-state.ts
source_files:
  - frontend/src/core/freefly-state.ts
adr: []
symbols:
  - freeflyInput
  - FreeflyState
invariants:
  - 被 camera/props 引用
tests: []
use_when:
  - 自由飞行
  - freefly
  - 相机自由飞行
  - 飞行状态
---

## 系统概览
**自由飞行状态管理**。管理相机的自由飞行模式状态，
被 camera/props 引用。

## 核心职责
- `freefly-state.ts` — 自由飞行状态存储、查询、设置。

## 对外 API（节选）
- `freeflyInput` — 自由飞行输入状态单例。
- `interface FreeflyState` — 自由飞行状态描述。

## 与其他子系统关系
- 相机：`../scene/camera/camera.ts`（自由飞行模式）。
- 道具：`../scene/env/props.ts`（自由飞行视角）。

## 不变量
- 自由飞行状态在相机模式切换时重置。
- 自由飞行模式下相机不受模型约束。
