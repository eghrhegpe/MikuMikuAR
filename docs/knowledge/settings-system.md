---
kind: settings_system
name: 设置 — 系统页面
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/settings-system.ts
adr:
  - ADR-157
---

## 系统概览
设置页面中的「系统」页（ADR-157）。管理设置导入/导出/重置、缓存统计与清理、软件管理（Blender/MMD 路径、自定义软件添加/编辑/删除）、系统级操作。

## 核心职责
- `settings-system.ts` — 设置管理、缓存维护、软件管理 Schema 构建与弹窗层级。

## 对外 API（节选）
- `buildSettingsSystemLevel(getSettingsMenu)` — 构建系统页面的 PopupLevel。
- `setBlenderPath()` — 设置 Blender 路径。
- `setMMDPath()` — 设置 MMD 路径。
- `addCustomSoftware()` — 添加自定义软件。
- `scanSoftwareDir()` — 扫描软件目录。
- `buildSoftwareDetailLevel(softwareId, getSettingsMenu)` — 构建软件详情层级。

## 内部协作
- `buildSettingsMgmtSchema(getSettingsMenu)` — 构建设置管理 Schema（导出/导入/重置）。
- `buildCacheSchema()` — 构建缓存维护 Schema（统计各缓存占用、清除按钮）。
- `buildSoftwareListSchema(getSettingsMenu)` — 构建软件列表 Schema。
- `buildSoftwareDetailManagedSchema` / `buildSoftwareDetailAutoSchema` — 软件详情构建（托管/自动识别两种模式）。
- `buildSystemSchema(getSettingsMenu)` — 组装系统页面 Schema。
- `sanitizeImportedSettings(parsed)` — 导入设置时进行清洗与校验。
- `exportSettings()` / `importSettings()` / `resetAllSettings()` — 设置导出/导入/重置。

## 与其他子系统关系
- 依赖 `wails-bindings` 的缓存清理与软件操作。
- 依赖 [`settings-actions`](./settings-actions.md) 的 `SETTINGS_ACTIONS` 动作分发。
- 依赖 `render-menu` 渲染菜单 Schema。