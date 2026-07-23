---
kind: scene_renderer
name: 场景渲染管线与后处理
category: rendering
scope:
  - frontend/src/scene/render/renderer.ts
source_files:
  - frontend/src/scene/render/renderer.ts
---

## 系统概览
Scene Renderer：渲染管线、后处理、渲染状态。职责：`DefaultRenderingPipeline` 管理、后处理开关、场景背景色、边缘高亮。从 `scene.ts` 静态导入但仅函数体内访问（ES module live binding 安全）。ADR-151：ReflectionProbe 已迁移至 `env-reflection.ts` 统一管理。

## 核心职责
- `ToneMappingMode`（OFF/ACES/REINHARD/CINEON/NEUTRAL）
- `RenderState` — 后处理（bloom / outline / fxaa / msaaSamples）、stage / imageProcessing（曝光、对比度、饱和度、色调）
- `DefaultRenderingPipeline` / `SSRRenderingPipeline` / `SSAO2RenderingPipeline` / `GlowLayer` 管理
- 场景背景色、接触阴影 `setContactShadow`、cel-ground 耦合 `registerCelGroundCoupling`（供 env-bridge 调用）
- 模块级 observer 句柄（initTransformGizmo 等）经 `observer-handle` 管理

## 对外 API（节选）
- `setRenderState(patch)` / `getRenderState()`
- `setContactShadow(...)` / `registerCelGroundCoupling(...)`
- `applyToneMapping(mode)` / 后处理开关

## 关键约定
- 渲染状态变更经 `scheduleRefresh()` 联动 UI
- dispose 级联释放 pipeline / 后处理 / GlowLayer

## 与其他子系统关系
- 被 `env-bridge.ts`（接触阴影/cel 耦合）、UI 渲染面板调用
- 依赖 `render/performance.ts`（性能快照重置）、`render/lighting.ts`（方向光）
- 依赖 `core/reactivity` / `core/observer-handle` / `core/dispose-helpers`
