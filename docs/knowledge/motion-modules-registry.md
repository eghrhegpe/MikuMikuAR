---
kind: motion_modules_registry
name: 动作模块注册表
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/registry.ts
source_files:
  - frontend/src/scene/motion/motion-modules/registry.ts
adr: []
symbols:
  - registerModule
  - unregisterModule
  - getRegisteredModules
  - createModule
  - getModuleState
invariants:
  - 模块注册后按 priority 排序执行
  - 每个模块有唯一 name 标识
tests: []
use_when:
  - 动作模块
  - 模块注册
  - 动作扩展
  - 动作管线扩展
---

## 系统概览
**动作模块注册表**。管理动作管线的可插拔模块（如脚部调整、手指姿态、身体姿势、摇摆等），
按优先级排序执行，支持动态注册/注销。是动作管线的扩展点。

## 核心职责
- `registry.ts` — 动作模块注册、排序、生命周期管理。

## 对外 API（节选）
- `interface MotionModule` — 动作模块接口（name、priority、apply 函数）。
- `class MotionModuleRegistry` — 注册表实现。
- `registerModule(id, meta, priority)` — 注册动作模块。
- `unregisterModule(id)` — 注销动作模块。
- `getRegisteredModules()` — 取已注册模块列表（按优先级排序）。
- `createModule(id, modelId)` — 为模型创建模块实例。
- `getModuleState(modelId, moduleId)` — 取模块运行时状态。

## 与其他子系统关系
- 被 `motion-pipeline.ts` 调用，逐帧执行各模块。
- 下游模块：`feet-adjustment-module`、`finger-pose`、`body-posture`、`sway-motion` 等。

## 不变量
- 模块按 priority 升序执行，相同 priority 按注册顺序。
- 模块 name 必须唯一，重复注册报错。
