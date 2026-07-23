---
kind: events
name: 事件处理与导航系统
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/events.ts
adr: []
---

## 系统概览
全局事件处理中枢：注册键盘/鼠标/Wails 事件、管理导航按钮映射、处理拖放导入、更新通知弹窗。涵盖 500+ 行事件注册逻辑，是 UI 交互与后端通信的桥梁。

## 核心职责
- `events.ts` — 全局事件注册、导航映射、弹窗管理、拖放导入、更新通知。

## 对外 API（节选）
- `registerEventHandlers()` — 注册全局事件监听（键盘、鼠标、Wails 事件、拖放）。
- `disposeEventHandlers()` — 释放所有已注册的事件处理器。
- `toggleOverlay(id, showFn)` — 切换弹窗显示状态，含过渡动画等待。
- `buildNavMaps()` — 构建导航按钮映射（navActions / navLabels）。
- `initDropHandler()` — 初始化拖放导入处理。
- `showUpdateToast(latest, url)` — 显示更新通知弹窗。

## 内部协作
- `_toggleOverlays()` — 批量关闭所有弹窗。
- `handleDropFile(path)` — 处理拖放文件的导入逻辑。
- `navActions` / `navLabels` — 导航按钮映射表，被 `shortcut-app.ts` 消费。

## 与其他子系统关系
- 依赖 [`shortcut-registry`](./shortcut-app.md) 获取快捷键列表。
- 依赖 `menus/library` 弹窗模型/动作库。
- 依赖 `platform` 打开外部 URL。
- 依赖 [`safe-call`](./safe-call.md) 安全执行异步操作。