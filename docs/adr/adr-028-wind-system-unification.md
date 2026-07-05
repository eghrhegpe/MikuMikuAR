# ADR-028: 风场系统统一 — 从碎片化到集中治理

> **状态**: 已实现 — wind-utils.ts 统一风向量 + 云/粒子/水面/布料四子系统联动
> **日期**: 2026-07-05
> **关联**: ADR-026(环境系统扩展)

---

## 0. 问题陈述

风场参数（风向、风速、开关）原本通过 `envState.windDirection` / `envState.windSpeed` / `envState.windEnabled` 统一存储，但**消费方各自独立读取 + 自行计算风力矢量**，导致三个问题：

| 症状 | 具体表现 |
|------|---------|
| **风逻辑重复 3 次** | 云漂移、粒子偏转、体积云平流各写一套 `windDirection × windSpeed × factor` |
| **子系统遗漏** | 水面 Gerstner 波方向硬编码 (`const vec2 WAVE_DIR[4]`)，完全不响应风向变化；XPBD 布料粒子无风场力 |
| **新系统接入成本高** | 每加一个受风影响的子系统都要重读 `envState`、重算风力矢量 |

根本原因：**风是唯一的"广播式"环境状态**——一个输入驱动 4+ 个独立子系统（云/粒子/水面/布料），而代码结构没有反映这种一对多的关系。

---

## 1. 否决的方案：全局物理属性管理器

考虑过引入 `GlobalPhysics` 事件总线：

```ts
globalPhysics.on('wind:change', (dir) => {
    clouds.updateWind(dir);
    particles.updateWind(dir);
    water.updateWaveDir(dir);
    cloth.updateWindForce(dir);
});
```

**否决理由**：层架冗余。现有 `envState` + `setEnvState()`（统一写入口）+ `ensureEnvUpdateObserver()`（统一每帧循环）已构成足够的管理层。再加一层事件系统只是重复既有链路，没有实质收益。

---

## 2. 决策：统一辅助函数 + 补齐缺口

不做架构变更，增量落地三件事：

### 2.1 统一风力入口

新增 `frontend/src/core/physics/wind-utils.ts`：

```ts
export function getWindVector(): Vector3;    // windDirection × windSpeed × 1.0
export function getWindStrength(): number;   // windSpeed (0 if disabled)
export function isWindActive(): boolean;     // enabled && speed > 0.01
```

所有子系统**统一调用** `getWindVector()` 获取风矢量，不再各自做 `dir[0] * speed * factor`。

### 2.2 水面风向联动

| 改前 | 改后 |
|------|------|
| `const vec2 WAVE_DIR[4]` 在 GLSL 中硬编码 | `uniform vec2 uWindDir[4]`，由 JS 端 `computeWaveDirs()` 根据 `envState.windDirection` 计算并传入 |
| 波浪方向固定，不随 UI 风向角变化 | 风向角滑条 → `setEnvState` → `_syncWaterUniforms` → `setArray2('uWindDir', ...)` 实时更新 |

`computeWaveDirs()` 生成 4 个 vec2：主方向与风向对齐，3 个副方向以微小弧度偏移（`+0.3, -0.2, +0.1` rad），保持波面自然丰富度。

### 2.3 布料风场

在 `xpbd-cloth.ts` 的 `buildClothUpdateFn()` 中，solver step 前对所有非锚定粒子施加风场位移：

```ts
windFactor = 0.2; // 布料惯性系数
particle.p += windVector * windFactor * dt * randomFactor(0.6~1.4);
```

随机因子防止所有粒子平行飘动，产生自然的布料褶皱变化。

### 2.4 粒子系统简化

`env-particles.ts` 的 `applyWindToParticles()` 从直接读 `envState` 改为调用 `getWindVector().scale(0.1)`。

---

## 3. 架构图

```
envState (config.ts)
└── windDirection, windSpeed, windEnabled
    │
    ├── wind-utils.ts ─── getWindVector() / isWindActive()
    │       │
    │       ├── env-impl.ts (云漂移)       — 直接读 envState 改为调 getWindVector
    │       ├── env-particles.ts (粒子偏转) — applyWindToParticles 用 getWindVector
    │       ├── env-water.ts (水面波向)     — computeWaveDirs → uniform ← 新增
    │       └── xpbd-cloth.ts (布料风力)    — 粒子循环加风场力 ← 新增
    │
    └── setEnvState() 统一写入口
            │
            └── _syncWaterUniforms() — 风向变化时更新 uWindDir uniform
```

---

## 4. 影响范围

| 文件 | 改动 | 行数 |
|------|------|------|
| `frontend/src/core/physics/wind-utils.ts` | **新增** | ~20 |
| `frontend/src/scene/env/env-water.ts` | WAVE_DIR 硬编码 → uniform + computeWaveDirs | ~30 |
| `frontend/src/physics/xpbd-cloth.ts` | 粒子循环加风场力 | ~20 |
| `frontend/src/scene/env/env-particles.ts` | applyWindToParticles 改用 getWindVector | ~2 |

零架构变更，无新增依赖。

---

## 5. 验证

- `tsc --noEmit` 通过（仅预存测试 mock 错误）
- `vite build` 通过（461 modules，~1.5s）
- 运行时：风向角滑条 → 云漂移、粒子偏转、水面波向、布料飘动**四系统同步响应**

---

## 6. 后续

当前没有第二个需要同样治理的 envState 字段——其他字段的消费模式都是单一模块内闭，不存在一对多的广播关系。若未来加入植被系统（草/树/旗帜随风摆动），接入方式为：

```
envState.windDirection → wind-utils.getWindVector() → 植被风力计算
```

不需要改现有代码，不需要新架构层。
