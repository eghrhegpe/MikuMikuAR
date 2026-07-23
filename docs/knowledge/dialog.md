---
kind: dialog
name: 跨平台对话框
category: core
scope:
  - frontend/src/core/dialog.ts
source_files:
  - frontend/src/core/dialog.ts
adr:
  - ADR-153
symbols:
  - showConfirm
  - showPrompt
  - showPrompt2
  - showErrorAction
  - disposeOverlay2
invariants:
  - 对话框请求串行排队，不能因并发调用覆盖 DOM 导致 Promise 永不结束
  - 关闭时恢复焦点陷阱、overlay 状态和当前 Promise
use_when:
  - 确认框、输入框、删除确认、错误详情、Android prompt
---

## 系统概览
用 CSS 模态框替代 `window.confirm` / `window.prompt`，为桌面和 Android WebView 提供统一交互。overlay 延迟创建为单例，按钮监听通过替换节点清理旧回调。

## 对外 API（节选）
- `showConfirm(title, message?)` — 返回 `Promise<boolean>`。
- `showPrompt(title, defaultValue?, placeholder?)` — 返回输入字符串或 `null`。
- `showPrompt2(opts)` — 返回双字段输入结果或 `null`。
- `showErrorAction(title, message)` — 展示可复制的错误详情。
- `disposeOverlay2()` — 清理双字段输入 overlay，供 HMR/销毁路径使用。

## 不变量
- 并发调用必须 FIFO 排队。
- Escape、取消、背景点击都必须走同一清理路径。
- 文本使用 `textContent`，不能把用户输入当 HTML 注入。

## 验证入口
- 测试：`frontend/src/__tests__/core/dialog.test.ts`（若存在）。

