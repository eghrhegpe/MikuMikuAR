---
kind: settings_appearance
name: 外观设置
category: ui
scope:
  - frontend/src/menus/settings-appearance.ts
source_files:
  - frontend/src/menus/settings-appearance.ts
adr:
  - ADR-157
symbols:
  - buildAppearanceLevel
  - AppearanceConfig
invariants:
  - Schema 驱动 UI
  - UI 尺寸/主题颜色/字体/动画/屏幕控制
tests: []
use_when:
  - 外观设置
  - 主题颜色
  - UI 尺寸
  - 字体
  - 动画
  - 屏幕控制
---

## 系统概览
**外观设置页面**（ADR-157）。提供 UI 尺寸、主题颜色、字体、动画、屏幕控制等外观配置，
是 settings 主菜单的一个子页面。

## 核心职责
- `settings-appearance.ts` — 外观配置菜单 schema 定义。

## 对外 API（节选）
- `buildSettingsAppearanceLevel()` — 构建外观设置层级。

## 与其他子系统关系
- 设置主菜单：`settings.ts`（路由到本页面）。
- 设置共享工具：`./settings-shared.ts`（applyUIAppearanceDom）。
- UI 状态：`@/core/state.uiState`。
- 渲染：`render-menu.ts`。

## 不变量
- Schema 驱动 UI：所有控件定义在 `MenuNode[]` 中。
- 外观配置与 `ui-state.ts` 的默认值保持一致。
