# 第②轮审核 — 环境云 + 环境粒子

## env-clouds.ts (488行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/env/env-clouds.ts`
**测试：** ❌ 0 测试文件

---

### 类型安全 — ✅

0 处 `as any` / `@ts-ignore`。

L411 `getLightByName('dir') as DirectionalLight`：`as` 断言而非 `as any`，生产环境保证 `dir` 光源始终是 `DirectionalLight`。🟢 P4，可接受。

### 资源管理 — ✅

| 对象 | 创建 | 释放 | 配对 |
|------|------|------|------|
| RawTexture3D (噪声) | `_createNoiseTexture()` | `disposeClouds()` | ✅ |
| Sphere Mesh (云壳) | `initClouds()` | `disposeClouds()` | ✅ |
| ShaderMaterial | `_createCloudMaterial()` | `disposeClouds()` | ✅ |
| Torus + Boxes (调试) | `initClouds()` (debug) | `disposeClouds()` | ✅ |
| Scene observer ×2 | `initClouds()` | `disposeClouds()` | ✅ |

释放顺序正确：observer 先断开 → material → mesh。旧版 `_envSys.clouds` 资源同时清理作为安全网。

### 测试覆盖 — 🔴 P1

**0 测试文件。** 云渲染涉及多个复杂状态（噪声纹理尺寸、FBM 参数、风向量、调试模式），无任何回归保护。

### 功能正确性 — 🟡 P3

| # | 问题 | 位置 | 风险 |
|---|------|------|------|
| 1 | `_volCloudObs`(L118) 与 `mesh.metadata.obs`(L424) 冗余存储同一 observer | 两个引用指向同一对象，`disposeClouds` 中重复 `remove()` | 幂等所以不报错，但代码意图不清晰 |
| 2 | noise 纹理每次 `disableClouds()` 释放，`enableClouds()` 重建 (256³ ≈ 16MB) | toggle 频繁时浪费显存分配 | 场景预设切换时可能累积碎片 |

### 设计质量 — ✅

| 设计模式 | 说明 |
|----------|------|
| Fast path uniform-only | 摄像机不动时只更新 uniform，不重建纹理 |
| 调试可视化隔离 | 调试用的 Torus/Boxes 仅在开发模式创建 |
| 风向量归一化 | 风输入被归一化到单位向量，防止极端值 |
| FBM 多噪声叠加 | 分形布朗运动产生自然云形态 |

---

## env-particles.ts (687行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/env/env-particles.ts`
**测试：** ❌ 0 测试文件

---

### 类型安全 — ✅

0 处 `as any` / `@ts-ignore`。

L57 `canvas.getContext('2d')!`：非空断言，在非浏览器环境（SSR/测试）直接抛 TypeError。🟡 P3。

### 资源管理 — ✅

| 对象 | 创建 | 释放 | 配对 |
|------|------|------|------|
| 主 GPUParticleSystem | `_createWeatherSystem()` | `disposeParticles()` | ✅ |
| Splash 粒子系统 | `_createSplash()` | `disposeParticles()` | ✅ |
| 烟花 × N (瞬态子系统) | `startFireworks()` | `stopFireworkBursts()` | ✅ |
| 纹理缓存 Map | `_textureCache` | `disposeParticles()` | ✅ |
| Scene observer ×2 | `initParticles()` | `disposeParticles()` | ✅ |

烟花使用 `cleanupTimer` + `stopFireworkBursts` 双保险机制，防止 setTimeout 遗留在系统 dispose 后执行。

### 测试覆盖 — 🔴 P1

**0 测试文件。** 粒子系统涉及天气（雨/雪/雾）、烟花（ambient + burst）、涟漪回调等多个子系统，无任何回归保护。

### 功能正确性 — 🟡 P3

| # | 问题 | 位置 | 风险 |
|---|------|------|------|
| 1 | `canvas.getContext('2d')!` 非空断言 | L57 | 非浏览器环境直接抛错。应加 `if (!ctx) throw new Error(...)` |
| 2 | 每帧 `new Vector3` | L493-494 | splash 更新路径每帧创建临时 Vector3 对象，GC 压力大 |

### 设计质量 — ✅

| 设计模式 | 说明 |
|----------|------|
| 天气 vs 局部分离 | 全局天气粒子与局部事件(涟漪溅射)独立管理 |
| 初始方向克隆 | `direction.clone()` 防风力叠加影响原始方向 |
| multiplier 实时调整 | 粒子发射率可在运行时连续调节 |
| 烟花双系统 | ambient(持续低密度) + burst(爆发高密度) 分离 |
| 涟漪回调集成 | 粒子溅射可触发水面涟漪（通过 `_rippleCallback`） |

---

## 跨模块风险

| 文件 | 观察 | 建议 |
|------|------|------|
| 🔴 P1 | env-clouds.ts | 0 测试覆盖 | 添加基础测试：噪声纹理创建、FBM 参数验证、toggle 生命周期 |
| 🔴 P1 | env-particles.ts | 0 测试覆盖 | 添加基础测试：天气切换、烟花生命周期、dispose 完整性 |
| 🟡 P3 | env-particles.ts:57 | 非空断言 | 改 `if (!ctx) throw new Error('canvas 2D context unavailable')` |
| 🟡 P3 | env-particles.ts:493 | 每帧 new Vector3 | 复用临时 Vector3 对象（参考 `followObserver` 复用模式） |
| 🟡 P3 | env-clouds.ts:118,424 | observer 冗余存储 | 统一用一个引用，消除 `mesh.metadata.obs` |
