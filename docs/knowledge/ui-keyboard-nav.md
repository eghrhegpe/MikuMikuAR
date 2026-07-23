---
kind: ui_keyboard_nav
name: 键盘导航工具
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/ui-keyboard-nav.ts
adr:
  - ADR-153
---

## 系统概览
从 `menu.ts` / `ui-fullscreen-overlay.ts` 抽取的共享列表键盘导航逻辑（ADR-153 Phase 3）。支持 Arrow 键方向导航、Enter 激活、Escape 回退、循环 wrap。返回 `Disposable` 用于移除监听。

## 核心职责
- `ui-keyboard-nav.ts` — 列表键盘导航创建。

## 对外 API（节选）
- `KeyboardNavOptions` — 配置接口（selector / onEnter / onEscape / wrap）。
- `createKeyboardNav(container, options)` — 创建键盘导航监听器，返回 Disposable。
  - ArrowUp/ArrowDown/ArrowLeft/ArrowRight 移动焦点（可循环 wrap）。
  - Enter 触发 click 或自定义 onEnter 回调。
  - Escape 触发 onEscape 回调。

## 与其他子系统关系
- 依赖 `dom.ts` 的 `addDisposableListener` 注册/移除事件监听。
- 被菜单列表、全屏覆盖层等需要键盘导航的 UI 组件引用。