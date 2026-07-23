---
kind: toast
name: Toast 通知系统
category: core
scope:
  - frontend/src/core/toast.ts
source_files:
  - frontend/src/core/toast.ts
symbols:
  - showToast
  - showErrorToast
  - showInfoToast
  - ToastAction
invariants:
  - 同时最多显示 5 条通知，淘汰最早项并清理定时器
  - 错误通知使用 assertive aria live；详情文本使用 textContent
use_when:
  - 错误提示、信息提示、复制错误、撤销按钮、toast
---

## 系统概览
轻量 DOM Toast 通知层，支持错误/信息两种变体、详情复制、操作按钮和自动淡出。它是状态栏之外的短时反馈出口。

## 对外 API（节选）
- `showToast(title, detail?, actions?, duration?, variant?)` — 创建通用通知。
- `showErrorToast(...)` — 创建错误通知。
- `showInfoToast(...)` — 创建信息通知。
- `ToastAction` — 定义按钮文案与回调。

## 不变量
- 可见通知数不超过 `MAX_VISIBLE_TOASTS`。
- 自动淡出、手动关闭和操作按钮都必须移除对应定时器与 DOM 状态。
- 用户可见文案由调用方传入已翻译文本，复制按钮使用 i18n。

## 验证入口
- 测试：Toast 当前主要由 UI 调用链间接覆盖。

