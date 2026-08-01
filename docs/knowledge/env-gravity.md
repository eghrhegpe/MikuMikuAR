---
tier: architecture
kind: env_gravity
name: 环境重力控制
category: env
scope:
  - frontend/src/scene/env/env-gravity.ts
source_files:
  - frontend/src/scene/env/env-gravity.ts
adr:
  - ADR-148
  - ADR-212
symbols:
  - setGravityStrength
  - getGravityStrength
invariants:
  - 重力强度始终钳制在 [0, 2] 范围
  - 仅 WASM 路径生效，JS 版无物理引擎
tests: []
use_when:
  - 重力控制
  - WASM 物理重力
---
## 系统概览
Env Gravity：从 env-bridge 拆出的重力强度模块（ADR-148 Phase 5 瘦身）。ADR-212 将碰撞功能迁至 `env-collision.ts`，本模块只保留重力向量写入 WASM 物理引擎。

## 核心职责
- 重力强度：`setGravityStrength(value)` 钳制 [0, 2] 后写入 `mmdRuntime.physics.setGravity()`（仅 WASM 路径生效，JS 版无物理引擎）

## 对外 API（节选）
- `setGravityStrength(v: number)` — 设置重力强度 [0, 2]
- `getGravityStrength(): number` — 读取当前重力强度

## 不变量
- 重力强度始终钳制在 [0, 2] 范围内
- 每个 setter 后都触发 `triggerAutoSave()`（持久化）

## 与其他子系统关系
- 依赖 `MmdWasmRuntime.physics`（WASM 专属，instanceof 守卫）
- 被 `env.ts` 门面 re-export
- 碰撞功能已迁至 `env-collision.ts`

## 验证入口
- 命令：`cd frontend && npm run test`
