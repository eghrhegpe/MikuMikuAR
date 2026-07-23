---
kind: settings_menu
name: 设置页路由与编排
category: ui
scope:
  - frontend/src/menus/settings.ts
source_files:
  - frontend/src/menus/settings.ts
adr:
  - ADR-157
---

## 系统概览
Settings：设置页路由 + barrel re-export。ADR-157 信息架构重组为 7 分类（外观/画面/操控/资源/媒体/系统/关于）。各子页面实现在 `settings-*.ts` 子模块中，本文件负责菜单注册、路由表、re-export 公开符号。

## 核心职责
- `registerPopupMenu(...)` 注册 settings 弹窗（wrapperKey `settings-menu`、popupType `settings`、overlayClass `sceneOverlay-settings`）
- 子页面构建器导入：`buildSettingsAppearanceLevel` / `buildSettingsGraphicsLevel` / `buildSettingsControlsLevel` / `buildSettingsResourcesLevel` / `buildSettingsMediaLevel` / `buildSettingsSystemLevel` / `buildSettingsAboutLevel`
- `handleSettingsAction` — 设置内动作处理
- 向后兼容 re-export：`refreshLibrary`（来自 library）、`isAutoLoadCompanionAudioEnabled`（已迁移到 core/state）、`preloadAutoImportState` 等

## 对外 API（节选）
- `getSettingsMenu()` / `refreshSettingsRoot()` / `showSettings()`
- `handleSettingsAction(...)`

## 关键约定
- 7 分类信息架构（ADR-157）作为路由表单一来源
- re-export 保持外部 API 不变，子模块实现内聚

## 与其他子系统关系
- 子页面实现：`settings-appearance/graphics/controls/resources/media/system/about.ts`
- 依赖 `menu-factory.ts`（注册）、`settings-targets.ts`（SETTINGS 路由表）、`settings-shared.ts`
- 状态读写经 `core/state` / `core/config`
