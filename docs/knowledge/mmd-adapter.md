---
tier: architecture
kind: mmd_adapter
name: babylon-mmd 适配边界
category: core
scope:
  - frontend/src/core/mmd-adapter.ts
source_files:
  - frontend/src/core/mmd-adapter.ts
adr:
  - ADR-192
  - ADR-071
symbols:
  - getPhysicsImpl
  - getRigidBodyBundleMap
  - getStreamAudio
  - CapabilityProbe
  - onBoneMatricesUpdated
  - transformWorldToRootLocal
  - getBoneWorldMatrix
  - switchAnimation
  - getRigidBodyMap
  - applyForceToModelRigidBodies
  - applyForceToModelRigidBodiesNative
  - solveIkNative
  - applyWindForceToModelRigidBodiesNative
invariants:
  - 本模块是联邦接触 babylon-mmd 私有/未公开字段的唯一适配边界
  - 所有对 babylon-mmd 私有字段的反射访问集中在此，不散落多个业务文件
  - 上游升级若重命名私有字段，本模块为唯一需要修改的点
  - onBoneMatricesUpdated 必须注册在 onBeforeRenderObservable（或之后），因 onAfterAnimationsObservable 在之前触发
  - switchAnimation 必须 seekAnimation(0, true) 归零全局时钟，否则陈旧时钟越界导致下一帧 pause
  - switchAnimation 必须 dispose 旧 runtime animation 句柄，否则 WASM AnimCurve 泄漏
tests:
  - frontend/src/__tests__/core/mmd-adapter.test.ts
use_when:
  - babylon-mmd
  - MmdRuntime
  - 骨骼矩阵
  - 动作切换
  - 物理桥
  - 音频
  - ADR-192
---

# babylon-mmd 适配边界

## 系统概览

联邦项目接触 babylon-mmd 的唯一适配边界（ADR-192）。把所有对 babylon-mmd 私有/未公开字段的访问（反射、类型网关）集中到本模块，避免脆弱依赖散落多个业务文件。上游 PR 路径关闭后，联邦对 babylon-mmd 为永久自治下游，本模块是本地应对的收敛点。

## 核心职责

- `mmd-adapter.ts` — babylon-mmd 适配层，反射访问收口

### 功能性适配
- `getPhysicsImpl(runtime)` — 从 IMmdRuntime 获取底层 MmdWasmPhysicsRuntimeImpl（条目 3，Phase 2 内化）
- `getRigidBodyBundleMap(impl)` — 返回所有 RigidBodyBundle 迭代器（通过公开 API `rigidBodyBundleReferenceCountMap.keys()`）
- `getStreamAudio(player)` — 从 StreamAudioPlayer 取出内部 HTMLAudioElement（条目 9，仍依赖私有 _audio 反射）

### 时序/坐标系契约固化
- `onBoneMatricesUpdated(scene, callback)` — 在骨骼 worldMatrix 已被 babylon-mmd 更新之后、渲染之前注册回调
- `transformWorldToRootLocal(mesh, target)` — 把世界坐标系下的点转换到 rootMesh 局部坐标系
- `getBoneWorldMatrix(bone, rootMesh)` — 返回骨骼在世界坐标系下的 worldMatrix

### 切换契约固化
- `switchAnimation(runtime, model, animation)` — 切换模型当前动画到新动画，归零运行时全局时钟到第 0 帧，释放旧 WASM 句柄

## 对外 API（节选）

- `getPhysicsImpl(runtime)` — 获取物理 impl
- `getRigidBodyBundleMap(impl)` — 遍历所有 RigidBodyBundle
- `getStreamAudio(player)` — 获取 HTMLAudioElement（可能 null）
- `CapabilityProbe.hasStreamAudio(player)` — 探测 _audio 字段是否存在
- `onBoneMatricesUpdated(scene, callback)` — 注册骨骼矩阵更新回调
- `transformWorldToRootLocal(mesh, target)` — 世界坐标转局部坐标
- `getBoneWorldMatrix(bone, rootMesh)` — 获取骨骼世界矩阵
- `switchAnimation(runtime, model, animation)` — 切换动画

## 与其他子系统关系

- 被 `wind-physics.ts`、`ground-collision.ts` 用于获取物理 impl
- 被 `perception-gaze.ts` 用于坐标系转换
- 被 `vmd-loader.ts`、`vmd-layers.ts` 用于动作切换
- 被 `lighting.ts` 用于骨骼矩阵更新时序

## 不变量

- 所有对 babylon-mmd 私有字段的反射操作集中在本模块，不散落业务文件
- 上游升级导致私有字段重命名时，本模块为唯一需要修改的点
- `onBoneMatricesUpdated` 必须注册在 `onBeforeRenderObservable`，不要在 `onAfterAnimationsObservable` 注册
- `switchAnimation` 必须同时做：解绑旧动画、释放 WASM 句柄、seekAnimation 归零时钟

## 验证入口

- 测试：`frontend/src/__tests__/core/mmd-adapter.test.ts`
- 命令：`cd frontend && npm run test -- core/mmd-adapter.test.ts`