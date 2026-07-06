# 风力影响 WASM Bullet 物理的可行性分析

## 背景

风系统（wind）当前已统一到 `getWindVector()`（`core/physics/wind-utils.ts`），但**只影响视觉效果**（云、粒子、水面）和 **XPBD 布料**。WASM Bullet 物理（MMD 模型骨髁物理）不受风影响。

## 当前风力覆盖

| 系统 | 受影响？ | 实现位置 |
|------|:-------:|---------|
| XPBD 布料 (JS) | ✅ | `xpbd-cloth.ts:379-399` → 直接加位移到粒子 |
| 粒子系统 | ✅ | `env-particles.ts:628` → `getWindVector().scale(0.1)` |
| 云漂移 | ✅ | shader uniform `windDirection` |
| 水面 | ✅ | `env-water.ts` 导入 `getWindVector` |
| WASM Bullet | ❌ | 无 |

## WASM Bullet 架构

```
MmdWasmRuntime (babylon-mmd)
  ├── _physicsRuntime: MultiPhysicsRuntime  (private)
  │     ├── setGravity(gravity)
  │     ├── stepSimulation(timeStep, maxSubSteps, fixedTimeStep)
  │     └── physicsWorld: MultiPhysicsWorld
  │           └── rigidBodyBundle: RigidBodyBundle
  │                 └── applyCentralForce(index, force)
  ├── models: MmdWasmModel[]
  │     └── rigidBodyStates: Uint8Array  (只控制启停)
  └── _externalPhysics: MmdWasmPhysics (private)
```

`babylon-mmd` 的 `RigidBodyBundle` 暴露了 `applyCentralForce(index, force)`（`rigidBodyBundle.d.ts:269`），但：
- `MmdWasmRuntime._physicsRuntime` 是 **private** 字段
- `MmdWasmRuntime._externalPhysics` 也是 **private**
- `rigidBodyStates` 只是 `Uint8Array`，只控制刚体启停（0=disable, 1=enable）

## 实现方案

### 方案 A：通过 MmdWasmRuntime 反射（侵入性）

```typescript
// 通过 (runtime as any)._physicsRuntime 获取 MultiPhysicsRuntime
// 再获取 physicsWorld.rigidBodyBundle.applyCentralForce(...)
```

- 优点：不改 babylon-mmd 源码
- 缺点：依赖内部私有字段，babylon-mmd 版本升级可能 break

### 方案 B：fork babylon-mmd 加 setWind API

给上游提 PR，或在 fork 的 `MmdWasmPhysics` 上加 `setWind(windForce: Vector3)` 方法，在 `stepSimulation` 前给所有 dynamic 刚体施加力。

- 优点：类型安全，符合封装
- 缺点：维护 fork 成本，babylon-mmd 已 4 个月未更新

### 方案 C：用 onBeforeRenderObservable 每帧注入

在 `scene.onBeforeRenderObservable` 里，通过 `(runtime as any)._physicsRuntime.physicsWorld.rigidBodyBundle.applyCentralForce(i, force)` 逐个刚体施加风力。

- 优点：不改依赖库
- 缺点：每帧 O(n) 遍历，和方案 A 同样依赖私有字段

## 需要考虑的问题

1. **需要绕过 babylon-mmd 的 private 字段** — 当前 `MultiPhysicsRuntime` 和 `rigidBodyBundle` 都在闭包里
2. **风力系数** — 布料用了 `windFactor=0.2`，Bullet 刚体的质量惯性更大，系数可能需要不同
3. **哪些刚体受风** — 裙子刚体应该受风（符合物理直觉），胸/头发/配件看用户需求
4. **性能** — 每帧给 n 个刚体施加力的开销，取决于模型刚体数（通常 50-200 个）
5. **babylon-mmd 状态** — 最后更新 4 个月前，短期不太可能改，但长远可能要维护 fork

## 建议

等决定实施时优先尝试 **方案 A + C**（用 runtime 反射 + onBeforeRenderObservable），不做 fork，减少维护负担。如果 private 字段访问太脆弱再考虑 fork。
