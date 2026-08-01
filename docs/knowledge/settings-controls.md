---
tier: leaf
kind: settings_controls
name: 设置 — 操控页面
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/settings-controls.ts
adr:
  - ADR-157
symbols:
  - buildCameraSchema
  - buildSettingsControlsLevel
invariants:
  - 快捷键编辑支持可交互式按键绑定，显示冲突检测
  - 快捷键绑定修改后经 shortcut-registry 持久化
  - buildCameraSchema 构建灵敏度/反转Y轴/自动居中 UI
tests: []
use_when:
  - 设置操控
  - 快捷键编辑
  - 相机设置
---

# 设置 — 操控页面

## 系统概览
设置页面中的「操控」页（ADR-157）。管理相机控制（灵敏度、反转 Y 轴、自动居中）、快捷键编辑（可交互式按键绑定，支持自定义覆盖）等操控相关设置。

## 核心职责
- `settings-controls.ts` — 相机设置、快捷键编辑 UI 的 Schema 构建与弹窗层级。

## 对外 API（节选）
- `buildSettingsControlsLevel(getSettingsMenu)` — 构建操控页面的 PopupLevel。

## 内部协作
- `buildCameraSchema()` — 构建相机设置 Schema（灵敏度滑块、反转 Y 轴开关、自动居中开关）。
- `buildShortcutsSchema(getSettingsMenu)` — 构建快捷键编辑 Schema（按分组列出快捷键，支持点击重新绑定，显示冲突检测）。
- `buildControlsSchema(getSettingsMenu)` — 组装操控页面 Schema。

## 与其他子系统关系
- 依赖 `scene/camera/camera` 的 `refreshCameraUserSettings` 应用相机设置。
- 依赖 `shortcut-registry`（[应用快捷键定义](./shortcut-app.md)）的快捷键注册表。
- 依赖 `render-menu` 渲染菜单 Schema。