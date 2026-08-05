---
kind: theme_core
name: 主题纯函数叶
tier: leaf
category: core
scope:
  - frontend/src/core/theme.ts
source_files:
  - frontend/src/core/theme.ts
adr:
  - ADR-238
symbols:
  - generateTextColors
  - FONT_MAP
  - SETTINGS_FONT_RESTORE
invariants:
  - 纯函数/常量叶，零 DOM/状态依赖（仅 import core/clamp 与 core/color-helpers）
  - menus/settings-shared re-export 保持既有消费者兼容，本文件为真源
tests: []
use_when:
  - 主题
  - 文字颜色
  - 字体
  - generateTextColors
  - FONT_MAP
  - settings-shared
---

# 主题纯函数叶

## 系统概览
**主题纯函数叶**（theme.ts）。ADR-238 从 `menus/settings-shared` 下沉的主题计算纯函数/常量：切断 `core/init.ts → menus/settings-shared` 反向依赖，主题计算归 core 叶，settings-shared re-export 保持既有消费者兼容。

## 核心职责
- `theme.ts` — 文字颜色生成（基于主题色亮度）+ 字体映射常量。

## 对外 API（节选）
- `generateTextColors(hex)` — 按主题色亮度生成 `{ bright, dim, muted }` 三档文字色：暗背景（亮度≤128）文字偏亮、亮背景文字偏暗，经 `clamp01` 混合主题色与纯白。
- `FONT_MAP` — 字体选项表：`system` / `noto` / `yahei`，各带 i18n labelKey 与 css 字体栈。
- `SETTINGS_FONT_RESTORE` — 由 FONT_MAP 派生的 `key → css` 恢复映射。

## 与其他子系统关系
- 上游依赖：`core/clamp`（clamp01）、`core/color-helpers`（hexToRgb）——纯叶链。
- 消费方：`core/init.ts`（generateTextColors/SETTINGS_FONT_RESTORE）、`menus/settings-shared.ts`（re-export 兼容）、`menus/settings-system.ts`（applyUIAppearanceDom 经 settings-shared）。

## 不变量
- **纯函数**：无 DOM/状态副作用，输入 hex 输出颜色字符串，可安全用于 SSR/测试。
- **真源唯一**：本文件为字体/颜色真源，settings-shared 仅 re-export，不重复实现。
