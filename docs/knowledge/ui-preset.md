---
kind: ui_preset
name: 预设面板复合组件
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/ui-preset.ts
adr: []
---

## 系统概览
收敛 env 面板中 5 处手写 chip 组与 3 处手写清除行的重复拼接逻辑。提供 `buildPresetChipGroup` 渲染一组预设芯片，`addClearRow` 渲染一行右对齐清除按钮。

## 核心职责
- `ui-preset.ts` — 预设芯片组构建、清除行渲染。

## 对外 API（节选）
- `PresetChipItem` — 单个预设芯片描述（label / onClick / isActive? / wrap?）。
- `buildPresetChipGroup(container, items, opts?)` — 渲染一组 preset-chip，支持初始高亮与自更新同步（isActive 回调），可选 paddingBottom 与 className。
- `addClearRow(container, hasValue, onClear, label?, testId?)` — 渲染一行右对齐清除按钮，仅在 hasValue 为真时渲染。

## 与其他子系统关系
- 依赖 `ui-collapsible` 的 `addPresetChip` 渲染单个芯片按钮。
- 被 env 面板等需要预设选择的 UI 引用。