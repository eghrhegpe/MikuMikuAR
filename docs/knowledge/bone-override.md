---
tier: architecture
source_files:
  - frontend/src/scene/motion/bone-override.ts
tests:
  - frontend/src/__tests__/scene/bone-override.test.ts
kind: bone_override
name: 骨骼覆盖核心 API
category: motion
scope:
  - frontend/src/scene/motion/bone-override.ts
adr:
  - ADR-061
  - ADR-116
  - ADR-123
  - ADR-126
  - ADR-186
symbols:
  - BoneHierarchyDump
  - BoneHierarchyNode
  - BoneOverrideEntry
  - FRAME_HOOK_ORDER
  - FrameHookSnapshot
  - OverrideSlotLike
  - OverrideType
  - applyBoneOverrideIK
  - clearAllOverrides
  - clearBoneOverride
  - computeOverride
  - dumpBoneHierarchy
  - getAllOverrides
  - getFrameHooksSnapshot
  - getOverride
  - getOverrideType
  - getWasmIkResolver
  - protectIkPosition
  - registerBoneOverrideFrameHook
  - restoreOverrides
  - setBoneOverride
  - setBoneOverridePosition
  - setBoneOverrideQuat
  - setWasmIkResolver
  - startBoneOverride
  - stopBoneOverride
invariants:
  - 被 6 个 motion-modules 子模块引用
  - 与 bone-override-store 协作（所有权仲裁）
  - 覆盖数据按模型 ID 隔离
  - 帧钩子按 order 升序执行（顺序由声明决定，与注册时序解耦）

use_when:
  - 骨骼覆盖
  - bone override
  - 骨骼编辑
  - 动作覆盖
  - 欧拉角覆盖
  - 混合权重
  - IK 保护
  - 帧钩子注册
  - 帧内时序（ADR-186）
---

# 骨骼覆盖核心 API

## 系统概览
**骨骼覆盖核心 API**（ADR-061/116/123/126/186）。提供骨骼覆盖的增删改查接口，是 UI 编辑和
动作模块的底层入口。与 `bone-override-store` 协作：本模块负责覆盖数据的管理和应用，
`bone-override-store` 负责多模块的所有权仲裁。

## 核心职责
- `bone-override.ts` — 骨骼覆盖数据管理、应用、序列化、帧钩子注册、IK 保护、运行时驱动

## 对外 API
- `type BoneOverrideEntry` — 单条骨骼覆盖描述（欧拉角 + 权重 + 绝对模式 + 可选位置）
- `computeOverride(boneName, euler, weight, modelId?)` — 计算覆盖
- `setBoneOverride(boneName, euler, weight, absolute?, modelId?)` — 设置骨骼覆盖（欧拉角路径）
- `setBoneOverrideQuat(boneName, quat, weight, absolute?, modelId?)` — 设置骨骼覆盖（四元数路径，内部高效）
- `setBoneOverridePosition(boneName, pos, modelId?)` — 仅设置位置覆盖（保留动画旋转）
- `applyBoneOverrideIK()` — 应用覆盖到 IK 系统
- `clearBoneOverride(boneName, modelId?)` — 清除指定骨骼覆盖
- `getOverride(boneName, modelId?)` — 取指定骨骼覆盖
- `getOverrideType(boneName, modelId?)` — 取覆盖类型（rotation/position/both/none，覆盖着色诊断用）
- `clearAllOverrides(modelId?)` — 清除全部覆盖
- `protectIkPosition(boneName)` — 注册 IK 位置保护（覆盖传播时撤销对 IK 目标的偏移）
- `registerBoneOverrideFrameHook(order, source, hook)` — 注册帧钩子（按 order 升序执行，source 用于 UI 管线时序一览展示）
- `getFrameHooksSnapshot()` — 取所有帧钩子快照（UI 时序图展示用）
- `getAllOverrides(modelId?)` — 取所有覆盖（序列化用）
- `restoreOverrides(entries, modelId?)` — 恢复覆盖（反序列化用）
- `startBoneOverride(modelId, getRuntimeBones, scene)` — 启动帧驱动（绑定 onBeforeRenderObservable）
- `stopBoneOverride()` — 停止帧驱动 + 释放资源
- `dumpBoneHierarchy(modelId?)` — dump 骨骼层级（UI 调试 / 骨骼选择器用）

## 与其他子系统关系
- 所有权仲裁：`bone-override-store`（ADR-084）
- 被 motion-modules 子模块引用（body-posture/hand-modules/foot-modules/riding-model 等，6 个子模块注册帧钩子）
- UI 编辑：`menus/motion-override-levels.ts`（renderOverrideCard / buildAdvancedBoneOverrideLevel）
- 类型定义：`../core/types.ts`（BoneOverrideEntry）
- WASM/JS 双路径：通过 `isWasmRuntime()` 分流，JS 路径跳过 IK 保护快照（与 ADR-186 时序图一致）

## 不变量
- 覆盖数据按模型 ID 隔离（`_overrideMaps: Map<modelId, Map<boneName, _OverrideSlot>>`）
- 应用覆盖时不改变骨骼原始值，使用 `setOverride` 机制
- 帧钩子按 `order` 升序执行（顺序由声明决定，与注册时序解耦，ADR-186 R2 修复）
- `absolute=true` 仅对叶骨使用（中间层级骨骼会丢弃父骨传播，导致子骨视觉跳跃，审计 P2 风险）
- IK 保护仅 WASM 路径生效（JS 路径跳过 `_snapshotProtectedPositions`/`_restoreProtectedPositions`，ADR-186 时序图步骤③⑤一致）

## 帧内时序（ADR-186）
bone-override stage 内部按以下顺序执行：
1. `_runFrameHooks()` — 帧钩子按 order 升序写入 overrideMap（foot-modules:0 → body-posture:5 → riding:10 → sway:20 → hand-symmetry:30）
2. 构建 boneMap + IK 保护快照（`_snapshotProtectedPositions`）
3. 覆盖循环 — 逐骨 `_applyWasmOverride`，每骨处理后立即 `_propagateChildrenWasm` 传播
4. IK 保护恢复（`_restoreProtectedPositions`）— 撤销传播对 IK 目标的偏移，保留自身 slot 覆盖
5. feet-adjustment 层（order=5，独立层）读取修复后的 IK 目标位置

> ⚠️ 传播是「每骨立即」而非「批量」。新增帧钩子若写入会被传播到 IK 目标的骨骼，需调用 `protectIkPosition()` 注册保护。

## WASM IK 重解与诊断日志门控（ADR-202 §六 / ADR-248）
- **重解入口**：`setWasmIkResolver(resolver)` 注册 WASM IK 重解回调，所有调用方（bone-override 内部 + feet-adjustment 经 `getWasmIkResolver`）统一走 `_guardedResolve` 包装——feetDebug 开启时检测同帧内同一 `(modelId, ikSolverIndex)` 的重复调用（重复 `mmdModelSolveIk` 求解），双重节流（帧内最多 1 条 + 2 秒窗口 1 条）。
- **求解优先序**：`_solvePosSlotIkWasm` 仅当原生 `IkSolver` 不存在时才回退 WASM 导出 `mmdModelSolveIk`（可信度存疑路径）。`_applyWasmOverride` 已先把 `slot.pos` 偏移写入 `worldMatrix`，`IkSolver.solve()` 读同一 `worldMatrix` 作为 IK 目标，解出髋/膝/踝旋转并回写全链。
- **诊断日志**：`[IK-ENTRY]`（slotCount 诊断）/ `[OVERRIDE-APPLY]`（POS 偏移写入确认）均 `feetDebug.value` 门控 + `%60` 帧节流——热路径每帧调用，无条件 logWarn 会刷爆环形缓冲/console（ADR-248 教训）。

## 生命周期守卫（round19）
- **`startBoneOverride` 守卫升级**：`if (_observerHandle && _driverScene === scene) return`——已启动且场景一致才短路。scene 变更后未 stop 直接 start 时走重建分支（`registerBoneOverrideFrameHook` 同 id 覆盖旧 layer，`_driverScene !== scene` 触发 observer 重建），修复原 `if (_observerHandle) return` 使重建分支成为死代码、静默绑定旧 scene observable 导致整个 pipeline 停摆无报错的问题。
- **帧首清空 IK 保护集合**：`_protectedIkBoneNames.clear()` 移入帧回调开头（原帧末 clear 会被下方提前 return 路径——无聚焦/overrideMap 空/bones 空——跳过，遗留陈旧条目在后续帧被 `_snapshotProtectedPositions` 全量回滚，抹掉其它模块对该骨的传播/覆盖）。与 `_resetIkResolveGuard()` 同为帧首重置模式。
