---
kind: lighting_shadow
name: 阴影生成器
category: rendering
scope:
  - frontend/src/scene/render/**
source_files:
  - frontend/src/scene/render/lighting-shadow.ts
adr: []
---

## 系统概览
阴影生成器管理模块：为环境主光（DirectionalLight）创建 `CascadedShadowGenerator`，为舞台灯光创建 `ShadowGenerator`。管理阴影投射者列表（遍历 modelRegistry + propRegistry 的所有 Mesh），支持阴影类型（hard / soft / pcf）、分辨率、级联数、偏移参数。

## 核心职责
- `lighting-shadow.ts` — 阴影生成器创建/重建、投射者列表管理。

## 对外 API（节选）
- `_addAllMeshesToShadow(gen)` — 遍历所有模型/道具的 Mesh，加入阴影生成器。
- `_ensureShadow()` — 创建/重建环境主光级联阴影生成器（CSM）。
- `rebuildShadowCasters()` — 模型/道具注册表更新时，重新生成阴影投射者列表。
- `_ensureStageShadow(id)` — 为指定舞台灯光创建阴影生成器。
- `_disposeStageShadow(id)` — 释放指定舞台灯光的阴影生成器。

## 与其他子系统关系
- 状态集中于 [`lighting-state`](./lighting-state.md) 的 `lightingState` 对象。
- 被 `lighting.ts` 主光照模块与 [`lighting-stage.ts`](./lighting-stage.md) 舞台灯光模块引用。
- 依赖 [`transform-pick`](./transform-pick.md) 的变换元数据。