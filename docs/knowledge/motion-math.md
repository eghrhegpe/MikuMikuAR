---
kind: motion_math
name: 动作数学工具
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/motion-math.ts
source_files:
  - frontend/src/scene/motion/motion-modules/motion-math.ts
adr: []
symbols:
  - computeSwayYaw
  - computePedalPhase
  - computeFootPitch
invariants:
  - 被 hand-symmetry/feet-adjustment 等模块引用
tests: []
use_when:
  - 动作数学
  - 四元数插值
  - 欧拉角插值
  - 角度转换
  - 动作插值
---

## 系统概览
**动作数学工具**。提供四元数/欧拉角插值、角度转换等数学工具，
被 hand-symmetry/feet-adjustment 等模块引用。

## 核心职责
- `motion-math.ts` — 四元数/欧拉角插值、角度转换。

## 对外 API（节选）
- `computeSwayYaw(t)` — 计算摇摆 yaw 角度。
- `computePedalPhase(tSec, pedalSpeedHz)` — 计算踏板相位。
- `computeFootPitch(phaseDeg, isLeftFoot)` — 计算脚部俯仰角度。

## 与其他子系统关系
- 手部对称：`./hand-symmetry.ts`（镜像计算）。
- 脚部调整：`./feet-adjustment-module.ts`（脚部位置计算）。

## 不变量
- 插值使用四元数避免万向锁。
- 角度使用弧度制（与 Babylon.js 一致）。
