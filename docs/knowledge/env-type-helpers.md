---
kind: env_type_helpers
name: Babylon.js 类型逃逸封装
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-type-helpers.ts
adr: []
---

## 系统概览
集中封装 Babylon.js 私有 API 访问与类型逃逸（`as unknown as` 断言），消除散落在业务代码中的类型逃生点。每个 helper 对应一处私有字段/未导出常量的访问，降低升级时断裂风险。

## 核心职责
- `env-type-helpers.ts` — 私有 API 桥接、类型断言封装。

## 对外 API（节选）
- `getCanvasCtx(dt)` — 封装 `DynamicTexture.getContext()` 到 `CanvasRenderingContext2D` 的断言。
- `setPostProcessEnabled(pp, enabled)` — 通过 `_enabled` 私有字段控制后处理开关（Babylon 未导出 enabled setter）。
- `isWorldMatrixFrozen(mesh)` — 查询 `AbstractMesh._worldMatrixFrozen` 私有字段。
- `REFRESHRATE_RENDER_ONCE` — Babylon 未导出的静态常量（`Number.MAX_VALUE`），供 `RenderTargetTexture` 单帧渲染用。
- `FrozenCamera` — `FreeCamera` 私有字段接口（`_worldMatrix` / `_isWorldMatrixFrozen`），供 `planar-reflection` 镜像相机矩阵设置用。

## 与其他子系统关系
- 被 `env-texture`、`env-ground` 等环境子系统引用。
- `FrozenCamera` 被 `planar-reflection` 使用。