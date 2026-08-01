---
tier: leaf
kind: wasm_layers_blender
name: WASM 图层混合器
category: motion
scope:
  - frontend/src/scene/motion/wasm-layers-blender.ts
  - frontend/src/scene/motion/wasm-layers-config.ts
source_files:
  - frontend/src/scene/motion/wasm-layers-blender.ts
  - frontend/src/scene/motion/wasm-layers-config.ts
adr: []
symbols:
  - DEFAULT_LAYER_BONE_FILTER
  - WasmLayerConfig
  - addWasmLayer
  - initWasmLayersBlender
  - isWasmLayersBlenderActive
  - removeWasmLayer
  - setupWasmLayersBlender
  - teardownWasmLayersBlender
  - updateWasmLayerWeight
invariants:
  - 混合引擎
tests: []
use_when:
  - WASM 混合器
  - 图层混合
  - 动作混合
  - 混合引擎
  - WASM 层
---

## 系统概览
**WASM 图层混合器**。将多个 WASM 动作图层按权重混合，提供 `BlenderDeps` 注入式的初始化与销毁。

## 核心职责
- `wasm-layers-blender.ts` — WASM 图层注册、权重更新、销毁。
- `wasm-layers-config.ts` — 默认骨骼过滤列表（`DEFAULT_LAYER_BONE_FILTER`）。

## 对外 API（节选）
- `initWasmLayersBlender(deps)` — 注入 `BlenderDeps` 初始化混合器。
- `teardownWasmLayersBlender(modelId)` — 销毁指定模型的混合器。
- `isWasmLayersBlenderActive(modelId)` — 查询模型是否激活混合器。
- `removeWasmLayer(modelId, layerId)` — 移除指定图层。
- `updateWasmLayerWeight(modelId, layerId, weight)` — 更新图层权重。

## 与其他子系统关系
- WASM 配置：`./wasm-layers-config.ts`。
- 感知层：`./perception.ts`（混合引擎）。
- MMD runtime：`@/core/config.mmdRuntime`。

## 不变量
- 图层混合按优先级排序，高优先级覆盖低优先级。
- 混合结果在每帧更新时计算，不缓存。
