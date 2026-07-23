---
kind: wind_physics
name: 风力物理注入（WASM Bullet）
category: physics
scope:
  - frontend/src/physics/**
source_files:
  - frontend/src/physics/wind-physics.ts
adr:
  - ADR-104
---

## 系统概览
通过 `MmdWasmPhysicsRuntimeImpl.onSyncObservable`，在每次 Bullet 物理步进前对所有 Dynamic 刚体施加风力，使头发/裙子等物理部件受风影响。仅 WASM 运行时生效（JS 运行时无 Bullet 物理）；Kinematic 刚体（骨骼跟随）不受力，Bullet 自动忽略。

## 核心职责
- `wind-physics.ts` — 风力订阅/重试/销毁编排、刚体遍历施力

## 对外 API（节选）
- `initWindPhysics(runtime)` — 初始化订阅（幂等；physics impl 延迟就绪时由 `retry` 补齐）
- `retryWindPhysicsSubscription(runtime?)` — 模型加载成功后重试订阅（ADR-104 替代原 monkey-patch `createMmdModel` 的脆弱做法；省略参数则重试全部已注册运行时）
- `disposeWindPhysics()` — 仅移除自身 observer，不影响其他 `onSyncObservable` 订阅者
- `isWindPhysicsActive()` — 当前是否实际启用风力物理（供 UI 判断 JS 运行时下的提示）

## 与其他子系统关系
- 依赖 `core/wind-utils`（`getWindVector` / `isWindActive`）
- 由 `scene.ts` 创建运行时后调用 `init`，`model-loader` 加载成功后 `retry`
- 反射访问 babylon-mmd 内部 `_rigidBodyBundleMap`（升级若重命名会抛错提示版本兼容性）
- 风力系数 `WIND_FORCE_SCALE = 0.15`（Bullet 刚体惯性大，需比 XPBD 布料更大）
