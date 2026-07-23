---
kind: settings_about
name: 设置 — 关于页面
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/settings-about.ts
adr:
  - ADR-157
---

## 系统概览
设置页面中的「关于」页（ADR-157 瘦身后：仅版本信息 / 链接 / 更新）。版本信息从 Go 后端 `GetBuildInfo` 获取，链接为 GitHub 仓库 / 许可证 / 问题反馈，更新支持自动检查与手动触发。

## 核心职责
- `settings-about.ts` — 关于页面的 Schema 构建与弹窗层级。

## 对外 API（节选）
- `buildSettingsAboutLevel(getSettingsMenu)` — 构建关于页面的 PopupLevel。

## 内部协作
- `buildAboutSchema(getSettingsMenu)` — 构建关于页面的 MenuNode 数组（版本信息卡 / 链接卡 / 更新卡）。

## 与其他子系统关系
- 依赖 `wails-bindings` 的 `GetBuildInfo` / `CheckForUpdate` / `SetUIAutoUpdate`。
- 依赖 `platform` 的 `openExternalURL` 打开外部链接。
- 依赖 `render-menu` 渲染菜单 Schema。