---
kind: locale
name: 国际化语言状态
category: core
scope:
  - frontend/src/core/i18n/**
source_files:
  - frontend/src/core/i18n/locale.ts
adr:
  - ADR-059
---

## 系统概览
i18n 语言状态管理层（ADR-059）：signal + localStorage 持久化。模块加载时即从 localStorage 读取语言偏好，确保菜单首帧即正确。`reactive` 使任意赋值自动触发菜单刷新。

## 核心职责
- `locale.ts` — 语言读取/切换/持久化、语言清单声明。

## 对外 API（节选）
- `LangCode` — 支持的语言代码联合类型（'zh-CN' | 'en' | 'ja' | 'ko' | 'zh-TW'）。
- `SUPPORTED_LANGS` — 规划支持的语言清单（与 DanceXR 对齐：简/繁中、英、日、韩）。
- `getLang()` — 获取当前语言。
- `setLang(lang)` — 切换语言：持久化到 localStorage + 更新 `<html lang>` + `scheduleRefresh()` 刷新菜单。
- `initI18n()` — 启动期初始化：同步 `<html lang>` 属性。

## 注意
- `SUPPORTED_LANGS` 是规划清单，真正可切换的语言由 `t.ts` 的 `AVAILABLE_LANGS`（有 bundle 的语言）决定。

## 与其他子系统关系
- 依赖 `reactivity.ts` 的 `reactive` 与 `scheduleRefresh`。
- 被 `t.ts` 引用以确定当前语言。