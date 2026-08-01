---
tier: architecture
kind: settings_shared
name: 设置共享工具
category: ui
scope:
  - frontend/src/menus/settings-shared.ts
source_files:
  - frontend/src/menus/settings-shared.ts
adr:
  - ADR-157
symbols:
  - FONT_MAP
  - SETTINGS_FONT_RESTORE
  - SettingsMenuHandle
  - THEME_PRESETS
  - applyUIAppearanceDom
  - formatBytes
  - generateTextColors
  - getAutoImportCached
  - getDownloadWatchEnabledCached
  - preloadAutoImportState
  - preloadDownloadWatchState
  - setAutoImportCached
  - setAutoLoadCompanionAudio
  - setDownloadWatchEnabledCached
  - setTheme
  - truncatePath
invariants:
  - 默认值与 ui-state.ts 的默认值保持一致
  - applyUIAppearanceDom 将外观配置应用到 DOM（CSS 变量）
  - formatBytes 返回人类可读格式（KB/MB/GB）
  - setTheme 修改 CSS 变量，不直接操作 DOM 元素
tests: []
use_when:
  - 设置共享
  - 设置工具
  - UI 主题应用
  - 字节格式化
  - 设置默认值
---

# 设置共享工具

## 系统概览
**设置共享工具**（ADR-157）。提供所有设置子页面共用的工具函数，包括 UI 外观 DOM 应用、
字节格式化、主题默认值、UI 默认值等。

## 核心职责
- `settings-shared.ts` — 设置共享工具函数、默认值配置。

## 对外 API（节选）
- `applyUIAppearanceDom(appearance)` — 将外观配置应用到 DOM。
- `formatBytes(bytes)` — 字节数 → 人类可读格式。
- `SETTINGS_THEME_DEFAULTS` — 主题默认值。
- `SETTINGS_UI_DEFAULTS` — UI 默认值。

## 与其他子系统关系
- 被 settings-about/settings-actions/settings-controls/settings-graphics/settings-media/settings-resources/settings-system 全部引用。
- UI 状态：`@/core/state.uiState`。

## UI 入口

- 菜单层级 / 入口函数 / 快捷键统一由 [menu-map.md](./menu-map.md) 机器生成（勿手改）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）无法静态提取，缺口由本卡正文说明。
## 不变量
- 默认值与 `ui-state.ts` 的默认值保持一致。
- 主题默认值变更时需同步更新 `settings-graphics.ts` 的预设列表。
