---
tier: leaf
kind: foot_modules
name: 脚部独立控制模块（左脚/右脚）
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/foot-modules.ts
source_files:
  - frontend/src/scene/motion/motion-modules/foot-modules.ts
adr:
  - ADR-116
  - ADR-129
symbols:
  - LEFT_FOOT_DEF
  - RIGHT_FOOT_DEF
invariants:
  - 左右脚完全独立，可分别调节旋转和位置偏移
  - 旋转通过 setBoneOverride 写入足 IK 骨骼
  - 位置偏移通过帧钩子 setBoneOverridePosition 每帧驱动
  - 与 feet-adjustment 引擎互不冲突（旋转 vs 位置，不同维度）
tests:
  - src/__tests__/scene/motion-modules-registry.test.ts
use_when:
  - 左脚控制
  - 右脚控制
  - 脚部模块
  - 足部位置偏移
---

# 脚部独立控制模块（左脚/右脚）

## 系统概览
**左脚/右脚独立控制模块**。每侧提供足 IK 骨骼旋转（pitch/yaw/roll）和位置偏移（footPosX/Y/Z）两组参数。

## 与地面跟随引擎的关系
- `feet-adjustment.ts` 每帧写 IK 目标骨骼的 **position**（Y 轴贴地）— always-on 基础设施。
- 本模块通过 bone-override 写 **rotation** + 帧钩子写 **position offset**。
- 帧管线顺序：帧钩子(order=0) 先写偏移 → feet-adjustment(order=5) 再修正位置+重解 IK。
- 两者操作不同维度（旋转 vs 位置），互不冲突。

## 核心职责
- `foot-modules.ts` — 工厂模式，`createFootModuleFactory(cfg)` 生成左右脚模块。
- 旋转：静态 `setBoneOverride` 写入足 IK 骨骼（`左足IK` / `右足IK`）。
- 位置偏移：帧钩子 `registerBoneOverrideFrameHook` 每帧调用 `setBoneOverridePosition`。

## 对外 API（节选）
- `LEFT_FOOT_DEF: ModuleDef` — 左脚模块定义（priority=8）。
- `RIGHT_FOOT_DEF: ModuleDef` — 右脚模块定义（priority=8）。

## 与其他子系统关系
- 注册表：`./registry.ts`（通过 `getBuiltinModuleDefs()` 注册）。
- 骨骼覆盖：`../bone-override.ts`（`setBoneOverride` + `setBoneOverridePosition` + `registerBoneOverrideFrameHook`）。
- 地面跟随引擎：`../feet-adjustment.ts`（always-on，不受模块启用/禁用影响）。
- 帧钩子管理器：`createFrameHookManager()`（`./module-base.ts`）。

## 管理骨骼
- 左脚：`左足IK`
- 右脚：`右足IK`

## 不变量
- 左右脚共享一个 `_footFrameHooks` Map（按 modelId 注册一次）。
- disable 时注销帧钩子 + clearBoneOverride 仅清 owned 骨骼。
- 位置偏移在 feet-adjustment 之前写入，引擎会在偏移基础上做地面修正。
