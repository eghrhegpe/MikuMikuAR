---
kind: env_particles
name: 粒子系统
category: env
scope:
  - frontend/src/scene/env/env-particles.ts
source_files:
  - frontend/src/scene/env/env-particles.ts
adr: []
symbols:
  - initParticles
  - disposeParticles
  - updateParticles
invariants:
  - 粒子发射器在 dispose 时释放
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

## 核心职责
- `env-particles.ts` — 粒子发射器创建、粒子类型切换、动画更新、资源释放。

## 对外 API（节选）
- `initParticles(scene, options)` — 初始化粒子系统。
- `disposeParticles()` — 释放粒子发射器。
- `updateParticles(deltaTime)` — 更新粒子动画。
- `setParticleType(type)` — 切换粒子类型。

## 与其他子系统关系
- 被 `env-impl.ts` 调用初始化。
- 参数来源：`envState.particles`。

## 不变量
- 粒子发射器在 `disposeParticles` 中释放，避免内存泄漏。
- 粒子数量根据性能等级动态调整。
