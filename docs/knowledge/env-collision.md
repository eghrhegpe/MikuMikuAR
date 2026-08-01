---
tier: architecture
kind: env_collision
name: 环境碰撞控制
category: env
scope:
  - frontend/src/scene/env/env-collision.ts
source_files:
  - frontend/src/scene/env/env-collision.ts
adr:
  - ADR-212
symbols:
  - setCollisionEnabled
  - getCollisionEnabled
  - setBodyCollisionEnabled
  - getBodyCollisionEnabled
  - setGroundCollisionEnabled
  - getGroundCollisionEnabled
invariants:
  - 碰撞开关仅 WASM Bullet 物理路径生效
  - 每个 setter 后触发 triggerAutoSave()（持久化）
  - setGroundCollisionEnabled 变化时调用 applyGroundCollision() 即时生效
tests: []
use_when:
  - 碰撞开关
  - 身体碰撞
  - 地面碰撞
  - WASM 物理碰撞
---

# 环境碰撞控制
## 系统概览
Env Collision：从 `env-gravity.ts` 拆出的碰撞开关模块（ADR-212 命名 vs 功能审计）。控制 WASM Bullet 物理引擎的碰撞总开关、身体碰撞、地面碰撞三种独立开关。

## 核心职责
- `env-collision.ts` — 碰撞总开关、身体碰撞开关、地面碰撞开关的 getter/setter，通过 `setEnvState` 单向写入状态。

## 对外 API（节选）
- `setCollisionEnabled(v: boolean)` — 碰撞总开关
- `getCollisionEnabled(): boolean` — 读取碰撞总开关
- `setBodyCollisionEnabled(v: boolean)` — 身体碰撞开关
- `getBodyCollisionEnabled(): boolean` — 读取身体碰撞开关
- `setGroundCollisionEnabled(v: boolean)` — 地面碰撞开关（变化时调用 `applyGroundCollision()`）
- `getGroundCollisionEnabled(): boolean` — 读取地面碰撞开关

## 与其他子系统关系
- 依赖 `env-bridge.setEnvState` 写入 EnvState
- 依赖 `physics/ground-collision.applyGroundCollision` 即时生效地面碰撞
- 被 `scene.ts` 门面 re-export
- 被 `menus/scene-physics-levels.ts` 消费（UI 层级）

## 不变量
- 碰撞开关仅 WASM 路径生效，JS 版无物理引擎
- 每个 setter 后触发 `triggerAutoSave()`（持久化）
- `setGroundCollisionEnabled` 在值变化时额外调用 `applyGroundCollision()` 即时生效

## 验证入口
- 命令：`cd frontend && npm run test`