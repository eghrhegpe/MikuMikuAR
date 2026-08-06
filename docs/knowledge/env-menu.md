---
tier: architecture
adr:
  - ADR-065
  - ADR-155
kind: env_menu
name: 环境弹窗（编排 + barrel）
category: ui
scope:
  - frontend/src/menus/env-menu.ts
source_files:
  - frontend/src/menus/env-menu.ts
invariants:
  - 环境弹窗核心 + barrel export：子文件（env-sky/ground/water/wind/cloud/fog/shadow/experimental/preset-levels）经本文件 re-export，调用方 import 路径不变
  - 道具已迁移至 scene-prop-levels.ts（舞台域），本文件不再承担道具入口
use_when:
  - 环境弹窗
  - 环境菜单
  - 环境设置入口
  - env 菜单
---

# 环境弹窗（编排 + barrel）

## 系统概览
Env Menu：环境弹窗（核心 + barrel export）。拆分后保留导航/统一面板/环境光照/粒子/入口 + barrel re-export。子文件：`env-sky-levels` / `env-ground-levels` / `env-water-levels` / `env-wind-levels` / `env-cloud-levels` / `env-fog-levels` / `env-shadow-levels` / `env-experimental-levels` / `env-preset-levels`。道具已迁移到 `scene-prop-levels.ts`（舞台域）。

## 核心职责
- `registerPopupMenu(...)` 注册 env 弹窗（wrapperKey `env-menu`）
- 子面板构建器经 `ENV_FOLDER_ROUTES` 内部引用（buildSkyLevel / buildWindLevel / buildExperimentalLevel / buildFogLevel / buildShadowLevel / buildCloudLevel / buildPresetLevel / SCENE_PRESETS），非 barrel re-export（barrel 仅 re-export `getEnvMenu`/`refreshEnvRoot`/`showEnvMenu` 与纹理绑定目标 getter/clearer）
- 环境纹理绑定目标（`getEnvTextureBindingTarget` / `setEnvTextureBindingTarget` / `clearEnvTextureBindingTarget`，已迁移到 env-menu-state）
- 经 `setEnvState`（来自 scene）驱动环境状态

## 对外 API（节选）
- `getEnvMenu()` / `showEnvMenu()`（由 menu-factory 返回）
- `SCENE_PRESETS` — 场景预设列表
- 各 `build*Level` 子面板构建器

## 关键约定
- 各子面板经 barrel re-export 保持向后兼容
- 纹理绑定目标迁移到 `env-menu-state.ts` 单独管理

## 与其他子系统关系
- 子面板实现：`env-*-levels.ts` / `env-level-helpers.ts`
- 状态写入：`scene/scene.ts`（`setEnvState`）、`scene/render/lighting.ts`（`setLightState`）
- 渲染：`render-menu.ts`；纹理绑定：`env-menu-state.ts`

## UI 入口

- 菜单层级 / 入口函数 / 快捷键统一由 [menu-map.md](./menu-map.md) 机器生成（勿手改）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）无法静态提取，缺口由本卡正文说明。
