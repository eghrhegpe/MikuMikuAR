---
kind: env_particles
name: 粒子系统
category: env
scope:
  - frontend/src/scene/env/env-particles.ts
source_files:
  - frontend/src/scene/env/env-particles.ts
adr:
  - ADR-026
symbols:
  - createParticleEmitter
  - disposeParticles
  - getCurrentParticleType
  - updateParticleWind
  - updateParticleParams
  - updateParticleTexture
  - syncSplashState
  - applyWindToParticles
  - disposeSplash
invariants:
  - disposeParticles 可选保留湿身效果（keepWetness）
  - 粒子数量根据性能等级动态调整
  - splash 粒子（水滴溅射）独立于主粒子发射器管理
tests: []
use_when:
  - 粒子
  - 雪花
  - 花瓣
  - 雨滴
  - 特效粒子
---

## 系统概览
**环境粒子系统**。生成各种环境粒子效果（雪花、花瓣、雨滴、光点等），增强场景氛围。
支持风力驱动粒子运动，与 splash（水滴溅射）联动。

## 核心职责
- `env-particles.ts` — 粒子发射器创建、类型切换、参数/纹理/风力更新、splash 管理、资源释放。

## 对外 API（节选）
- `createParticleEmitter(type, windEnabled)` — 按类型创建粒子发射器，返回 `ParticleSystem`。
- `disposeParticles(keepWetness?)` — 释放粒子发射器（可选保留湿身效果）。
- `getCurrentParticleType()` — 取当前粒子类型。
- `updateParticleWind()` / `updateParticleParams()` / `updateParticleTexture()` — 增量更新（按 envState 变化触发）。
- `syncSplashState()` — 同步 splash（水滴溅射）状态。
- `disposeSplash()` — 释放 splash 粒子。
- `applyWindToParticles(ps)` — 对指定粒子系统施加风力。

## 与其他子系统关系
- 被 `env-impl.ts` 调用初始化。
- 参数来源：`envState.particles`。

## 不变量
- 粒子发射器在 `disposeParticles` 中释放，避免内存泄漏。
- 粒子数量根据性能等级动态调整。
