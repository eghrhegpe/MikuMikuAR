---
kind: motion_module_types
name: 动作模块类型定义
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/types.ts
source_files:
  - frontend/src/scene/motion/motion-modules/types.ts
adr:
  - ADR-116
  - ADR-126
  - ADR-145
symbols:
  - ModuleMeta
  - MotionOverrideModule
  - ModuleDef
  - ModuleParam
invariants:
  - 被所有 motion-module 子模块引用（约 9 次）
tests: []
use_when:
  - 动作模块类型
  - ModuleMeta
  - MotionOverrideModule
  - ModuleDef
  - 模块定义
---

## 系统概览
**动作模块类型定义**（ADR-116/126/145）。定义 ModuleMeta、MotionOverrideModule、ModuleDef 等
核心类型，被所有 motion-module 子模块引用。

## 核心职责
- `types.ts` — 动作模块类型定义。

## 对外 API（节选）
- `interface ModuleMeta` — 模块元数据（id、name、priority 等）。
- `interface MotionOverrideModule` — 运动覆盖模块接口（apply/dispose 等）。
- `interface ModuleDef` — 模块定义常量。
- `type ModuleParam` — 模块参数类型。

## 与其他子系统关系
- 被 body-posture/feet-adjustment/finger-pose/hand-symmetry/riding/sway/position-offset 全部引用。
- 注册表：`./registry.ts` 使用 ModuleDef。
- 类型定义：`../../core/types.ts`（MotionModuleState）。

## 不变量
- 所有子模块必须实现 `MotionOverrideModule` 接口。
- ModuleDef 中的 priority 决定模块在管线中的执行顺序。
