---
tier: architecture
kind: env_ground
name: 地面系统
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-ground.ts
  - frontend/src/scene/env/env-ground-presets.ts
  - frontend/src/menus/env-ground-levels.ts
adr:
  - ADR-114
symbols:
  - GROUND_PRESETS
  - GROUND_PRESET_KEYS
  - GroundMat
  - GroundPreset
  - GroundProceduralKind
  - INFINITE_GROUND_SIZE
  - _disableGroundRippleTexture
  - _effectiveBumpLevel
  - _effectiveRoughness
  - _generateGroundTexture
  - _getAlbedoColor
  - _getAlbedoTex
  - _needAlphaBlend
  - _setAlbedoColor
  - _setAlbedoTex
  - _syncAllTextureOffsets
  - _syncGroundNormalTexture
  - _syncGroundRippleTexture
  - _syncPbrProperties
  - _syncTextureGroundTexture
  - _updateGroundTexture
  - applyGround
  - applyGroundEdgeFade
  - buildGroundLevel
  - buildGroundPresetEnvState
  - buildGroundReflection
  - clearGroundTexCache
  - createGroundMaterial
  - disposeGround
  - generateProceduralGroundTextures
  - getGroundHeightAt
  - getGroundSchema
  - setGroundActualSize
  - setGroundMesh
  - setOnGroundChanged
  - setOnTerrainReady
  - tickGround
  - triggerTerrainReady
invariants:
  - disposeGround 释放地面材质、网格、反射与涟漪资源，经 safeDispose 安全清理
  - 程序化纹理 6 种预设（木材/大理石/混凝土/瓷砖/地毯/金属），每类含 albedo + roughness + normal 三通道
  - UV 滚动动画每帧由 tickGround(dt) 驱动
  - 高度查询 getGroundHeightAt 含倾斜平面插值
tests: []
use_when:
  - 地面系统
  - 程序化纹理
  - 涟漪
  - 地面高度查询
---

# 地面系统

## 系统概览
地面子系统的完整实现：纯色/纹理/程序化纹理三种地面模式，支持 PBR 材质（ADR-114）、边缘淡出、UV 滚动动画、地面涟漪（与水系统联动）、程序化纹理含 6 种预设（木材/大理石/混凝土/瓷砖/地毯/金属），每类含 albedo、roughness、normal 三通道生成器。预设数据已拆分至独立文件。

## 核心职责
- `env-ground.ts` — 地面材质创建/切换、程序化纹理生成器注册表、涟漪同步、高度查询。
- `env-ground-presets.ts` — 地面预设类型定义（`GroundPreset`）、7 套内置预设（`GROUND_PRESETS`）、`buildGroundPresetEnvState` 映射函数。经 `env-ground.ts` barrel re-export 保持向后兼容。

## 对外 API（节选）
- `GroundProceduralKind` — 6 种程序化纹理枚举类型（定义位于 `env-ground-presets.ts`）。
- `GroundPreset` / `GROUND_PRESETS` — 地面预设接口与内置预设集合（定义位于 `env-ground-presets.ts`，经 `env-ground.ts` re-export）。
- `applyGround(state)` — 根据 EnvState 应用地面材质/纹理/模式（204 行核心调度）。
- `tickGround(dt)` — 每帧更新地面 UV 滚动动画。
- `getGroundHeightAt(x, z)` — 查询地面高度（含倾斜平面插值，供模型/摄像机站立）。
- `clearGroundTexCache()` — 清理程序化纹理缓存。
- `setOnTerrainReady(cb)` / `setOnGroundChanged(cb)` — 地形就绪/地面变化回调。
- `buildGroundPresetEnvState(preset)` — 从预设构建部分 EnvState（定义位于 `env-ground-presets.ts`，经 `env-ground.ts` re-export）。
- `disposeGround()` — 释放地面材质、网格、反射与涟漪资源。
- `_effectiveRoughness(state)` / `_effectiveBumpLevel(state)` — 根据状态计算有效粗糙度/凹凸强度。
- `_disableGroundRippleTexture(mat)` — 禁用地面涟漪贴图。

## 与其他子系统关系
- 依赖 [`env-terrain`](./env-terrain.md) 的 FBM 噪声与高度图生成。
- 依赖 [`env-texture`](./env-texture.md) 的统一 canvas 贴图工厂。
- 依赖 [`env-reflection`](./env-reflection.md) 的平面反射质量预设。
- 依赖 [`env-context`](./env-context.md) 的上下文与环境系统引用。
- 地面涟漪与水系统（`env-water`）联动，通过 `env` 外观（facade）注册更新。

## 菜单入口（去哪找 UI）
- 菜单层文件：`frontend/src/menus/env-ground-levels.ts`，入口函数 `buildGroundLevel(): PopupLevel`。
- 路由归属：**场景菜单**（`scene-menu.ts`），target = `scene:ground`（注意文件名前缀 `env-` 与路由域 `scene:` 名实错位，历史遗留）。
- schema 节点 id 以 `env:ground:*` 为前缀（如 `env:ground:presets`/`env:ground:texture`/`env:ground:overlay`）。
- 添加/修改地面菜单行的规范流程见 [menu-how-to.md](../menu-how-to.md)。

## UI 入口

- 入口函数：`buildGroundLevel()`（菜单文件见 [menu-map.md](./menu-map.md) 入口一览）
- 菜单层级 / 静态骨架由 [menu-map.md](./menu-map.md) 机器生成（勿手改）；运行时动态入口以本节为准。
