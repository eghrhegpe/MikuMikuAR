---
kind: shortcut_registry
name: 快捷键注册表
category: core
scope:
  - frontend/src/core/shortcut-registry.ts
source_files:
  - frontend/src/core/shortcut-registry.ts
adr: []
symbols:
  - ShortcutRegistry
  - registerShortcut
  - unregisterShortcut
invariants:
  - 快捷键 ID 唯一
tests: []
use_when:
  - 快捷键
  - 快捷键注册
  - 键盘绑定
---

## 系统概览
**快捷键注册表**。管理全局快捷键绑定，支持注册/注销/触发，提供快捷键冲突检测。

## 核心职责
- `shortcut-registry.ts` — 快捷键注册、注销、触发、冲突检测。

## 对外 API（节选）
- `registerShortcut(id, key, handler)` — 注册快捷键。
- `unregisterShortcut(id)` — 注销快捷键。
- `triggerShortcut(id)` — 触发快捷键。

## 与其他子系统关系
- 快捷键定义：`shortcut-app.ts`。
- 事件系统：`events.ts`。

## 不变量
- 快捷键 ID 唯一，重复注册报错。
- 快捷键可注销，注销后不触发。
