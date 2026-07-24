---
kind: core_types
name: 共享类型定义
category: core
scope:
  - frontend/src/core/types.ts
source_files:
  - frontend/src/core/types.ts
adr:
  - ADR-061
  - ADR-116
  - ADR-123
  - ADR-145
  - ADR-167
symbols:
  - BoneOverrideEntry
  - ParamValue
  - MotionModuleState
  - PresetModuleState
  - MotionPreset
  - ModelInstance
  - VmdLayer
  - EnvState
  - UIState
invariants:
  - 纯类型定义，零运行时代码
  - 通过 config.ts barrel re-export 提供
tests: []
use_when:
  - 类型定义
  - 共享类型
  - ModelInstance
  - EnvState
  - UIState
  - 骨骼覆盖类型
  - 动作模块类型
  - 动作预设
---

## 系统概览
**全项目共享类型定义**。从 config.ts 拆出的纯类型文件，零运行时代码。包含骨骼覆盖（ADR-061）、
动作模块状态（ADR-116/145）、VMD 图层、场景动作意图（ADR-167）等核心数据结构，
被核心/场景/菜单三大目录广泛引用。

## 核心职责
- `types.ts` — 集中管理跨模块共享的类型定义。

## 对外 API（节选）
- `type BoneOverrideEntry` — 单条骨骼覆盖配置（欧拉角 + 权重 + 绝对模式）。
- `type MotionModuleState` — 动作模块运行时状态（per-motion）。
- `type MotionPreset` — 动作预设 DTO（ADR-145）。
- `type ModelInstance` — 模型实例描述（vmdData/vmdName 等）。
- `type VmdLayer` — VMD 图层描述。
- `type EnvState` — 环境状态容器。
- `type UIState` — UI 持久化状态容器。

## 与其他子系统关系
- barrel re-export：`config.ts` → `types.ts`。
- 被 core/scene/menus 约 38 个模块直接引用。
- ADR-061/116/123/145/167 均在此定义相关类型。

## 不变量
- 纯类型定义，不含任何运行时代码。
- 通过 `config.ts` 统一导出，调用方无需改 import 路径。
