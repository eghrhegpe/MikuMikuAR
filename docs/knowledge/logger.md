---
kind: logger
name: 轻量日志工具（无依赖）
category: core
scope:
  - frontend/src/core/logger.ts
source_files:
  - frontend/src/core/logger.ts
adr:
  - ADR-141
---

## 系统概览
无依赖的轻量日志工具，从 `utils.ts` 拆分而来（ADR-141），专门消除 `state ↔ utils` 的循环依赖。所有模块应统一经本文件导入日志函数，而非从 `utils.ts` 取，从而保证标签格式一致、且不反向拉入状态模块。

## 核心职责
- `logInfo(tag, message, ...args)` — 统一 `[tag] message` 前缀，走 `console.info`
- `logWarn(tag, message, err?)` — 走 `console.warn`；`err` 为空时不传第二参数，避免打印 `undefined`
- `logError(tag, message, err?)` — 走 `console.error`

## 对外 API（节选）
- `logInfo(tag: string, message: string, ...args: unknown): void`
- `logWarn(tag: string, message: string, err?: unknown): void`
- `logError(tag: string, message: string, err?: unknown): void`

## 关键约定
- 前缀格式固定为 `[tag] message`，`message` 为空时退化为 `[tag]`
- `warn`/`error` 的 `err` 为 `undefined` 时不传入，避免控制台出现多余的 `undefined`

## 与其他子系统关系
- 被全模块引用（统一日志出口）
- 由 ADR-141 从 `utils.ts` 剥离，切断与 `state.ts` 的循环依赖
