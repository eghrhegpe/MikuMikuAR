# ADR-194: 风物理系统修复 — 从「假风」到真实风场

> **状态**: 已完成（2026-07-27 — tsc 零错误，env-bridge 80 + wind-physics 1 + app.contract 17 全绿；P2 修复后全量 2174/2174 全绿）
> **日期**: 2026-07-27（初版）/ 2026-07-27（P2 修复 — 水面 `uWindSpeed` 加 `windEnabled` 守卫）
> **关联**: ADR-028（风场系统统一）、ADR-138（env-dispatcher 破循环依赖）、ADR-192（wind-physics.ts 私有字段反射经 Phase 2 内化为 mmd-adapter 公开 API，本 ADR 的 `WIND_FORCE_SCALE` 修改在同一文件）

---

## 背景

ADR-028 已将风场参数统一为 `getWindVector()` 入口，水面/粒子/云/布料四子系统均通过此函数获取风矢量。但用户实测反馈：

> 一点效果都没有，10 级风速粒子 + 水面 + Bullet 物理全部没动静

经诊断发现风系统存在三处设计缺陷和一处时序 bug，导致风场形同虚设。

---

## 问题分析

### 问题 1：水面 shader 从未接入风速（设计遗漏）

[env-water.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/env/env-water.ts) 的 `_syncWaterUniforms` 只将 `windDirection` 传入 `uWindDir`（波方向），**从未将 `windSpeed` 传入 shader**。

[water.vert.glsl](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/env/shaders/water.vert.glsl) 中波幅度是硬编码常量：

```glsl
const float WAVE_AMP[4] = float[4](0.3, 0.25, 0.2, 0.15);
float a = WAVE_AMP[i] * h * waveHeight; // windSpeed 完全无关
```

**后果**：风速 0 和风速 10，水面波形完全一样。

### 问题 2：粒子风仅改发射初方向（「假风」）

[env-particles.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/env/env-particles.ts) 的 `applyWindToParticles` 只改写 `direction1/direction2`（初速度方向），**粒子出生后只受 `gravity` 牵引**。

| 维度 | 旧行为 | 问题 |
|------|--------|------|
| 发射方向 | wind × 0.1 叠加到 direction | 仅新粒子受影响 |
| 飞行轨迹 | 仅受 gravity（垂直下落） | 已飞行粒子不受风 |
| 风速响应 | 仅新粒子 | 调风速滑条后旧粒子无变化 |

加上系数 `0.1` 过小（风速 10 时方向偏移仅 1.0，被强 gravity −25 掩盖），视觉上几乎不可察觉。

### 问题 3：Bullet 物理风力系数过小

[wind-physics.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/physics/wind-physics.ts) 的 `WIND_FORCE_SCALE = 0.15`，风速 10 时仅产生 1.5N 力。Dynamic 刚体（头发/裙子）质量约 0.5–2kg，1.5N 仅产生 0.75–3m/s² 加速度，肉眼难辨。

### 问题 4：`_baseGravity` 变量缺失导致粒子风守卫拦截（时序 bug）

新增 `_baseGravity` 后，其唯一赋值点 `_baseGravity = ps.gravity.clone()` 位于 `createParticleEmitter` 内部。但该函数在粒子类型未变时直接返回（第 409 行）：

```ts
if (_envSys.particles.system && _currentParticleType === type) {
    return; // ← 调整风速时走此路径，_baseGravity 永不赋值
}
```

表现为：`_baseGravity` 始终为 `null` → `applyWindToParticles` 被 `if (!_baseGravity) return` 守卫拦截 → 风从未施加。

此问题在 HMR 热更新后尤为突出：模块重新加载后 `_baseGravity` 初始化为 `null`，但粒子系统已存在，调整风速不会触发重新创建。

---

## 决策

### 1. 水面风速联调

在 vertex shader 中新增 `uniform float uWindSpeed`，波幅度受风速线性调制：

```glsl
float windAmp = 0.4 + 0.1 * uWindSpeed; // 0 级风 → 0.4 倍（平静），10 级风 → 1.4 倍（汹涌）
float a = WAVE_AMP[i] * h * waveHeight * windAmp;
```

JS 端在 `_syncWaterUniforms` 中新增 `mat.setFloat('uWindSpeed', state.windSpeed)`，并在 `WATER_UNIFORMS` 列表中注册。

### 2. 粒子系统改为「双重风场」

不再仅改方向，而是**同时修改 direction 和 gravity**：

| 渠道 | 系数 | 作用对象 | 物理意义 |
|------|------|---------|---------|
| `direction1/2` 偏移 | 0.2 | 新发射粒子 | 出生瞬间已带横向初速度 |
| `gravity` 叠加 | 1.0 | **所有活跃粒子** | 飞行中持续受风加速度 |

`gravity` 是 Babylon `ParticleSystem` 的内置属性，每帧对所有活跃粒子施加。叠加风矢量到 gravity 等于每帧持续风场——风速变化实时响应，轨迹是真实弧线，风停后立即恢复。

同时新增 **惰性初始化** 机制解决时序 bug：

```ts
if (!_baseGravity) {
    _baseGravity = ps.gravity.clone();
}
```

首次 `applyWindToParticles` 调用时，若 `_baseGravity` 未初始化，直接从现有粒子系统读取，不依赖 `createParticleEmitter` 的执行时序。

### 3. 雨粒子纹理方向矫正

雨的粒子纹理是竖线条，默认 `BILLBOARDMODE_ALL`（始终面向相机）使竖线在屏幕永远竖直。风吹时雨斜着飞但纹理仍是竖直的，产生方向错位感。

在创建粒子系统时对 `rain` 类型设置 `BILLBOARDMODE_STRETCHED`，使纹理沿速度方向拉伸对齐实际轨迹：

```ts
if (type === 'rain') {
    ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
}
```

### 4. Bullet 物理风力系数

`WIND_FORCE_SCALE` 从 0.15→1.0。风速 10 时产生 10N 力，Dynamic 刚体（头发/裙子）摆动明显。Kinematic 刚体（骨骼跟随）由 Bullet 自动忽略，无需额外跳过。

---

## 影响范围

| 文件 | 改动 |
|------|------|
| `frontend/src/scene/env/shaders/water.vert.glsl` | 新增 `uWindSpeed` uniform + `windAmp` 波幅度调制 |
| `frontend/src/scene/env/env-water.ts` | `_syncWaterUniforms` 新增 `setFloat('uWindSpeed')`；`WATER_UNIFORMS` 注册；**P2 修复**：`uWindSpeed` 受 `windEnabled` 守卫（`windEnabled ? state.windSpeed : 0`），对齐粒子/Bullet/云的开关行为 |
| `frontend/src/scene/env/env-particles.ts` | `applyWindToParticles` 改为双重风场（direction + gravity）；新增 `_baseGravity` 惰性初始化；`disposeParticles` 兼容清理；`createParticleEmitter` 新增 rain 的 STRETCHED billboard |
| `frontend/src/core/wind-utils.ts` | 无改动（统一入口已验证有效） |
| `frontend/src/physics/wind-physics.ts` | `WIND_FORCE_SCALE` 0.15→1.0 |

---

## 架构图（更新自 ADR-028）

```
envState (config.ts)
└── windDirection, windSpeed, windEnabled
    │
    ├── wind-utils.ts ─── getWindVector() / isWindActive()
    │       │
    │       ├── env-impl.ts (云漂移)
    │       │       └── ensureEnvUpdateObserver 每帧 → 读 getWindVector()
    │       │
    │       ├── env-particles.ts (粒子偏转 + 持续风场)
    │       │       ├── applyWindToParticles()
    │       │       │   ├── direction1/2 ← _initialDir + wind×0.2        (发射瞬间)
    │       │       │   └── gravity ← _baseGravity + wind×1.0            (持续飞行)
    │       │       └── rain: BILLBOARDMODE_STRETCHED (纹理顺风)
    │       │
    │       ├── env-water.ts (水面波向 + 波幅) ──【例外：不经过 getWindVector()】
    │       │       ├── uWindDir ← computeWaveDirs(windDirection)
    │       │       └── uWindSpeed ← (windEnabled ? windSpeed : 0) → windAmp 调制波幅度
    │       │           注：波幅是幅度调制而非力，量纲与 Bullet 不同，故水面特例直读
    │       │
    │       ├── wind-physics.ts (Bullet 刚体风力)
    │       │       └── onSync → applyCentralForce(getWindVector() × 1.0)
    │       │
    │       └── xpbd-cloth.ts (布料风力, ADR-028)
    │
    └── setEnvState() 统一写入口
            └── dispatchEnvChange → water/particle 回调
```

---

## 验证

- `tsc --noEmit`：零错误
- `vitest`：env-bridge 80 + wind-physics 1 + app.contract 17 全绿
- 全量 2167 测试通过（初版）；P2 修复后全量 2174/2174 全绿

运行时验证（需模型加载 + 粒子 + 水面）：
1. **粒子**：风速调至 10 → 雨/雪有明显斜飞角度，纹理顺风对齐
2. **水面**：风速调至 0 → 近于平静；调至 10 → 涌浪幅度明显增大
3. **Bullet 物理**：带头发/裙子动态刚体的模型 → 随风摆动
4. **四系统一致性**：关闭 `windEnabled` → 粒子停飞、云停漂、裙停摆、**浪平息**（P2 修复验证）

---

## 余留问题

- `env-impl.ts` 的 `ensureEnvUpdateObserver` 在非粒子天气下（如 `particleType = 'none'`）可能未被调用。当前依赖 `createParticleEmitter` 或 `applyGround`/`createClouds` 触发。若用户只开水面不开粒子，水面风幅不进行每帧更新（但 `_syncWaterUniforms` 在 `setEnvState` 响应时已写入，静态下不影响效果）。
- 雪/樱花瓣/落叶等粒子纹理非方向性，未启用 `BILLBOARDMODE_STRETCHED`。若未来有方向性纹理（细长花瓣等），同理处理。
