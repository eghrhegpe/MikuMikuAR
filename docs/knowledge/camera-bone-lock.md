---
tier: leaf
kind: camera_bone_lock
name: 相机骨骼锁定
category: scene
scope:
  - frontend/src/scene/camera/camera-bone-lock.ts
source_files:
  - frontend/src/scene/camera/camera-bone-lock.ts
adr:
  - ADR-148
symbols:
  - setOrbitBoneLock
  - getOrbitBoneLock
  - setBoneLockDamping
  - getBoneLockDamping
  - getFocusedModelBoneNames
  - stopBoneLock
  - restoreBoneLockIfEnabled
invariants:
  - 骨骼锁仅在 orbit 模式下生效，切换到其他模式时显式 stopBoneLock（仅 dispose observer，保留启用状态）
  - 切回 orbit 时由 camera.ts 调用 restoreBoneLockIfEnabled 重启 observer，避免假启用
  - 启用时保存并禁用 panning + 关闭 inertia，避免与每帧 target 跟随冲突
  - 每帧通过 bone absolute position 计算 target，cam.setTarget 跟随
tests:
  - frontend/src/__tests__/camera.test.ts
use_when:
  - 骨骼锁
  - orbit 跟随骨骼
  - 阻尼系数
---

# 相机骨骼锁定

## 系统概览
**相机骨骼锁定模块**（ADR-148 阶段 3 续拆，2026-07-26）。从 camera.ts 抽出 orbit 模式下的骨骼锁逻辑：相机 target 每帧跟随指定骨骼的世界坐标，常用于"眼部追踪"或"上半身跟随"。

## 核心职责
- `setOrbitBoneLock(enabled, boneName?)` — 启用/禁用骨骼锁；启用时记录骨骼名 + 模型 ID，启动每帧跟随；禁用时清空状态 + 停止 observer
- `getOrbitBoneLock()` — 查询当前骨骼锁状态（`{ enabled, boneName?, modelId? }`）
- `setBoneLockDamping(v)` — 设置阻尼系数（控制相机跟随的平滑度）
- `getBoneLockDamping()` — 查询阻尼系数
- `getFocusedModelBoneNames()` — 获取当前聚焦模型的骨骼名列表（供 UI 下拉选择）
- `stopBoneLock()` — 临时停止骨骼锁（dispose observer + 恢复 panning / inertia，**保留** `_boneLockEnabled` 状态供切回 orbit 时恢复）
- `restoreBoneLockIfEnabled()` — 切回 orbit 时由 camera.ts switchCameraMode 调用：若 `_boneLockEnabled` 仍为 true，重启每帧跟随 observer

## 与其他子系统关系
- 依赖 `camera-state.ts`（`getCurrentCamera` / `getCameraScene` / `focusedModelId` via `@/core/config`）
- 依赖 `@/core/observer-handle`（`observe` 注册每帧回调）
- 依赖 `model-ops.ts`（通过 `modelRegistry` 查询模型骨骼）
- 被 `camera.ts` 调用（`switchCameraMode` 离开 orbit 时调用 `stopBoneLock`）
- 被 `motion-camera-levels.ts` 调用（UI 提供骨骼选择 + 开关）

## 不变量
- 骨骼锁仅在 orbit 模式下生效，切换到其他模式时 `switchCameraMode` 显式调用 `stopBoneLock`
- 启用时保存并禁用 `panningSensibility`（设为 0 完全禁用平移）+ 关闭 `inertia`（避免与每帧 target 跟随冲突），停止时恢复
- 每帧通过 bone absolute position 计算 target，`cam.setTarget()` 跟随；阻尼系数控制平滑度
- 骨骼锁状态（`_boneLockEnabled` / `_boneLockBoneName` / `_boneLockModelId`）通过 camera-state.ts 不持有，保留在本模块作为运行时状态（不参与序列化）
