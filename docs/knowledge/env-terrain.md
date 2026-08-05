---
tier: leaf
kind: env_terrain
name: 地形生成器
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-terrain.ts
adr:
  - ADR-073
  - ADR-226
symbols:
  - applyTerrainMaterial
  - clearTerrainGeneration
  - createHeightmapGround
  - fbm
  - generateTerrainHeightmapURL
  - hash2
  - valueNoise
invariants:
  - 确定性整数哈希，相同 seed 产生相同地形
  - fbm 使用分形布朗运动叠加，返回 ~[-1,1] 范围
  - 高度图 256² 灰度图，亮=高峰，暗=低谷
  - createHeightmapGround 创建 isPickable=true 的可拾取地形网格
  - onReady 陈旧回调必须双重守卫（代际 _terrainGen + mesh.isDisposed），绝不对已销毁 mesh 施加材质
tests:
  - frontend/src/__tests__/scene/env-terrain.test.ts
use_when:
  - 地形生成
  - 高度图
  - 程序化地形
---

# 地形生成器

## 系统概览
程序化地形生成：用确定性整数哈希（FBM 分形布朗运动）在 CPU 端生成 256² 灰度高度图，通过 `CreateGroundFromHeightMap` 创建可拾取地形网格。支持高程着色（Phase B：按顶点高度三段色插值）。

## 核心职责
- `env-terrain.ts` — 确定性噪声函数、高度图生成、地形网格创建、地形材质应用。

## 对外 API（节选）
- `hash2(ix, iz, seed)` — 确定性二维整数哈希，相同 seed 产生相同结果。
- `valueNoise(x, z, seed)` — 双线性插值值噪声。
- `fbm(x, z, seed, octaves, baseFreq)` — 分形布朗运动叠加，返回 ~[-1,1]。
- `generateTerrainHeightmapURL(opts)` — 生成 256² 灰度高度图 data URL（亮=高峰，暗=低谷）。
- `createHeightmapGround(state, scene, onReady)` — 用高度图创建可拾取地形网格（`isPickable=true`，模型可站在坡面上）。几何体在 `onReady` 前为空，故先置 `isPickable=false`。
- `clearTerrainGeneration()` — 清零地形代际计数器 `_terrainGen`（测试/场景重置用）。
- `applyTerrainMaterial(ground, state, scene)` — 地形材质应用（纯色/纹理/高程着色），支持 PBR 升级。

## 内部协作
- `applyElevationColoring` — 按顶点高度插值三段色（低谷深绿→山腰棕→峰顶白），写入 VertexBuffer.ColorKind。

## 与其他子系统关系
- 被 [`env-ground-spec`](./env-ground-spec.md) 的 `createGroundMeshFromSpec` 调用以创建地形模式地面（ADR-226 Phase 4：`env-ground.ts` 已移除自己的 terrain 重建分支，不再 import 本模块的 `createHeightmapGround` / `applyTerrainMaterial`）。
- 依赖 [`env-texture`](./env-texture.md) 的 `createCanvasDataURL` 生成高度图 data URL。
- 依赖 [`env-ground`](./env-ground.md) 的 `_effectiveBumpLevel` 计算 PBR 法线强度（Standard 材质直接用 `groundNormalStrength`）。
- 调用 [`env-underwater-fog`](./env-underwater-fog.md) 的 `underwaterFogController.uninstall(oldMat)`，在旧材质销毁前摘除水下焦散注册条目。

## 不变量
- **异步 onReady 陈旧回调守卫**：`createHeightmapGround` 的 `onReady` 是异步回调，用户快速连切地面类型时旧回调仍会到达。回调首行须双重放弃——先比对代际 `gen !== _terrainGen`（ADR-231 模式），再检查 `gm.isDisposed()`；两者任一命中即 return，绝不对已销毁 mesh 施加材质，否则产生僵尸材质泄漏。
- **材质纹理归属**：`applyTerrainMaterial` 释放旧材质前，缓存持有的纹理（`isCacheOwnedTexture`）只脱离不 dispose，由 `disposeTextureCache` 统一释放；`emissiveTexture` 与 albedo/共享焦散同引用，无条件脱离。
- **确定性**：`hash2`/`valueNoise`/`fbm` 为纯函数，相同 seed 必得相同地形（原语统一由 `@/core/math/hash-noise` 提供，本模块 re-export）。