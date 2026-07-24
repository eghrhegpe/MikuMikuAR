---
kind: core_orbit
name: 轨道坐标系转换
category: core
scope:
  - frontend/src/core/orbit.ts
source_files:
  - frontend/src/core/orbit.ts
adr: []
symbols:
  - orbitToCartesian
  - cartesianToOrbit
invariants:
  - 被 props/model-manager 引用
tests: []
use_when:
  - 轨道坐标
  - 球面坐标
  - 笛卡尔坐标
  - 坐标转换
  - 轨道转换
---

## 系统概览
**轨道坐标系转换**。提供球面坐标↔笛卡尔坐标的双向转换，被 props 和 model-manager 引用。

## 核心职责
- `orbit.ts` — 球面坐标↔笛卡尔坐标转换。

## 对外 API（节选）
- `orbitToCartesian(pitch, yaw, distance)` — 球面坐标→笛卡尔坐标。
- `cartesianToOrbit(x, y, z)` — 笛卡尔坐标→球面坐标。

## 与其他子系统关系
- 道具系统：`../scene/env/props.ts`（道具位置）。
- 模型管理：`../scene/manager/model-manager.ts`（模型位置）。
- 相机：`../scene/camera/camera.ts`（相机位置）。

## 不变量
- 坐标转换使用右手坐标系（与 Babylon.js 一致）。
- 球面坐标范围：pitch [-90, 90]、yaw [-180, 180]、distance [0, +∞)。
