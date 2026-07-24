---
kind: motion_preset_types
name: 动作预设类型
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/preset-types.ts
source_files:
  - frontend/src/scene/motion/motion-modules/preset-types.ts
adr:
  - ADR-145
symbols:
  - MotionPreset
  - PresetModuleState
invariants:
  - 被 registry/ui-preset 引用
tests: []
use_when:
  - 动作预设类型
  - 预设类型
  - MotionPreset
  - PresetModuleState
---

## 系统概览
**动作预设类型**（ADR-145）。定义 MotionPreset、PresetModuleState 等预设相关类型，
被 registry/ui-preset 引用。

## 核心职责
- `preset-types.ts` — 动作预设类型定义。

## 对外 API（节选）
- `interface MotionPreset` — 动作预设描述。
- `interface PresetModuleState` — 预设模块状态。

## 与其他子系统关系
- 注册表：`./registry.ts`（预设加载）。
- 预设面板：`../../core/ui-preset.ts`（预设 UI）。

## 不变量
- 预设类型与 `../core/types.ts` 的 MotionPreset 保持一致。
- 预设模块状态可序列化/反序列化。
