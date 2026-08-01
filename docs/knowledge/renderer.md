---
tier: architecture
kind: scene_renderer
name: 场景渲染管线与后处理
category: rendering
scope:
  - frontend/src/scene/render/renderer.ts
source_files:
  - frontend/src/scene/render/renderer.ts
symbols:
  - RenderState
  - ToneMappingMode
  - defaultRenderState
  - disposeRenderer
  - getRenderState
  - initRenderer
  - isRendererReady
  - isSSRActive
  - pipeline
  - reattachPipeline
  - rebuildOutlineState
  - registerCelGroundCoupling
  - setRenderState
  - setSSRFromReflection
  - transitionRenderState
invariants:
  - disposeRenderer 级联释放 DefaultRenderingPipeline / 后处理 / GlowLayer / 模块级 observer
  - RenderState 通过 setRenderState patch 合并，而非整体替换
  - SSR / SSAO / bloom 等后处理在 pipeline 重建后重新附着（reattachPipeline）
  - 接触阴影与 cel-ground 通过 registerCelGroundCoupling 解耦，由 env-bridge 注入
tests: []
use_when:
  - 渲染管线
  - 后处理
  - tone mapping
  - SSR / SSAO
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
