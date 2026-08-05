---
tier: architecture
source_files:
  - frontend/src/menus/env-ground-levels.ts
  - frontend/src/scene/env/env-ground-presets.ts
  - frontend/src/scene/env/env-ground.ts
tests:
  - frontend/src/__tests__/scene/env-ground.test.ts
kind: env_ground
name: 地面系统
category: env
scope:
  - frontend/src/scene/env/**
adr:
  - ADR-114
  - ADR-226
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
  - _syncGroundEmissive
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
  - terrain 与平面/无限统一走 spec 单源，applyGround 无 legacy 分支（ADR-226 Phase 4）
  - groundRippleTex 归 env-water-fx 所有，地面侧只脱离不 dispose，重建时复位 _groundRippleApplied
  - elevation 着色由 applyTerrainMaterial 全权负责，spec 侧 isElevation 守卫跳过材质覆盖

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
- `env-ground.ts` — 地面调度与资源生命周期：`applyGround` 的原地/重建两条路径分派、程序化纹理生成器注册表、材质属性同步原语（`_sync*`）、涟漪贴图挂载/摘除、高度查询。材质「长什么样」的决策已上移至 [`env-ground-spec`](./env-ground-spec.md)，本模块只负责执行与释放（ADR-226）。
- `env-ground-presets.ts` — 地面预设类型定义（`GroundPreset`）、7 套内置预设（`GROUND_PRESETS`）、`buildGroundPresetEnvState` 映射函数。经 `env-ground.ts` barrel re-export 保持向后兼容。

## 对外 API（节选）
- `GroundProceduralKind` — 6 种程序化纹理枚举类型（定义位于 `env-ground-presets.ts`）。
- `GroundPreset` / `GROUND_PRESETS` — 地面预设接口与内置预设集合（定义位于 `env-ground-presets.ts`，经 `env-ground.ts` re-export）。
- `applyGround(state)` — 根据 EnvState 应用地面材质/纹理/模式。以 `specKey(buildGroundMaterialSpec(state))` 与 `_currentGroundKey` 比对决定原地或重建，两条路径分别委派 `applyGroundMaterialSpec` / `createGroundMeshFromSpec`。
- `tickGround(dt)` — 每帧更新地面 UV 滚动动画。
- `getGroundHeightAt(x, z)` — 查询地面高度（含倾斜平面插值，供模型/摄像机站立）。
- `clearGroundTexCache()` — 清理程序化纹理缓存。
- `setOnTerrainReady(cb)` / `setOnGroundChanged(cb)` — 地形就绪/地面变化回调。
- `buildGroundPresetEnvState(preset)` — 从预设构建部分 EnvState（定义位于 `env-ground-presets.ts`，经 `env-ground.ts` re-export）。
- `disposeGround()` — 释放地面材质、网格、反射与涟漪资源。
- `_effectiveRoughness(state)` / `_effectiveBumpLevel(state)` — 根据状态计算有效粗糙度/凹凸强度。
- `_disableGroundRippleTexture(mat)` — 禁用地面涟漪贴图。

## 与其他子系统关系
- 依赖 [`env-ground-spec`](./env-ground-spec.md) 的 `GroundMaterialSpec` 单源：`specKey` 判定重建、`applyGroundMaterialSpec` 落原地材质、`createGroundMeshFromSpec` 建网格。三种几何（flat/infinite/terrain）无一例外（ADR-226）。
- 依赖 [`env-terrain`](./env-terrain.md) 的 FBM 噪声与高度图生成；`createHeightmapGround` / `applyTerrainMaterial` 现由 `env-ground-spec.ts` 直接 import，`env-ground.ts` 不再引用。
- 依赖 [`env-texture`](./env-texture.md) 的统一 canvas 贴图工厂。
- 依赖 [`env-reflection`](./env-reflection.md) 的平面反射质量预设。
- 依赖 [`env-context`](./env-context.md) 的上下文与环境系统引用。
- 地面涟漪与水系统（`env-water`）联动：涟漪纹理 `groundRippleTex` 由 `env-water-fx.ts` 的 `_groundRippleTex` 持有，地面侧仅通过 `_syncGroundRippleTexture` / `_disableGroundRippleTexture` 挂载与摘除。

## 不变量
- 地面重建路径（含 terrain）统一走 `createGroundMeshFromSpec`，原地路径统一走 `applyGroundMaterialSpec`；`_applyGroundInplaceLegacy` 与 terrain 专属重建分支已删除，terrain 不再有 legacy 特例（ADR-226 Phase 4）。
- `groundRippleTex` 的所有权归 `env-water-fx.ts`（`_groundRippleTex`，经 `disposeGroundRipples` 释放）。`disposeGroundMaterial` 的 `disposeTex` 跳过该名字的纹理，且 `mat.bumpTexture?.name === 'groundRippleTex'` 时先置 null 再 dispose 材质——地面侧只脱离不释放。
- `applyGround` 重建路径必须复位 `_groundRipples = null` 与 `_groundRippleApplied = false`，避免 `_disableGroundRippleTexture` 把上一代材质的陈旧 bump 恢复到新材质上。
- `_disableGroundRippleTexture` 仅以 `_groundRippleApplied` 门控，不得对 `_groundRipples` 判空：暂存的原始 bump 本就可能是 null，null 也必须恢复（即恢复为「无 bump」）。
- 高程着色（`groundType === 'terrain' && groundElevationColoringEnabled`）由 `applyTerrainMaterial` 全权负责，`applyGroundMaterialSpec` 的 `isElevation` 守卫跳过 albedo 来源、法线同步与涟漪 sync/disable，spec 侧不得覆盖。

## 菜单入口（去哪找 UI）
- 菜单层文件：`frontend/src/menus/env-ground-levels.ts`，入口函数 `buildGroundLevel(): PopupLevel`。
- 路由归属：**场景菜单**（`scene-menu.ts`），target = `scene:ground`（注意文件名前缀 `env-` 与路由域 `scene:` 名实错位，历史遗留）。
- schema 节点 id 以 `env:ground:*` 为前缀（如 `env:ground:presets`/`env:ground:texture`/`env:ground:overlay`）。
- 添加/修改地面菜单行的规范流程见 [menu-how-to.md](../menu-how-to.md)。

## UI 入口

- 菜单层级 / 入口函数 / 快捷键统一由 [menu-map.md](./menu-map.md) 机器生成（勿手改）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）无法静态提取，缺口由本卡正文说明。
