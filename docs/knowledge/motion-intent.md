---
tier: architecture
kind: motion_intent
name: 场景级动作意图库
category: motion
scope:
  - frontend/src/scene/motion/motion-intent.ts
source_files:
  - frontend/src/scene/motion/motion-intent.ts
tests:
  - frontend/src/__tests__/scene/motion-intent-replace-default.test.ts
adr:
  - ADR-121
  - ADR-167
symbols:
  - LoadableProcId
  - addSceneMotion
  - clearAllSceneMotions
  - findOrCreateModuleState
  - getActiveMotion
  - getActiveMotionId
  - getAllLoadableProcMotions
  - getLoadedProceduralMotions
  - getMotionGen
  - getSceneMotions
  - initMotionIntent
  - loadProceduralMotion
  - removeSceneMotion
  - replaceDefaultMotion
  - resetMotionIntent
  - resolveCompatibility
  - setBroadcastCallback
  - setDefaultMotion
  - setLoadedProceduralMotions
  - unloadProceduralMotion
invariants:
  - _sceneMotions 为场景级动作库，多主动作平等共存（ADR-167）
  - _motionGen 每次变更递增，守护异步广播竞态
  - 轻量 singleton（非 EnvState），规避 Go struct 同步成本
use_when:
  - 动作意图
  - 多主动作
  - 动作库
  - 动作广播
  - 默认动作
  - 场景动作
---

# 场景级动作意图库

## 系统概览
**场景级动作意图库（Scene Motion Library）**。管理多主动作平等共存（ADR-167）：场景级
`_sceneMotions` 动作库 + `_activeMotionId` 默认动作 + 每实例继承/覆盖 + 广播/兼容性解析。
轻量 singleton 设计，规避 EnvState 的 Go struct 同步与 wails 绑定重生成本。

## 核心职责
- `motion-intent.ts` — 场景动作库管理、默认动作切换、动作广播到模型实例、状态序列化。

## 对外 API（节选）
- `interface SceneMotionIntent` — 场景动作意图（id、filePath、procMotion 参数等）。
- `getActiveMotion()` — 取当前默认动作（null = 无默认）。
- `getSceneMotions()` — 取所有动作列表。
- `setDefaultMotion(id)` — 设置默认动作。
- `addSceneMotion(intent)` — 添加动作到场景库。
- `removeSceneMotion(motionId)` — 从场景库移除动作。
- `setBroadcastCallback(cb)` — 注册动作广播回调。

## 与其他子系统关系
- 上游：`vmd-loader.ts` 加载动作后通过 `replaceDefaultMotion` 注册。
- 下游：遍历 `modelRegistry` 写入 `inst.vmdData` / `inst.vmdName`。
- 使用 `matchBone` 匹配骨骼名称。
- 程序化动作：`@/motion-algos/procedural-motion`。

## 不变量
- `_motionGen` generation counter：每次库变更递增，异步广播 await 后检查。
- 不 import 任何 UI 模块，保持单向依赖。
- 轻量 singleton，状态不经过 EnvState 同步。
- 删除默认动作时 `_activeMotionId` 直接置 `null`（不回退列表第一项，修复「动作根卡片永远到不了无动作」）。
- `setLoadedProceduralMotions` 过滤非 `LoadableProcId` 值（反序列化脏数据防御）。
- `initMotionIntent` 幂等守卫 + `resetMotionIntent()` 显式重置（场景重建/HMR 可再注册）。
