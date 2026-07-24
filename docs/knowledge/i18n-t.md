---
kind: i18n_t
name: 国际化翻译函数
category: core
scope:
  - frontend/src/core/i18n/t.ts
source_files:
  - frontend/src/core/i18n/t.ts
adr:
  - ADR-059
symbols:
  - bundles
  - AVAILABLE_LANGS
  - t
invariants:
  - 单例，无状态
  - 被 ar-camera/camera/env-bridge/props/model-loader 等引用
tests: []
use_when:
  - 国际化
  - 翻译
  - 多语言
  - i18n
  - 文本本地化
---

## 系统概览
**国际化翻译函数入口**（ADR-059）。提供 `t(key, params?)` 函数，支持嵌套 key 和参数插值，
底层从 `locale.ts` 的语言状态获取当前语言，从语言包文件读取翻译文本。

## 核心职责
- `t.ts` — 翻译函数实现、key 解析、参数插值。

## 对外 API（节选）
- `t(key, params?)` — 翻译函数，支持嵌套 key 和参数插值。
- `AVAILABLE_LANGS` — 可用语言代码列表。

## 与其他子系统关系
- 语言状态：`./locale.ts`。
- 语言包：`./locales/zh-CN.ts` / `zh-TW.ts` / `en.ts` / `ja.ts` / `ko.ts`。
- 被 ar-camera/camera/env-bridge/props/model-loader/vmd-loader 等约 9 个模块直接引用。

## 不变量
- 单例，无状态。
- 翻译失败时降级为 key 本身，不抛异常。
