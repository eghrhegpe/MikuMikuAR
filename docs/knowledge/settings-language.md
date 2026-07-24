---
kind: settings_language
name: 语言设置
category: ui
scope:
  - frontend/src/menus/settings-language.ts
source_files:
  - frontend/src/menus/settings-language.ts
adr:
  - ADR-157
symbols:
  - buildSettingsLanguageLevel
  - AVAILABLE_LANGS
invariants:
  - 被 settings.ts 引用
tests: []
use_when:
  - 语言设置
  - 多语言
  - i18n 设置
  - 语言切换
---

## 系统概览
**语言设置页面**（ADR-157）。提供语言切换 UI（简体中文/繁体中文/英文/日文/韩文），
被 settings.ts 引用。

## 核心职责
- `settings-language.ts` — 语言选择菜单 schema 定义。

## 对外 API（节选）
- `buildSettingsLanguageLevel()` — 构建语言设置层级。
- `AVAILABLE_LANGS` — 可用语言列表。

## 与其他子系统关系
- 设置主菜单：`settings.ts`（路由到本页面）。
- 语言状态：`@/core/i18n/locale.ts`。
- 渲染：`render-menu.ts`。

## 不变量
- 语言列表与 `i18n/locales/` 目录同步。
- 语言切换立即生效，无需重启。
