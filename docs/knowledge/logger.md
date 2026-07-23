---
kind: logger
name: 轻量日志工具
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/logger.ts
adr:
  - ADR-141
---

## 系统概览
无依赖的轻量日志模块，从 `utils.ts` 拆分而来（ADR-141），消除 state ↔ utils 循环依赖。为所有模块提供统一标签格式的三级日志（info / warn / error），各模块应通过此文件导入日志函数，而非从 `utils.ts` 导入。

## 核心职责
- `logger.ts` — 统一标签格式的 info / warn / error 日志。

## 对外 API（节选）
- `logInfo(tag, message, ...args)` — info 级别日志（走 `console.info`）。
- `logWarn(tag, message, err?)` — warn 级别日志（走 `console.warn`），err 可选。
- `logError(tag, message, err?)` — error 级别日志（走 `console.error`），err 可选。

## 与其他子系统关系
- 被 `safe-call.ts` 等依赖，是项目内日志记录的唯一入口。