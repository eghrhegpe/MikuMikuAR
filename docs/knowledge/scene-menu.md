---
kind: scene_menu
name: 场景弹窗（编排 + 路由）
category: ui
scope:
  - frontend/src/menus/scene-menu.ts
source_files:
  - frontend/src/menus/scene-menu.ts
---

## 系统概览
Scene Menu：场景弹窗（核心 + barrel export）。职责：MenuStack 场景弹窗路由/入口，拆分后只保留根级 + 路由 + 动作处理。子文件：`scene-render-levels.ts`。程序化动作/LipSync 归位 `motion-procmotion-levels.ts`（动作弹窗域）；环境功能归位 `env-menu.ts`（环境弹窗域）。

## 核心职责
- `registerPopupMenu(...)` 注册 scene 弹窗（wrapperKey `scene-menu`）
- 根级路由 + 动作处理：场景序列化（`serializeScene`）、AR 截图（`takeARScreenshot` / `isARModeActive`）、撤销快照（`popUndoSnapshot` / `restoreUndoSnapshot`）、模型聚焦（`focusModel` / `setFocusedModelId`）
- 经 `setEnvState`、`SelectDir` / `SaveScreenshot` / `SaveScenePreset`（backend 代理）联动

## 对外 API（节选）
- `getSceneMenu()` / `showSceneMenu()`
- 场景动作处理（序列化 / AR 截图 / 撤销恢复）

## 关键约定
- 环境/程序化动作已拆分到各自弹窗域，本文件仅做场景根路由
- 错误经 `translateGoError` 翻译后 `showErrorToast` 呈现（可理解性）

## 与其他子系统关系
- 依赖 `scene/scene.ts`（序列化/聚焦/撤销）、`core/wails-bindings`（backend 调用）
- 子面板：`scene-render-levels.ts`、`scene-*-levels.ts`
- 错误翻译：`core/i18n/goerr`
