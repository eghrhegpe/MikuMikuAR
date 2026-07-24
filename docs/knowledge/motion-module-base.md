---
kind: motion_module_base
name: 动作模块基类
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/module-base.ts
source_files:
  - frontend/src/scene/motion/motion-modules/module-base.ts
adr:
  - ADR-116
  - ADR-126
symbols:
  - ModuleBaseMethods
  - ModuleBaseOverrides
  - createModuleBase
  - applyModuleSnapshot
  - createFrameHookManager
  - ModuleShellConfig
  - createModuleShell
  - prepareBake
invariants:
  - 被 body-posture/feet-adjustment/finger-pose/hand-symmetry/riding/sway 等 8+ 模块引用
  - 提供骨架代码，子模块通过覆写实现自定义行为
tests: []
use_when:
  - 动作模块基类
  - module base
  - 模块骨架
  - 模块创建
  - 帧钩子管理
---

## 系统概览
**动作模块基类**（ADR-116/126）。提供所有 motion-module 的骨架代码，包括模块创建、
状态管理、帧钩子注册、烘焙准备等。子模块（body-posture/feet-adjustment/finger-pose/hand-symmetry/riding/sway/position-offset）
通过覆写基类方法实现自定义行为。

## 核心职责
- `module-base.ts` — 模块骨架代码、状态管理、帧钩子、烘焙。

## 对外 API（节选）
- `interface ModuleBaseMethods` — 模块基础方法接口。
- `interface ModuleBaseOverrides` — 可覆写的方法。
- `createModuleBase(config)` — 创建模块基类实例。
- `applyModuleSnapshot(snapshot, module)` — 应用状态快照。
- `createFrameHookManager()` — 创建帧钩子管理器。
- `createModuleShell(config)` — 创建模块外壳（运动覆盖模块）。
- `prepareBake(modelId, moduleId)` — 准备烘焙。

## 与其他子系统关系
- 被 body-posture/feet-adjustment/finger-pose/hand-symmetry/riding/sway/position-offset 全部引用。
- 骨骼覆盖：`../bone-override.ts`。
- 注册表：`./registry.ts`。

## 不变量
- 所有子模块必须通过 `createModuleBase` 或 `createModuleShell` 创建。
- 帧钩子必须在模块 `dispose()` 时清除。
