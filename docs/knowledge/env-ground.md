---
kind: env_ground
name: 地面系统
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-ground.ts
adr:
  - ADR-114
---

## 系统概览
地面子系统的完整实现：纯色/纹理/程序化纹理三种地面模式，支持 PBR 材质（ADR-114）、边缘淡出、UV 滚动动画、地面涟漪（与水系统联动）、高度查询（含倾斜平面插值）。程序化纹理含 6 种预设（木材/大理石/混凝土/瓷砖/地毯/金属），每类含 albedo、roughness、normal 三通道生成器。

## 核心职责
- `env-ground.ts` — 地面材质创建/切换、程序化纹理生成、涟漪同步、高度查询、预设管理。

## 对外 API（节选）
- `GroundProceduralKind` — 6 种程序化纹理枚举类型。
- `GroundPreset` / `GROUND_PRESETS` — 地面预设接口与内置预设集合。
- `applyGround(state)` — 根据 EnvState 应用地面材质/纹理/模式（204 行核心调度）。
- `tickGround(dt)` — 每帧更新地面 UV 滚动动画。
- `getGroundHeightAt(x, z)` — 查询地面高度（含倾斜平面插值，供模型/摄像机站立）。
- `clearGroundTexCache()` — 清理程序化纹理缓存。
- `setOnTerrainReady(cb)` / `setOnGroundChanged(cb)` — 地形就绪/地面变化回调。
- `buildGroundPresetEnvState(preset)` — 从预设构建部分 EnvState。
- `disposeGround()` — 释放地面材质、网格、反射与涟漪资源。
- `_effectiveRoughness(state)` / `_effectiveBumpLevel(state)` — 根据状态计算有效粗糙度/凹凸强度。
- `_disableGroundRippleTexture(mat)` — 禁用地面涟漪贴图。

## 与其他子系统关系
- 依赖 [`env-terrain`](./env-terrain.md) 的 FBM 噪声与高度图生成。
- 依赖 [`env-texture`](./env-texture.md) 的统一 canvas 贴图工厂。
- 依赖 [`env-reflection`](./env-reflection.md) 的平面反射质量预设。
- 依赖 [`env-context`](./env-context.md) 的上下文与环境系统引用。
- 地面涟漪与水系统（`env-water`）联动，通过 `env` 外观（facade）注册更新。