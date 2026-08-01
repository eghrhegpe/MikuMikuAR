---
tier: leaf
kind: plaza_thumbnail
name: 模型广场 UI 辅助函数
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/plaza-thumbnail.ts
adr:
  - ADR-087
symbols:
  - _plazaBtn
  - _plazaSectionHeader
invariants:
  - 纯 UI 辅助函数，无业务逻辑
  - _plazaBtn 支持 innerHTML 内容、className、title 参数
tests: []
use_when:
  - 广场 UI
  - 按钮工厂
  - 节头部
---

## 系统概览
从 `plaza-browser.ts` 拆出的纯 UI 辅助函数，提供按钮工厂与节头部组件。用于模型广场页面的 UI 构建。

## 核心职责
- `plaza-thumbnail.ts` — 按钮创建、节头部组件。

## 对外 API（节选）
- `_plazaBtn(html, onClick, className?, title?)` — 创建 `plaza-btn` 样式按钮，支持 innerHTML 内容与点击回调。
- `_plazaSectionHeader(titleHtml, ...actions)` — 创建 `plaza-section-header` 节头部，包含标题与操作栏。

## 与其他子系统关系
- 被 `plaza-browser` 等广场 UI 模块引用。