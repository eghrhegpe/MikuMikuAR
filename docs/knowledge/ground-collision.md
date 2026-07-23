---
kind: ground_collision
name: 地面碰撞体（WASM Bullet 静态刚体）
category: physics
scope:
  - frontend/src/scene/physics/**
source_files:
  - frontend/src/scene/physics/ground-collision.ts
adr: []
---

## 系统概览
通过 `MmdWasmPhysicsRuntimeImpl.addRigidBodyToGlobal` 把一块静态地板刚体注入所有模型的物理世界，使头发/裙子等 Dynamic 刚体在重力下落到地面时获得支撑，不再无限下坠。由 `env-bridge.setGroundCollisionEnabled` 驱动；运行时就绪 / 场景加载后由 `applyGroundCollision()` 还原持久化状态。

## 核心职责
- `ground-collision.ts` — 全局静态地面刚体注入 / 移除 / 状态还原（幂等）

## 对外 API（节选）
- `isGroundCollisionEnabled()` — 当前是否启用
- `enableGroundCollision(groundY=0)` — 注入静态地板（幂等；失败释放已分配资源，保持未启用态）
- `disableGroundCollision()` — 从所有世界移除并释放
- `applyGroundCollision()` — 按 `envState.groundCollisionEnabled` 还原

## 与其他子系统关系
- 驱动方：`env-bridge.setGroundCollisionEnabled`
- 仅 WASM 运行时生效；JS 运行时空转
- 释放顺序：removeRigidBodyFromGlobal → rb.dispose → info.dispose → shape.dispose
- 地板半尺寸 2000m（覆盖全场景），碰撞组/掩码全开，friction 0.9
