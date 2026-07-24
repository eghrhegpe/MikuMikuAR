---
kind: icons_bundle
name: 图标聚合
category: core
scope:
  - frontend/src/core/icons.ts
  - frontend/src/core/icons-bundle.ts
source_files:
  - frontend/src/core/icons.ts
  - frontend/src/core/icons-bundle.ts
adr: []
symbols:
  - createIconifyIcon
  - getIconBundle
invariants:
  - 图标按需加载
tests: []
use_when:
  - 图标
  - 图标包
  - Iconify
  - 图标创建
---

## 系统概览
**图标聚合层**。集成 Iconify 图标库，提供按需加载和图标创建接口。

## 核心职责
- `icons.ts` — 图标创建、加载。
- `icons-bundle.ts` — 图标包管理。

## 对外 API（节选）
- `createIconifyIcon(name, props?)` — 创建 Iconify 图标。
- `getIconBundle()` — 取图标包。

## 与其他子系统关系
- 图标库：`@iconify/*`。
- 被 UI 组件调用。

## 不变量
- 图标按需加载：只在需要时加载图标数据。
