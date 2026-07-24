---
kind: wasm_layers_blender
name: WASM 图层混合器
category: motion
scope:
  - frontend/src/scene/motion/wasm-layers-blender.ts
source_files:
  - frontend/src/scene/motion/wasm-layers-blender.ts
adr: []
symbols:
  - setupWasmLayersBlender
  - addWasmLayer
  - removeWasmLayer
  - updateWasmLayers
invariants:
  - 感知层核心混合引擎
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
**WASM 图层混合器**。将多个 WASM 动作图层按优先级混合，提供统一的混合引擎。

## 核心职责
- `wasm-layers-blender.ts` — WASM 图层注册、混合、更新。

## 对外 API（节选）
- `setupWasmLayersBlender(runtime)` — 初始化 WASM 混合器。
- `addWasmLayer(layerId, config)` — 添加 WASM 图层。
- `removeWasmLayer(layerId)` — 移除 WASM 图层。
- `updateWasmLayers(deltaTime)` — 更新图层混合。

## 与其他子系统关系
- WASM 配置：`./wasm-layers-config.ts`。
- 感知层：`./perception.ts`（混合引擎）。
- MMD runtime：`@/core/config.mmdRuntime`。

## 不变量
- 图层混合按优先级排序，高优先级覆盖低优先级。
- 混合结果在每帧更新时计算，不缓存。
