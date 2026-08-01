---
tier: architecture
kind: motion_detail_ui
name: 动作详情 UI
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/motion-detail-ui.ts
adr: []
symbols:
  - buildLayerLevel
  - buildMotionDetailLevel
  - buildMotionToolsLevel
  - buildPlaybackSpeedLevel
  - syncPlaybackSpeedToRuntime
invariants:
  - 依赖 motion-intent 获取场景动作列表
  - Schema 驱动 UI，经声明式 MenuNode 构建
tests: []
use_when:
  - 动作详情
  - 图层管理
  - 播放速度
---

## 系统概览
场景级动作的详情 UI 层。构建动作详情层级（`buildMotionDetailLevel`）、图层层级（`buildLayerLevel`）、工具层级（`buildMotionToolsLevel`）以及播放速度层级（`buildPlaybackSpeedLevel`）。管理场景动作的播放状态、图层参数、删除等操作。

## 核心职责
- `motion-detail-ui.ts` — 动作详情、图层管理、工具菜单、播放速度控制。

## 对外 API（节选）
- `buildLayerLevel(layerId, id)` — 构建动作图层参数编辑层级。
- `buildMotionDetailLevel(sceneMotionId?)` — 构建动作详情层级（播放状态、速度、图层列表、删除）。
- `buildMotionToolsLevel(sceneMotionId)` — 构建动作工具层级。
- `syncPlaybackSpeedToRuntime(runtime)` — 同步播放速度到运行时。
- `buildPlaybackSpeedLevel()` — 构建播放速度选择层级。

## 与其他子系统关系
- 依赖 `motion-intent` 获取场景动作列表。
- 依赖 `render-menu` 渲染菜单 Schema。
- 依赖 `motion-popup` 获取动作菜单引用。

## UI 入口

- 入口函数：`buildPlaybackSpeedLevel()`（菜单文件见 [menu-map.md](./menu-map.md) 入口一览）
- 菜单层级 / 静态骨架由 [menu-map.md](./menu-map.md) 机器生成（勿手改）；运行时动态入口以本节为准。
