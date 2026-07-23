---
kind: env_texture
name: 统一贴图工厂
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-texture.ts
adr:
  - ADR-092
---

## 系统概览
环境子系统内所有 canvas 生成贴图的统一工厂。消除散点 `getContext→toDataURL→new Texture` 模式，优先使用 `DynamicTexture`（无 PNG 编码开销），任意环节失败回退普通 canvas → toDataURL → Texture。提供缓存层，支持按 key 复用，避免拖动滑块时反复生成。

## 核心职责
- `env-texture.ts` — canvas 贴图创建、缓存管理、data URL 导出。

## 对外 API（节选）
- `CanvasTextureOptions` — 贴图创建选项接口（size / draw / scene / wrap / getAlphaFromRGB / hasAlpha / generateMipMaps）。
- `createCanvasTexture(opts)` — 统一创建 canvas 贴图，优先 DynamicTexture，失败回退 toDataURL。
- `getOrCreateCanvasTexture(key, opts)` — 按 key 缓存复用，key 不变不重建。
- `isCacheOwnedTexture(tex)` — 判断贴图是否归缓存所有（材质释放时跳过缓存贴图，避免提前 dispose 后复用失效）。
- `disposeTextureCache()` — 释放全部缓存贴图（`disposeEnv` 统一清理时调用）。
- `createCanvasDataURL(opts)` — 创建 canvas 并导出 data URL（供 `CreateGroundFromHeightMap` 等以 URL 为输入的场景使用）。

## 与其他子系统关系
- 被 `env-ground`（程序化纹理）、`env-terrain`（高度图 URL）、`env-water`（涟漪贴图）直接依赖。
- 缓存所有权机制（`WeakSet`）确保 `disposeGround` 等路径不错误释放缓存贴图。