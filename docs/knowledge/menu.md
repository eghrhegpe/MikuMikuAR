---
kind: slide_menu
name: 滑出式菜单引擎（SlideMenu）
category: ui
scope:
  - frontend/src/menus/menu.ts
source_files:
  - frontend/src/menus/menu.ts
---

## 系统概览
核心菜单引擎：`SlideMenu` 类。管理弹窗的层级栈（PopupLevel）、容器/视口/面板/头部，处理键盘导航、触屏滑动手势、过渡动画与 dispose 清理。所有 UI 控件（`slideRow`/`addSliderRow` 等）在渲染时经 `getCurrentRenderingMenu()` 自动注册到当前菜单实例。

## 核心职责
- `SlideMenu` — `levels` 栈、`container`/`viewport`/`panel`/`headerEl`、焦点索引 `focusIndex`、过渡锁 `transitioning`
- 渲染上下文栈 `_renderingStack` + `getCurrentRenderingMenu()` — 供 ui-helpers 控件函数自动注册到当前菜单
- 资源清理：`_pendingTimeouts`（cancelAnims 清除）、`_keydownHandler`、`_swipe*Touch*Handler` 在 dispose 释放，避免监听器泄漏
- RAF 去抖 `_reRenderPending`；头部额外按钮缓存 `_cachedExtraBtns` 避免每次重建
- 过渡时长常量（与 app.css `--menu-transition-duration` 同步）：0.15s / 0.12s

## 对外 API（节选）
- `class SlideMenu` — `push(level)` / `pop()` / `updateControls()` / `dispose()`
- `getCurrentRenderingMenu(): SlideMenu | null`

## 关键约定
- dispose 必须释放 keydown / 触摸监听器 / 未决 timeout，杜绝 HMR 与多次开关的监听器泄漏
- 过渡期间 `transitioning` 锁防止动画竞态

## 与其他子系统关系
- 控件函数来自 `core/ui-helpers`（自动注册到当前 SlideMenu）
- 状态订阅经 `core/reactivity`（`subscribe`）
- 由 `menu-factory.ts` / `menu-schema.ts` 创建的菜单实例驱动
