---
kind: env_terrain
name: 地形生成器
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-terrain.ts
adr: []
---

## 系统概览
程序化地形生成：用确定性整数哈希（FBM 分形布朗运动）在 CPU 端生成 256² 灰度高度图，通过 `CreateGroundFromHeightMap` 创建可拾取地形网格。支持高程着色（Phase B：按顶点高度三段色插值）。

## 核心职责
- `env-terrain.ts` — 确定性噪声函数、高度图生成、地形网格创建、地形材质应用。

## 对外 API（节选）
- `hash2(ix, iz, seed)` — 确定性二维整数哈希，相同 seed 产生相同结果。
- `valueNoise(x, z, seed)` — 双线性插值值噪声。
- `fbm(x, z, seed, octaves, baseFreq)` — 分形布朗运动叠加，返回 ~[-1,1]。
- `generateTerrainHeightmapURL(opts)` — 生成 256² 灰度高度图 data URL（亮=高峰，暗=低谷）。
- `createHeightmapGround(state, scene, onReady)` — 用高度图创建可拾取地形网格（`isPickable=true`，模型可站在坡面上）。
- `applyTerrainMaterial(ground, state, scene)` — 地形材质应用（纯色/纹理/高程着色），支持 PBR 升级。

## 内部协作
- `applyElevationColoring` — 按顶点高度插值三段色（低谷深绿→山腰棕→峰顶白），写入 VertexBuffer.ColorKind。

## 与其他子系统关系
- 被 `env-ground` 的 `applyGround` 调用以创建地形模式地面。
- 依赖 `env-texture` 的 `createCanvasDataURL` 生成高度图 data URL。
- 依赖 `env-ground` 的 `_effectiveBumpLevel` 计算法线强度。