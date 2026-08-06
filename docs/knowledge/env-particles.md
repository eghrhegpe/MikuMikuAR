---
tier: leaf
kind: env_particles
name: 粒子系统
category: env
scope:
  - frontend/src/scene/env/env-particles.ts
source_files:
  - frontend/src/scene/env/env-particles.ts
adr:
  - ADR-026
  - ADR-138
  - ADR-160
symbols:
  - applyWetnessToInst
  - applyWindToParticles
  - createParticleEmitter
  - disposeParticles
  - disposeSplash
  - getCurrentParticleType
  - isWetnessActive
  - syncSplashState
  - updateParticleParams
  - updateParticleTexture
  - updateParticleWind
invariants:
  - disposeParticles 可选保留湿身效果（keepWetness）
  - 粒子数量根据性能等级动态调整
  - splash 粒子（水滴溅射）独立于主粒子发射器管理（对象池 _splashBurstPool）
  - fireworks burst 调度（scheduleNextFireworkBurst/stopFireworkBursts）与碰撞检测 observer 配对释放；splash/firework 50ms emitRate 停发 timer 存于 burst 实例（emitStopTimer）dispose 时一并清除
  - applyWetnessToInst/isWetnessActive 由 env-wetness.ts 导出，本文件仅 re-export（ADR-160 湿身联动）
  - 湿身切换按「进入 rain 激活 / 离开 rain 移除」独立判断（rain→snow 切换须移除湿身）
  - createParticleEmitter 返回 void（系统挂到 _envSys.particles.system），非 ParticleSystem
tests:
  - frontend/src/__tests__/scene/env-particles.test.ts
use_when:
  - 粒子
  - 雪花
  - 花瓣
  - 雨滴
  - 特效粒子
---

# 粒子系统

## 系统概览
**环境粒子系统**。生成各种环境粒子效果（雪花、花瓣、雨滴、光点等），增强场景氛围。
支持风力驱动粒子运动，与 splash（水滴溅射）联动。

## 核心职责
- `env-particles.ts` — 粒子发射器创建、类型切换、参数/纹理/风力更新、splash 管理、资源释放。

## 对外 API（全量导出）
> 本文件 9 个直接导出 + 2 个 re-export（来自 `env-wetness.ts`，ADR-160 湿身联动），与 `symbols` 字段一致。

### 直接导出（`env-particles.ts`）
- `createParticleEmitter(type: EnvState['particleType'], windEnabled: boolean): void` — 按类型创建粒子发射器；系统挂到 `_envSys.particles.system`，**返回 void 而非 `ParticleSystem`**（见 invariant）。
- `disposeParticles(keepWetness = false): void` — 释放粒子发射器（可选保留湿身效果）。
- `getCurrentParticleType(): EnvState['particleType']` — 取当前粒子类型。
- `updateParticleWind(): void` — 按 `envState` 增量更新风力。
- `updateParticleParams(): void` — 按 `envState` 增量更新粒子参数。
- `updateParticleTexture(): void` — 按 `envState` 增量更新粒子纹理。
- `syncSplashState(): void` — 同步 splash（水滴溅射）状态。
- `disposeSplash(): void` — 释放 splash 粒子。
- `applyWindToParticles(ps: ParticleSystem): void` — 对指定粒子系统施加风力。

### re-export（`env-wetness.ts`，ADR-160）
- `isWetnessActive(): boolean` — 湿身效果是否激活。
- `applyWetnessToInst(inst: ModelInstance): void` — 对模型实例施加湿身效果。

## 与其他子系统关系
- 被 `env-impl.ts` 调用初始化。
- 参数来源：`envState.particles`。

## 不变量
- 粒子发射器在 `disposeParticles` 中释放，避免内存泄漏。
- 粒子数量根据性能等级动态调整。
