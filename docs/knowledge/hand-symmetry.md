---
tier: leaf
kind: hand_modules
name: 手部独立控制模块（左手/右手）
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/hand-modules.ts
source_files:
  - frontend/src/scene/motion/motion-modules/hand-modules.ts
adr:
  - ADR-116
  - ADR-126
  - ADR-129
symbols:
  - LEFT_HAND_DEF
  - RIGHT_HAND_DEF
invariants:
  - 左右手完全独立，不再强制镜像
  - 合并原 hand-symmetry（手腕旋转+位置偏移）与 finger-pose（手指预设）
  - 帧钩子驱动手臂位置偏移（与旧 hand-symmetry 同构）
  - 手指/手腕为静态 bake
tests:
  - src/__tests__/scene/motion-modules-registry.test.ts
use_when:
  - 左手控制
  - 右手控制
  - 手部模块
  - 手指姿势
---

## 系统概览
**左手/右手独立控制模块**。每侧提供手腕旋转（pitch/yaw/roll）、手臂位置偏移（handPosX/Y/Z）、手指预设（fingerPreset + fingerIntensity）三组参数。

## 核心职责
- `hand-modules.ts` — 工厂模式，`createHandModuleFactory(cfg)` 生成左右手模块。
- 手腕旋转：静态 `setBoneOverride` 写入手首骨骼。
- 手臂位置：帧钩子 `registerBoneOverrideFrameHook` 每帧驱动，FK 父根骨平移 + IK 重解增强。
- 手指姿势：5 指 × 3 节静态 bake，预设 × 强度控制卷曲程度。

## 对外 API（节选）
- `LEFT_HAND_DEF: ModuleDef` — 左手模块定义（priority=1）。
- `RIGHT_HAND_DEF: ModuleDef` — 右手模块定义（priority=1）。

## 与其他子系统关系
- 注册表：`./registry.ts`（通过 `getBuiltinModuleDefs()` 注册）。
- 骨骼覆盖：`../bone-override.ts`（`setBoneOverride` + `setBoneOverridePosition` + `registerBoneOverrideFrameHook`）。
- 帧钩子管理器：`createFrameHookManager()`（`./module-base.ts`）。
- 模块基类：`createModuleBase` + `createModuleShell` + `prepareBake`。
- 骨骼候选：`@/motion-algos/proc-motion-shared`（`BONE_ARM_IK_L/R_CANDIDATES`、`BONE_SHOULDER_L/R_CANDIDATES`）。

## 管理骨骼
- 手腕：`左手首` / `右手首`
- 肩根骨：`左肩` / `右肩`
- 手指：`左/右` + 5 指名 + 6 节后缀 = 30 候选骨骼

## 不变量
- 左右手共享一个 `_handFrameHooks` Map（按 modelId 注册一次）。
- 手臂 IK 缓存 `_armIkCache` per-model 惰性查找。
- disable 时注销帧钩子 + clearBoneOverride 仅清 owned 骨骼。
