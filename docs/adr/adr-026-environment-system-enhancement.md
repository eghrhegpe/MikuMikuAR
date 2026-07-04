# ADR-026: 环境系统增强 — 纹理地面、粒子溅射、水下后处理联动

**日期**：2026-07-04
**状态**：实施中（Phase A + C 核心完成，待内置纹理资源 + Phase B）

---

## 背景

当前环境系统三个子系统存在功能缺口：

| 子系统 | 当前状态 | 缺口 |
|--------|----------|------|
| 地面 | 纯色/网格二选一（`groundColor`/`groundGrid`） | 无纹理地面（如草地） |
| 雨雪粒子 | GPU 粒子系统，出生即下落 | 无落地溅射效果 |
| 水下后处理 | `camera.y < waterLevel` 触发简单 pipeline 参数切换 | 未随水色/透明度动态变化 |

目标：补齐三个缺口，提升场景真实感。

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

## 决策二：雨雪粒子落地溅射（Phase B）— 已确认，B1 方案

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

## 决策三：水下后处理联动水色（Phase C）— 已确认，轻量版

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
