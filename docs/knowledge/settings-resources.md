---
kind: settings_resources
name: 设置 — 资源页面
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/settings-resources.ts
adr:
  - ADR-157
---

## 系统概览
设置页面中的「资源」页（ADR-157）。管理存储设置（私有/共享目录切换）、库设置（排序方式、显示名优先级、材质分类映射）、路径覆盖（各类资源的默认路径覆盖）、下载监听（监听目录、自动导入开关）。

## 核心职责
- `settings-resources.ts` — 存储、库、路径、监听设置的 Schema 构建与弹窗层级。

## 对外 API（节选）
- `buildSettingsResourcesLevel(getSettingsMenu)` — 构建资源页面的 PopupLevel。

## 内部协作
- `buildStorageSchema(getSettingsMenu)` — 构建存储 Schema（Android 存储模式选择）。
- `buildLibrarySchema(getSettingsMenu)` — 构建库设置 Schema（排序方式、显示名优先级、材质分类映射 CRUD）。
- `buildOverrideSchema()` — 构建路径覆盖 Schema（各资源类型的目录覆盖选择）。
- `buildWatchSchema(getSettingsMenu)` — 构建下载监听 Schema（监听目录选择 / 自动导入开关）。
- `buildResourcesSchema(getSettingsMenu)` — 组装资源页面 Schema。

## 与其他子系统关系
- 依赖 `library-core` 的存储模式切换与库刷新。
- 依赖 `settings-actions` 的 `SETTINGS_ACTIONS` 动作分发。
- 依赖 `wails-bindings` 的后端操作。