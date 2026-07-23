---
kind: bone_override_store
name: 骨骼覆盖存储（多模块仲裁）
category: motion
scope:
  - frontend/src/scene/motion/**
source_files:
  - frontend/src/scene/motion/bone-override-store.ts
adr:
  - ADR-084
---

## 系统概览
骨骼覆盖的**所有权存储与仲裁层**。多个模块（动作系统、感知层、虚拟裙骨）需要临时占用模型骨骼，
本存储记录每个骨骼被哪个模块 claim / release，检测冲突（同一骨骼被两模块同时占用），为多模块共存提供
安全的骨骼调度。是 ADR-084 虚拟裙骨与感知层骨骼冲突治理的底层设施。

## 核心职责
- `bone-override-store.ts` — 骨骼所有权登记、冲突检测、释放监听。

## 对外 API（节选）
- `interface OverrideSlot` — 单次骨骼占用的槽位描述。
- `interface BoneOwnership` — 某骨骼的当前归属。
- `interface BoneConflict` — 冲突描述（争用方、骨骼集合）。
- `interface ModuleRuntimeState` — 模块运行时状态。
- `type ReleaseListener` — 释放事件回调。
- `interface BoneOverrideStore` — 存储抽象（claim / release / query / onRelease）。
- `class InMemoryBoneOverrideStore` — 内存实现。
- `getBoneOverrideStore()` — 取全局单例。

## 与其他子系统关系
- 被动作系统、感知层（`perception-observer`）、虚拟裙骨（ADR-084）共享。
- 冲突信息可上抛 UI（冲突 banner / 滑块标记），是感知层冲突可视化的数据来源。
