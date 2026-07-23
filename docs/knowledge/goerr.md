---
kind: goerr
name: Go 错误翻译
category: core
scope:
  - frontend/src/core/i18n/**
source_files:
  - frontend/src/core/i18n/goerr.ts
adr:
  - ADR-117
---

## 系统概览
将 Go 端返回的 UserError 翻译为当前语言（ADR-117）。Go 端将错误编码为 `<可读msg>\n@@GOERR@@<json信封>` 格式，前端按哨兵 `@@GOERR@@` 提取 JSON 信封（含 code / params / msg），用 `t('goerr.<code>', params)` 翻译；无法解析时回退原始文本。

## 核心职责
- `goerr.ts` — Go 错误解析与国际化翻译。

## 对外 API（节选）
- `translateGoError(e)` — 将 Go 端返回的 error 翻译为当前语言，返回翻译后的字符串或原始文本。

## 内部协作
- `GoErrEnvelope` — JSON 信封接口（code / params? / msg?）。
- `toText(e)` — 将未知类型转为字符串（处理 Error / string / 含 message 的对象）。

## 与其他子系统关系
- 依赖 `t.ts` 的 `t()` 函数进行国际化翻译。
- 被 [`init.ts`](./init.md) 等需要显示 Go 错误的模块引用。