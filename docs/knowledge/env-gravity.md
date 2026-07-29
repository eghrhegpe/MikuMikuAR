---
kind: env_gravity
name: 环境重力与碰撞控制
category: env
scope:
  - frontend/src/scene/env/env-gravity.ts
source_files:
  - frontend/src/scene/env/env-gravity.ts
adr:
  - ADR-148
symbols:
  - setGravityStrength
  - getGravityStrength
  - setCollisionEnabled
  - getCollisionEnabled
  - setBodyCollisionEnabled
  - getBodyCollisionEnabled
  - setGroundCollisionEnabled
  - getGroundCollisionEnabled
invariants:
  - 重力强度始终钳制在 [0, 2] 范围
  - setGroundCollisionEnabled 值未变化时直接返回（幂等优化）
  - 仅 WASM 路径生效，JS 版无物理引擎
tests: []
use_when:
  - 重力控制
  - 碰撞开关
  - 身体/地面碰撞
---

## 系统概览
Env Gravity & Collision：从 env-bridge 拆出的重力强度与碰撞开关模块（ADR-148 Phase 5 瘦身）。职责单一：重力向量写入 WASM 物理引擎 + 三级碰撞开关（总开关/身体碰撞/地面碰撞）持久化。

## 核心职责
- 重力强度：`setGravityStrength(value)` 钳制 [0, 2] 后写入 `mmdRuntime.physics.setGravity()`（仅 WASM 路径生效，JS 版无物理引擎）
- 碰撞总开关：`setCollisionEnabled()` → `envState.collisionEnabled` + 持久化
- 身体碰撞：`setBodyCollisionEnabled()` → `envState.bodyCollisionEnabled` + 持久化
- 地面碰撞：`setGroundCollisionEnabled()` → 触发 `applyGroundCollision()`（重建地面碰撞体）+ 持久化

## 对外 API（节选）
- `setGravityStrength(v: number)` — 设置重力强度 [0, 2]
- `getGravityStrength(): number` — 读取当前重力强度
- `setCollisionEnabled(v: boolean)` — 碰撞总开关
- `getCollisionEnabled(): boolean`
- `setBodyCollisionEnabled(v: boolean)` — 身体碰撞开关
- `getBodyCollisionEnabled(): boolean`
- `setGroundCollisionEnabled(v: boolean)` — 地面碰撞开关（含碰撞体重建）
- `getGroundCollisionEnabled(): boolean`

## 不变量
- 重力强度始终钳制在 [0, 2] 范围内
- `setGroundCollisionEnabled` 值未变化时直接返回（幂等优化）
- 每个 setter 后都触发 `triggerAutoSave()`（持久化）

## 与其他子系统关系
- 依赖 `MmdWasmRuntime.physics`（WASM 专属，instanceof 守卫）
- 依赖 `physics/ground-collision.ts` 的 `applyGroundCollision()`
- 依赖 `env-bridge.ts` 的 `setEnvState()`
- 被 `env.ts` 门面 re-export

## 验证入口
- 命令：`cd frontend && npm run test`
