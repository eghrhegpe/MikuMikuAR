---
kind: color_helpers
name: 颜色工具函数
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/color-helpers.ts
adr: []
---

## 系统概览
收敛颜色相关的散落实现，提供 Babylon.js `Color3` 构造、十六进制颜色解析、CSS 颜色字符串转换的统一入口。替代 `new Color3(arr[0], arr[1], arr[2])` 散点模式与各模块手写 hex 解析。

## 核心职责
- `color-helpers.ts` — 颜色三元组构造、hex 解析、CSS 字符串转换。

## 对外 API（节选）
- `col3FromTriple(t)` — 从 `[r, g, b]` 三元组构造 `Color3`，索引缺失时回退 0。
- `hexToRgb(hex)` — 将 `#rrggbb` 解析为 `{r, g, b}`（0–255），非法输入回退主题默认色 74,108,247。
- `rgbToString(rgb)` — 将 `{r,g,b}` 转为 CSS `"r, g, b"` 字符串（供 `--accent-rgb` 等 CSS 变量）。
- `rgbString(c)` — 将 `Color3` 转为 CSS `rgb(r, g, b)` 字符串（0–255 整数）。

## 与其他子系统关系
- 被 [`init.ts`](./init.md)、`settings-shared.ts` 等模块引用，是主题色解析的唯一实现。