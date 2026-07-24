---
kind: sw_register
name: Service Worker 注册
category: core
scope:
  - frontend/src/core/sw-register.ts
source_files:
  - frontend/src/core/sw-register.ts
adr: []
symbols:
  - registerSW
invariants:
  - PWA 支持
tests: []
use_when:
  - Service Worker
  - PWA
  - 离线缓存
  - sw 注册
---

## 系统概览
**Service Worker 注册模块**。在浏览器模式下注册 Service Worker，提供离线缓存能力。

## 核心职责
- `sw-register.ts` — Service Worker 注册、更新检测。

## 对外 API（节选）
- `registerServiceWorker(enabled)` — 注册 Service Worker。

## 与其他子系统关系
- 运行时模式：`./runtime-mode.ts`（浏览器模式检测）。
- 初始化：`./init.ts`（启动时注册）。

## 不变量
- Service Worker 只在浏览器模式（非 Wails）下注册。
- 更新检测与 Service Worker 的 `skipWaiting()` 配合。
