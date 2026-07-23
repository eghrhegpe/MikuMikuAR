---
kind: physics_bridge
name: 物理骨骼桥与每帧注册表
category: physics
scope:
  - frontend/src/physics/**
source_files:
  - frontend/src/physics/physics-bridge.ts
adr:
  - ADR-081
---

## 系统概览
与物理后端无关的骨骼读取桥 + 挂件 auto-fit 几何工具 + 单一每帧 update 调度注册表。原 XPBD(TS) 物理栈删除后（ADR-081），将与求解器无关、可跨后端复用的构件抽离到此独立模块，避免「测试物理寄生 MMD 加载主链」的覆辙。本模块不被任何启动期代码 eager 导入，仅作为将来挂载布料 / ragdoll / attachment 时的基础设施备用。

## 核心职责
- `physics-bridge.ts` — 骨骼世界矩阵/位置读取、挂件几何 auto-fit 推算、PerFrameUpdateRegistry 每帧调度

## 对外 API（节选）
- `findRuntimeBone(model, boneName)` — 在 runtimeBones 中按名查找（WASM/JS runtime 通用）
- `getBoneWorldMatrix(model, boneName)` — 取骨骼列主序世界矩阵 `Float32Array[16]`
- `getBoneWorldPosition(model, boneName)` — 取骨骼世界位置 `Vector3`
- `autoFitAttachment(anchor, opts?)` — 由模型尺寸启发式推算挂件几何（topology / segmentsH/V / innerRadius / length / particleRadius / particleSpacing）
- `PerFrameUpdateRegistry` — 单一 `onBeforeRenderObservable` 调度多个按 key 注册的每帧回调；dt 做非有限值/后台恢复钳制（上限 50ms）

## 与其他子系统关系
- `virtual-skirt.ts` 引用 `getBoneWorldPosition` / `PerFrameUpdateRegistry`
- `ground-collision.ts` 间接依赖骨骼读取能力
- 求解器内部步进/写回不在此处（随后端语义在具体实现处理）
