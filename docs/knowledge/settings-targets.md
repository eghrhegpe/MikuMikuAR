---
kind: settings_targets
name: 设置目标常量
category: ui
scope:
  - frontend/src/menus/settings-targets.ts
source_files:
  - frontend/src/menus/settings-targets.ts
adr:
  - ADR-157
symbols:
  - SETTINGS_ACTION
  - SETTINGS
  - SETTINGS_RESOURCE
invariants:
  - 被 settings-actions/settings-resources/settings-system/settings 引用（约 4 次）
tests: []
use_when:
  - 设置目标
  - 设置常量
  - settings targets
  - 设置操作
---

## 系统概览
**设置目标常量**（ADR-157）。定义 SETTINGS_ACTION/SETTINGS/SETTINGS_RESOURCE 等设置操作常量，
被 settings-actions/settings-resources/settings-system/settings 约 4 个模块引用。

## 核心职责
- `settings-targets.ts` — 设置操作常量定义。

## 对外 API（节选）
- `SETTINGS_ACTION` — 设置操作目标常量。
- `SETTINGS` — 设置根常量。
- `SETTINGS_RESOURCE` — 设置资源常量。

## 与其他子系统关系
- 设置动作：`./settings-actions.ts`。
- 设置资源：`./settings-resources.ts`。
- 设置系统：`./settings-system.ts`。
- 设置主菜单：`./settings.ts`。

## 不变量
- 常量与设置主菜单的路由保持一致。
- 新设置页面需同步添加常量。
