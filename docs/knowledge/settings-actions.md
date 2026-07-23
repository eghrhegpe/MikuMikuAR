---
kind: settings_actions
name: 设置动作映射表
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/settings-actions.ts
adr:
  - ADR-157
---

## 系统概览
设置动作映射表（ADR-157：从 `settings-paths` 抽出）。集中管理 target→handler 映射，替代原 `handleSettingsAction` 的 switch 链。各设置页直接调用 `SETTINGS_ACTIONS[target]()`，不再构造假 PopupRow 套娃。

## 核心职责
- `settings-actions.ts` — 设置项点击动作分发、缓存清除、路径选择、语言切换。

## 对外 API（节选）
- `SETTINGS_ACTIONS` — 动作映射表，key 为 `SETTINGS_ACTION` 枚举值，value 为处理函数。覆盖：清除解压缓存、清除缩略图缓存、清除全部缓存、选择资源根目录、各路径覆盖选择。
- `handleSettingsAction(row, menu?)` — 全局设置项点击分发：`lang:*` 前缀触发语言切换并重建菜单，其余查 `SETTINGS_ACTIONS` 表分发。

## 与其他子系统关系
- 依赖 `settings-targets` 的 `SETTINGS_ACTION` 枚举。
- 依赖 `wails-bindings` 的缓存清理函数。
- 依赖 `i18n/locale` 的语言切换。
- 被 `settings.ts` 的 `onItemClick` 调用。