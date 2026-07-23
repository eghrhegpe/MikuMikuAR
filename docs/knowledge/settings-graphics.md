---
kind: settings_graphics
name: 设置 — 画面页面
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/settings-graphics.ts
adr:
  - ADR-157
---

## 系统概览
设置页面中的「画面」页（ADR-157）。管理渲染相关的性能预设、帧率与画质、渲染效果（阴影/泛光/抗锯齿/景深等开关）、物理与显示设置。

## 核心职责
- `settings-graphics.ts` — 画面设置 Schema 构建与弹窗层级。

## 对外 API（节选）
- `buildSettingsGraphicsLevel(getSettingsMenu)` — 构建画面页面的 PopupLevel。

## 内部协作
- `buildPresetSchema(getSettingsMenu)` — 构建性能预设 Schema（自动/质量优先/平衡/性能优先/自定义）。
- `buildFrameQualitySchema()` — 构建帧率与画质 Schema（帧率上限、VSync、渲染缩放、分辨率等）。
- `buildEffectsSchema()` — 构建渲染效果 Schema（阴影/泛光/FXAA/DOF/SSAO/辉光/色差/颗粒等开关）。
- `buildPhysicsHudSchema()` — 构建物理与显示 Schema（物理开关、FPS 时钟、运行时徽标）。
- `buildGraphicsSchema(getSettingsMenu)` — 组装画面页面 Schema。

## 与其他子系统关系
- 依赖 `wails-bindings` 的 `SetPerformanceMode`。
- 依赖 `scene/render/performance` 的性能模式管理。
- 依赖 `scene/render/renderer` 的渲染状态。
- 依赖 `scene/render/lighting` 的光照状态。