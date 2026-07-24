---
kind: hand_symmetry
name: 手部对称动作模块
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/hand-symmetry.ts
source_files:
  - frontend/src/scene/motion/motion-modules/hand-symmetry.ts
adr:
  - ADR-126
symbols:
  - HAND_SYMMETRY_DEF
  - createHandSymmetryModule
invariants:
  - 手部对称模块
  - 被 registry 引用
tests: []
use_when:
  - 手部对称
  - 手势对称
  - 手部镜像
---

## 系统概览
**手部对称动作模块**。将一只手的骨骼姿态镜像到另一只手，实现自然的手部对称动作。

## 核心职责
- `hand-symmetry.ts` — 手部骨骼镜像对称。

## 对外 API（节选）
- `HAND_SYMMETRY_DEF` — 模块定义常量。
- `createHandSymmetryModule(modelId)` — 创建手部对称模块实例。

## 与其他子系统关系
- 注册表：`./registry.ts`。
- 骨骼覆盖：`../bone-override.ts`。
- 动作模块基类：`./module-base.ts`。

## 不变量
- 手部骨骼镜像使用骨骼名映射（左→右/右→左）。
- 镜像后与 VMD 动作互补。
