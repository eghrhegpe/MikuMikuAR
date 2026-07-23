# ADR-026: 环境系统增强 — 纹理地面、粒子系统、粒子溅射、水下后处理联动

> **日期**: 2026-07-04
> **状态**: 已完成 — Phase A 纹理地面 + Phase B 粒子系统+溅射 + Phase C 水下后处理全部完成

---

## 背景

当前环境系统四个子系统存在功能缺口：

| 子系统 | 当前状态 | 缺口 |
|--------|----------|------|
| 地面 | 纯色/网格二选一（`groundColor`/`groundGrid`） | 无纹理地面（如草地） |
| 粒子 | 仅 rain/snow 两种基础类型 | 缺 sakura/fireworks/fireflies/leaves；无程序化纹理；无运行时调参 |
| 雨雪粒子 | GPU 粒子系统，出生即下落 | 无落地溅射效果 |
| 水下后处理 | `camera.y < waterLevel` 触发简单 pipeline 参数切换 | 未随水色/透明度动态变化 |

目标：补齐四个缺口，提升场景真实感。

---

## 决策一：纹理地面（Phase A）— 已确认

### 方案

在 `EnvState` 新增 `groundTexture: string`（URL 或内置名），`groundTextureEnabled: boolean`，`groundTextureScale: number`（默认 1，控制 UV 重复）。

`buildGroundMesh()` 逻辑：
- `groundTextureEnabled=true` 且有有效纹理 → 创建 `Ground` + `StandardMaterial` + `Texture`，**替换**纯色/网格地面
- `groundTextureEnabled=false` → 回退纯色/网格（现有逻辑不变）

### ⚠️ 关键约束：subdivisions 与 UV 重复分离

`GroundMesh.subdivisions` 控制几何细分，**不影响**纹理 UV 重复次数。

正确做法：
- `subdivisions` 保持 `2` 不变（性能优先，地面不需要高模）
- 纹理重复由 `diffuseTexture.uScale = vScale = 1 / groundTextureScale` 控制
- 旋转由 `diffuseTexture.wAng` 控制

| 参数 | 控制方式 | 性能影响 |
|------|----------|----------|
| 几何细分 | `ground.subdivisions` | 改变顶点数 |
| 纹理重复 | `texture.uScale` / `vScale` | 仅材质 uniform，零成本 |
| 纹理旋转 | `texture.wAng` | 仅材质 uniform，零成本 |

### 纹理来源

| 来源 | 方案 | 优先级 |
|------|------|--------|
| 内置 | 打包 2-3 张 512px 纹理（草地、石板、沙滩）进 `frontend/public/textures/` | P0 |
| 用户文件 | 通过文件选择器加载外部图片 | P1 |

### 涉及文件

| 文件 | 改动 |
|------|------|
| `frontend/src/core/config.ts` | `EnvState` 加 `groundTexture`/`groundTextureEnabled`/`groundTextureScale` |
| `frontend/src/scene/env/env-ground.ts` | `buildGroundMesh()` 支持纹理路径 + uScale/vScale |
| `frontend/src/menus/env-feature-levels.ts` | `buildGroundLevel()` 加纹理选择行 + 缩放滑条 |
| `frontend/src/scene/env/env-bridge.ts` | `applyEnvState()` 转发纹理参数 |

---

## 决策二：核心粒子系统架构（Phase B 前置）— 已实现

### 设计目标

6 种粒子类型（sakura/rain/snow/fireworks/fireflies/leaves），全部程序化纹理，无需外部图片资源。两类发射策略（全景天气 / 局部效果），运行时参数可调。

### 纹理生成：Canvas 2D 程序化绘制

不依赖外部图片文件。`makeParticleTexture(kind)` 用 Canvas 2D 绘制 64×64 纹理，缓存到 `_particleTextures` Map 防止重复创建。

| 类型 | 绘制方式 | 视觉效果 |
|------|---------|---------|
| sakura | 5 瓣椭圆旋转 + 黄色花蕊圆 | 粉色樱花瓣 |
| rain | 线性渐变 rect（透明→半透→透明） | 竖向雨滴条纹 |
| snow | 6 臂晶体线条（60° 间隔 + 分叉） | 六角雪花 |
| fireworks | 径向渐变 + 十字线 | 爆炸光点 |
| fireflies | 径向渐变（绿→透明） | 萤火虫光晕 |
| leaves | 椭圆 + 叶脉线（倾斜 0.3rad） | 秋叶 |
| splash | 径向渐变（白→透明，小半径） | 溅射水滴 |

### 两类发射策略

| 策略 | 适用类型 | 发射器 | 位置跟随 |
|------|---------|--------|---------|
| **全景天气** | sakura/rain/snow/leaves | Box 80×80 | XZ 跟随相机，Y 固定地面上方 25 单位 |
| **局部效果** | fireworks/fireflies | Sphere | XZ 跟随相机，Y 相对地面偏移（萤火虫 1.5 / 烟花 8） |

判断逻辑：`isWeather = ['sakura', 'rain', 'snow', 'leaves'].includes(type)`

### GPUParticleSystem 容量规划

```
capacity >= max(emitRate) × max(maxLifeTime) × 2.5
雨：1000 × 2 × 2.5 = 5000 → 实际 capacity=10000（留余量给 multiplier）
```

### 运行时调参机制

保存创建时的基础值（`_baseEmitRate` / `_baseMinSize` / `_baseMaxSize` / `_baseMinEmitPower` / `_baseMaxEmitPower`），滑条变化时乘以用户 multiplier：

```typescript
ps.emitRate = _baseEmitRate * envState.particleEmitRate;
ps.minSize = _baseMinSize * envState.particleSize;
ps.minEmitPower = _baseMinEmitPower * envState.particleSpeed;
```

### 风场联动

保存初始发射方向 `_initialDir1` / `_initialDir2`，每帧基于 `getWindVector().scale(0.1)` 叠加风力偏移。关键：风力始终基于初始值计算，避免方向累积叠加。

```typescript
ps.direction1 = _initialDir1.clone().add(wind);
ps.direction2 = _initialDir2.clone().add(wind);
```

### 涉及文件

| 文件 | 职责 |
|------|------|
| `frontend/src/scene/env/env-particles.ts` | 核心粒子系统（536 行） |
| `frontend/src/menus/env-menu.ts` | 粒子 UI 面板（类型/密度/大小/速度/溅射） |
| `frontend/src/core/config.ts` | `EnvState` 粒子相关字段 |
| `frontend/src/core/physics/wind-utils.ts` | 风向量计算 |

---

## 决策三：雨雪粒子落地溅射（Phase B）— 已确认，B1 方案

### 方案：视觉欺骗（B1）

独立 `GPUParticleSystem`（溅射），地面随机位置脉冲触发。不绑定主粒子落点——雨雪溅射的视觉本质是「地面有一层细密的跳跃噪点」，精确落点反而不自然。

### 实现要点

- 主粒子系统（`rain/snow`）保持不变（GPU）
- 新增 `splashSystem: GPUParticleSystem | null`，`createSplashEmitter()`
- 溅射粒子用 `SphereEmitter(radius)` + **向上初速度** + 随机水平偏移
  - ⚠️ `SphereEmitter` 默认径向向外，需设 `direction1/direction2` 的 Y 分量为正（向上），否则溅射粒子原地不动
- 溅射粒子：`minLifeTime=0.3`, `maxLifeTime=0.6`，快速消失
- `particleSplash: boolean` 字段控制开关

### 涉及文件

| 文件 | 改动 |
|------|------|
| `frontend/src/scene/env/env-particles.ts` | 新增 `createSplashEmitter()` / `disposeSplash()`，集成溅射逻辑 |
| `frontend/src/core/config.ts` | `EnvState` 加 `particleSplash: boolean` |
| `frontend/src/menus/env-feature-levels.ts` | `buildParticleLevel()` 加溅射开关 |

---

## 决策四：水下后处理联动水色（Phase C）— 已确认，轻量版

### 方案：复用 `imageProcessing.tintColor` / `tintAmount`

**不引入自定义 PostProcess**。直接用 Babylon.js 内置的 `DefaultRenderingPipeline.imageProcessing` 的 `tintColor` 和 `tintAmount`：

```typescript
pipeline.imageProcessing.tintColor = new Color3(0.2, 0.4, 0.8); // 蓝色调，随 waterColor 动态计算
pipeline.imageProcessing.tintAmount = t * 0.25; // 水下逐渐叠加，t 为相机没入水面的深度比
```

改动约 3 行，不引入新文件，已有「水下蓝色偏移」感知。

### 联动参数

| 参数 | 联动方式 |
|------|----------|
| 主色调 | `waterColor` → `tintColor`（取 RGB，降低亮度避免过饱和） |
| 透明度 | `waterOpacity` 越低 → `tintAmount` 系数越小（水越清澈，色调偏移越弱）|
| 雾密度 | 水下 `fogDensity` 自动乘以 `underwaterFogMultiplier`（新增字段，默认 2）|

新增 `EnvState` 字段：
- `underwaterToneIntensity: number`（0~1，默认 0.5，控制 tintAmount 上限）
- `underwaterFogMultiplier: number`（默认 2）

### 涉及文件

| 文件 | 改动 |
|------|------|
| `frontend/src/core/config.ts` | 加 `underwaterToneIntensity` / `underwaterFogMultiplier` |
| `frontend/src/scene/env/env-water.ts` | `updateUnderwaterEffect()` 读取水色并应用到 `pipeline.imageProcessing` |
| `frontend/src/menus/env-feature-levels.ts` | `buildWaterLevel()` 加水下联动滑条 |

---

## 实施顺序（已确认）

```
Phase A（纹理地面）+ Phase C（水下联动）→ 并行开发 → 合并验证
→ Phase B（粒子溅射）→ 单独验证
→ Phase D（UI 整合 + 序列化验证）
```

每 Phase 完成后做一次 `tsc` 静态检查 + 增量提交。

---

## 参考

- 当前粒子系统实现：`frontend/src/scene/env/env-particles.ts`
- 地面构建：`frontend/src/scene/env/env-ground.ts`
- 水下切换：`frontend/src/scene/env/env-water.ts`
- 环境 UI：`frontend/src/menus/env-feature-levels.ts`
- Babylon.js `imageProcessing.tintColor`：https://doc.babylonjs.com/typedoc/classes/BABYLON.ImageProcessingConfiguration
