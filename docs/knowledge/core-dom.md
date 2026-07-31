---
kind: core_dom
name: DOM 工具
tier: leaf
category: core
scope:
  - frontend/src/core/dom.ts
source_files:
  - frontend/src/core/dom.ts
adr: []
symbols:
  - dom
  - DomRefs
  - Disposable
  - addDisposableListener
invariants:
  - addDisposableListener 返回的 Disposable 必须调用 dispose() 释放
  - dom 引用为全局单例，初始化时一次性赋值
  - dom.ts 引用了 i18n/t，非零依赖叶（与 async.ts/clamp.ts 不同）
tests: []
use_when:
  - DOM 工具
  - 事件监听
  - 可清理监听
  - DOM 引用
---

## 系统概览
**DOM 工具函数**。提供 `dom` 全局引用集合和 `addDisposableListener` 可清理事件监听，
被 events/init/shortcut-registry/menu/plaza 等约 15 个模块引用，是最核心的基础设施之一。

## 核心职责
- `dom.ts` — DOM 元素引用、可清理事件监听。

## 对外 API（节选）
- `dom` — 全局 DOM 元素引用集合（cardContainer、popupContainer 等）。
- `type DomRefs` — DOM 引类型。
- `interface Disposable` — 可清理对象接口（`dispose()` 方法）。
- `addDisposableListener(el, event, handler, options?)` — 添加可清理事件监听，返回 Disposable。

## 与其他子系统关系
- 被 events/init/shortcut-registry/menu/plaza 等约 15 个模块直接引用。
- 通过 `config.ts` barrel re-export。

## 不变量
- `addDisposableListener` 返回的 Disposable 必须调用 `dispose()` 释放，避免内存泄漏。
- `dom` 引用为全局单例，初始化时一次性赋值。
