---
kind: runtime_mode
name: 运行模式检测
category: core
scope:
  - frontend/src/core/runtime-mode.ts
source_files:
  - frontend/src/core/runtime-mode.ts
adr: []
symbols:
  - RuntimeMode
  - detectRuntimeMode
  - persistRuntimeMode
  - loadPersistedRuntimeMode
  - renderRuntimeBadge
invariants:
  - 运行模式在启动时确定
tests: []
use_when:
  - 运行模式
  - 桌面模式
  - 浏览器模式
  - 环境检测
---

## 系统概览
**运行模式检测模块**。检测当前运行环境（桌面 Wails / 浏览器），为分支逻辑提供依据。

## 核心职责
- `runtime-mode.ts` — 运行环境检测、模式暴露。

## 对外 API（节选）
- `enum RuntimeMode` — 运行模式枚举（desktop/browser）。
- `getRuntimeMode()` — 取当前运行模式。

## 与其他子系统关系
- 被 `drop-import.ts` 调用（分支路由）。
- 后端适配：`@/core/backend/*`。

## 不变量
- 运行模式在应用启动时确定，运行时不变。
- 模式检测基于 `navigator.userAgent` 和 Wails 注入标记。
