---
kind: animation_retargeter
name: 外部动作重定向桥
category: motion
scope:
  - frontend/src/scene/motion/animation-retargeter.ts
source_files:
  - frontend/src/scene/motion/animation-retargeter.ts
adr:
  - ADR-108
symbols:
  - BoneMapPreset
  - RetargetResult
  - RetargetPlayState
  - getRetargetPlayState
  - retargetAndPlay
  - stopRetarget
invariants:
  - 同时只允许一个 retarget 动画活跃（_currentRetarget 单例）
  - retarget 动画以 additive 模式叠加在 VMD 之上，不替换
tests: []
use_when:
  - 外部动画
  - Mixamo
  - VRM
  - GLB
  - FBX
  - 动作重定向
  - 骨骼映射
  - 人形动画导入
---

## 系统概览
外部人形动画（Mixamo / VRM / GLB / FBX / GLTF）到 **MMD 骨骼的重定向桥**。将外部动画加载为
Babylon.js `AnimationGroup`，通过预设的骨骼映射表（`MixamoMmdHumanoidBoneMap` / `VrmMmdHumanoidBoneMap`）
映射到等效 MMD 骨骼，以 additive 模式叠加播放。与 ADR-061 骨骼映射模块共享映射预设。

## 核心职责
- `animation-retargeter.ts` — 加载外部动画文件、骨骼重映射、additive 播放控制、状态序列化。

## 对外 API（节选）
- `type BoneMapPreset = 'mixamo' | 'vrm' | 'custom'` — 骨骼映射预设类型。
- `interface RetargetResult` — 重定向结果（animationGroup + sourceSkeleton + boneMapName）。
- `interface RetargetPlayState` — 活跃状态（用于场景序列化）。
- `getRetargetPlayState()` — 取当前活跃 retarget 状态。
- `retargetAndPlay(scene, filePath, boneMapPreset, modelId?)` — 加载并重定向播放。
- `stopRetarget()` — 停止当前 retarget 动画。

## 与其他子系统关系
- 使用 `babylon-mmd` 的 `AnimationRetargeter` 和预设骨骼映射表。
- 加载器：`@babylonjs/core/Loading/sceneLoader.ImportMeshAsync`。
- 场景序列化：`RetargetPlayState` 写入 `vmd-layers.ts` 的层状态。
- 与 ADR-061 共享 Mixamo/VRM 映射预设。

## 不变量
- 同时只允许一个 retarget 活跃；新播放自动停止旧播放。
- retarget 动画叠加于 VMD 之上，不替换 VMD 内容。
