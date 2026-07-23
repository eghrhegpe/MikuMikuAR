---
kind: status_bar
name: 状态栏与提示系统
category: core
scope:
  - frontend/src/core/status-bar.ts
source_files:
  - frontend/src/core/status-bar.ts
adr:
  - ADR-153
symbols:
  - setStatus
  - showHint
  - hideHint
  - applyHudVisibility
  - disposeStatusBar
  - initHints
invariants:
  - 新状态到来时取消旧的隐藏与淡出定时器
  - HMR 或销毁时清理所有 timer 与 hint listener
use_when:
  - 状态栏、HUD、FPS 显示、鼠标提示、加载反馈、状态淡出
---

## 系统概览
管理顶部状态栏、菜单 hover hint 以及 FPS/运行时徽标的显隐。状态文本支持成功/普通两种颜色、自动淡出、hint 临时覆盖和屏幕阅读器播报。

## 对外 API（节选）
- `setStatus(text, ok, hold?)` — 写入状态并按成功/失败设置淡出时长。
- `showHint(text)` / `hideHint()` — 临时保存并恢复状态栏内容。
- `applyHudVisibility()` — 根据 `uiState` 应用 FPS 与 runtime badge 显隐。
- `initHints()` — 绑定 `[data-hint]` 元素的 hover 提示。
- `disposeStatusBar()` — 清理定时器和 hint 监听器。

## 不变量
- 状态文本为空时隐藏状态栏容器，避免残留空黑框。
- hint 活跃时不覆盖原状态；隐藏 hint 后恢复原文案和颜色。

## 验证入口
- 测试：状态栏当前主要由菜单与初始化流程间接覆盖。

