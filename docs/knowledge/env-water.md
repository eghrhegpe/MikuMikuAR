---
tier: architecture
source_files:
  - frontend/src/core/math/hash-noise.ts
  - frontend/src/menus/env-water-levels.ts
  - frontend/src/scene/env/env-water.ts
  - frontend/src/scene/env/env-water-fx.ts
  - frontend/src/scene/env/env-water-material.ts
  - frontend/src/scene/env/env-water-reflect.ts
tests:
  - frontend/src/__tests__/scene/env-water.test.ts
kind: env_water
name: 水面系统
category: env
scope:
  - frontend/src/scene/env/env-water.ts
  - frontend/src/scene/env/env-water-fx.ts
  - frontend/src/scene/env/env-water-material.ts
  - frontend/src/scene/env/env-water-reflect.ts
adr:
  - ADR-062
symbols:
  - MAX_RIPPLES
  - WATER_PRESETS
  - WaterPreset
  - _WATER_KEYS
  - _applyWaterLOD
  - _createWaterMaterial
  - _rebuildWaterMaterial
  - _setupMirrorRT
  - _syncWaterUniforms
  - _waterUpdateCallback
  - addGroundRipple
  - addRipple
  - applyWaterPresetToCurrent
  - buildRippleBuffers
  - buildWaterLevel
  - buildWaterPresetEnvState
  - clearGroundRipples
  - clearRipples
  - computeWaveDirs
  - createWater
  - disposeDetailNormalTexture
  - disposeGroundRipples
  - disposeWater
  - getGroundRippleTexture
  - getWaterLODMeshes
  - getWaterPhase
  - getWaterSchema
  - hasActiveGroundRipples
  - hash2
  - hash2v
  - isUnderwaterActive
  - refreshWaterRenderList
  - resetUnderwaterFlags
  - resetUnderwaterState
  - resetWaterLODState
  - resetWaterPhaseState
  - selectWaterLOD
  - setGroundGeometryProvider
  - setUnderwaterFog
  - setWaterLODMeshes
  - setWaterWaveSpeed
  - updateGroundRipples
  - updateRipples
  - updateUnderwaterTransition
  - updateWaterAnimSpeed
  - valueNoise
  - waterReflection
invariants:
  - disposeWater 级联释放水面 RT + 材质 + 镜像相机
  - 涟漪（ripple）独立于水面主体
  - 水下过渡效果与水面可见性联动
  - groundRippleTex 归 env-water-fx 独占拥有，仅 disposeGroundRipples 可释放；地面材质只借用为 bumpTexture，重建时只脱离不 dispose

use_when:
  - 水面
  - 水池
  - 水面反射
---

# 水面系统

## 系统概览
**水面系统**。在地面之上生成动态水面，支持波纹动画和反射效果。

## 核心职责
- `env-water.ts` — 生命周期宿主与编排（ADR-239）：水面网格创建、资源释放、转发 fx/material/reflect。
- `env-water-fx.ts` — 涟漪/地面涟漪/LOD/水下过渡/波方向（ADR-239）。
- `env-water-material.ts` — 材质/着色器 uniform/法线细节纹理/水下雾/preset 系（ADR-239）。
- `env-water-reflect.ts` — 平面反射单例（waterReflection，ADR-239 叶子模块）。

## 对外 API（节选）
- `createWater(state)` — 初始化水面（env.ts 亦 re-export）。
- `disposeWater()` — 释放水面资源（含反射 RT）。

## 与其他子系统关系
- 被 `env-impl.ts` 调用初始化。
- 参数来源：`envState.water`。
- 反射：可能使用 `env-reflection.ts` 的反射技术。
- 向 [`env-ground`](./env-ground.md) 出借地面涟漪纹理：地面侧经 `getGroundRippleTexture(scene)` 取得后挂到材质 `bumpTexture`；几何映射所需的地面中心/尺寸由 `setGroundGeometryProvider` 反向注入（避免 env-water→env-ground 循环依赖）。

## UI 入口

- 菜单层级 / 入口函数 / 快捷键统一由 [menu-map.md](./menu-map.md) 机器生成（勿手改）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）无法静态提取，缺口由本卡正文说明。
## 不变量
- 水面反射 RT（RenderTexture）在 `disposeWater` 中释放。
- 水面对象在场景 dispose 时级联释放。
- **地面涟漪纹理所有权（跨模块契约）**：`groundRippleTex`（`env-water-fx.ts` 模块级 `_groundRippleTex`，256² DynamicTexture）由本系统独占拥有，唯一释放点是 `disposeGroundRipples()`（`disposeWater` / `disposeGround` 调用）。地面材质**仅借用**它作为 `bumpTexture`，属外部引用：地面重建/材质销毁时必须**只脱离不 dispose**（`env-ground.ts` 按 `tex.name !== 'groundRippleTex'` 跳过），否则 env-water-fx 侧持有已销毁引用，涟漪静默失效。
- 小波细节波受 `smallWaveEnabled` 门控：关闭时 `_syncWaterUniforms` 向 shader 送 `smallWaveHeight=0`（水面呈纯净反射面），字段缺失时 `?? true` 兜底为开启。此为水面功能开关体系试点，复用地面 `folder + headerToggle` 模式（开关只控 shader 输出，不联动置灰 slider）。

## 菜单入口（去哪找 UI）
- 菜单层文件：`frontend/src/menus/env-water-levels.ts`，入口函数 `buildWaterLevel(): PopupLevel`。
- 路由归属：**场景菜单**（`scene-menu.ts`），target = `scene:water`（注意文件名前缀 `env-` 与路由域 `scene:` 名实错位，历史遗留）。
- schema 节点 id 以 `env:water:*` 为前缀（如 `env:water:presets`/`env:water:bigWave`/`env:water:color-fog`）。
- 添加/修改水面菜单行的规范流程见 [menu-how-to.md](../menu-how-to.md)。
